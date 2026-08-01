#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
    GOLDENLAND_START_MINUTE_OF_DAY,
    QUICK_SAVE_SLOT,
    SAVE_FORMAT_VERSION,
    PersistenceRuntime,
    createSaveData,
    deserializeSaveData,
    validateSaveData,
} = await vite.ssrLoadModule("/src/game/PersistenceRuntime.ts");

const save = createSaveData({ gameMode: "single", level: "l1_1", entrance: null });
assert.equal(save.clock.minuteOfDay, GOLDENLAND_START_MINUTE_OF_DAY);
save.metadata = {
    name: "Quick save",
    savedAt: "2026-08-06T18:54:14.186Z",
    locationTitle: "Вход в Светлоград",
    preview: "data:image/jpeg;base64,AA==",
};
save.persons = { local: false };
save.personStatesByLevel = {
    "single:l1_1": { local: false, alive: true },
    "single:l2": { remote: false },
};
const restored = deserializeSaveData(JSON.stringify(save));
assert.equal(restored.version, SAVE_FORMAT_VERSION);
assert.deepEqual(restored.personStatesByLevel, save.personStatesByLevel);
assert.deepEqual(restored.metadata, save.metadata);

const emptyNameSave = structuredClone(save);
emptyNameSave.metadata.name = "";
assert.equal(deserializeSaveData(JSON.stringify(emptyNameSave)).metadata.name, "");

const legacy = { ...save, version: 6 };
delete legacy.metadata;
delete legacy.lootGenerationLevel;
delete legacy.personStatesByLevel;
const migrated = validateSaveData(legacy);
assert.equal(migrated.version, SAVE_FORMAT_VERSION);
assert.deepEqual(migrated.personStatesByLevel, {});
assert.deepEqual(migrated.persons, { local: false });

class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
    keys() { return this.values.keys(); }
}

const currentStorage = new MemoryStorage();
const currentPersistence = new PersistenceRuntime(currentStorage);
currentPersistence.quickSave(save);
assert.equal(QUICK_SAVE_SLOT, "slot0");
assert.equal(currentPersistence.load("slot0")?.metadata.name, "Quick save");

const legacyStorage = new MemoryStorage();
const legacyPersistence = new PersistenceRuntime(legacyStorage);
legacyPersistence.save("quick", save);
assert.equal(legacyPersistence.load("slot0")?.metadata.name, "Quick save");

await vite.close();

console.log("Verified empty and named save metadata, native start clock, slot0 quick-save alias, per-level person state round-trip, and legacy migrations");
