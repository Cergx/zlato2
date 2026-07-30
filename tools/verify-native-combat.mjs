#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import {
    createOriginalCombatProfile,
    originalCombatDistance,
    originalScoutCaution,
    originalTalkativeness,
    parsePersonCombatScript,
    resolveOriginalAttack,
    selectOriginalPersonWeapon,
    UNARMED_WEAPON_PROFILE,
} from "../src/game/systems/Combat.ts";
import { NATIVE_SKILL_PERKS, unlockedSkillPerks } from "../src/game/SkillPerkRuntime.ts";

const profile = createOriginalCombatProfile({
    parameters: {
        strength: 10,
        constitution: 10,
        dexterity: 8,
        perception: 6,
        intelligence: 3,
        wisdom: 5,
        luck: 0,
        skill_athletic: 5,
        skill_tactic: 4,
        skill_critical_hit: 0,
        skill_magicuse: 0,
        skill_speech: 5,
        skill_smith: 5,
    },
});
assert.equal(profile.maxHealth, 46);
assert.equal(profile.maxEnergy, 21);
assert.equal(profile.hitChance, 54);
assert.equal(profile.actionPoints, 18);
assert.equal(profile.armorClass, 4);
assert.equal(profile.initiative, 10);
assert.equal(profile.healthRegenerationTime, 4.5);
assert.equal(profile.energyRegenerationTime, 4.9);
assert.equal(profile.weapon.damage.crushing.max, 9);
assert.deepEqual(profile.damageResistance, { crushing: 8, hacking: 7, pricking: 8 });
assert.equal(profile.maxWeight, 60.2);

const originalBuild = (overrides = {}) => createOriginalCombatProfile({
    parameters: {
        strength: 5,
        constitution: 5,
        dexterity: 5,
        perception: 5,
        wisdom: 5,
        intelligence: 5,
        luck: 5,
        ...overrides,
    },
});
const baselineBuild = originalBuild();
assert.equal(baselineBuild.maxHealth, 21);
assert.equal(baselineBuild.maxEnergy, 21);
assert.equal(baselineBuild.actionPoints, 12);
assert.equal(baselineBuild.hitChance, 53);
assert.equal(baselineBuild.criticalChance, 0);
assert.equal(baselineBuild.armorClass, 2);
assert.equal(baselineBuild.maxWeight, 20.1);
assert.equal(baselineBuild.weapon.damage.crushing.max, 8);
assert.deepEqual(baselineBuild.damageResistance, { crushing: 2, hacking: 2, pricking: 2 });
assert.equal(baselineBuild.criticalMissChance, 5);
const level45Build = originalBuild({ experience: 100000 });
assert.equal(level45Build.maxHealth, 40);
assert.equal(level45Build.maxEnergy, 30);
assert.equal(level45Build.maxWeight, 24.5);
const speechMasterBuild = originalBuild({ experience: 100000, skill_speech: 15 });
assert.equal(speechMasterBuild.maxEnergy, 39);
assert.equal(speechMasterBuild.magicResistance.shadows, 6);
assert.equal(originalBuild({ strength: 24 }).maxHealth, 52);
assert.equal(originalBuild({ strength: 24 }).weapon.damage.crushing.max, 10);
assert.equal(originalBuild({ constitution: 24 }).maxHealth, 80);
assert.equal(originalBuild({ dexterity: 24 }).actionPoints, 22);
assert.equal(originalBuild({ dexterity: 24 }).armorClass, 2);
assert.equal(originalBuild({ perception: 24 }).hitChance, 53);
assert.equal(originalBuild({ wisdom: 24 }).maxEnergy, 79);
assert.equal(originalBuild({ intelligence: 24 }).maxEnergy, 52);
assert.equal(originalBuild({ luck: 24 }).hitChance, 57);
const combatArtExpectations = [
    { level: 0, hitChance: 53, criticalChance: 0 },
    { level: 1, hitChance: 54, criticalChance: 1 },
    { level: 2, hitChance: 55, criticalChance: 2 },
    { level: 3, hitChance: 55, criticalChance: 2 },
    { level: 4, hitChance: 56, criticalChance: 2 },
    { level: 5, hitChance: 57, criticalChance: 3 },
    { level: 8, hitChance: 59, criticalChance: 4 },
    { level: 11, hitChance: 61, criticalChance: 5 },
    { level: 14, hitChance: 63, criticalChance: 6 },
    { level: 17, hitChance: 65, criticalChance: 7 },
    { level: 20, hitChance: 67, criticalChance: 8 },
];
for (const expectation of combatArtExpectations) {
    const combatArtBuild = originalBuild({ skill_critical_hit: expectation.level });
    assert.equal(combatArtBuild.hitChance, expectation.hitChance);
    assert.equal(combatArtBuild.criticalChance, expectation.criticalChance);
}
assert.equal(originalBuild({ skill_critical_hit: 5 }).criticalMissChance, 0);
assert.equal(originalBuild().initiative, 9);
assert.equal(originalBuild({ skill_critical_hit: 9 }).initiative, 9);
assert.equal(originalBuild({ skill_critical_hit: 10 }).initiative, 19);
assert.equal(originalBuild({ skill_critical_hit: 15 }).initiative, 19);
const tacticActionPointExpectations = [
    [0, 12], [1, 13], [2, 13], [3, 14], [4, 15], [6, 16], [7, 17],
    [9, 18], [10, 19], [12, 20], [13, 21], [20, 25],
];
for (const [level, actionPoints] of tacticActionPointExpectations) {
    const tacticBuild = originalBuild({ skill_tactic: level });
    assert.equal(tacticBuild.actionPoints, actionPoints);
    assert.equal(tacticBuild.initiative, 9);
}
assert.equal(originalScoutCaution(0), 0);
assert.equal(originalScoutCaution(4), 0);
assert.equal(originalScoutCaution(5), 25);
assert.equal(originalScoutCaution(14), 70);
assert.equal(originalScoutCaution(15), 90);
assert.equal(originalScoutCaution(20), 90);
assert.equal(originalTalkativeness(0, 5), 0);
assert.equal(originalTalkativeness(1, 5), 19);
assert.equal(originalTalkativeness(10, 7), 57);
assert.equal(originalTalkativeness(14, 7), 73);
assert.equal(originalTalkativeness(14, 50), 116);
assert.equal(originalTalkativeness(15, 50), 100);
assert.equal(NATIVE_SKILL_PERKS.length, 108);
assert.deepEqual(unlockedSkillPerks("skill_critical_hit", 0).map(({ id }) => id), []);
assert.deepEqual(unlockedSkillPerks("skill_critical_hit", 1).map(({ id }) => id), [96]);
assert.deepEqual(unlockedSkillPerks("skill_critical_hit", 5).map(({ id }) => id), [96, 97]);
assert.deepEqual(unlockedSkillPerks("skill_critical_hit", 10).map(({ id }) => id), [96, 97, 98]);
assert.deepEqual(unlockedSkillPerks("skill_critical_hit", 15).map(({ id }) => id), [96, 97, 98, 99]);
assert.deepEqual(NATIVE_SKILL_PERKS.map(({ id }) => id).sort((left, right) => left - right),
    Array.from({ length: 108 }, (_, id) => id));
assert.equal(new Set(NATIVE_SKILL_PERKS.map(({ parameter }) => parameter)).size, 27);
for (const parameter of new Set(NATIVE_SKILL_PERKS.map(({ parameter }) => parameter))) {
    assert.deepEqual(NATIVE_SKILL_PERKS.filter((perk) => perk.parameter === parameter)
        .map(({ requiredLevel }) => requiredLevel), [1, 5, 10, 15]);
}
const sdbData = async (path) => {
    const bytes = await readFile(path);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder("windows-1251");
    const header = decoder.decode(bytes.subarray(0, 4));
    const xorRequired = header !== "SDB ";
    const data = {};
    let offset = xorRequired ? 0 : 4;
    while (offset + 8 <= view.byteLength) {
        const id = view.getInt32(offset, true);
        const length = view.getInt32(offset + 4, true);
        offset += 8;
        if (length < 0 || offset + length > view.byteLength) break;
        const encoded = bytes.subarray(offset, offset + length);
        const decoded = xorRequired ? Uint8Array.from(encoded, (byte) => byte ^ 0xaa) : encoded;
        data[id] = decoder.decode(decoded).trim();
        offset += length;
    }
    return data;
};
const [perkNames, perkDescriptions] = await Promise.all([
    sdbData("public/assets/sdb/perks/perks_lit.sdb"),
    sdbData("public/assets/sdb/perks/perks_desc.sdb"),
]);
assert.equal(Object.keys(perkNames).length, 108);
assert.equal(Object.keys(perkDescriptions).length, 108);
for (const { id } of NATIVE_SKILL_PERKS) {
    assert.ok(perkNames[id], `Native perk ${id} must have a name`);
    assert.ok(perkDescriptions[id], `Native perk ${id} must have a description`);
}
assert.equal(originalCombatDistance({ x: 0, y: 0 }, { x: 6, y: 0 }), 6);
assert.equal(originalCombatDistance({ x: 0, y: 0 }, { x: 6, y: 6 }), 8);

const personRoot = "public/assets/scripts/persons";
const personFiles = (await readdir(personRoot)).filter((name) => name.toLowerCase().endsWith(".scr")).sort();
const personDecoder = new TextDecoder("windows-1251");
let weaponReferences = 0;
let weaponLevelOffsets = 0;
let barterEnabled = 0;
let plotnik;
let kolbasens;
for (const file of personFiles) {
    const template = parsePersonCombatScript(file, personDecoder.decode(await readFile(`${personRoot}/${file}`)));
    weaponReferences += template.weapons.length;
    if (template.weaponLevelOffset !== 0) weaponLevelOffsets += 1;
    if (template.trade.change !== 0) barterEnabled += 1;
    if (file === "l1_1.p387_poison_plotnik.scr") plotnik = template;
    if (file === "l0.p7_kolbasens_rodstvennik1.scr") kolbasens = template;
}
assert.equal(personFiles.length, 782);
assert.equal(weaponReferences, 3594);
assert.equal(weaponLevelOffsets, 338);
assert.equal(barterEnabled, 666);
assert.ok(plotnik);
assert.equal(plotnik.weaponLevelOffset, 0);
assert.deepEqual(plotnik.weapons.at(0), {
    itemId: "NPC_THROWING_AXE_AC_HPMax_HDRES_PDRES_9",
    minimumLevel: 18,
    maximumLevel: 200,
});
assert.equal(selectOriginalPersonWeapon(plotnik.weapons, plotnik.weaponLevelOffset, 1, () => 0)?.itemId,
    "NPC_THROWING_AXE_AC_HPMax_HDRES_PDRES_3");
const wrappedSelectionRolls = [0.75, 0];
assert.equal(selectOriginalPersonWeapon(
    plotnik.weapons,
    plotnik.weaponLevelOffset,
    1,
    () => wrappedSelectionRolls.shift(),
)?.itemId, "NPC_THROWING_AXE_AC_HPMax_HDRES_PDRES_1");
assert.ok(kolbasens);
assert.equal(kolbasens.weaponLevelOffset, -7);
assert.equal(selectOriginalPersonWeapon(kolbasens.weapons, kolbasens.weaponLevelOffset, 10, () => 0)?.itemId,
    "NPC_HANDS_AC_HPMax_CDRES_HDRES_PDRES_7");

const attackProfile = {
    ...profile,
    hitChance: 100,
    criticalChance: 0,
    criticalMissChance: 0,
    weapon: {
        ...UNARMED_WEAPON_PROFILE,
        damage: {
            crushing: { min: 0, max: 0 },
            hacking: { min: 0, max: 0 },
            pricking: { min: 0, max: 0 },
        },
    },
    elementalDamage: {
        fire: { min: 1, max: 3 },
        cold: { min: 0, max: 0 },
        poison: { min: 0, max: 0 },
    },
};
const targetProfile = {
    ...profile,
    maxHealth: 20,
    armorClass: 0,
    damageResistance: { crushing: 0, hacking: 0, pricking: 0 },
    elementalResistance: { fire: 0, cold: 0, poison: 0 },
};
const elemental = resolveOriginalAttack(attackProfile, targetProfile, 20, () => 0.999);
assert.deepEqual(elemental.elementalDamageByKind, { fire: 3, cold: 0, poison: 0 });
assert.equal(elemental.appliedDamage, 3);
assert.equal(elemental.healthAfter, 17);

const critical = resolveOriginalAttack({
    ...attackProfile,
    criticalChance: 100,
    criticalDamage: 50,
    weapon: {
        ...UNARMED_WEAPON_PROFILE,
        damage: {
            crushing: { min: 10, max: 10 },
            hacking: { min: 0, max: 0 },
            pricking: { min: 0, max: 0 },
        },
    },
    elementalDamage: {
        fire: { min: 0, max: 0 },
        cold: { min: 0, max: 0 },
        poison: { min: 0, max: 0 },
    },
}, {
    ...targetProfile,
    damageResistance: { crushing: 3, hacking: 0, pricking: 0 },
}, 20, () => 0);
assert.equal(critical.critical, true);
assert.equal(critical.damageByKind.crushing, 12);
assert.equal(critical.appliedDamage, 12);

const criticalMiss = resolveOriginalAttack({ ...attackProfile, criticalMissChance: 100 }, targetProfile, 20, () => {
    throw new Error("Native 100% critical miss must not consume RNG");
});
assert.equal(criticalMiss.hit, false);
assert.equal(criticalMiss.criticalMiss, true);
assert.equal(criticalMiss.appliedDamage, 0);

console.log("Verified native combat stats, regeneration, distance, hit channels, resistance, criticals, and critical misses");
