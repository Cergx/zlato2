#!/usr/bin/env node
// Generate an archive -> entry -> (size, sha256) manifest for every Burut PAK
// in the game Data directory. Used to prove which archive variant a shipped
// asset came from (base vs *.update.3.pak patch).
//
// The parser enforces the same integrity invariants as tools/inspect-pak.mjs:
// "PAK " magic, bounded directory/payload ranges, codec 0 (raw) or 1 (zlib)
// only, and decoded length equal to the directory's declared byte length.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { extname, join } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cp1251 = new TextDecoder("windows-1251", { fatal: true });

class PakFormatError extends Error {
    constructor(file, message) {
        super(`${file}: ${message}`);
        this.name = "PakFormatError";
    }
}

class Reader {
    constructor(bytes, file) {
        this.bytes = bytes;
        this.file = file;
        this.offset = 0;
    }

    require(byteLength, field) {
        if (!Number.isSafeInteger(byteLength) || byteLength < 0 || this.offset + byteLength > this.bytes.byteLength) {
            throw new PakFormatError(this.file, `${field} at ${this.offset} needs ${byteLength} bytes; ${this.bytes.byteLength - this.offset} remain`);
        }
    }

    u32(field) {
        this.require(4, field);
        const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getUint32(0, true);
        this.offset += 4;
        return value;
    }

    bytesOf(byteLength, field) {
        this.require(byteLength, field);
        const slice = this.bytes.subarray(this.offset, this.offset + byteLength);
        this.offset += byteLength;
        return slice;
    }
}

function parseDirectory(bytes, file) {
    const reader = new Reader(bytes, file);
    const magic = new TextDecoder("ascii", { fatal: true }).decode(reader.bytesOf(4, "magic"));
    if (magic !== "PAK ") throw new PakFormatError(file, `magic is ${JSON.stringify(magic)}, expected "PAK "`);
    const reserved = reader.u32("reserved");
    const count = reader.u32("entry count");
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        const pathLength = reader.u32(`entry[${index}].pathLength`);
        const path = cp1251.decode(reader.bytesOf(pathLength, `entry[${index}].path`));
        const byteLength = reader.u32(`entry[${index}].byteLength`);
        const offset = reader.u32(`entry[${index}].offset`);
        entries.push({ path, byteLength, offset });
    }
    return { reserved, count, entries };
}

function decodePayload(bytes, entry, nextOffset, file, index) {
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
    return payload;
}

function parsePak(bytes, file) {
    const { entries } = parseDirectory(bytes, file);
    const result = new Map();
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const nextOffset = index + 1 < entries.length ? entries[index + 1].offset : bytes.byteLength;
        const payload = decodePayload(bytes, entry, nextOffset, file, index);
        result.set(entry.path.toLowerCase().replace(/\\/g, "/"), { size: payload.byteLength, sha256: sha256(payload) });
    }
    return result;
}

const dataDir = process.argv[2] ?? "E:/Games/zlato22/Data";
const outPath = process.argv[3] ?? "dist/extract/pak-manifest.json";

const files = (await readdir(dataDir)).filter((name) => extname(name).toLowerCase() === ".pak").sort();
const manifest = {};
let entryTotal = 0;
for (const file of files) {
    const bytes = new Uint8Array(await readFile(join(dataDir, file)));
    const entries = parsePak(bytes, file);
    manifest[file] = Object.fromEntries(entries);
    entryTotal += entries.size;
}
await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outPath}: ${files.length} archives, ${entryTotal} entries.`);
