#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true, hmr: { port: 24680 } }, appType: "custom" });
const { GameStateRuntime } = await vite.ssrLoadModule("/src/game/GameStateRuntime.ts");
const { LVLParser } = await vite.ssrLoadModule("/src/game/parsers/LVLParser.ts");
const { SEFParser } = await vite.ssrLoadModule("/src/game/parsers/SEFParser.ts");
const { parsePersonCombatScript } = await vite.ssrLoadModule("/src/game/systems/Combat.ts");
const { SDBParser } = await vite.ssrLoadModule("/src/game/parsers/SDBParser.ts");
const { AudioWeatherRuntime } = await vite.ssrLoadModule("/src/game/AudioWeatherRuntime.ts");
const { WorldGrid } = await vite.ssrLoadModule("/src/game/WorldGrid.ts");

globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/assets/")) return new Response(null, { status: 404 });
    try {
        return new Response(await readFile(resolve("public", `.${decodeURIComponent(url)}`)), { status: 200 });
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return new Response(null, { status: 404 });
        }
        throw error;
    }
};

const interfaceStringBytes = await readFile(resolve("public/assets/sdb/user_interface.sdb"));
const interfaceStrings = new SDBParser(interfaceStringBytes.buffer.slice(
    interfaceStringBytes.byteOffset,
    interfaceStringBytes.byteOffset + interfaceStringBytes.byteLength,
)).getData();
assert.equal(interfaceStrings[0xBF], "Требуется очков действия %d");
assert.equal(interfaceStrings[0xC0], "Невозможно дойти в этот ход");

const level = "l1_1";
const sefBytes = await readFile(resolve(`public/assets/levels/single/${level}/${level}.sef`));
const parsedSef = new SEFParser(new TextDecoder("windows-1251").decode(sefBytes)).getData();
const people = parsedSef.persons.filter((person, index, persons) =>
    persons.findIndex((candidate) => candidate.name.toLowerCase() === person.name.toLowerCase()) === index).slice(0, 2);
assert.equal(people.length, 2);
const asLevelPerson = (person, combatantId = person.name) => ({
    ...person,
    combatantId,
    worldPosition: { x: person.position.x * 12, y: person.position.y * 9 },
    sprites: {},
});
const sefData = { ...parsedSef, persons: people };
const lvlParser = new LVLParser(`/assets/levels/lvl/${sefData.pack}.lvl`);
await lvlParser.parse();
const lvlData = lvlParser.getData();
const pathGrid = new WorldGrid(lvlData.maskHDR);
let pathStart;
for (let y = 0; y < pathGrid.height && !pathStart; y += 1) {
    for (let x = 0; x < pathGrid.width; x += 1) {
        if (pathGrid.isWalkable({ x, y })) {
            pathStart = { x, y };
            break;
        }
    }
}
assert.ok(pathStart, "The shipped level must contain a walkable path origin");
let substitutedDestination;
for (let y = 0; y < pathGrid.height && !substitutedDestination; y += 1) {
    for (let x = 0; x < pathGrid.width; x += 1) {
        const destination = { x, y };
        if (pathGrid.isWalkable(destination)) continue;
        const snappedPath = pathGrid.findPath(pathStart, destination);
        if (snappedPath.length === 0) continue;
        substitutedDestination = destination;
        assert.equal(pathGrid.findPath(pathStart, destination, undefined, true).length, 0,
            "Exact ground paths must reject an impassable clicked cell instead of substituting a nearby cell");
        assert.notDeepEqual(snappedPath.at(-1), destination);
        break;
    }
}
assert.ok(substitutedDestination, "The shipped level must expose an impassable destination with a nearest-cell fallback");
const createdAudio = [];
const audio = new AudioWeatherRuntime({
    random: () => 0,
    crossfadeDurationMs: 0,
    createAudio: () => {
        const element = {
            src: "",
            loop: false,
            volume: 0,
            muted: false,
            currentTime: 0,
            play() {},
            pause() {},
            removeAttribute() {},
            load() {},
        };
        createdAudio.push(element);
        return element;
    },
});
audio.loadLevel(lvlData);
const explorationMusic = createdAudio.find((element) => element.src.includes("/music/"))?.src;
assert.ok(explorationMusic);
audio.setCombatMode(true);
assert.equal(createdAudio.at(-1).src, "/assets/music/gl04.ogg");
audio.setCombatMode(false);
assert.equal(createdAudio.at(-1).src, explorationMusic);
audio.destroy();
const combatModeChanges = [];
const runtime = new GameStateRuntime({
    onLoadArea() {},
    onCombatModeChange: (active) => combatModeChanges.push(active),
    random: () => 0,
});
await runtime.loadLevel({
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
    levelPersons: people.map((person) => asLevelPerson(person)),
    player: {
        name: "hero",
        position: { x: 0, y: 0 },
        worldPosition: { x: 0, y: 0 },
        direction: "DOWN",
        sprites: {},
        combatantId: "hero",
    },
});

runtime.setCombatMode(true);
let combat = runtime.snapshot().combat;
const maximumActionPoints = combat.combatants.hero.maximumActionPoints;
for (let spent = 0; spent < maximumActionPoints; spent += 1) {
    assert.equal(runtime.consumeCombatMovementActionPoint(), true);
}
assert.equal(runtime.consumeCombatMovementActionPoint(), false);
assert.equal(runtime.snapshot().combat.combatants.hero.actionPoints, 0);

const ally = people[0];
const enemy = people[1];
assert.equal(runtime.invokeHost("rs_addtoheropartyname", [ally.name]), 1);
assert.equal(runtime.invokeHost("rs_testherohaspartyname", [ally.name.toUpperCase()]), 1);
assert.equal(runtime.snapshot().combat.combatants[ally.name].partyMember, true);
assert.equal(runtime.snapshot().combat.combatants[ally.name].relationToHero, "friendly");
assert.equal(runtime.getCombatVisualState(enemy.name).relation, "friendly");
runtime.attackPerson(enemy.name);
assert.equal(runtime.getCombatVisualState(enemy.name).relation, "hostile");

runtime.setCombatantPosition(ally.name, { x: 2000, y: 2000 });
runtime.setCombatantPosition(enemy.name, { x: 3000, y: 3000 });
runtime.setCombatMode(true);
assert.equal(runtime.endCombatTurn(), true);
const turnOrder = [];
for (let time = 0; time <= 5000 && runtime.snapshot().combat.currentCombatant !== "hero"; time += 351) {
    const current = runtime.snapshot().combat.currentCombatant;
    if (current && turnOrder.at(-1) !== current) turnOrder.push(current);
    runtime.update(time, time, { x: 0, y: 0 }, time);
}
combat = runtime.snapshot().combat;
assert.deepEqual(turnOrder, [...turnOrder].sort((left, right) =>
    combat.combatants[right].initiative - combat.combatants[left].initiative));
assert.equal(combat.active, true);
assert.equal(combat.round, 2);
assert.equal(combat.currentCombatant, "hero");
assert.equal(combat.combatants.hero.actionPoints, maximumActionPoints);

assert.equal(runtime.invokeHost("rs_settribesrelation", ["hero", enemy.tribe, 1]), 0);
assert.equal(runtime.endCombatTurn(), true);
for (let time = 6000; time <= 11000 && runtime.snapshot().combat.active; time += 351) {
    runtime.update(time, time, { x: 0, y: 0 }, time);
}
combat = runtime.snapshot().combat;
assert.equal(combat.active, false);
assert.deepEqual(combatModeChanges, [true, false]);
assert.equal(runtime.invokeHost("rs_removefromheropartyname", [ally.name.toUpperCase()]), 1);
assert.equal(runtime.invokeHost("rs_testherohaspartyname", [ally.name]), 0);

const loadAiRuntime = async (person, options = {}) => {
    const aiRuntime = new GameStateRuntime({ onLoadArea() {}, random: () => 0, ...options });
    await aiRuntime.loadLevel({
        gameMode: "single",
        levelName: level,
        image: {},
        sdbData: {},
        sefData: { ...parsedSef, persons: [person] },
        lvlData,
        laoData: [],
        levelAnimations: [],
        levelStatics: [],
        levelDoors: [],
        levelMasks: [],
        triggerCells: {},
        triggerMasks: [],
        levelPersons: [asLevelPerson(person)],
        player: {
            name: "hero",
            position: { x: 0, y: 0 },
            worldPosition: { x: 0, y: 0 },
            direction: "DOWN",
            sprites: {},
            combatantId: "hero",
        },
    });
    return aiRuntime;
};

const historyTarget = { ...ally, literaryLabel: "Стражник", position: { x: 0, y: 0 } };
const historyMessages = [];
let attackRolls;
const historyRuntime = await loadAiRuntime(historyTarget, {
    onMessage: (message) => historyMessages.push(String(message)),
    resolveHeroName: () => "Вертас",
    resolveInterfaceString: (id) => interfaceStrings[id],
    random: () => attackRolls?.shift() ?? 0,
});
assert.equal(historyRuntime.getCombatantLiteraryName(historyTarget.name), "Стражник",
    "Person hover/status resolution must expose the registered literary name");
attackRolls = [0.99, 0, 0.99, 0.5, 0.5, 0.5, 0.5];
historyRuntime.setCombatantPosition(historyTarget.name, { x: 0, y: 0 });
const hitResult = historyRuntime.attackPerson(historyTarget.name);
assert.equal(hitResult?.hit, true, "The deterministic history probe must land a physical hit");
assert.ok(historyMessages.includes(`Вертас наносит Стражник ${hitResult.appliedDamage} пунктов повреждений`),
    "Physical hits must publish the native attacker/target/damage history template");

attackRolls = [0.99, 0.99];
const missResult = historyRuntime.attackPerson(historyTarget.name);
assert.equal(missResult?.hit, false, "The deterministic history probe must miss");
assert.ok(historyMessages.includes("Вертас промахивается"),
    "Ordinary misses must publish the native attacker history template");

const exhaustedRuntime = await loadAiRuntime(ally);
exhaustedRuntime.setCombatMode(true);
const exhaustedMaximum = exhaustedRuntime.snapshot().combat.combatants.hero.maximumActionPoints;
for (let spent = 0; spent < exhaustedMaximum; spent += 1) {
    assert.equal(exhaustedRuntime.consumeCombatMovementActionPoint(), true);
}
assert.equal(exhaustedRuntime.snapshot().combat.message, "", "Movement AP consumption must not publish turn lifecycle text");
assert.equal(exhaustedRuntime.completeHeroCombatAction(), true, "The completed final-AP action must end the hero turn");
assert.equal(exhaustedRuntime.snapshot().combat.active, false,
    "AI combatants without a hostile target must skip immediately instead of waiting for the AI pacing timer");

const idleRuntime = await loadAiRuntime(ally);
idleRuntime.setCombatMode(true);
assert.equal(idleRuntime.snapshot().combat.message, "", "Combat start must not publish a history message");
assert.equal(idleRuntime.endCombatTurn(), true);
assert.equal(idleRuntime.snapshot().combat.active, false, "A no-target AI queue must finish synchronously");
assert.equal(idleRuntime.snapshot().combat.message, "", "Skipped AI turns must not publish history messages");

const clockRuntime = await loadAiRuntime(ally);
clockRuntime.update(0, 0, { x: 0, y: 0 }, 0);
clockRuntime.update(1, 1000, { x: 0, y: 0 }, 1000);
assert.equal(clockRuntime.snapshot().elapsedMinutes, 1, "Exploration must advance the passive game clock");
clockRuntime.setCombatMode(true);
clockRuntime.update(2, 10000, { x: 0, y: 0 }, 10000);
assert.equal(clockRuntime.snapshot().elapsedMinutes, 1, "Combat must freeze the passive game clock");
clockRuntime.setCombatMode(false);
clockRuntime.update(3, 11000, { x: 0, y: 0 }, 11000);
assert.equal(clockRuntime.snapshot().elapsedMinutes, 2, "Leaving combat must resume without a combat-time catch-up");

const spiderScript = new TextDecoder("windows-1251").decode(await readFile(resolve("public/assets/scripts/persons/l0.m15_spider.scr")));
const spiderTemplate = parsePersonCombatScript("L0.M15_Spider", spiderScript);
assert.equal(spiderTemplate.radiusSee, 50);
assert.equal(spiderTemplate.radiusHear, 30);

const mover = { ...enemy, name: "L0.M15_Spider", tribe: "ai_mover", position: { x: 20, y: 20 } };
let moverWorld = { x: mover.position.x * 12, y: mover.position.y * 9 };
const movementSteps = [];
const attackAnimations = [];
const movingRuntime = await loadAiRuntime(mover, {
    onCombatantMoveRequest: (technicalName, targetPosition, away) => {
        assert.equal(technicalName, mover.name);
        const direction = away ? -1 : 1;
        moverWorld = {
            x: moverWorld.x + Math.sign(targetPosition.x - moverWorld.x) * 12 * direction,
            y: moverWorld.y + Math.sign(targetPosition.y - moverWorld.y) * 9 * direction,
        };
        movementSteps.push({ ...moverWorld });
        return moverWorld;
    },
    onCombatAnimation: (technicalName, kind) => attackAnimations.push([technicalName, kind]),
    onCombatantFace: (technicalName, targetPosition) => attackAnimations.push(["face", technicalName, targetPosition]),
});
movingRuntime.attackPerson(mover.name);
assert.equal(movingRuntime.endCombatTurn(), true);
for (let time = 0; time <= 20000 && movingRuntime.snapshot().combat.currentCombatant !== "hero"; time += 351) {
    movingRuntime.update(time, time, { x: 0, y: 0 }, time);
}
assert.ok(movementSteps.length > 0, "AI combatant must walk toward a distant hostile target");
assert.ok(attackAnimations.some(([technicalName, kind]) => technicalName === mover.name && kind === "attack"),
    "AI combatant must attack after reaching weapon range");
assert.ok(attackAnimations.some(([kind, technicalName]) => kind === "face" && technicalName === mover.name),
    "AI combatant must face its target before attacking");

const caster = { ...enemy, name: "L0.M25_Salamandr", tribe: "ai_caster", position: { x: 30, y: 30 } };
const magicMessages = [];
const magicEffects = [];
let casterMovement = 0;
const castingRuntime = await loadAiRuntime({ ...caster, literaryLabel: "Саламандра" }, {
    onCombatantMoveRequest: () => {
        casterMovement += 1;
        return undefined;
    },
    onMagicEffect: (technicalName, targetName) => magicEffects.push([technicalName, targetName]),
    onMessage: (message) => magicMessages.push(String(message)),
    resolveHeroName: () => "Вертас",
    resolveInterfaceString: (id) => interfaceStrings[id],
});
castingRuntime.attackPerson(caster.name);
assert.equal(castingRuntime.endCombatTurn(), true);
for (let time = 0; time <= 1400 && magicEffects.length === 0; time += 351) {
    castingRuntime.update(time, time, { x: 0, y: 0 }, time);
}
assert.ok(magicEffects.some(([, targetName]) => targetName === "hero"), "AI caster must apply an offensive spell to the hero");
assert.equal(casterMovement, 0, "AI caster should cast before closing to weapon range when battle magic is selected");
assert.ok(magicMessages.some((message) => message.startsWith("Саламандра применяет магию ")),
    "Spell casts must publish the native caster/spell history template");

const detectingRuntime = await loadAiRuntime(mover, {
    onCombatantCanSee: () => true,
});
assert.equal(detectingRuntime.invokeHost("rs_settribesrelation", ["hero", mover.tribe, 0]), 0);
detectingRuntime.update(0, 0, { x: moverWorld.x - 12, y: moverWorld.y - 9 }, 0);
assert.equal(detectingRuntime.snapshot().combat.active, true, "Hostile actor must start combat inside radius_see");

const duplicateRuntime = new GameStateRuntime({ onLoadArea() {}, random: () => 0 });
const duplicatePeople = [
    { ...mover, position: { x: 20, y: 20 } },
    { ...mover, position: { x: 40, y: 40 } },
];
await duplicateRuntime.loadLevel({
    gameMode: "single",
    levelName: level,
    image: {},
    sdbData: {},
    sefData: { ...parsedSef, persons: duplicatePeople },
    lvlData,
    laoData: [],
    levelAnimations: [],
    levelStatics: [],
    levelDoors: [],
    levelMasks: [],
    triggerCells: {},
    triggerMasks: [],
    levelPersons: duplicatePeople.map((person, index) => asLevelPerson(person, index === 0 ? mover.name : `${mover.name}#2`)),
    player: {
        name: "hero",
        combatantId: "hero",
        position: { x: 0, y: 0 },
        worldPosition: { x: 0, y: 0 },
        direction: "DOWN",
        sprites: {},
    },
});
assert.ok(duplicateRuntime.snapshot().combat.combatants[mover.name]);
assert.ok(duplicateRuntime.snapshot().combat.combatants[`${mover.name}#2`]);
duplicateRuntime.setCombatantPosition(`${mover.name}#2`, { x: 12, y: 9 });
assert.equal(duplicateRuntime.attackPerson(`${mover.name}#2`) !== undefined, true,
    "A duplicated technical name must resolve to its exact combat instance");

await vite.close();
console.log("Verified native combat history, perception radii, automatic combat, duplicate-instance identity, movement AP, facing, relation state, party ABI, AI movement, weapon attacks, spellcasting, asynchronous turns, round reset, and combat termination");
