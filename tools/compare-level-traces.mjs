#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [nativePath, cleanPath] = process.argv.slice(2);
if (!nativePath || !cleanPath) {
    console.error("Usage: node tools/compare-level-traces.mjs <native.ndjson> <clean.ndjson>");
    process.exit(2);
}

const readEvents = async (path) => (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

const [nativeEvents, cleanEvents] = await Promise.all([readEvents(nativePath), readEvents(cleanPath)]);
const nativeServer = nativeEvents.find(({ event, label }) => event === "module_verified" && label === "Server.dll");
const nativeLoader = nativeEvents.find(({ event }) => event === "native_level_loader");
assert.deepEqual(nativeServer, {
    event: "module_verified",
    label: "Server.dll",
    size: 589824,
    sha256: "418e256063748f2e90db35ae7c6abe6eac401fb86908cb5f27ebf565a21cc837",
});
assert.deepEqual(nativeLoader, {
    event: "native_level_loader",
    slotOffset: 40,
    value: "Server.dll+0x33214",
});
const nativeDimensions = nativeEvents.find(({ event }) => event === "native_level_dimensions");
const nativeTransition = nativeEvents.find(({ event }) => event === "native_level_person_transition");
const nativeReload = nativeEvents.find(({ event }) => event === "native_level_person_reload");
const cleanTransition = cleanEvents.find(({ event }) => event === "clean_level_person_transition");
assert.ok(nativeDimensions, "Native level dimensions event missing");
assert.ok(nativeTransition, "Native person transition event missing");
assert.ok(nativeReload, "Native person reload event missing");
assert.ok(cleanTransition, "Clean-room person transition event missing");
assert.equal(cleanTransition.level, nativeTransition.level);
assert.deepEqual(cleanTransition.dimensions, {
    width: nativeDimensions.width,
    height: nativeDimensions.height,
});
assert.equal(cleanTransition.person, nativeTransition.person);
assert.equal(nativeTransition.nodes, 15);
assert.deepEqual(nativeEvents
    .filter(({ event, phase }) => event === "native_level_scr_node" && phase === "transition")
    .map(({ kind }) => kind), [49, 50, 48, 23, 22, 22, 50, 48, 23, 22, 50, 48, 23, 22, 22]);
assert.deepEqual(nativeEvents
    .filter(({ event, turn }) => event === "native_scr_evaluation" && turn === 1)
    .map(({ depth, kind, result }) => ({ depth, kind, result })), [
    { depth: 0, kind: 49, result: 0 },
    { depth: 1, kind: 48, result: 1 },
    { depth: 0, kind: 50, result: 1 },
    { depth: 1, kind: 48, result: 0 },
    { depth: 0, kind: 50, result: 0 },
    { depth: 1, kind: 48, result: 0 },
    { depth: 0, kind: 50, result: 0 },
]);
assert.deepEqual(nativeEvents
    .filter(({ event, phase }) => event === "native_level_scr_node" && phase === "reload")
    .map(({ kind }) => kind), [49, 50, 48, 23, 22, 22]);
assert.deepEqual(nativeEvents
    .filter(({ event, turn }) => event === "native_scr_evaluation" && turn === 2)
    .map(({ depth, kind, result }) => ({ depth, kind, result })), [
    { depth: 0, kind: 49, result: 0 },
    { depth: 1, kind: 48, result: 1 },
    { depth: 0, kind: 50, result: 1 },
]);
assert.equal(cleanTransition.beforeDelete, nativeTransition.beforeDelete);
assert.equal(cleanTransition.deleteResult, nativeTransition.deleteResult);
assert.equal(cleanTransition.afterDelete, nativeTransition.afterDelete);
assert.equal(cleanTransition.afterReload, nativeReload.result);
assert.equal(nativeReload.result, 1);
assert.equal(nativeReload.nodes, 6);

console.log(`Matched Server.dll+0x33214 ${cleanTransition.level} ${cleanTransition.dimensions.width}x${cleanTransition.dimensions.height} load and ${cleanTransition.person} native transition 1 -> delete(0) -> 0; native and browser same-level reload restore 1`);
