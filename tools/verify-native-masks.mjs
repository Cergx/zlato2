#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SEFParser } from "../src/game/parsers/SEFParser.ts";
import { LVLParser } from "../src/game/parsers/LVLParser.ts";
import {
    buildNativeAlternateMaskTiles,
    findNativeOccluders,
} from "../src/game/MaskCompositorRuntime.ts";

const frameBlocks = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const blocks = new Map();
    let offset = 0;
    while (offset + 12 <= bytes.byteLength) {
        const id = new TextDecoder("ascii").decode(bytes.subarray(offset, offset + 8)).replace(/\0+$/, "");
        const size = view.getUint32(offset + 8, true);
        offset += 12;
        blocks.set(id, bytes.subarray(offset, offset + size));
        offset += size;
    }

    return blocks;
};

globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    try {
        return new Response(await readFile(`public${url}`), { status: 200 });
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return new Response(null, { status: 404 });
        }
        throw error;
    }
};

const parseMaskDescriptions = (block) => {
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const count = view.getUint32(0, true);
    return Array.from({ length: count }, (_, index) => ({
        type: view.getUint32(4 + index * 16, true),
        number: view.getInt32(8 + index * 16, true),
    }));
};

const csxDimensions = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const paletteSize = view.getInt32(0, true);
    const offset = 8 + paletteSize * 4;
    return [view.getInt32(offset, true), view.getInt32(offset + 4, true)];
};

const lvlBytes = new Uint8Array(await readFile("public/assets/levels/lvl/l1_3.lvl"));
const descriptions = parseMaskDescriptions(frameBlocks(lvlBytes).get("BLK_MDSC"));
const alternateResources = descriptions.filter(({ type }) => (type & 1) !== 0).map(({ number }) => number).sort((a, b) => a - b);
assert.deepEqual(alternateResources, [61, 62, 63, 64, 70]);
for (const number of alternateResources) {
    const [main, alternate] = await Promise.all([
        readFile(`public/assets/levels/pack/l1_3/bitmaps/masks/mask_${number}.csx`),
        readFile(`public/assets/levels/pack/l1_3/bitmaps/masks/alt/mask_${number}.csx`),
    ]);
    assert.deepEqual(csxDimensions(main), csxDimensions(alternate));
    assert.notDeepEqual(main, alternate);
}

const [sefBytes, triggerParser] = await Promise.all([
    readFile("public/assets/levels/single/l1_1/l1_1.sef"),
    (async () => {
        const parser = new LVLParser("/assets/levels/lvl/l1_1.lvl");
        await parser.parse();
        return parser;
    })(),
]);
const sef = new SEFParser(new TextDecoder("windows-1251").decode(sefBytes)).getData();
const authoredTriggerMasks = new Set(triggerParser.getData().triggerDescription.map(({ name }) => name.toLowerCase()));
const inventoryTriggers = sef.triggers.filter(({ inventoryName }) => inventoryName);
assert.ok(inventoryTriggers.length > 0);
assert.equal(inventoryTriggers.every(({ name }) => authoredTriggerMasks.has(name.toLowerCase())), true);

const inactive = { terrain: 0, flags: 0, maskIndex: -1 };
const active = (terrain, maskIndex = 0) => ({ terrain, flags: 0, maskIndex });
const header = {
    width: 2,
    height: 2,
    chunks: [
        [active(1), inactive, inactive, inactive],
        [active(3), inactive, inactive, inactive],
        [active(3), inactive, inactive, inactive],
        [inactive, inactive, inactive, inactive],
    ],
};
const masks = [{ type: 1, foreground: {}, alternateForeground: {} }];
const closedTiles = buildNativeAlternateMaskTiles(header, masks, [{ opened: false, cells: [{ x: 0, y: 0 }] }]);
const openTiles = buildNativeAlternateMaskTiles(header, masks, [{ opened: true, cells: [{ x: 0, y: 0 }] }]);
const bounds = { x: 0, y: 0, width: 24, height: 18 };
assert.deepEqual(findNativeOccluders(header, masks, bounds, 0, 0, closedTiles), [{ maskIndex: 0, alternate: true }]);
assert.deepEqual(findNativeOccluders(header, masks, bounds, 0, 0, openTiles), [{ maskIndex: 0, alternate: false }]);
assert.deepEqual(findNativeOccluders({ ...header, chunks: header.chunks.map((chunk) => chunk.map((tile) => ({ ...tile, terrain: tile.terrain & ~2 }))) }, masks, bounds, 0, 0, closedTiles), []);

console.log("Verified native type-1 alternate mask assets, closed-door switching, authored inventory-trigger masks, and two-axis boundary acceptance");
