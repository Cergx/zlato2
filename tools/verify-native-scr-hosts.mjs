#!/usr/bin/env node
import assert from "node:assert/strict";
import { GameStateRuntime } from "../src/game/GameStateRuntime.ts";

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
assert.deepEqual(events, [
    ["global-map"],
    ["dialog", [42]],
    ["trigger", "trigger", true],
    ["visible", "trigger", false],
    ["door", "door", true],
    ["effect", "effect_fire_small", { x: 2811, y: 1355 }],
    ["effect", "vis_gods", { x: 528, y: 585 }],
    ["finished", 3],
]);

console.log("Verified native-zero SCR mutator returns, faction defaults, location-state variables, and shipped visual-effect argument order");
