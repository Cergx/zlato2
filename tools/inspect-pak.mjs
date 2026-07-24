#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const cp1251 = new TextDecoder('windows-1251', { fatal: true });

class PakFormatError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'PakFormatError';
  }
}

class Reader {
  constructor(bytes, file) {
    this.bytes = bytes;
    this.file = file;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }

  require(byteLength, field) {
    if (this.offset + byteLength > this.bytes.byteLength) {
      throw new PakFormatError(this.file, `${field} at ${this.offset} needs ${byteLength}; ${this.bytes.byteLength - this.offset} remain`);
    }
  }

  u32(field) {
    this.require(4, field);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  bytesOf(byteLength, field) {
    this.require(byteLength, field);
    const value = this.bytes.subarray(this.offset, this.offset + byteLength);
    this.offset += byteLength;
    return value;
  }
}

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function parseDirectory(bytes, file) {
  const reader = new Reader(bytes, file);
  const magic = new TextDecoder('ascii', { fatal: true }).decode(reader.bytesOf(4, 'magic'));
  if (magic !== 'PAK ') throw new PakFormatError(file, `magic is ${JSON.stringify(magic)}, expected "PAK "`);
  const reserved = reader.u32('reserved');
  const count = reader.u32('entry count');
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const pathLength = reader.u32(`entry[${index}].pathLength`);
    const path = cp1251.decode(reader.bytesOf(pathLength, `entry[${index}].path`));
    const byteLength = reader.u32(`entry[${index}].byteLength`);
    const offset = reader.u32(`entry[${index}].offset`);
    entries.push({ path, byteLength, offset });
  }
  return { reserved, count, directoryEnd: reader.offset, entries };
}

function parsePayload(bytes, entry, nextOffset, file, index) {
  if (entry.offset > nextOffset || nextOffset > bytes.byteLength) {
    throw new PakFormatError(file, `entry[${index}] ${entry.path} has invalid payload range [${entry.offset}, ${nextOffset})`);
  }
  const reader = new Reader(bytes.subarray(entry.offset, nextOffset), file);
  const codec = reader.u32(`entry[${index}].codec`);
  let payload;
  if (codec === 0) {
    payload = reader.bytesOf(entry.byteLength, `entry[${index}].rawPayload`);
  } else if (codec === 1) {
    const compressedLength = reader.u32(`entry[${index}].compressedLength`);
    const compressed = reader.bytesOf(compressedLength, `entry[${index}].compressedPayload`);
    try {
      payload = inflateSync(compressed);
    } catch (error) {
      throw new PakFormatError(file, `entry[${index}] ${entry.path} has invalid zlib payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    throw new PakFormatError(file, `entry[${index}] ${entry.path} has unknown codec ${codec}`);
  }
  if (payload.byteLength !== entry.byteLength) {
    throw new PakFormatError(file, `entry[${index}] ${entry.path} decoded ${payload.byteLength} bytes; directory declares ${entry.byteLength}`);
  }
  if (reader.offset !== reader.bytes.byteLength) {
    throw new PakFormatError(file, `entry[${index}] ${entry.path} leaves ${reader.bytes.byteLength - reader.offset} bytes before the next payload`);
  }
  return { codec, payload };
}

async function inspectPak(file, compareRoot) {
  const bytes = new Uint8Array(await readFile(file));
  const directory = parseDirectory(bytes, file);
  if (directory.entries.length > 0 && directory.entries[0].offset !== directory.directoryEnd) {
    throw new PakFormatError(file, `first payload begins at ${directory.entries[0].offset}, expected directory end ${directory.directoryEnd}`);
  }

  const codecCounts = new Map();
  let compressedBytes = 0;
  let decodedBytes = 0;
  let matches = 0;
  let mismatches = 0;
  let missing = 0;
  for (let index = 0; index < directory.entries.length; index += 1) {
    const entry = directory.entries[index];
    const nextOffset = index + 1 < directory.entries.length ? directory.entries[index + 1].offset : bytes.byteLength;
    const { codec, payload } = parsePayload(bytes, entry, nextOffset, file, index);
    codecCounts.set(codec, (codecCounts.get(codec) ?? 0) + 1);
    compressedBytes += nextOffset - entry.offset;
    decodedBytes += payload.byteLength;
    if (compareRoot) {
      const diskPath = join(compareRoot, ...entry.path.split('\\'));
      try {
        const diskBytes = new Uint8Array(await readFile(diskPath));
        if (sameBytes(payload, diskBytes)) matches += 1;
        else mismatches += 1;
      } catch {
        missing += 1;
      }
    }
  }

  return {
    byteLength: bytes.byteLength,
    directory: { reserved: directory.reserved, count: directory.count, byteLength: directory.directoryEnd },
    codecs: Object.fromEntries([...codecCounts].sort(([left], [right]) => left - right)),
    payloadBytes: { stored: compressedBytes, decoded: decodedBytes },
    comparison: compareRoot ? { matches, mismatches, missing } : undefined,
  };
}

async function collectPakFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return extname(path).toLowerCase() === '.pak' ? [path] : [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => collectPakFiles(join(path, entry.name))));
  return nested.flat();
}

function printSummary(file, summary) {
  const codecs = Object.entries(summary.codecs).map(([codec, count]) => `${codec}=${count}`).join(', ');
  const comparison = summary.comparison
    ? `; compare: ${summary.comparison.matches} equal, ${summary.comparison.mismatches} different, ${summary.comparison.missing} missing`
    : '';
  console.log(`${file}: ${summary.directory.count} entries; directory=${summary.directory.byteLength} bytes; codecs=${codecs}; stored=${summary.payloadBytes.stored} bytes; decoded=${summary.payloadBytes.decoded} bytes${comparison}`);
}

const args = process.argv.slice(2);
const json = args.includes('--json');
let compareRoot;
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--json') continue;
  if (arg === '--compare-root') {
    compareRoot = args[index + 1];
    index += 1;
    continue;
  }
  positional.push(arg);
}
if (positional.length !== 1 || args.includes('--compare-root') && !compareRoot) {
  console.error('Usage: node tools/inspect-pak.mjs <file-or-directory> [--compare-root <resource-root>] [--json]');
  process.exitCode = 2;
} else {
  const files = await collectPakFiles(resolve(positional[0]));
  const summaries = [];
  const errors = [];
  for (const file of files) {
    try {
      const summary = await inspectPak(file, compareRoot && resolve(compareRoot));
      summaries.push({ file: relative(process.cwd(), file), ...summary });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (json) process.stdout.write(`${JSON.stringify({ files: summaries, errors }, null, 2)}\n`);
  else {
    summaries.forEach(({ file, ...summary }) => printSummary(file, summary));
    console.log(`Validated ${summaries.length}/${files.length} PAK files.`);
    errors.forEach((error) => console.error(`ERROR: ${error}`));
  }
  if (errors.length > 0) process.exitCode = 1;
}
