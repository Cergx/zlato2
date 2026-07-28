#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import {
    createOriginalCombatProfile,
    originalCombatDistance,
    parsePersonCombatScript,
    resolveOriginalAttack,
    selectOriginalPersonWeapon,
    UNARMED_WEAPON_PROFILE,
} from "../src/game/systems/Combat.ts";

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
assert.equal(profile.maxHealth, 190);
assert.equal(profile.maxEnergy, 26);
assert.equal(profile.actionPoints, 42);
assert.equal(profile.armorClass, 14);
assert.equal(profile.initiative, 18);
assert.equal(profile.healthRegenerationTime, 4.5);
assert.equal(profile.energyRegenerationTime, 4.9);
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
