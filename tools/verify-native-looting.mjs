#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { materializeInventory, parseInventoryScript } from "../src/game/parsers/INVParser.ts";
import { parsePersonResourceDefinition } from "../src/game/parsers/PRSParser.ts";
import { parsePersonCombatScript } from "../src/game/systems/Combat.ts";

const vite = await createServer({ server: { middlewareMode: true, hmr: { port: 24679 } }, appType: "custom" });
const { GameStateRuntime } = await vite.ssrLoadModule("/src/game/GameStateRuntime.ts");

const [minerSource, malformedSource, personBytes, resourceSource, heroSource] = await Promise.all([
    readFile("public/assets/scripts/inventory/pgmur_miner.inv", "utf8"),
    readFile("public/assets/scripts/inventory/inv004_maceman_hammer.inv", "utf8"),
    readFile("public/assets/scripts/persons/l0.p7_kolbasens_rodstvennik1.scr"),
    readFile("public/assets/scripts/persons_res/l0.p1184_rich_peasants_male01.prs", "utf8"),
    readFile("public/assets/scripts/inventory/hero_items.inv", "utf8"),
]);

const miner = parseInventoryScript(minerSource);
const randomValues = [0.5, 0.5];
let randomCalls = 0;
const generated = materializeInventory(miner, {
    level: 1,
    random: () => {
        const value = randomValues[randomCalls];
        if (value === undefined) throw new Error("Inventory materializer consumed an extra RNG value");
        randomCalls += 1;
        return value;
    },
});
assert.deepEqual(generated, { QST_1_0_57: 8 });
assert.equal(randomCalls, 2);

const malformed = parseInventoryScript(malformedSource);
assert.equal(malformed.entries.length, 41);
assert.equal(malformed.entries.some(({ technicalName }) => technicalName === "CLU_2_1_1"), true);
assert.equal(malformed.entries.some(({ technicalName }) => technicalName === "HLM_1_01_1"), false);
const person = parsePersonCombatScript("L0.P7_Kolbasens_Rodstvennik1", new TextDecoder("windows-1251").decode(personBytes));
assert.equal(person.resourceId, "L0.P1184_Rich_Peasants_Male01");
assert.equal(parsePersonResourceDefinition(resourceSource).containerAfterDie, true);

const heroRuntime = new GameStateRuntime({ onLoadArea: () => undefined, random: () => 0 });
heroRuntime.initializeInventoryFromScript("Hero", heroSource, { periodicSecondPass: false });
assert.deepEqual(heroRuntime.getInventory("Hero"), { MON_1_0_1: 1000 });

const statusMessages = [];
const runtime = new GameStateRuntime({
    onLoadArea: () => undefined,
    onMessage: (message) => statusMessages.push(String(message)),
    resolveItemLiteraryName: (technicalName) => technicalName === "FOD_1_1_1" ? "Проверочный предмет" : technicalName,
    random: () => 0,
});
runtime.initializeInventoryFromScript("person:merchant", 'regenerate_chance 0\nitem "FOD_1_1_1" 1 100 100 1 1\n');
assert.equal(runtime.hasInventory("person:merchant"), true);
assert.deepEqual(runtime.getInventory("person:merchant"), { FOD_1_1_1: 2 });
runtime.transferInventoryAll("person:merchant", "Hero");
assert.deepEqual(runtime.getInventory("person:merchant"), {});
assert.equal(runtime.hasInventory("person:merchant"), true, "An emptied native person inventory must not reroll on reopen");
assert.deepEqual(runtime.getInventory("Hero"), { FOD_1_1_1: 2 });
assert.deepEqual(statusMessages, [], "Loot transfers must not create status-history messages");
runtime.invokeHost("RS_PersonAddItem", ["Hero", "FOD_1_1_1", 1]);
assert.deepEqual(statusMessages, ["Получен предмет: Проверочный предмет"], "Scripted item grants must create a status-history message");

await vite.close();
console.log("Verified native INV parsing, RNG short-circuits, second pass, corpse resource binding, silent looting, scripted grant messages, atomic take-all, and retained empty person inventories");
