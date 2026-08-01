#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true, hmr: { port: 24679 } }, appType: "custom" });
const [
    { materializeInventory, parseInventoryScript },
    { parsePersonResourceDefinition },
    { originalInventoryLevelForWorld, parsePersonCombatScript },
    { SEFParser },
    { GameStateRuntime },
    { ScenarioRuntime },
    { createSaveData, validateSaveData, SAVE_FORMAT_VERSION },
] = await Promise.all([
    vite.ssrLoadModule("/src/game/parsers/INVParser.ts"),
    vite.ssrLoadModule("/src/game/parsers/PRSParser.ts"),
    vite.ssrLoadModule("/src/game/systems/Combat.ts"),
    vite.ssrLoadModule("/src/game/parsers/SEFParser.ts"),
    vite.ssrLoadModule("/src/game/GameStateRuntime.ts"),
    vite.ssrLoadModule("/src/game/ScenarioRuntime.ts"),
    vite.ssrLoadModule("/src/game/PersistenceRuntime.ts"),
]);

const [
    minerSource,
    poorSwordsmanSource,
    malformedSource,
    personBytes,
    resourceSource,
    heroSource,
    poorCivilChestSource,
    moneyChestSource,
    levelSource,
] = await Promise.all([
    readFile("public/assets/scripts/inventory/pgmur_miner.inv", "utf8"),
    readFile("public/assets/scripts/inventory/inv001_poor_swordsman.inv", "utf8"),
    readFile("public/assets/scripts/inventory/inv004_maceman_hammer.inv", "utf8"),
    readFile("public/assets/scripts/persons/l0.p7_kolbasens_rodstvennik1.scr"),
    readFile("public/assets/scripts/persons_res/l0.p1184_rich_peasants_male01.prs", "utf8"),
    readFile("public/assets/scripts/inventory/hero_items.inv", "utf8"),
    readFile("public/assets/scripts/inventory/inv012_poor_civil.inv", "utf8"),
    readFile("public/assets/scripts/inventory/inv014_money.inv", "utf8"),
    readFile("public/assets/levels/single/l1_3/l1_3.sef", "utf8"),
]);

const miner = parseInventoryScript(minerSource);
let randomCalls = 0;
const generated = materializeInventory(miner, {
    level: 1,
    random: () => {
        randomCalls += 1;
        return 0.5;
    },
});
assert.deepEqual(generated, {}, "The normal inventory must not receive a decreased bonus pass");
assert.equal(randomCalls, 1);
randomCalls = 0;
const decreased = materializeInventory(miner, {
    level: 1,
    pass: "decreased",
    random: () => {
        randomCalls += 1;
        return 0.5;
    },
});
assert.deepEqual(decreased, { QST_1_0_57: 8 }, "The decreased pass is a separate personal inventory");
assert.equal(randomCalls, 1, "Chance above 100 must not consume RNG");

const poorSwordsman = parseInventoryScript(poorSwordsmanSource);
assert.equal(materializeInventory(poorSwordsman, {
    level: 1,
    random: () => 0.5,
}).MON_1_0_1, 77, "The first matching gold row must roll its quantity and later matching rows must add one coin each");
assert.equal(materializeInventory(poorSwordsman, {
    level: 12,
    random: () => 0.5,
}).MON_1_0_1, 78, "Level bands must change the number of one-coin duplicate insertions without summing their ranges");

const decreasedQuantity = parseInventoryScript([
    "regenerate_chance 0",
    "chance_decrease 2",
    "quantity_decrease 3",
    'item "FOD_1_1_1" 1 100 100 5 10',
].join("\n"));
assert.deepEqual(materializeInventory(decreasedQuantity, {
    level: 1,
    pass: "decreased",
    random: () => 0,
}), { FOD_1_1_1: 2 }, "Decreased quantities must ceil both authored bounds before the inclusive roll");

const level = new SEFParser(levelSource).getData();
const chestInventories = Object.fromEntries(level.triggers
    .filter(({ name }) => /^L1_3_T[5-9]_FILLING$/i.test(name))
    .map(({ name, inventoryName }) => [name.toUpperCase(), inventoryName]));
assert.deepEqual(chestInventories, {
    L1_3_T5_FILLING: "inv012_poor_civil",
    L1_3_T6_FILLING: "inv014_money",
    L1_3_T7_FILLING: "inv012_poor_civil",
    L1_3_T8_FILLING: "inv012_poor_civil",
    L1_3_T9_FILLING: "inv012_poor_civil",
}, "L1_3 T5-T9 must retain their authored trigger-to-INV bindings");

const duplicateScenario = new ScenarioRuntime({
    triggers: [
        { name: "BOX", cellsName: "box", inventoryName: "probe", isActive: true, isVisible: true },
        { name: "BOX", cellsName: "box", inventoryName: "probe", isActive: true, isVisible: true },
    ],
    persons: [],
    doors: {},
    cellGroups: { box: [{ x: 1, y: 1 }] },
}, {
    mapSize: { width: 120, height: 90 },
    doors: [],
    cellGroups: {},
    triggerDescription: [],
}, {}, { random: () => 0 });
assert.deepEqual(duplicateScenario.getTriggerStates().map(({ instanceKey }) => instanceKey), ["BOX", "BOX#1"], "Duplicate SEF names must remain separate trigger instances");
assert.deepEqual(duplicateScenario.getTriggersAt({ x: 1, y: 1 }).map(({ instanceKey }) => instanceKey), ["BOX", "BOX#1"], "Overlapping duplicate triggers must both participate in hit selection");

const poorCivilChest = parseInventoryScript(poorCivilChestSource);
const moneyChest = parseInventoryScript(moneyChestSource);
assert.equal(materializeInventory(poorCivilChest, {
    level: 1,
    random: () => 0.75,
}).MON_1_0_1, 90, "L1_3 T5/T7/T8/T9 must roll the first money row and add one coin for each later duplicate");
assert.equal(materializeInventory(moneyChest, {
    level: 1,
    random: () => 0.75,
}).MON_1_0_1, 90, "L1_3 T6 must roll the first money row and add one coin for each later duplicate");
assert.equal(materializeInventory(poorCivilChest, {
    level: 1,
    random: () => 0,
}).MON_1_0_1, 52, "L1_3 poor-civil chests must produce the native level-1 minimum");
assert.equal(materializeInventory(moneyChest, {
    level: 1,
    random: () => 0,
}).MON_1_0_1, 52, "L1_3 money chest must produce the native level-1 minimum");
assert.equal(materializeInventory(poorCivilChest, {
    level: 1,
    random: () => 0.999999,
}).MON_1_0_1, 102, "L1_3 poor-civil chests must produce the native level-1 maximum");
assert.equal(materializeInventory(moneyChest, {
    level: 1,
    random: () => 0.999999,
}).MON_1_0_1, 102, "L1_3 money chest must produce the native level-1 maximum");

assert.equal(originalInventoryLevelForWorld([{ experience: 0 }]), 2, "A level-1 hero without loot-rating skill bonuses must use INV level 2");
assert.equal(originalInventoryLevelForWorld([{ experience: 0, criticalHitSkill: 10 }]), 7, "Combat Art 10 must add five native loot-rating levels");
assert.equal(originalInventoryLevelForWorld([{ experience: Number.MAX_SAFE_INTEGER, criticalHitSkill: 10, hackSkill: 5 }]), 1, "A computed world loot rating above 100 must retain the native zero field before INV +1");
assert.equal(originalInventoryLevelForWorld([{ experience: 0, hackSkill: 5 }]), 7, "Lockpicking 5 must add five native loot-rating levels");
assert.equal(originalInventoryLevelForWorld([{ experience: 0, criticalHitSkill: 10, hackSkill: 5 }]), 12, "Combat Art 10 and Lockpicking 5 must stack before the INV +1");
assert.equal(originalInventoryLevelForWorld([{ experience: 0 }, { experience: 5500 }]), 7, "Multiplayer world rating must truncate the average of eligible player ratings before INV +1");
assert.equal(originalInventoryLevelForWorld([{ experience: 5500 }]), 12, "A displayed level-11 hero without bonuses must use INV level 12");
assert.equal(materializeInventory(moneyChest, {
    level: originalInventoryLevelForWorld([{ experience: 0, criticalHitSkill: 10 }]),
    random: () => 0,
}).MON_1_0_1, 54, "One five-level skill bonus must make five UID-16 money rows match");
assert.equal(materializeInventory(moneyChest, {
    level: originalInventoryLevelForWorld([{ experience: 0, criticalHitSkill: 10 }]),
    random: () => 0.999999,
}).MON_1_0_1, 104, "One five-level skill bonus must retain the first low money band");
assert.equal(materializeInventory(poorCivilChest, {
    level: originalInventoryLevelForWorld([{ experience: 5500 }]),
    random: () => 0,
}).MON_1_0_1, 53, "UID 15 must produce the observed effective-level-12 minimum through level_offset 8");
assert.equal(materializeInventory(poorCivilChest, {
    level: originalInventoryLevelForWorld([{ experience: 5500 }]),
    random: () => 0.999999,
}).MON_1_0_1, 103, "UID 15 must produce the observed effective-level-12 maximum through level_offset 8");
assert.equal(materializeInventory(moneyChest, {
    level: originalInventoryLevelForWorld([{ experience: 5500 }]),
    random: () => 0,
}).MON_1_0_1, 83, "UID 16 must produce the native level-11 minimum");
assert.equal(materializeInventory(moneyChest, {
    level: originalInventoryLevelForWorld([{ experience: 5500 }]),
    random: () => 0.999999,
}).MON_1_0_1, 163, "UID 16 must produce the native level-11 maximum");

const duplicateStackProbe = parseInventoryScript([
    'item "MON_1_0_1" 1 100 100 50 100',
    'item "MON_1_0_1" 1 100 100 60 120',
].join("\n"));
let duplicateRandomCalls = 0;
assert.equal(materializeInventory(duplicateStackProbe, {
    level: 1,
    random: () => {
        duplicateRandomCalls += 1;
        return 0;
    },
}).MON_1_0_1, 51);
assert.equal(duplicateRandomCalls, 4, "A duplicate row must still consume its chance and quantity rolls before adding one item");

const stackCapacityProbe = parseInventoryScript([
    'item "FOD_1_1_1" 1 100 100 2 2',
    'item "FOD_1_1_1" 1 100 100 99 99',
    'item "FOD_1_1_1" 1 100 100 99 99',
].join("\n"));
assert.equal(materializeInventory(stackCapacityProbe, {
    level: 1,
    random: () => 0,
    resolveMaximumStack: () => 3,
}).FOD_1_1_1, 6, "A compatible non-full stack gains one item; a full stack forces a new clamped stack");

const malformed = parseInventoryScript(malformedSource);
assert.equal(malformed.entries.length, 41);
assert.equal(malformed.entries.some(({ technicalName }) => technicalName === "CLU_2_1_1"), true);
assert.equal(malformed.entries.some(({ technicalName }) => technicalName === "HLM_1_01_1"), false);
const person = parsePersonCombatScript("L0.P7_Kolbasens_Rodstvennik1", new TextDecoder("windows-1251").decode(personBytes));
assert.equal(person.resourceId, "L0.P1184_Rich_Peasants_Male01");
assert.equal(parsePersonResourceDefinition(resourceSource).containerAfterDie, true);

const heroRuntime = new GameStateRuntime({ onLoadArea: () => undefined, random: () => 0 });
heroRuntime.initializeInventoryFromScript("Hero", heroSource);
assert.deepEqual(heroRuntime.getInventory("Hero"), { MON_1_0_1: 1000 });

const statusMessages = [];
const runtime = new GameStateRuntime({
    onLoadArea: () => undefined,
    onMessage: (message) => statusMessages.push(String(message)),
    resolveItemLiteraryName: (technicalName) => technicalName === "FOD_1_1_1" ? "Проверочный предмет" : technicalName,
    random: () => 0,
});
runtime.initializeInventoryFromScript("person:merchant", 'regenerate_chance 0\nitem "FOD_1_1_1" 1 100 100 1 1\n');
runtime.initializeInventoryFromScript("trade:merchant", 'regenerate_chance 0\nitem "FOD_1_1_1" 1 100 100 1 1\n');
assert.deepEqual(runtime.getInventory("person:merchant"), { FOD_1_1_1: 1 });
assert.deepEqual(runtime.getInventory("trade:merchant"), { FOD_1_1_1: 1 });
runtime.invokeHost("RS_PersonAddItemToTrade", ["merchant", "FOD_1_1_1", 2]);
assert.deepEqual(runtime.getInventory("trade:merchant"), { FOD_1_1_1: 3 });
assert.deepEqual(runtime.getInventory("person:merchant"), { FOD_1_1_1: 1 }, "Trade stock must be separate from corpse loot");
runtime.transferInventoryAll("person:merchant", "Hero");
assert.deepEqual(runtime.getInventory("person:merchant"), {});
assert.equal(runtime.hasInventory("person:merchant"), true, "An emptied native person inventory must not reroll on reopen");
assert.deepEqual(runtime.getInventory("Hero"), { FOD_1_1_1: 1 });
assert.deepEqual(statusMessages, [], "Loot transfers must not create status-history messages");
runtime.invokeHost("RS_PersonAddItem", ["Hero", "FOD_1_1_1", 1]);
assert.deepEqual(statusMessages, ["Получен предмет: Проверочный предмет"], "Scripted item grants must create a status-history message");


const openedDuplicateOwners = [];
const duplicateRolls = [0, 0, 0, 0.999999];
const duplicateLootRuntime = new GameStateRuntime({
    onLoadArea: () => undefined,
    onContainerOpen: (owner) => openedDuplicateOwners.push(owner),
    random: () => duplicateRolls.shift() ?? 0,
});
Object.assign(duplicateLootRuntime, {
    scenario: {
        interactTrigger: (instanceKey) => ({
            instanceKey,
            name: "BOX",
            active: true,
            inventoryName: "probe",
        }),
    },
});
const duplicateInventorySource = 'item "FOD_1_1_1" 1 100 100 1 2';
const fetchBeforeDuplicateProbe = globalThis.fetch;
globalThis.fetch = async () => new Response(new TextEncoder().encode(duplicateInventorySource), { status: 200 });
assert.equal(await duplicateLootRuntime.interactTrigger("BOX"), true);
assert.equal(await duplicateLootRuntime.interactTrigger("BOX#1"), true);
globalThis.fetch = fetchBeforeDuplicateProbe;
assert.deepEqual(openedDuplicateOwners, ["trigger:BOX", "trigger:BOX#1"], "Each duplicate trigger must open its own inventory owner");
assert.deepEqual(duplicateLootRuntime.getInventory("trigger:BOX"), { FOD_1_1_1: 1 });
assert.deepEqual(duplicateLootRuntime.getInventory("trigger:BOX#1"), { FOD_1_1_1: 2 });
const legacySave = createSaveData({ gameMode: "single", level: "L1_3", entrance: null });
legacySave.personParameters = { Hero: { skill_critical_hit: 10, skill_hack: 5 } };
const migratedSave = validateSaveData(Object.fromEntries(
    Object.entries({ ...legacySave, version: 7 }).filter(([key]) => key !== "lootGenerationLevel" && key !== "metadata"),
));
assert.equal(migratedSave.version, SAVE_FORMAT_VERSION);
assert.equal(migratedSave.lootGenerationLevel, 12, "Version-7 saves must recover the persisted loot rating from hero XP and skills");
const restoredLootRuntime = new GameStateRuntime({ onLoadArea: () => undefined, random: () => 0 });
migratedSave.inventories["trigger:L1_3_T6_FILLING"] = [];
restoredLootRuntime.restore(migratedSave);
assert.equal(restoredLootRuntime.snapshot().lootGenerationLevel, 12, "Save restore must retain the world loot rating");
assert.equal(restoredLootRuntime.hasInventory("trigger:L1_3_T6_FILLING"), true, "An emptied initialized trigger inventory must survive save restore");
Object.assign(restoredLootRuntime, {
    scenario: {
        interactTrigger: () => ({ instanceKey: "L1_3_T6_FILLING", active: true, name: "L1_3_T6_FILLING", inventoryName: "inv014_money" }),
    },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("A restored trigger inventory must not fetch or regenerate"); };
assert.equal(await restoredLootRuntime.interactTrigger("L1_3_T6_FILLING"), true);
globalThis.fetch = originalFetch;
Object.assign(restoredLootRuntime, { personInventoryLevels: new Map([["merchant", 1]]) });
restoredLootRuntime.restore(migratedSave);
restoredLootRuntime.initializeInventoryFromScript("person:merchant", moneyChestSource);
assert.equal(restoredLootRuntime.getInventory("person:merchant").MON_1_0_1, 83, "A never-opened person inventory after restore must use the saved world loot rating");

await vite.close();
console.log("Verified native loot rating bonuses and ranges, persistent empty trigger inventories, v7 loot-rating migration, INV parsing, duplicate-stack insertion, corpse ownership, silent looting, scripted grants, and atomic take-all");
