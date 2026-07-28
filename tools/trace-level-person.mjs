#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GameStateRuntime } from "../src/game/GameStateRuntime.ts";
import { LVLParser } from "../src/game/parsers/LVLParser.ts";
import { SEFParser } from "../src/game/parsers/SEFParser.ts";
import { WORLD_CELL_HEIGHT, WORLD_CELL_WIDTH } from "../src/game/WorldCoordinates.ts";

const assetRoot = resolve("public/assets");
globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/assets/")) return new Response(null, { status: 404 });
    try {
        const bytes = await readFile(resolve("public", `.${decodeURIComponent(url)}`));
        return new Response(bytes, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
        });
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return new Response(null, { status: 404 });
        }
        throw error;
    }
};

const level = "L1_1";
const person = "L1_1.P387_Poison_Plotnik";
const sefBytes = await readFile(resolve(assetRoot, "levels/single/l1_1/l1_1.sef"));
const sefData = new SEFParser(new TextDecoder("windows-1251").decode(sefBytes)).getData();
const lvlParser = new LVLParser(`/assets/levels/lvl/${sefData.pack}.lvl`);
await lvlParser.parse();
const lvlData = lvlParser.getData();
const dimensions = {
    width: lvlData.mapSize.width / WORLD_CELL_WIDTH,
    height: lvlData.mapSize.height / WORLD_CELL_HEIGHT,
};
assert.deepEqual(dimensions, { width: 230, height: 224 });

const runtime = new GameStateRuntime({ onLoadArea() {}, random: () => 0 });
const levelData = {
    gameMode: "single",
    levelName: level,
    image: {},
    sdbData: {},
    sefData,
    lvlData,
    laoData: [],
    levelAnimations: [],
    levelStatics: [],
    levelDoors: [],
    levelMasks: [],
    triggerCells: {},
    triggerMasks: [],
    levelPersons: [],
    player: {
        name: "hero",
        position: { x: 0, y: 0 },
        worldPosition: { x: 0, y: 0 },
        direction: "DOWN",
        sprites: {},
    },
};
await runtime.loadLevel(levelData);

assert.ok(sefData.persons.some((candidate) => candidate.name === person));
const beforeDelete = runtime.invokeHost("rs_ispersonexistsi", [level, person]);
const deleteResult = runtime.invokeHost("rs_delperson", [person]);
const afterDelete = runtime.invokeHost("rs_ispersonexistsi", [level, person]);
assert.equal(beforeDelete, 1);
assert.equal(deleteResult, 0);
assert.equal(afterDelete, 0);
assert.equal(runtime.snapshot().persons[person], false);
await runtime.loadLevel(levelData);
const afterReload = runtime.invokeHost("rs_ispersonexistsi", [level, person]);
assert.equal(afterReload, 1);

console.log(JSON.stringify({
    event: "clean_level_person_transition",
    level,
    dimensions,
    person,
    loadedPersons: sefData.persons.length,
    beforeDelete,
    deleteResult,
    afterDelete,
    afterReload,
}));
