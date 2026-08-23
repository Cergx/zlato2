#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
const { GameStateRuntime } = await vite.ssrLoadModule("/src/game/GameStateRuntime.ts");

const events = [];
const runtime = new GameStateRuntime({
    onLoadArea: (request) => events.push(["load", request]),
    onGlobalMap: () => events.push(["global-map"]),
    onDialog: (arguments_) => events.push(["dialog", arguments_]),
    onFinished: (ending) => events.push(["finished", ending]),
    onWorldMagicEffect: (name, position) => events.push(["effect", name, position]),
    random: () => 0,
});
const callHost = (name, arguments_) => runtime.invokeHost(name, arguments_);

assert.equal(callHost("rs_globalmap", []), 0);
runtime.scenario = {
    setTriggerActive: (name, active) => events.push(["trigger", name, active]),
    setTriggerVisible: (name, visible) => events.push(["visible", name, visible]),
    setDoorOpened: (name, opened) => events.push(["door", name, opened]),
};
runtime.levelData = { gameMode: "single", levelName: "L1_1" };
runtime.currentDynamicPersonLevel = "single:l1_1";
runtime.persons.set("local-person", true);
runtime.personStatesByLevel.set("single:l2", new Map([
    ["remote-dead", false],
    ["remote-alive", true],
]));
assert.equal(callHost("rs_ispersonexistsi", ["L1_1", "local-person"]), 1);
assert.equal(callHost("rs_ispersonexistsi", ["L2", "remote-dead"]), 0);
assert.equal(callHost("rs_ispersonexistsi", ["L2", "remote-alive"]), 1);
assert.equal(callHost("rs_ispersonexistsi", ["never-visited", "unknown"]), 1);
assert.equal(callHost("rs_startdialog", [42]), 0);
assert.equal(callHost("rs_settribesrelation", ["citizen", "hero", "VERY_EVIL"]), 0);
assert.equal(callHost("rs_gettribesrelation", ["citizen", "hero"]), 0);
assert.equal(callHost("rs_gettribesrelation", ["missing", "hero"]), 2);
assert.equal(callHost("rs_addexp", [125]), 0);
const minutesBeforeAddTime = runtime.getElapsedMinutes();
assert.equal(callHost("rs_addtime", [25, 0]), 0);
assert.equal(runtime.getElapsedMinutes(), minutesBeforeAddTime + 25 * 60);
assert.equal(callHost("rs_questcomplete", ["quest"]), 0);
assert.equal(callHost("rs_stageenable", ["quest", "stage"]), 0);
assert.equal(callHost("rs_stagecomplete", ["quest", "stage"]), 0);
assert.equal(callHost("rs_storylinequestenable", ["story"]), 0);
assert.equal(callHost("rs_setpersonparameteri", ["Hero", "REPUTATION", 7]), 0);
assert.equal(callHost("rs_questenable", ["disabled-quest"]), 0);
assert.equal(callHost("rs_delperson", ["removed-person"]), 0);
assert.equal(callHost("rs_enabletrigger", ["trigger", 1]), 0);
assert.equal(callHost("wd_setvisible", ["trigger", 0]), 0);
assert.equal(callHost("rs_setdoorstate", ["door", 1]), 0);
assert.equal(callHost("rs_setundeadstate", ["person", 1]), 0);
assert.equal(callHost("rs_setinjured", ["person", 1]), 0);
assert.equal(callHost("rs_addperson_1", ["STAY", "", 0, 0, 0]), 0);
assert.equal(callHost("rs_setlocationaccess", ["L1_2", 2]), 0);
assert.equal(callHost("wd_loadarea", ["L29_1", "GM"]), 0);
assert.equal(callHost("wd_loadarea", ["L1_1_1", "GM"]), 0);
assert.equal(callHost("le_casteffect", ["center", "effect_fire_small", 2811, 1355]), 0);
assert.equal(callHost("le_castmagic", ["vis_gods", 528, 585]), 0);
assert.equal(callHost("c_finished", [3]), 0);

const snapshot = runtime.snapshot();
assert.equal(snapshot.experience, 125);
assert.equal(snapshot.questFlags.quest, true);
assert.equal(snapshot.questFlags.story, false);
assert.equal(snapshot.stageFlags["quest:stage"], true);
assert.equal(snapshot.questFlags["disabled-quest"], false);
assert.equal(snapshot.persons["removed-person"], false);
assert.equal(snapshot.personStatesByLevel["single:l1_1"]["removed-person"], false);
assert.equal(snapshot.personStatesByLevel["single:l2"]["remote-dead"], false);
assert.equal(snapshot.personStatesByLevel["single:l2"]["remote-alive"], true);
assert.equal(snapshot.personParameters.Hero.reputation, 7);
assert.equal(snapshot.locationAccess.l1_2, 2);
assert.equal(snapshot.variables.l1_2_state, 2);
assert.equal(snapshot.locationAccess.l29_1, 1, "Travelling to a global-map point must discover it");
assert.equal(snapshot.variables.l29_1_state, 1, "Discovery must mirror into the authored location-state variable");
assert.equal("l1_1_1" in snapshot.locationAccess, false, "A sub-location target must not create a map access entry");
assert.deepEqual(events, [
    ["global-map"],
    ["dialog", [42]],
    ["trigger", "trigger", true],
    ["visible", "trigger", false],
    ["door", "door", true],
    ["load", { gameMode: "single", level: "l29_1", entrance: "GM" }],
    ["load", { gameMode: "single", level: "l1_1_1", entrance: "GM" }],
    ["effect", "effect_fire_small", { x: 2811, y: 1355 }],
    ["effect", "vis_gods", { x: 528, y: 585 }],
    ["finished", 3],
]);

const cursorHttp = createHttpServer(vite.middlewares);
await new Promise((resolve) => cursorHttp.listen(0, "127.0.0.1", resolve));
try {
    const cursorResponse = await fetch(`http://127.0.0.1:${cursorHttp.address().port}/Data/Cursors/normal.ani`);
    assert.equal(cursorResponse.status, 200, "The served cursor URL must resolve");
    const cursorBytes = new Uint8Array(await cursorResponse.arrayBuffer());
    assert.equal(new TextDecoder("ascii").decode(cursorBytes.slice(0, 4)), "RIFF", "The served cursor must begin with a RIFF header");
} finally {
    cursorHttp.close();
}

const { ANIParser, buildAniCursorSteps } = await vite.ssrLoadModule("/src/game/parsers/ANIParser.ts");
const originalCreateObjectURL = URL.createObjectURL;
URL.createObjectURL = () => "blob:ani-test";
try {
    const takeBuffer = readFileSync("public/Data/Cursors/take.ani");
    const takeParsed = new ANIParser(takeBuffer.buffer.slice(takeBuffer.byteOffset, takeBuffer.byteOffset + takeBuffer.byteLength)).parse();
    const takeSteps = buildAniCursorSteps(takeParsed);
    assert.equal(takeSteps.steps.length, 8, "take.ani must emit all eight authored steps");
    assert.deepEqual(takeSteps.steps.map((step) => step.frameIndex), [0, 1, 2, 3, 4, 3, 2, 5], "take.ani must follow its authored seq, not collapse to six linear frames");
    assert.deepEqual(takeSteps.steps.map((step) => step.percent), [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5], "take.ani keyframes must land at cumulative rate percentages");
    assert.equal(takeSteps.rateSum, 48, "take.ani total duration must sum the eight authored rates");
} finally {
    URL.createObjectURL = originalCreateObjectURL;
}

console.log("Verified native-zero SCR mutator returns, faction defaults, location-state variables, and shipped visual-effect argument order");
} finally {
    await vite.close();
}
