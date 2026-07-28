#!/usr/bin/env node
import assert from "node:assert/strict";
import {
    SAVE_FORMAT_VERSION,
    createSaveData,
    deserializeSaveData,
    validateSaveData,
} from "../src/game/PersistenceRuntime.ts";

const save = createSaveData({ gameMode: "single", level: "l1_1", entrance: null });
save.persons = { local: false };
save.personStatesByLevel = {
    "single:l1_1": { local: false, alive: true },
    "single:l2": { remote: false },
};
const restored = deserializeSaveData(JSON.stringify(save));
assert.equal(restored.version, SAVE_FORMAT_VERSION);
assert.deepEqual(restored.personStatesByLevel, save.personStatesByLevel);

const legacy = { ...save, version: 6 };
delete legacy.personStatesByLevel;
const migrated = validateSaveData(legacy);
assert.equal(migrated.version, SAVE_FORMAT_VERSION);
assert.deepEqual(migrated.personStatesByLevel, {});
assert.deepEqual(migrated.persons, { local: false });

console.log("Verified save version 7 per-level person state round-trip and version 6 migration");
