#!/usr/bin/env node

import { access, readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const decoder = new TextDecoder('windows-1251', { fatal: true });
const REQUIRED_BLOCKS = [
  'BLK_LVER', 'BLK_MPSZ', 'BLK_MHDR', 'BLK_MDSC', 'BLK_SDSC', 'BLK_ADSC',
  'BLK_TDSC', 'BLK_CGRP', 'BLK_SENV', 'BLK_WTHR', 'BLK_DOOR', 'BLK_LFLS',
];

class LvlFormatError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'LvlFormatError';
  }
}

class Reader {
  constructor(bytes, file, section) {
    this.bytes = bytes;
    this.file = file;
    this.section = section;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }

  require(size, field) {
    if (this.offset + size > this.bytes.byteLength) {
      throw new LvlFormatError(this.file, `${this.section}.${field} at ${this.offset} needs ${size} bytes; ${this.bytes.byteLength - this.offset} remain`);
    }
  }

  u16(field) {
    this.require(2, field);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  i16(field) {
    this.require(2, field);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(field) {
    this.require(4, field);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  i32(field) {
    this.require(4, field);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32(field) {
    this.require(4, field);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  string(field) {
    const byteLength = this.u32(`${field}.length`);
    this.require(byteLength, field);
    const value = decoder.decode(this.bytes.subarray(this.offset, this.offset + byteLength));
    this.offset += byteLength;
    return value;
  }

  finish() {
    if (this.offset !== this.bytes.byteLength) {
      throw new LvlFormatError(this.file, `${this.section} has ${this.bytes.byteLength - this.offset} unconsumed bytes`);
    }
  }
}

function frameBlocks(bytes, file) {
  const reader = new Reader(bytes, file, 'file');
  const blocks = new Map();
  const order = [];

  while (reader.offset < bytes.byteLength) {
    reader.require(12, 'block header');
    const id = new TextDecoder('ascii', { fatal: true }).decode(bytes.subarray(reader.offset, reader.offset + 8));
    reader.offset += 8;
    const byteLength = reader.u32(`${id}.length`);
    reader.require(byteLength, `${id}.payload`);
    if (blocks.has(id)) {
      throw new LvlFormatError(file, `duplicate ${id} block`);
    }
    const payload = bytes.subarray(reader.offset, reader.offset + byteLength);
    reader.offset += byteLength;
    blocks.set(id, payload);
    order.push({ id, byteLength });
  }

  const missing = REQUIRED_BLOCKS.filter((id) => !blocks.has(id));
  if (missing.length > 0) {
    throw new LvlFormatError(file, `missing required blocks: ${missing.join(', ')}`);
  }
  return { blocks, order };
}

function parseFixedBytes(blocks, id, expectedSize, file) {
  const block = blocks.get(id);
  if (block.byteLength !== expectedSize) {
    throw new LvlFormatError(file, `${id} is ${block.byteLength} bytes; expected ${expectedSize}`);
  }
  return new Reader(block, file, id);
}

function parseVersion(blocks, file) {
  const reader = parseFixedBytes(blocks, 'BLK_LVER', 4, file);
  const version = { minor: reader.u16('minor'), major: reader.u16('major') };
  reader.finish();
  return version;
}

function parseMapSize(blocks, file) {
  const reader = parseFixedBytes(blocks, 'BLK_MPSZ', 8, file);
  const mapSize = { width: reader.u32('width'), height: reader.u32('height') };
  reader.finish();
  return mapSize;
}

function parseMaskHeader(blocks, file, maskCount) {
  const reader = new Reader(blocks.get('BLK_MHDR'), file, 'BLK_MHDR');
  const width = reader.u32('width');
  const height = reader.u32('height');
  const chunkCount = width * height;
  const tileCount = chunkCount * 4;
  const expectedSize = 8 + tileCount * 6;
  if (!Number.isSafeInteger(expectedSize) || expectedSize !== reader.bytes.byteLength) {
    throw new LvlFormatError(file, `BLK_MHDR is ${reader.bytes.byteLength} bytes; ${width}×${height} chunks require ${expectedSize}`);
  }

  const terrainCounts = new Map();
  const flagCounts = new Map();
  const maskIndexes = new Set();
  let activeMaskCount = 0;
  let inactiveIndexedCount = 0;
  let boundaryCount = 0;
  for (let index = 0; index < tileCount; index += 1) {
    const terrain = reader.u16(`tile[${index}].terrain`);
    const flags = reader.u16(`tile[${index}].flags`);
    const maskIndex = reader.i16(`tile[${index}].maskIndex`);
    const active = (terrain & 1) !== 0;
    terrainCounts.set(terrain, (terrainCounts.get(terrain) ?? 0) + 1);
    flagCounts.set(flags, (flagCounts.get(flags) ?? 0) + 1);
    if (active) {
      if (maskIndex < 0 || maskIndex >= maskCount) {
        throw new LvlFormatError(file, `BLK_MHDR tile ${index} has active mask index ${maskIndex}; expected 0..${maskCount - 1}`);
      }
      maskIndexes.add(maskIndex);
      activeMaskCount += 1;
      if ((terrain & 2) !== 0) boundaryCount += 1;
    } else if (maskIndex !== -1) {
      inactiveIndexedCount += 1;
    }
  }
  reader.finish();

  return {
    width,
    height,
    chunkCount,
    tileCount,
    activeMaskCount,
    inactiveIndexedCount,
    boundaryCount,
    maskIndexes: [...maskIndexes].sort((a, b) => a - b),
    terrain: Object.fromEntries([...terrainCounts].sort(([a], [b]) => a - b)),
    flags: Object.fromEntries([...flagCounts].sort(([a], [b]) => a - b)),
  };
}

function parseMaskDescriptions(blocks, file) {
  const reader = new Reader(blocks.get('BLK_MDSC'), file, 'BLK_MDSC');
  const count = reader.u32('count');
  const typeCounts = new Map();
  const resourceIndexes = new Set();
  let invalidResourceIndexCount = 0;
  for (let index = 0; index < count; index += 1) {
    const type = reader.u32(`record[${index}].type`);
    const resourceIndex = reader.i32(`record[${index}].resourceIndex`);
    reader.i32(`record[${index}].x`);
    reader.i32(`record[${index}].y`);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    if (resourceIndex < 0) {
      invalidResourceIndexCount += 1;
    } else {
      resourceIndexes.add(resourceIndex);
    }
  }
  reader.finish();
  return {
    count,
    types: Object.fromEntries([...typeCounts].sort(([a], [b]) => a - b)),
    resourceIndexes: [...resourceIndexes].sort((a, b) => a - b),
    invalidResourceIndexCount,
  };
}

function parseNamedDescriptions(blocks, id, file) {
  const reader = new Reader(blocks.get(id), file, id);
  const count = reader.u32('count');
  const typeCounts = new Map();
  const resourceIndexes = new Set();
  for (let index = 0; index < count; index += 1) {
    const type = reader.u16(`record[${index}].type`);
    reader.u16(`record[${index}].flags`);
    const resourceIndex = reader.u32(`record[${index}].resourceIndex`);
    reader.i32(`record[${index}].x`);
    reader.i32(`record[${index}].y`);
    reader.string(`record[${index}].name`);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    resourceIndexes.add(resourceIndex);
  }
  reader.finish();
  return {
    count,
    types: Object.fromEntries([...typeCounts].sort(([a], [b]) => a - b)),
    resourceIndexes: [...resourceIndexes].sort((a, b) => a - b),
  };
}

function parseCellGroups(blocks, file) {
  const reader = new Reader(blocks.get('BLK_CGRP'), file, 'BLK_CGRP');
  const count = reader.u32('count');
  let cellCount = 0;
  for (let index = 0; index < count; index += 1) {
    reader.string(`group[${index}].name`);
    const groupCellCount = reader.u32(`group[${index}].cellCount`);
    cellCount += groupCellCount;
    for (let cell = 0; cell < groupCellCount; cell += 1) {
      reader.u16(`group[${index}].cell[${cell}].x`);
      reader.u16(`group[${index}].cell[${cell}].y`);
    }
  }
  reader.finish();
  return { count, cellCount };
}

function parseEnvironment(blocks, file) {
  const reader = new Reader(blocks.get('BLK_SENV'), file, 'BLK_SENV');
  const header = {
    type: reader.i32('header.type'),
    param1: reader.f32('header.param1'),
    param2: reader.f32('header.param2'),
    param3: reader.f32('header.param3'),
  };
  const extraSoundCount = reader.u32('extraSoundCount');
  const music = reader.string('music');
  const dayAmbience = reader.string('dayAmbience');
  const nightAmbience = reader.string('nightAmbience');
  for (let index = 0; index < extraSoundCount; index += 1) {
    reader.string(`extraSound[${index}].path`);
    for (let field = 0; field < 8; field += 1) reader.f32(`extraSound[${index}].float[${field}]`);
    for (let field = 0; field < 4; field += 1) reader.u32(`extraSound[${index}].uint[${field}]`);
  }
  reader.finish();
  return { header, extraSoundCount, music, dayAmbience, nightAmbience };
}

function parseDoors(blocks, file) {
  const reader = new Reader(blocks.get('BLK_DOOR'), file, 'BLK_DOOR');
  const count = reader.u32('count');
  for (let index = 0; index < count; index += 1) {
    for (const field of ['sefName', 'openAction', 'closeAction', 'cellGroup', 'param1', 'staticName']) {
      reader.string(`door[${index}].${field}`);
    }
  }
  reader.finish();
  return { count };
}

function parseLevel(bytes, file) {
  const { blocks, order } = frameBlocks(bytes, file);
  const weather = parseFixedBytes(blocks, 'BLK_WTHR', 4, file);
  const levelFloors = parseFixedBytes(blocks, 'BLK_LFLS', 4, file);
  const masks = parseMaskDescriptions(blocks, file);
  const summary = {
    file,
    byteLength: bytes.byteLength,
    blocks: order,
    version: parseVersion(blocks, file),
    mapSize: parseMapSize(blocks, file),
    maskHeader: parseMaskHeader(blocks, file, masks.count),
    masks,
    statics: parseNamedDescriptions(blocks, 'BLK_SDSC', file),
    animations: parseNamedDescriptions(blocks, 'BLK_ADSC', file),
    triggers: parseNamedDescriptions(blocks, 'BLK_TDSC', file),
    cellGroups: parseCellGroups(blocks, file),
    environment: parseEnvironment(blocks, file),
    weather: { type: weather.u16('type'), intensity: weather.u16('intensity') },
    doors: parseDoors(blocks, file),
    levelFloors: levelFloors.u32('count'),
  };
  weather.finish();
  levelFloors.finish();
  return summary;
}

async function collectLevelFiles(path) {
  const info = await stat(path);
  if (info.isFile()) {
    if (extname(path).toLowerCase() !== '.lvl') throw new Error(`${path} is not an .lvl file`);
    return [path];
  }
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? collectLevelFiles(child) : extname(entry.name).toLowerCase() === '.lvl' ? [child] : [];
  }));
  return nested.flat().sort();
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function verifyReferencedAssets(levelsRoot, summary) {
  const pack = basename(summary.file, '.lvl');
  const packRoot = join(levelsRoot, 'pack', pack);
  const references = [
    ['masks', 'mask', summary.masks.resourceIndexes],
    ['static', 'static', summary.statics.resourceIndexes],
    ['animated', 'anim', summary.animations.resourceIndexes],
    ['triggers', 'trigger', summary.triggers.resourceIndexes],
  ];
  const missing = [];
  let referencedCount = 0;

  for (const [directory, prefix, indexes] of references) {
    for (const index of indexes) {
      referencedCount += 1;
      const relativePath = join('bitmaps', directory, `${prefix}_${index}.csx`);
      if (!await pathExists(join(packRoot, relativePath))) {
        missing.push(relativePath);
      }
    }
  }
  if (!await pathExists(join(packRoot, 'bitmaps', 'layer.jpg'))) {
    missing.push(join('bitmaps', 'layer.jpg'));
  }
  if (summary.animations.count > 0 && !await pathExists(join(packRoot, 'data', 'animated', `${pack}.lao`))) {
    missing.push(join('data', 'animated', `${pack}.lao`));
  }

  return { pack, referencedCount, missing };
}

function printSummary(summary) {
  const { file, version, mapSize, maskHeader, masks, statics, animations, triggers, cellGroups, doors, levelFloors, assets } = summary;
  const assetStatus = assets ? `; assets=${assets.referencedCount} references, ${assets.missing.length} missing` : '';
  console.log(`${file}: v${version.major}.${version.minor}; ${mapSize.width}×${mapSize.height}px; ${maskHeader.width}×${maskHeader.height} chunks; ${maskHeader.tileCount} terrain tiles; masks=${masks.count}; statics=${statics.count}; animations=${animations.count}; triggers=${triggers.count}; cell-groups=${cellGroups.count}/${cellGroups.cellCount} cells; doors=${doors.count}; floors=${levelFloors}${assetStatus}`);
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const positional = [];
let assetsRoot;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--json') continue;
  if (arg === '--assets-root') {
    assetsRoot = args[index + 1];
    index += 1;
    continue;
  }
  positional.push(arg);
}

if (positional.length !== 1 || args.includes('--assets-root') && !assetsRoot) {
  console.error('Usage: node tools/inspect-lvl.mjs <file-or-directory> [--assets-root <levels-directory>] [--json]');
  process.exitCode = 2;
} else {
  const files = await collectLevelFiles(resolve(positional[0]));
  const summaries = [];
  const errors = [];
  for (const file of files) {
    try {
      const summary = parseLevel(await readFile(file), file);
      if (assetsRoot) {
        summary.assets = await verifyReferencedAssets(resolve(assetsRoot), summary);
        if (summary.assets.missing.length > 0) {
          errors.push(`${file}: ${summary.assets.pack} is missing ${summary.assets.missing.join(', ')}`);
        }
      }
      summaries.push(summary);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ files: summaries, errors }, null, 2)}\n`);
  } else {
    summaries.forEach(printSummary);
    console.log(`Validated ${summaries.length}/${files.length} LVL files.`);
    errors.forEach((error) => console.error(`ERROR: ${error}`));
  }
  if (errors.length > 0) process.exitCode = 1;
}
