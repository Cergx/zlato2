#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

class CsxFormatError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'CsxFormatError';
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
      throw new CsxFormatError(this.file, `${field} at ${this.offset} needs ${byteLength} bytes; ${this.bytes.byteLength - this.offset} remain`);
    }
  }

  i32(field) {
    this.require(4, field);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u8At(offset, field) {
    if (offset >= this.bytes.byteLength) {
      throw new CsxFormatError(this.file, `${field} at ${offset} is beyond ${this.bytes.byteLength} bytes`);
    }
    return this.bytes[offset];
  }
}

function parseScanline(bytes, start, end, width, paletteSize, file, line) {
  let byteOffset = start;
  let pixelCount = 0;
  const commands = new Map();
  const add = (name) => commands.set(name, (commands.get(name) ?? 0) + 1);
  const requireBytes = (count, name) => {
    if (byteOffset + count > end) {
      throw new CsxFormatError(file, `line ${line}: ${name} at compressed byte ${byteOffset} needs ${count}; ${end - byteOffset} remain`);
    }
  };
  const requirePaletteIndex = (index, name) => {
    if (index >= paletteSize) {
      throw new CsxFormatError(file, `line ${line}: ${name} palette index ${index} exceeds ${paletteSize - 1}`);
    }
  };

  while (pixelCount < width && byteOffset < end) {
    const opcode = bytes[byteOffset++];
    switch (opcode) {
      case 105:
        pixelCount += 1;
        add('transparent');
        break;
      case 106: {
        requireBytes(2, 'run');
        const color = bytes[byteOffset++];
        const count = bytes[byteOffset++];
        if (count === 0) throw new CsxFormatError(file, `line ${line}: zero-length run`);
        requirePaletteIndex(color, 'run');
        pixelCount += Math.min(count, width - pixelCount);
        add('run');
        break;
      }
      case 107: {
        requireBytes(1, 'escaped literal');
        const color = bytes[byteOffset++];
        requirePaletteIndex(color, 'escaped literal');
        pixelCount += 1;
        add('escapedLiteral');
        break;
      }
      case 108: {
        requireBytes(1, 'transparent run');
        const count = bytes[byteOffset++];
        if (count === 0) throw new CsxFormatError(file, `line ${line}: zero-length transparent run`);
        pixelCount += Math.min(count, width - pixelCount);
        add('transparentRun');
        break;
      }
      default:
        requirePaletteIndex(opcode, 'literal');
        pixelCount += 1;
        add('literal');
        break;
    }
  }

  if (pixelCount !== width) {
    throw new CsxFormatError(file, `line ${line}: decoded ${pixelCount}/${width} pixels`);
  }
  if (byteOffset !== end) {
    throw new CsxFormatError(file, `line ${line}: ${end - byteOffset} unconsumed compressed bytes`);
  }
  return commands;
}

function parseCsx(bytes, file) {
  if (bytes.byteLength === 0) return { byteLength: 0, empty: true };
  const reader = new Reader(bytes, file);
  const paletteSize = reader.i32('paletteSize');
  if (paletteSize < 0 || paletteSize > 256) {
    throw new CsxFormatError(file, `palette size ${paletteSize} is outside 0..256`);
  }
  reader.require(4, 'fill color');
  reader.offset += 4;
  reader.require(paletteSize * 4, 'palette');
  reader.offset += paletteSize * 4;

  const width = reader.i32('width');
  const height = reader.i32('height');
  if (width <= 0 || height <= 0) {
    throw new CsxFormatError(file, `invalid dimensions ${width}×${height}`);
  }
  const indexTableStart = reader.offset;
  const indexTableBytes = (height + 1) * 4;
  reader.require(indexTableBytes, 'scanline index table');
  const lineOffsets = [];
  for (let line = 0; line <= height; line += 1) lineOffsets.push(reader.i32(`lineOffset[${line}]`));
  const compressedStart = reader.offset;
  const compressedLength = bytes.byteLength - compressedStart;
  if (lineOffsets[0] !== 0) {
    throw new CsxFormatError(file, `lineOffset[0] is ${lineOffsets[0]}, expected 0`);
  }
  if (lineOffsets.at(-1) !== compressedLength) {
    throw new CsxFormatError(file, `lineOffset[${height}] is ${lineOffsets.at(-1)}, expected compressed length ${compressedLength}`);
  }

  const commandCounts = new Map();
  for (let line = 0; line < height; line += 1) {
    const start = lineOffsets[line];
    const end = lineOffsets[line + 1];
    if (start < 0 || start > end || end > compressedLength) {
      throw new CsxFormatError(file, `invalid scanline range [${start}, ${end}) for line ${line}; compressed length ${compressedLength}`);
    }
    const commands = parseScanline(bytes.subarray(compressedStart), start, end, width, paletteSize, file, line);
    for (const [command, count] of commands) commandCounts.set(command, (commandCounts.get(command) ?? 0) + count);
  }

  return {
    byteLength: bytes.byteLength,
    paletteSize,
    width,
    height,
    indexTableOffset: indexTableStart,
    compressedLength,
    commands: Object.fromEntries([...commandCounts].sort()),
  };
}

async function collectCsxFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return extname(path).toLowerCase() === '.csx' ? [path] : [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => collectCsxFiles(`${path}/${entry.name}`)));
  return nested.flat();
}

function printSummary(file, summary) {
  if (summary.empty) {
    console.log(`${file}: empty CSX placeholder`);
    return;
  }
  const commands = Object.entries(summary.commands).map(([name, count]) => `${name}=${count}`).join(', ');
  console.log(`${file}: ${summary.width}×${summary.height}px; palette=${summary.paletteSize}; compressed=${summary.compressedLength}/${summary.byteLength} bytes; ${commands}`);
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const quiet = args.includes('--quiet');
const positional = args.filter((arg) => arg !== '--json' && arg !== '--quiet');
if (positional.length !== 1) {
  console.error('Usage: node tools/inspect-csx.mjs <file-or-directory> [--json] [--quiet]');
  process.exitCode = 2;
} else {
  const files = await collectCsxFiles(resolve(positional[0]));
  const summaries = [];
  const errors = [];
  for (const file of files) {
    try {
      const summary = parseCsx(new Uint8Array(await readFile(file)), file);
      summaries.push({ file, ...summary });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (json) process.stdout.write(`${JSON.stringify({ files: summaries, errors }, null, 2)}\n`);
  else {
    if (!quiet) summaries.forEach(({ file, ...summary }) => printSummary(file, summary));
    console.log(`Validated ${summaries.length}/${files.length} CSX files.`);
    errors.forEach((error) => console.error(`ERROR: ${error}`));
  }
  if (errors.length > 0) process.exitCode = 1;
}
