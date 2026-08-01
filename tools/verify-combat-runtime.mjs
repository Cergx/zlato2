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
const {
    nativeAdvanceMovementCost,
    nativeSelfPreservationProbability,
    rankNativeCombatAiTargets,
} = await vite.ssrLoadModule("/src/game/systems/NativeCombatAi.ts");
const { SDBParser } = await vite.ssrLoadModule("/src/game/parsers/SDBParser.ts");
const { AudioWeatherRuntime } = await vite.ssrLoadModule("/src/game/AudioWeatherRuntime.ts");
const { WorldGrid } = await vite.ssrLoadModule("/src/game/WorldGrid.ts");

const nativeGrid = new WorldGrid({ width: 2, height: 2, chunks: [] });
assert.deepEqual(nativeGrid.findPath({ x: 0, y: 0 }, { x: 1, y: 1 }), [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
], "Server.dll 0x1400FF28 must expand a direct diagonal with native cost 14");
const cornerBlocked = new Set([nativeGrid.index({ x: 1, y: 0 }), nativeGrid.index({ x: 0, y: 1 })]);
assert.deepEqual(nativeGrid.findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, cornerBlocked), [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
], "Native diagonal legality checks the destination footprint, not the two adjacent cardinal cells");
const rankedNativeTargets = rankNativeCombatAiTargets([
    { id: "ordinary", marker: 0, priority: 0, relationRank: 0, rosterOrder: 0 },
    { id: "secondary", marker: 1, priority: 2, relationRank: 1, rosterOrder: 1 },
    { id: "primary", marker: 1, priority: 4, relationRank: 0, rosterOrder: 2 },
    { id: "friendly", marker: 0, priority: 0, relationRank: 2, rosterOrder: 3 },
], { primary: "primary", secondary: "secondary" });
assert.deepEqual(rankedNativeTargets.map(({ id, score }) => [id, score]), [
    ["primary", 24],
    ["secondary", 8],
    ["ordinary", 6],
], "Runtime target ranking must preserve the recovered native score and relation filter");
assert.ok(Math.abs(nativeSelfPreservationProbability(20, 50) - 0.68) < 1e-12,
    "Low-health action probability must use the recovered 1.0 - 0.8 * health / threshold formula");
assert.equal(nativeAdvanceMovementCost(10, 5), 7,
    "Advance-and-attack movement must use the recovered -0.5 weapon-range contribution");

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
const baselineHeroParameters = Object.freeze({
    strength: 5,
    constitution: 5,
    dexterity: 5,
    perception: 5,
    wisdom: 5,
    intelligence: 5,
    luck: 5,
});

const runtime = new GameStateRuntime({
    onLoadArea() {},
    onCombatModeChange: (active) => combatModeChanges.push(active),
    random: () => 0,
});
runtime.initializeHeroProfile(baselineHeroParameters, 0);
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
const enemyFaction = runtime.snapshot().combat.combatants[enemy.name].faction;
assert.equal(runtime.invokeHost("rs_addtoheropartyname", [ally.name]), 1);
assert.equal(runtime.invokeHost("rs_testherohaspartyname", [ally.name.toUpperCase()]), 1);
assert.equal(runtime.snapshot().combat.combatants[ally.name].partyMember, true);
assert.equal(runtime.snapshot().combat.combatants[ally.name].relationToHero, "friendly");
runtime.setCombatMode(false);
runtime.setCombatMode(true);
runtime.setCombatantPosition(enemy.name, { x: 0, y: 0 });
assert.equal(runtime.getCombatVisualState(enemy.name).relation, "friendly");
assert.equal(runtime.invokeHost("rs_settribesrelation", [enemyFaction, "hero", 0]), 0);
assert.equal(runtime.getCombatVisualState(enemy.name).relation, "hostile");
assert.equal(runtime.invokeHost("rs_settribesrelation", ["probe.source", "probe.target", 0]), 0);
assert.equal(runtime.invokeHost("rs_gettribesrelation", ["probe.source", "probe.target"]), 0);
assert.equal(runtime.invokeHost("rs_gettribesrelation", ["probe.target", "probe.source"]), 2,
    "Native tribe relations must remain directional");

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

assert.equal(runtime.invokeHost("rs_settribesrelation", [enemyFaction, "hero", 1]), 0);
assert.equal(runtime.endCombatTurn(), true);
for (let time = 6000; time <= 11000 && runtime.snapshot().combat.active; time += 351) {
    runtime.update(time, time, { x: 0, y: 0 }, time);
}
combat = runtime.snapshot().combat;
assert.equal(combat.active, false);
assert.deepEqual(combatModeChanges, [true, false, true, false]);
assert.equal(runtime.invokeHost("rs_removefromheropartyname", [ally.name.toUpperCase()]), 1);
assert.equal(runtime.invokeHost("rs_testherohaspartyname", [ally.name]), 0);


const loadAiRuntime = async (personOrPeople, options = {}, heroParameters = baselineHeroParameters) => {
    const selectedPeople = Array.isArray(personOrPeople) ? personOrPeople : [personOrPeople];
    const aiRuntime = new GameStateRuntime({ onLoadArea() {}, random: () => 0, ...options });
    aiRuntime.initializeHeroProfile(heroParameters, 0);
    await aiRuntime.loadLevel({
        gameMode: "single",
        levelName: level,
        image: {},
        sdbData: {},
        sefData: { ...parsedSef, persons: selectedPeople },
        lvlData,
        laoData: [],
        levelAnimations: [],
        levelStatics: [],
        levelDoors: [],
        levelMasks: [],
        triggerCells: {},
        triggerMasks: [],
        levelPersons: selectedPeople.map((person) => asLevelPerson(person)),
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

let lootInventoryPhase = false;
const lootLevelRuntime = await loadAiRuntime(people[0], { random: () => lootInventoryPhase ? 0.5 : 0 });
lootLevelRuntime.invokeHost("rs_addexp", [100000]);
lootInventoryPhase = true;
lootLevelRuntime.initializeInventoryFromScript(`person:${people[0].name}`, [
    "regenerate_chance 0",
    'item "MON_1_0_1" 1 1 100 50 100',
    'item "MON_1_0_1" 2 100 100 80 160',
].join("\n"));
assert.equal(lootLevelRuntime.getInventory(`person:${people[0].name}`).MON_1_0_1, 75,
    "A lazily fetched person INV must use the hero level captured when that person spawned");
assert.equal(await lootLevelRuntime.interactTrigger("L1_1_T3_FILLING"), true);
assert.equal(lootLevelRuntime.getInventory("trigger:L1_1_T3_FILLING").MON_1_0_1, 270,
    "A lazily fetched trigger INV must use the hero level captured when the level generation began");

const partyDamageRuntime = await loadAiRuntime(ally);
assert.equal(partyDamageRuntime.invokeHost("rs_addtoheropartyname", [ally.name]), 1);
partyDamageRuntime.setCombatMode(true);
partyDamageRuntime.setCombatantPosition(ally.name, { x: 0, y: 0 });
const partyHealthBefore = partyDamageRuntime.snapshot().combat.combatants[ally.name].health;
const partyActionPointsBefore = partyDamageRuntime.snapshot().combat.combatants.hero.actionPoints;
assert.equal(partyDamageRuntime.attackPerson(ally.name), undefined,
    "Hero-party ownership must block direct friendly damage");
assert.equal(partyDamageRuntime.snapshot().combat.combatants[ally.name].health, partyHealthBefore);
assert.equal(partyDamageRuntime.snapshot().combat.combatants.hero.actionPoints, partyActionPointsBefore);

const historyTarget = { ...ally, literaryLabel: "Стражник", position: { x: 0, y: 0 } };
const historyMessages = [];
let attackRolls;
const historyRuntime = await loadAiRuntime(historyTarget, {
    onMessage: (message) => historyMessages.push(String(message)),
    resolveHeroName: () => "Вертас",
    resolveInterfaceString: (id) => interfaceStrings[id],
    random: () => attackRolls?.shift() ?? 0,
});
const historyTargetFaction = historyRuntime.snapshot().combat.combatants[historyTarget.name].faction;
assert.equal(historyRuntime.getCombatantLiteraryName(historyTarget.name), "Стражник",
    "Person hover/status resolution must expose the registered literary name");
assert.equal(historyRuntime.invokeHost("rs_settribesrelation", [historyTargetFaction, "hero", 2]), 0);
assert.equal(historyRuntime.invokeHost("rs_settribesrelation", ["hero", historyTargetFaction, 2]), 0);
attackRolls = [0.99, 0, 0.99, 0.5, 0.5, 0.5, 0.5];
historyRuntime.setCombatantPosition(historyTarget.name, { x: 0, y: 0 });
const hitResult = historyRuntime.attackPerson(historyTarget.name);
assert.equal(hitResult?.hit, true, "The deterministic history probe must land a physical hit");
assert.equal(historyRuntime.invokeHost("rs_gettribesrelation", [historyTargetFaction, "hero"]), 0,
    "A damaged faction must become hostile toward its attacker");
assert.equal(historyRuntime.invokeHost("rs_gettribesrelation", ["hero", historyTargetFaction]), 2,
    "Damage hostility must not reverse the native directional relation");
assert.ok(historyMessages.includes(`Вертас наносит Стражник ${hitResult.appliedDamage} пунктов повреждений`),
    "Physical hits must publish the native attacker/target/damage history template");

historyRuntime.setCombatMode(false);
historyRuntime.setCombatMode(true);
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
assert.equal(spiderTemplate.experienceValue, 21);
assert.equal(spiderTemplate.reputationDelta, 0);
const negativeReputationScript = new TextDecoder("windows-1251").decode(await readFile(resolve(
    `public/assets/scripts/persons/${enemy.name.toLowerCase()}.scr`,
)));
const negativeReputationTemplate = parsePersonCombatScript(enemy.name, negativeReputationScript);
assert.equal(negativeReputationTemplate.experienceValue, 1);
assert.equal(negativeReputationTemplate.reputationDelta, -1);

const rewardScript = new TextDecoder("windows-1251").decode(await readFile(resolve(
    `public/assets/scripts/persons/${ally.name.toLowerCase()}.scr`,
)));
const rewardTemplate = parsePersonCombatScript(ally.name, rewardScript);
assert.equal(rewardTemplate.experienceValue, 20);
assert.equal(rewardTemplate.reputationDelta, 0);
const rewardTarget = { ...ally, literaryLabel: "Плотник", position: { x: 0, y: 0 } };
const rewardHeroParameters = Object.freeze({
    ...baselineHeroParameters,
    strength: 30,
    dexterity: 30,
    luck: 30,
    skill_wpn_hand: 15,
});
let rewardAttackPhase = false;
let rewardAttackRolls = [];
const rewardRuntime = await loadAiRuntime(rewardTarget, {
    random: () => rewardAttackPhase ? rewardAttackRolls.shift() ?? 0.5 : 0,
}, rewardHeroParameters);
rewardAttackPhase = true;
const rewardFaction = rewardRuntime.snapshot().combat.combatants[rewardTarget.name].faction;
assert.equal(rewardRuntime.invokeHost("rs_settribesrelation", [rewardFaction, "hero", 0]), 0);
assert.equal(rewardRuntime.invokeHost("rs_settribesrelation", ["hero", rewardFaction, 0]), 0);
rewardRuntime.setCombatantPosition(rewardTarget.name, { x: 0, y: 0 });
for (let attack = 0; attack < 64 && !rewardRuntime.snapshot().combat.combatants[rewardTarget.name].dead; attack += 1) {
    rewardAttackRolls = [0.99, 0, 0.99, 0.5, 0.5, 0.5, 0.5];
    rewardRuntime.setCombatMode(false);
    rewardRuntime.setCombatMode(true);
    const result = rewardRuntime.attackPerson(rewardTarget.name);
    assert.ok(result, "The deterministic death-reward probe must perform an attack");
}
const rewardSnapshot = rewardRuntime.snapshot();
assert.equal(rewardSnapshot.combat.combatants[rewardTarget.name].dead, true,
    "The deterministic death-reward probe must kill the shipped person");
assert.equal(rewardSnapshot.experience, rewardTemplate.experienceValue,
    "A credited death must award the person's authored experience_value");
assert.equal(rewardRuntime.invokeHost("rs_getpersonparameteri", ["Hero", "reputation"]), rewardTemplate.reputationDelta,
    "A credited death must apply the person's authored reputation_delta");
assert.equal(rewardSnapshot.bestiaryKills[rewardTemplate.resourceId.toLowerCase()], 1,
    "A credited death must update the shipped bestiary resource counter");

const mover = { ...enemy, name: "L0.M15_Spider", tribe: "ai_mover", position: { x: 20, y: 20 } };
let moverWorld = { x: mover.position.x * 12, y: mover.position.y * 9 };
const movementSteps = [];
const attackAnimations = [];
const aiActionEvents = [];
let movingSimulationTime = 0;
const attackTimes = [];
let heroTurnAfterAttacks;
const movingRuntime = await loadAiRuntime(mover, {
    onCombatantMoveRequest: (technicalName, targetPosition, away) => {
        assert.equal(technicalName, mover.name);
        const direction = away ? -1 : 1;
        moverWorld = {
            x: moverWorld.x + Math.sign(targetPosition.x - moverWorld.x) * 12 * direction,
            y: moverWorld.y + Math.sign(targetPosition.y - moverWorld.y) * 9 * direction,
        };
        movementSteps.push({ ...moverWorld });
        aiActionEvents.push("move");
        return { position: moverWorld, durationMs: 200 };
    },
    onCombatAnimation: (technicalName, kind) => {
        attackAnimations.push([technicalName, kind]);
        if (technicalName === mover.name && kind === "attack") {
            aiActionEvents.push("attack");
            attackTimes.push(movingSimulationTime);
            return 900;
        }
        return undefined;
    },
    onCombatantFace: (technicalName, targetPosition) => attackAnimations.push(["face", technicalName, targetPosition]),
}, { ...baselineHeroParameters, constitution: 100 });
const moverFaction = movingRuntime.snapshot().combat.combatants[mover.name].faction;
movingRuntime.attackPerson(mover.name);
assert.equal(movingRuntime.invokeHost("rs_settribesrelation", [moverFaction, "hero", 0]), 0);
assert.equal(movingRuntime.endCombatTurn(), true);
for (movingSimulationTime = 0; movingSimulationTime <= 20000; movingSimulationTime += 100) {
    movingRuntime.update(movingSimulationTime, movingSimulationTime, { x: 0, y: 0 }, movingSimulationTime);
    if (movingRuntime.snapshot().combat.currentCombatant === "hero") {
        heroTurnAfterAttacks = movingSimulationTime;
        break;
    }
}
assert.ok(movementSteps.length > 0, "AI combatant must walk toward a distant hostile target");
assert.ok(attackAnimations.some(([technicalName, kind]) => technicalName === mover.name && kind === "attack"),
    "AI combatant must attack after reaching weapon range");
const firstAiAttack = aiActionEvents.indexOf("attack");
assert.ok(firstAiAttack > 0 && aiActionEvents[firstAiAttack - 1] === "move",
    "An advance that reaches weapon range must finish its authored movement before dispatching the attack");
assert.ok(attackAnimations.some(([kind, technicalName]) => kind === "face" && technicalName === mover.name),
    "AI combatant must face its target before attacking");
assert.ok(attackTimes.length > 0, "The AI pacing probe must dispatch at least one weapon attack");
for (let index = 1; index < attackTimes.length; index += 1) {
    assert.ok(attackTimes[index] - attackTimes[index - 1] >= 900,
        "An AI weapon attack must finish its authored animation before the next attack starts");
}
assert.ok(heroTurnAfterAttacks !== undefined && heroTurnAfterAttacks - attackTimes.at(-1) >= 900,
    "The final AI weapon animation must finish before control returns to the hero");
const retryActor = { ...mover, position: { x: 20, y: 20 } };
const retryAlly = { ...ally, position: { x: 10, y: 10 } };
let retryActorWorld = { x: retryActor.position.x * 12, y: retryActor.position.y * 9 };
const retryTargets = [];
const retryRuntime = await loadAiRuntime([retryActor, retryAlly], {
    onCombatantMoveRequest: (technicalName, targetPosition) => {
        assert.equal(technicalName, retryActor.name);
        retryTargets.push({ ...targetPosition });
        if (retryTargets.length === 1) return undefined;
        retryActorWorld = {
            x: retryActorWorld.x + Math.sign(targetPosition.x - retryActorWorld.x) * 12,
            y: retryActorWorld.y + Math.sign(targetPosition.y - retryActorWorld.y) * 9,
        };
        return { position: retryActorWorld, durationMs: 200 };
    },
});
assert.equal(retryRuntime.invokeHost("rs_addtoheropartyname", [retryAlly.name]), 1);
const retryActorFaction = retryRuntime.snapshot().combat.combatants[retryActor.name].faction;
const retryAllyFaction = retryRuntime.snapshot().combat.combatants[retryAlly.name].faction;
assert.equal(retryRuntime.invokeHost("rs_settribesrelation", [retryActorFaction, retryAllyFaction, 0]), 0);
assert.equal(retryRuntime.invokeHost("rs_settribesrelation", [retryActorFaction, "hero", 0]), 0);
retryRuntime.setCombatMode(true);
retryRuntime.setCombatantPosition(retryActor.name, retryActorWorld);
assert.equal(retryRuntime.endCombatTurn(), true);
retryRuntime.update(0, 0, { x: 0, y: 0 }, 0);
retryRuntime.update(351, 351, { x: 0, y: 0 }, 351);
assert.deepEqual(retryTargets.slice(0, 2), [
    { x: 0, y: 0 },
    { x: retryAlly.position.x * 12, y: retryAlly.position.y * 9 },
], "A blocked top-ranked target must fall through to the next native-ranked target in the same dispatch");

const caster = { ...enemy, name: "L0.M25_Salamandr", tribe: "ai_caster", position: { x: 30, y: 30 } };
const magicMessages = [];
const magicEffects = [];
const castAnimations = [];
let firstCasterAction;
let castingSimulationTime = 0;
const castTimes = [];
let heroTurnAfterCasts;
const castingRuntime = await loadAiRuntime({ ...caster, literaryLabel: "Саламандра" }, {
    onCombatantMoveRequest: () => {
        firstCasterAction ??= "move";
        return undefined;
    },
    onMagicEffect: (technicalName, targetName) => magicEffects.push([technicalName, targetName]),
    onCombatAnimation: (technicalName, kind) => {
        castAnimations.push([technicalName, kind]);
        if (technicalName === caster.name && kind === "cast") {
            firstCasterAction ??= "cast";
            castTimes.push(castingSimulationTime);
            return 1020;
        }
        return undefined;
    },
    onMessage: (message) => magicMessages.push(String(message)),
    resolveHeroName: () => "Вертас",
    resolveInterfaceString: (id) => interfaceStrings[id],
}, { ...baselineHeroParameters, constitution: 100 });
const casterFaction = castingRuntime.snapshot().combat.combatants[caster.name].faction;
castingRuntime.attackPerson(caster.name);
assert.equal(castingRuntime.invokeHost("rs_settribesrelation", [casterFaction, "hero", 0]), 0);
assert.equal(castingRuntime.endCombatTurn(), true);
for (castingSimulationTime = 0; castingSimulationTime <= 20000; castingSimulationTime += 100) {
    castingRuntime.update(castingSimulationTime, castingSimulationTime, { x: 0, y: 0 }, castingSimulationTime);
    if (castingRuntime.snapshot().combat.currentCombatant === "hero") {
        heroTurnAfterCasts = castingSimulationTime;
        break;
    }
}
assert.ok(magicEffects.some(([, targetName]) => targetName === "hero"), "AI caster must apply an offensive spell to the hero");
assert.ok(castAnimations.some(([technicalName, kind]) => technicalName === caster.name && kind === "cast"),
    "Spell casts must dispatch the caster's dedicated cast animation instead of a weapon attack animation");
assert.equal(castAnimations.some(([technicalName, kind]) => technicalName === caster.name && kind === "attack"), false,
    "Spell casts must not reuse the caster's ordinary attack animation");
assert.equal(firstCasterAction, "cast", "AI caster should cast before closing to weapon range when battle magic is selected");
assert.ok(magicMessages.some((message) => message.startsWith("Саламандра применяет магию ")),
    "Spell casts must publish the native caster/spell history template");
assert.ok(castTimes.length > 0, "The AI pacing probe must dispatch at least one spell cast");
for (let index = 1; index < castTimes.length; index += 1) {
    assert.ok(castTimes[index] - castTimes[index - 1] >= 1020,
        "An AI spell cast must finish its authored animation before the next cast starts");
}
assert.ok(heroTurnAfterCasts !== undefined && heroTurnAfterCasts - castTimes.at(-1) >= 1020,
    "The final AI cast animation must finish before control returns to the hero");

const detectingRuntime = await loadAiRuntime(mover, {
    onCombatantCanSee: () => true,
});
const detectingMoverFaction = detectingRuntime.snapshot().combat.combatants[mover.name].faction;
assert.equal(detectingRuntime.invokeHost("rs_settribesrelation", [detectingMoverFaction, "hero", 0]), 0);
detectingRuntime.update(0, 0, { x: moverWorld.x - 12, y: moverWorld.y - 9 }, 0);
assert.equal(detectingRuntime.snapshot().combat.active, true, "Hostile actor must start combat inside radius_see");

const duplicateRuntime = new GameStateRuntime({ onLoadArea() {}, random: () => 0 });
duplicateRuntime.initializeHeroProfile(baselineHeroParameters, 0);
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
console.log("Verified native AI target scoring, relation filtering, low-health probability, movement-cost arithmetic, blocked-target fallback, advance-and-attack timing, eight-direction 10/14 routing, diagonal destination-footprint legality, directional faction relations, hero-party damage immunity, victim hostility, combat history, credited death experience/reputation/bestiary rewards, perception radii, automatic combat, duplicate-instance identity, movement AP, facing, AI movement, weapon attacks, spellcasting, asynchronous turns, round reset, and combat termination");
