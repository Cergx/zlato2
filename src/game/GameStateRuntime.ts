import { Paths } from "../constants/paths.ts";
import type { LevelData } from "./Level.ts";
import {
    ScenarioRuntime,
    type NpcRouteState,
    type ScenarioDoorChange,
    type ScenarioScriptRequest,
    type ScenarioTriggerState,
} from "./ScenarioRuntime.ts";
import {
    SCRRuntime,
    extractSCREventHandler,
    parseSCR,
    type SCRProgram,
    type SCRValue,
} from "./scripts/SCRRuntime.ts";
import type { GameSaveData } from "./PersistenceRuntime.ts";
import {
    FactionRelations,
    createCombatant,
    createOriginalCombatProfile,
    resolveOriginalAttack,
    type Combatant,
    type FactionRelation,
    type OriginalAttackResult,
    type OriginalCombatProfile,
    type OriginalWeaponProfile,
} from "./systems/Combat.ts";
import { cellToWorld, worldToCell, type WorldPosition } from "./WorldCoordinates.ts";
import type { EquipmentSlot } from "./systems/Items.ts";
import { materializeInventory, parseInventoryScript } from "./parsers/INVParser.ts";
import { loadPersonCombatAssets, type PersonCombatAssets } from "./PersonAssetRuntime.ts";
import type { ShippedItem } from "./ItemCatalogRuntime.ts";
import type { SoundShaderDefinition } from "./SoundShaderRuntime.ts";
import type { Direction, RouteType, SEFPerson } from "./parsers/SEFParser.ts";
import {
    loadMagicCatalog,
    magicActionPointCost,
    magicDamageChannel,
    magicDuration,
    magicEnergyCost,
    magicValue,
    type MagicCastResult,
    type MagicDamageChannel,
    type MagicDefinition,
    type MagicSpecialDefinition,
} from "./MagicCatalogRuntime.ts";


export interface DynamicPersonDefinition extends SEFPerson {
    literaryLabel: string;
}

interface DynamicPersonRoute {
    routeType: RouteType;
    route?: string;
    radius: number;
    delayMin: number;
    delayMax: number;
}


export interface AreaTransitionRequest {
    gameMode: LevelData["gameMode"];
    level: string;
    entrance?: string;
}

export type CombatAnimationKind = "attack" | "suffer" | "die";

export interface CombatantRuntimeSnapshot {
    readonly health: number;
    readonly maximumHealth: number;
    readonly energy: number;
    readonly maximumEnergy: number;
    readonly actionPoints: number;
    readonly maximumActionPoints: number;
    readonly initiative: number;
    readonly dead: boolean;
    readonly profile: OriginalCombatProfile;
}

export interface CombatRuntimeSnapshot {
    readonly active: boolean;
    readonly round: number;
    readonly currentCombatant?: string;
    readonly message: string;
    readonly combatants: Readonly<Record<string, CombatantRuntimeSnapshot>>;
}

export interface MagicEffectRuntimeSnapshot {
    readonly spellId: number;
    readonly specialId: string;
    readonly targetName: string;
    readonly value: number;
    readonly remainingMinutes: number;
}

export interface MagicRuntimeSnapshot {
    readonly knownSpellIds: readonly number[];
    readonly hotbarSpellIds: readonly (number | null)[];
    readonly castableSpellIds: readonly number[];
    readonly activeEffects: readonly MagicEffectRuntimeSnapshot[];
    readonly selectedSpellId?: number;
}

export interface RegenerationElapsedRuntimeSnapshot {
    readonly health: number;
    readonly energy: number;
}


export interface GameRuntimeSnapshot {
    variables: Readonly<Record<string, SCRValue>>;
    persons: Readonly<Record<string, boolean>>;
    inventories: Readonly<Record<string, Readonly<Record<string, number>>>>;
    equipped: Readonly<Partial<Record<EquipmentSlot, string>>>;
    questFlags: Readonly<Record<string, boolean>>;
    stageFlags: Readonly<Record<string, boolean>>;
    locationAccess: Readonly<Record<string, number>>;
    personParameters: Readonly<Record<string, Readonly<Record<string, number>>> >;
    experience: number;
    elapsedMinutes: number;
    magic: MagicRuntimeSnapshot;
    regenerationElapsed: Readonly<Record<string, RegenerationElapsedRuntimeSnapshot>>;
    combat: CombatRuntimeSnapshot;
}

export interface GameStateRuntimeOptions {
    onLoadArea: (request: AreaTransitionRequest) => void;
    onGlobalMap?: () => void;
    onDialog?: (arguments_: readonly SCRValue[]) => void;
    onPersonPresence?: (technicalName: string, present: boolean) => void;
    onDynamicPerson?: (person: DynamicPersonDefinition) => void;
    onDoorChange?: (change: ScenarioDoorChange) => void;
    onTriggerChange?: (trigger: ScenarioTriggerState) => void;
    onFinished?: (ending: number) => void;
    onHeroDeath?: () => void;
    onTrade?: () => void;
    onContainerOpen?: (owner: string, triggerName: string) => void;
    onMessage?: (message: SCRValue) => void;
    onWeather?: (type: number) => void;
    onSound?: (arguments_: readonly SCRValue[]) => void;
    onPersonSound?: (shader: SoundShaderDefinition) => void;
    onCombatAnimation?: (technicalName: string, kind: CombatAnimationKind) => void;
    onMagicEffect?: (technicalName: string, targetName: string) => void;
    random?: () => number;
    now?: () => Date;
    addonMode?: boolean;
}

const relationScores: Readonly<Record<FactionRelation, number>> = {
    hostile: 0,
    neutral: 1,
    friendly: 2,
};

const relationFromScript = (value: SCRValue): FactionRelation => {
    if (typeof value === "number") return value >= 2 ? "friendly" : value <= 0 ? "hostile" : "neutral";
    const normalized = String(value).toLowerCase();
    if (normalized.includes("evil") || normalized.includes("hostile")) return "hostile";
    if (normalized.includes("good") || normalized.includes("friend")) return "friendly";
    return "neutral";
};

const decodeScript = async (path: string): Promise<string> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to load SCR script ${path}: HTTP ${response.status}`);
    if (response.headers.get("content-type")?.includes("text/html")) throw new Error(`SCR script ${path} resolved to the application shell`);
    return new TextDecoder("windows-1251").decode(await response.arrayBuffer());
};

const stringArgument = (arguments_: readonly SCRValue[], index: number, call: string): string => {
    const value = arguments_[index];
    if (typeof value !== "string" || value.length === 0) throw new Error(`${call} argument ${index + 1} must be a non-empty string`);
    return value;
};

const numberArgument = (arguments_: readonly SCRValue[], index: number, call: string): number => {
    const value = arguments_[index];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${call} argument ${index + 1} must be a finite number`);
    return value;
};
const integerArgument = (arguments_: readonly SCRValue[], index: number, call: string): number => {
    const value = numberArgument(arguments_, index, call);
    if (!Number.isSafeInteger(value)) throw new Error(`${call} argument ${index + 1} must be a safe integer`);
    return value;
};


const optionalStringArgument = (arguments_: readonly SCRValue[], index: number, call: string): string => {
    const value = arguments_[index];
    if (typeof value !== "string") throw new Error(`${call} argument ${index + 1} must be a string`);
    return value;
};

const ROUTE_TYPES: readonly RouteType[] = ["STAY", "RANDOM_RADIUS", "STAY_ROTATE", "MOVED_FLIP", "MOVED", "RANDOM"];
const DIRECTIONS: readonly Direction[] = ["LEFT", "RIGHT", "UP", "DOWN", "UP_LEFT", "UP_RIGHT", "DOWN_LEFT", "DOWN_RIGHT"];

const enumArgument = <T extends string>(value: string, values: readonly T[], call: string, index: number): T => {
    if (!values.includes(value as T)) throw new Error(`${call} argument ${index + 1} has unsupported value ${value}`);
    return value as T;
};
const ALLY_COMMANDS: Readonly<Record<string, number>> = {
    CMD_ALLY_DO_NOT_FIGHT: 0,
    CMD_ALLY_ALL_TARGET: 1,
    CMD_ALLY_WEAK_TARGET: 2,
    CMD_ALLY_HERO_DANGER: 3,
    CMD_ALLY_HERO_TARGET: 4,
    CMD_ALLY_NOT_HERO_TARGET: 5,
};


export const EQUIPPED_INVENTORY_OWNER = "__hero_equipped__";


interface ActiveMagicEffect {
    readonly spellId: number;
    readonly specialId: string;
    readonly targetName: string;
    readonly value: number;
    remainingMinutes: number;
}

interface CombatProfileSource {
    readonly parameters: Readonly<Record<string, number>>;
    readonly items: readonly ShippedItem[];
    readonly base: Partial<Pick<Parameters<typeof createOriginalCombatProfile>[0], "baseHealth" | "baseEnergy" | "baseHitChance" | "baseActionPoints" | "baseArmorClass">>;
}
const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
    "mainHand", "offHand", "ammo", "head", "body", "arms", "bracelet", "amulet", "ringLeft", "ringRight",
];
const MAGIC_SPELL_COUNT = 78;
const MAGIC_HOTBAR_SIZE = 9;
const magicSpellParameter = (magicId: number): string => `magic_spell_${magicId}`;
const magicHotbarParameter = (slot: number): string => `magic_hotbar_${slot}`;


const itemSpecialParameterName = (specialId: number): string => {
    const attributes: Readonly<Record<number, string>> = {
        6: "strength",
        7: "constitution",
        8: "perception",
        9: "dexterity",
        10: "intelligence",
        11: "wisdom",
        12: "luck",
        48: "health",
        49: "energy",
    };
    return attributes[specialId] ?? `item_special_${specialId}`;
};

const COMBAT_SPECIAL_MODIFIERS: Readonly<Record<number, string>> = {
    0: "poisonDamage",
    1: "coldDamage",
    2: "fireDamage",
    3: "poisonResistance",
    4: "coldResistance",
    5: "fireResistance",
    13: "godsMagicResistance",
    14: "elementsMagicResistance",
    15: "lightMagicResistance",
    16: "darkMagicResistance",
    17: "shadowsMagicResistance",
    18: "natureMagicResistance",
    19: "hackingResistance",
    20: "crushingResistance",
    21: "prickingResistance",
    22: "maxHealth",
    23: "maxEnergy",
    24: "initiative",
    27: "actionPoints",
    29: "armorClass",
    30: "maxWeight",
    33: "hackingDamage",
    34: "crushingDamage",
    35: "prickingDamage",
    42: "godsMagicImmunity",
    43: "elementsMagicImmunity",
    44: "lightMagicImmunity",
    45: "darkMagicImmunity",
    46: "shadowsMagicImmunity",
    47: "natureMagicImmunity",
    50: "hitChance",
    51: "criticalChance",
    52: "criticalDamage",
    53: "criticalMissChance",
};

const shiftedDamage = (range: Readonly<{ min: number; max: number }>, amount: number) => ({
    min: Math.max(0, range.min + amount),
    max: Math.max(0, range.max + amount),
});

const SUMMON_SPECIALS: Readonly<Record<string, string>> = {
    IDSPEC_SUMMON_DEMISHADOW: "l0.m59_demishadow",
    IDSPEC_SUMMON_ICE_BEAST: "l0.m60_beast",
    IDSPEC_SUMMON_WINGED_DEMON: "l0.m32_winged_demon02",
    IDSPEC_SUMMON_VIOLIA: "l0.m10_u_violia",
};

const MAGIC_ATTRIBUTE_PARAMETERS: Readonly<Record<string, string>> = {
    IDSPEC_CONSTITUTION: "constitution",
    IDSPEC_DEXTERITY: "dexterity",
    IDSPEC_INTELLIGENCE: "intelligence",
    IDSPEC_LUCK: "luck",
    IDSPEC_STRENGTH: "strength",
    IDSPEC_WISDOM: "wisdom",
};

const MAGIC_PROFILE_MODIFIERS: Readonly<Record<string, string>> = {
    IDSPEC_ACTION_POINTS: "actionPoints",
    IDSPEC_ARMOR_CLASS: "armorClass",
    IDSPEC_CHT_CRITICAL_HIT: "criticalChance",
    IDSPEC_CHT_CRITICAL_MISS: "criticalMissChance",
    IDSPEC_CHT_HIT: "hitChance",
    IDSPEC_CHT_HIT_THROWING: "hitChance",
    IDSPEC_COLD_RES: "coldResistance",
    IDSPEC_CRUSHING_RES: "crushingResistance",
    IDSPEC_DARKNESS_MAGIC_IMMUN: "darkMagicImmunity",
    IDSPEC_DARKNESS_MAGIC_RES: "darkMagicResistance",
    IDSPEC_ELEMENTS_MAGIC_IMMUN: "elementsMagicImmunity",
    IDSPEC_ELEMENTS_MAGIC_RES: "elementsMagicResistance",
    IDSPEC_FIRE_RES: "fireResistance",
    IDSPEC_GODS_MAGIC_IMMUN: "godsMagicImmunity",
    IDSPEC_GODS_MAGIC_RES: "godsMagicResistance",
    IDSPEC_LIGHTNESS_MAGIC_IMMUN: "lightMagicImmunity",
    IDSPEC_LIGHTNESS_MAGIC_RES: "lightMagicResistance",
    IDSPEC_HACKING_RES: "hackingResistance",
    IDSPEC_HEALTH_REGENERATE_TIME: "healthRegenerationTime",
    IDSPEC_ENERGY_REGENERATE_TIME: "energyRegenerationTime",
    IDSPEC_INITIATIVE: "initiative",
    IDSPEC_MAX_HEALTH: "maxHealth",
    IDSPEC_MOD_CRITICAL_HIT: "criticalDamage",
    IDSPEC_NATURE_MAGIC_IMMUN: "natureMagicImmunity",
    IDSPEC_NATURE_MAGIC_RES: "natureMagicResistance",
    IDSPEC_POISON_RES: "poisonResistance",
    IDSPEC_PRICKING_RES: "prickingResistance",
    IDSPEC_SHADOWS_MAGIC_IMMUN: "shadowsMagicImmunity",
    IDSPEC_SHADOWS_MAGIC_RES: "shadowsMagicResistance",
};

const dynamicPersonLevelKey = (levelData: LevelData): string => `${levelData.gameMode}:${levelData.levelName.toLowerCase()}`;

export class GameStateRuntime {
    private readonly scr: SCRRuntime;
    private readonly factions = new FactionRelations();
    private readonly persons = new Map<string, boolean>();
    private readonly inventories = new Map<string, Map<string, number>>();
    private readonly questFlags = new Map<string, boolean>();
    private readonly stageFlags = new Map<string, boolean>();
    private readonly locationAccess = new Map<string, number>();
    private readonly personParameters = new Map<string, Map<string, number>>();
    private readonly personConditions = new Map<string, Map<string, number | boolean>>();
    private readonly equipped: Partial<Record<EquipmentSlot, string>> = {};
    private readonly combatants = new Map<string, Combatant>();
    private readonly personSounds = new Map<string, PersonCombatAssets["sounds"]>();
    private readonly corpseInventorySources = new Map<string, string>();
    private readonly lootableCorpses = new Set<string>();
    private readonly random: () => number;
    private readonly combatProfiles = new Map<string, OriginalCombatProfile>();
    private readonly combatItems = new Map<string, readonly ShippedItem[]>();
    private readonly registeredItems = new Map<string, ShippedItem>();
    private readonly combatProfileSources = new Map<string, CombatProfileSource>();
    private readonly combatantPositions = new Map<string, WorldPosition>();
    private readonly activeMagicEffects: ActiveMagicEffect[] = [];
    private readonly healthRegenerationElapsed = new Map<string, number>();
    private readonly energyRegenerationElapsed = new Map<string, number>();
    private lastPlayerPosition: WorldPosition = { x: 0, y: 0 };
    private readonly activeEnemies = new Set<string>();
    private readonly magicDefinitions = new Map<number, MagicDefinition>();
    private selectedMagicId: number | undefined;
    private dynamicPersons: DynamicPersonDefinition[] = [];
    private readonly dynamicPersonsByLevel = new Map<string, DynamicPersonDefinition[]>();
    private pendingDynamicRoute: DynamicPersonRoute | undefined;
    private pendingDynamicCombatLoads: Promise<void>[] = [];
    private currentDynamicPersonLevel = "";
    private combatActive = false;
    private combatRound = 0;
    private currentCombatant: string | undefined;
    private combatMessage = "";
    private remainingActionPoints = new Map<string, number>();
    private scenario: ScenarioRuntime | null = null;
    private levelData: LevelData | null = null;
    private coreProgram: SCRProgram | null = null;
    private generation = 0;
    private experience = 0;
    private elapsedMinutes = 0;
    private lastCoreTick = 0;
    private lastSimulationTimeMs: number | undefined;
    private clockAccumulatorMs = 0;
    private npcRoutes: readonly NpcRouteState[] = [];

    public constructor(private readonly options: GameStateRuntimeOptions) {
        this.random = options.random ?? Math.random;
        this.scr = new SCRRuntime({ host: { call: (name, arguments_) => this.callHost(name, arguments_) } });
    }

    public async loadLevel(levelData: LevelData): Promise<void> {
        const generation = ++this.generation;
        this.levelData = levelData;
        this.coreProgram = levelData.coreScript ? parseSCR(levelData.coreScript, `${levelData.levelName}/core.scr`) : null;
        this.lastCoreTick = 0;
        this.lastSimulationTimeMs = undefined;
        this.clockAccumulatorMs = 0;
        this.pendingDynamicRoute = undefined;
        this.pendingDynamicCombatLoads = [];
        this.currentDynamicPersonLevel = dynamicPersonLevelKey(levelData);
        this.dynamicPersons = (this.dynamicPersonsByLevel.get(this.currentDynamicPersonLevel) ?? [])
            .map((person) => ({ ...person, position: { ...person.position } }));

        const personDefinitions = [...levelData.sefData.persons, ...this.dynamicPersons];
        const [personAssets, heroAssets, magicDefinitions] = await Promise.all([
            Promise.all(personDefinitions.map(async (person) => [
                person.name.toLowerCase(),
                await loadPersonCombatAssets(person.name),
            ] as const)),
            loadPersonCombatAssets("hero"),
            loadMagicCatalog(),
        ]);
        if (generation !== this.generation) return;
        this.magicDefinitions.clear();
        for (const definition of magicDefinitions) this.magicDefinitions.set(definition.id, definition);
        this.scenario = new ScenarioRuntime(levelData.sefData, levelData.lvlData, levelData.triggerCells, {
            random: this.random,
            onScript: (request) => void this.executeTriggerRequest(request, generation),
            onDoorChange: (change) => this.options.onDoorChange?.(change),
            onTriggerChange: ({ trigger }) => this.options.onTriggerChange?.(trigger),
        });
        const assets = new Map(personAssets);
        this.createCombatants(levelData, assets, heroAssets);
        for (const person of this.dynamicPersons) this.registerPersonCombatant(person, assets.get(person.name.toLowerCase()));
        if (levelData.initScript) this.scr.execute(levelData.initScript, `${levelData.levelName}/init.scr`);
        await Promise.all(this.pendingDynamicCombatLoads);
    }

    public update(tick: number, simulationTimeMs: number, playerPosition: Readonly<WorldPosition>): void {
        if (!this.scenario || !this.levelData) return;
        this.lastPlayerPosition = { ...playerPosition };
        this.scenario.setPlayerWorldPosition(playerPosition);
        if (this.lastSimulationTimeMs !== undefined) {
            const delta = simulationTimeMs - this.lastSimulationTimeMs;
            if (delta >= 0 && delta < 60_000) {
                this.clockAccumulatorMs += delta;
                const elapsedGameMinutes = Math.floor(this.clockAccumulatorMs / 1000);
                if (elapsedGameMinutes > 0) {
                    this.clockAccumulatorMs -= elapsedGameMinutes * 1000;
                    this.advanceClock(elapsedGameMinutes);
                }
            }
        }
        this.lastSimulationTimeMs = simulationTimeMs;
        this.npcRoutes = this.scenario.advanceRoutes(simulationTimeMs);
        if (this.coreProgram && tick - this.lastCoreTick >= 20) {
            this.lastCoreTick = tick;
            this.scr.executeProgram(this.coreProgram);
        }
    }

    public getScenario(): ScenarioRuntime | null {
        return this.scenario;
    }

    public getNpcRoutes(): readonly NpcRouteState[] {
        return this.npcRoutes;
    }

    public getDynamicPersons(): readonly DynamicPersonDefinition[] {
        return this.dynamicPersons.map((person) => ({ ...person, position: { ...person.position } }));
    }


    public getScenarioRuntime(): ScenarioRuntime | null {
        return this.scenario;
    }
    public toggleDoor(name: string): boolean {
        const scenario = this.scenario;
        if (!scenario) return false;
        scenario.toggleDoor(name);
        return true;
    }

    public async interactTrigger(name: string): Promise<boolean> {
        const scenario = this.scenario;
        if (!scenario) return false;
        const trigger = scenario.interactTrigger(name);
        if (!trigger.active) return false;
        if (!trigger.inventoryName) return true;

        const inventoryOwner = `trigger:${trigger.name}`;
        if (!this.inventories.has(inventoryOwner)) {
            const fileName = trigger.inventoryName.toLowerCase().endsWith(".inv")
                ? trigger.inventoryName.toLowerCase()
                : `${trigger.inventoryName.toLowerCase()}.inv`;
            const response = await fetch(`${Paths.SCRIPTS}/inventory/${fileName}`);
            if (!response.ok) throw new Error(`Failed to load trigger inventory ${fileName}: HTTP ${response.status}`);
            const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
            this.initializeInventory(inventoryOwner, materializeInventory(parseInventoryScript(source), this.random));
        }
        this.options.onContainerOpen?.(inventoryOwner, trigger.name);
        return true;
    }

    public initializeHeroProfile(parameters: Readonly<Record<string, number>>, experience: number): void {
        if (!Number.isFinite(experience) || experience < 0) throw new Error("Hero experience must be a non-negative finite number");
        const existing = this.personParameters.get("Hero");
        if (existing && existing.size > 0) return;
        for (const [name, value] of Object.entries(parameters)) {
            if (!Number.isFinite(value)) throw new Error(`Hero parameter ${name} must be finite`);
            this.setPersonParameter("Hero", name, value);
        }
        this.experience = experience;
    }

    public adjustHeroProgression(
        parameter: string,
        pointPool: "person_points" | "skill_points",
        direction: 1 | -1,
        minimum: number,
        maximum: number,
    ): boolean {
        const values = this.personParameters.get("Hero");
        if (!values) return false;
        const normalized = parameter.toLowerCase();
        const current = values.get(normalized) ?? 0;
        const points = values.get(pointPool) ?? 0;
        if (!Number.isSafeInteger(current) || !Number.isSafeInteger(points)) return false;

        if (direction > 0) {
            const next = current + 1;
            if (next > maximum || points < next) return false;
            values.set(normalized, next);
            values.set(pointPool, points - next);
            return true;
        }

        if (current <= minimum) return false;
        values.set(normalized, current - 1);
        values.set(pointPool, points + current);
        return true;
    }

    public initializeInventory(owner: string, items: Readonly<Record<string, number>>): void {
        const existingOwner = this.inventoryOwner(owner);
        if (this.inventories.has(existingOwner)) return;
        const inventory = new Map<string, number>();
        for (const [item, quantity] of Object.entries(items)) {
            if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`Invalid initial quantity for ${item}`);
            inventory.set(item, quantity);
        }
        this.inventories.set(owner, inventory);
    }

    public getInventory(owner: string): Readonly<Record<string, number>> {
        const inventory = this.inventories.get(this.inventoryOwner(owner));
        return inventory ? Object.fromEntries(inventory) : {};
    }

    public transferInventoryItem(source: string, destination: string, item: string, quantity: number): boolean {
        return this.transferItem(source, destination, item, quantity) === 1;
    }

    public transferInventoryAll(source: string, destination: string): void {
        this.transferAllItems(source, destination);
    }

    public async interactDeadPerson(technicalName: string): Promise<boolean> {
        const resolvedName = this.resolveCombatantName(technicalName);
        const normalized = resolvedName?.toLowerCase() ?? technicalName.toLowerCase();
        const combatant = resolvedName ? this.combatants.get(resolvedName) : undefined;
        const inventorySource = this.corpseInventorySources.get(normalized);
        if (!combatant?.isDead || !this.lootableCorpses.has(normalized) || !inventorySource) return false;

        const inventoryOwner = `corpse:${resolvedName ?? technicalName}`;
        if (!this.inventories.has(this.inventoryOwner(inventoryOwner))) {
            const fileName = inventorySource.toLowerCase().endsWith(".inv")
                ? inventorySource.toLowerCase()
                : `${inventorySource.toLowerCase()}.inv`;
            const response = await fetch(`${Paths.SCRIPTS}/inventory/${fileName}`);
            if (!response.ok) throw new Error(`Failed to load corpse inventory ${fileName}: HTTP ${response.status}`);
            const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
            this.initializeInventory(inventoryOwner, materializeInventory(parseInventoryScript(source), this.random));
        }
        this.options.onContainerOpen?.(inventoryOwner, resolvedName ?? technicalName);
        return true;
    }

    public registerItem(item: ShippedItem): void {
        this.registeredItems.set(item.technicalName.toLowerCase(), item);
        this.refreshHeroCombatProfile();
    }

    public equipHeroItem(item: string, slot: EquipmentSlot): boolean {
        if (!EQUIPMENT_SLOTS.includes(slot)) throw new Error(`Unknown equipment slot ${slot}`);
        if (this.itemCount("Hero", item) < 1) return false;
        const previous = this.equipped[slot];
        if (previous?.toLowerCase() === item.toLowerCase()) return true;
        this.changeItemCount("Hero", item, -1);
        if (previous) this.changeItemCount("Hero", previous, 1);
        this.equipped[slot] = item;
        this.refreshHeroCombatProfile();
        return true;
    }

    public unequipHeroItem(slot: EquipmentSlot): boolean {
        const item = this.equipped[slot];
        if (!item) return false;
        this.changeItemCount("Hero", item, 1);
        delete this.equipped[slot];
        this.refreshHeroCombatProfile();
        return true;
    }

    public dropHeroItem(item: string, quantity = 1): boolean {
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Drop quantity must be a positive integer");
        if (this.itemCount("Hero", item) < quantity) return false;
        return this.changeItemCount("Hero", item, -quantity) === 1;
    }

    public useHeroItem(
        item: string,
        effects: readonly { readonly specialId: number; readonly amount: number }[],
        nutrition: number,
    ): boolean {
        if (this.itemCount("Hero", item) < 1) return false;
        this.changeItemCount("Hero", item, -1);
        for (const effect of effects) {
            const parameter = itemSpecialParameterName(effect.specialId);
            const current = this.personParameters.get("Hero")?.get(parameter) ?? 0;
            this.setPersonParameter("Hero", parameter, current + effect.amount);
        }
        if (nutrition > 0) {
            const current = this.personParameters.get("Hero")?.get("nutrition") ?? 0;
            this.setPersonParameter("Hero", "nutrition", current + nutrition);
        }
        return true;
    }
    public learnHeroMagic(item: string, magicId: number): boolean {
        if (!Number.isSafeInteger(magicId) || magicId < 0 || magicId >= MAGIC_SPELL_COUNT) return false;
        if (this.getPersonParameter("Hero", magicSpellParameter(magicId)) !== 0) return false;
        if (this.itemCount("Hero", item) < 1) return false;
        this.changeItemCount("Hero", item, -1);
        this.setPersonParameter("Hero", magicSpellParameter(magicId), 1);
        return true;
    }

    public setHeroMagicHotbar(slot: number, magicId: number | null): boolean {
        if (!Number.isSafeInteger(slot) || slot < 0 || slot >= MAGIC_HOTBAR_SIZE) return false;
        if (magicId !== null && (!Number.isSafeInteger(magicId) || magicId < 0 || magicId >= MAGIC_SPELL_COUNT
            || this.getPersonParameter("Hero", magicSpellParameter(magicId)) === 0)) return false;
        this.setPersonParameter("Hero", magicHotbarParameter(slot), magicId ?? -1);
        return true;
    }
    public activateHeroMagicSlot(slot: number): boolean {
        if (!Number.isSafeInteger(slot) || slot < 0 || slot >= MAGIC_HOTBAR_SIZE) return false;
        const magicId = this.magicSnapshot().hotbarSpellIds[slot];
        if (magicId === null) return false;
        if (this.selectedMagicId === magicId) {
            this.selectedMagicId = undefined;
            this.combatMessage = "Выбор заклинания отменён";
            return true;
        }
        const magic = this.magicDefinitions.get(magicId);
        if (!magic || !magic.executable) {
            this.combatMessage = magic
                ? `${magic.literaryName}: эффект не поддерживается`
                : `Неизвестное заклинание ${magicId}`;
            return false;
        }
        if (magic.target === "ally") {
            this.selectedMagicId = undefined;
            return this.performHeroMagic(magicId, "hero") !== undefined;
        }
        this.selectedMagicId = magicId;
        this.combatMessage = `${magic.literaryName}: выберите цель`;
        return true;
    }

    public cancelHeroMagicTargeting(): void {
        this.selectedMagicId = undefined;
    }

    public isHeroMagicTargeting(): boolean {
        return this.selectedMagicId !== undefined;
    }

    public castHeroMagic(magicId: number, technicalName: string): MagicCastResult | undefined {
        return this.performHeroMagic(magicId, technicalName);
    }


    public getEquippedItems(): Readonly<Partial<Record<EquipmentSlot, string>>> {
        return { ...this.equipped };
    }

    public setCombatMode(active: boolean): void {
        this.combatActive = active;
        this.selectedMagicId = undefined;
        this.activeEnemies.clear();
        this.combatRound = active ? 1 : 0;
        this.currentCombatant = active ? "hero" : undefined;
        this.remainingActionPoints.clear();
        if (active) {
            const profile = this.combatProfiles.get("hero");
            if (profile) this.remainingActionPoints.set("hero", profile.actionPoints);
            this.combatMessage = "Боевой режим: ход героя";
        } else {
            this.combatMessage = "";
        }
    }

    public endCombatTurn(): boolean {
        if (!this.combatActive) {
            this.setCombatMode(true);
            return true;
        }
        if (this.currentCombatant !== "hero") return false;
        const hero = this.combatants.get("hero");
        if (!hero || hero.isDead) return false;

        const order = ["hero", ...this.activeEnemies]
            .filter((name) => !this.combatants.get(name)?.isDead)
            .sort((left, right) => (this.combatProfiles.get(right)?.initiative ?? 0) - (this.combatProfiles.get(left)?.initiative ?? 0));
        const heroIndex = order.indexOf("hero");
        const enemyTurns = [...order.slice(heroIndex + 1), ...order.slice(0, heroIndex)];
        for (const enemy of enemyTurns) {
            const attacker = this.combatants.get(enemy);
            const profile = this.combatProfiles.get(enemy);
            if (!attacker || attacker.isDead || !profile || hero.isDead) continue;
            this.currentCombatant = enemy;
            this.remainingActionPoints.set(enemy, profile.actionPoints);
            while ((this.remainingActionPoints.get(enemy) ?? 0) >= profile.weapon.actionPointCost && !hero.isDead) {
                this.performCombatAttack(enemy, "hero");
            }
        }

        this.advanceMagicEffects(1);
        this.combatRound += 1;
        this.currentCombatant = hero.isDead ? undefined : "hero";
        const heroProfile = this.combatProfiles.get("hero");
        if (heroProfile && !hero.isDead) this.remainingActionPoints.set("hero", heroProfile.actionPoints);
        this.combatMessage = hero.isDead ? "Игра окончена." : `Раунд ${this.combatRound}: ход героя`;
        this.syncCombatParameters("hero");
        return !hero.isDead;
    }

    public invokeHost(name: string, arguments_: readonly SCRValue[]): SCRValue | undefined {
        return this.callHost(name.toLowerCase(), arguments_);
    }

    public attackPerson(technicalName: string): OriginalAttackResult | MagicCastResult | undefined {
        const targetName = this.resolveCombatantName(technicalName);
        if (!targetName) throw new Error(`Unknown combatant ${technicalName}`);
        const target = this.combatants.get(targetName)!;
        if (target.isDead) return undefined;
        if (this.selectedMagicId !== undefined) {
            const magicId = this.selectedMagicId;
            this.selectedMagicId = undefined;
            return this.performHeroMagic(magicId, targetName);
        }
        if (!this.combatActive) this.setCombatMode(true);
        if (this.currentCombatant !== "hero") return undefined;
        this.activeEnemies.add(targetName);
        const result = this.performCombatAttack("hero", targetName);
        if (target.isDead) this.activeEnemies.delete(targetName);
        return result;
    }

    public restoreScriptVariables(variables: GameSaveData["scriptVariables"]): void {
        this.scr.clearVariables();
        for (const [name, value] of Object.entries(variables)) this.scr.setVariable(name, value);
    }

    public restore(save: GameSaveData): void {
        this.restoreScriptVariables(save.scriptVariables);
        this.inventories.clear();
        for (const [owner, items] of Object.entries(save.inventories)) {
            if (owner === EQUIPPED_INVENTORY_OWNER) continue;
            this.inventories.set(owner, new Map(Object.entries(items)));
        }
        for (const slot of EQUIPMENT_SLOTS) delete this.equipped[slot];
        for (const encoded of Object.keys(save.inventories[EQUIPPED_INVENTORY_OWNER] ?? {})) {
            const separator = encoded.indexOf(":");
            const slot = encoded.slice(0, separator) as EquipmentSlot;
            const item = encoded.slice(separator + 1);
            if (separator > 0 && EQUIPMENT_SLOTS.includes(slot) && item) this.equipped[slot] = item;
        }
        this.questFlags.clear();
        for (const [name, value] of Object.entries(save.questFlags)) this.questFlags.set(name, value);
        if (Object.keys(save.persons).length > 0) {
            this.persons.clear();
            for (const [name, present] of Object.entries(save.persons)) this.setPersonPresence(name, present);
        }
        this.stageFlags.clear();
        for (const [name, value] of Object.entries(save.stageFlags)) this.stageFlags.set(name, value);
        this.locationAccess.clear();
        for (const [name, value] of Object.entries(save.locationAccess)) this.locationAccess.set(name, value);
        this.personParameters.clear();
        for (const [person, values] of Object.entries(save.personParameters)) {
            this.personParameters.set(person, new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value])));
        }
        this.experience = save.experience;
        this.elapsedMinutes = save.clock.day * 24 * 60 + save.clock.minuteOfDay;
        this.clockAccumulatorMs = 0;
        if (this.scenario) {
            for (const [name, opened] of Object.entries(save.doors)) this.scenario.setDoorOpened(name, opened);
            for (const [name, state] of Object.entries(save.triggers)) {
                this.scenario.setTriggerActive(name, state.active);
                this.scenario.setTriggerVisible(name, state.visible);
            }
        }
        this.restoreMagicState(save);
        this.restoreCombatantVitals(save.personParameters);
    }
    public advanceClock(minutes: number): void {
        if (!Number.isFinite(minutes) || minutes < 0) throw new Error("Clock advancement must be a non-negative finite number");
        this.elapsedMinutes += minutes;
        let remaining = minutes;
        while (remaining > 0) {
            let step = remaining;
            for (const effect of this.activeMagicEffects) step = Math.min(step, Math.max(0, effect.remainingMinutes));
            if (step <= 0) {
                this.advanceMagicEffects(remaining);
                break;
            }
            this.advanceRegeneration(step);
            this.advanceMagicEffects(step);
            remaining -= step;
        }
    }


    public setVariable(name: string, value: SCRValue): void {
        this.scr.setVariable(name, value);
    }

    public getVariable(name: string): SCRValue | undefined {
        return this.scr.getVariable(name);
    }

    public snapshot(): GameRuntimeSnapshot {
        return {
            variables: Object.fromEntries(this.scr.variableEntries()),
            persons: Object.fromEntries(this.persons),
            inventories: Object.fromEntries([...this.inventories].map(([owner, items]) => [owner, Object.fromEntries(items)])),
            equipped: { ...this.equipped },
            questFlags: Object.fromEntries(this.questFlags),
            stageFlags: Object.fromEntries(this.stageFlags),
            locationAccess: Object.fromEntries(this.locationAccess),
            personParameters: Object.fromEntries([...this.personParameters].map(([person, values]) => [person, Object.fromEntries(values)])),
            experience: this.experience,
            elapsedMinutes: this.elapsedMinutes,
            magic: this.magicSnapshot(),
            regenerationElapsed: this.regenerationElapsedSnapshot(),
            combat: this.combatSnapshot(),
        };
    }

    private magicSnapshot(): MagicRuntimeSnapshot {
        const parameters = this.personParameters.get(this.resolveParameterOwner("Hero") ?? "Hero");
        const knownSpellIds: number[] = [];
        for (let magicId = 0; magicId < MAGIC_SPELL_COUNT; magicId += 1) {
            if ((parameters?.get(magicSpellParameter(magicId)) ?? 0) !== 0) knownSpellIds.push(magicId);
        }
        const hotbarSpellIds = Array.from({ length: MAGIC_HOTBAR_SIZE }, (_, slot): number | null => {
            const magicId = parameters?.get(magicHotbarParameter(slot));
            return magicId !== undefined && magicId >= 0 && magicId < MAGIC_SPELL_COUNT ? magicId : null;
        });
        const castableSpellIds = [...this.magicDefinitions.values()]
            .filter((magic) => magic.executable)
            .map((magic) => magic.id);
        const activeEffects = this.activeMagicEffects.map(({ spellId, specialId, targetName, value, remainingMinutes }) => ({
            spellId, specialId, targetName, value, remainingMinutes,
        }));
        return { knownSpellIds, hotbarSpellIds, castableSpellIds, activeEffects, selectedSpellId: this.selectedMagicId };
    }

    private regenerationElapsedSnapshot(): Readonly<Record<string, RegenerationElapsedRuntimeSnapshot>> {
        const names = new Set([...this.healthRegenerationElapsed.keys(), ...this.energyRegenerationElapsed.keys()]);
        return Object.fromEntries([...names].map((name) => [name, {
            health: this.healthRegenerationElapsed.get(name) ?? 0,
            energy: this.energyRegenerationElapsed.get(name) ?? 0,
        }]));
    }

    private restoreMagicState(save: GameSaveData): void {
        this.activeMagicEffects.length = 0;
        this.healthRegenerationElapsed.clear();
        this.energyRegenerationElapsed.clear();
        for (const [name, elapsed] of Object.entries(save.regenerationElapsed)) {
            if (elapsed.health > 0) this.healthRegenerationElapsed.set(name, elapsed.health);
            if (elapsed.energy > 0) this.energyRegenerationElapsed.set(name, elapsed.energy);
        }
        for (const effect of save.magicEffects) {
            if (effect.specialId.startsWith("SUMMON:")) {
                this.summonMagicPerson(effect.specialId.slice("SUMMON:".length), effect.spellId, effect.remainingMinutes);
            } else {
                this.setTimedMagicEffect({ ...effect });
            }
        }
    }

    private restoreCombatantVitals(savedParameters: GameSaveData["personParameters"]): void {
        for (const [name, combatant] of this.combatants) {
            const profile = this.combatProfiles.get(name);
            const owner = this.resolveParameterOwner(name) ?? (name === "hero" ? "Hero" : name);
            const parameters = savedParameters[owner];
            if (!profile || !parameters) continue;
            const health = parameters.health;
            const energy = parameters.energy;
            if (health !== undefined) combatant.health = Math.max(0, Math.min(profile.maxHealth, Math.round(health)));
            if (energy !== undefined) combatant.mana = Math.max(0, Math.min(profile.maxEnergy, Math.round(energy)));
            combatant.isDead = combatant.health === 0;
            this.syncCombatParameters(name);
        }
    }

    private async executeTriggerRequest(request: ScenarioScriptRequest, generation: number): Promise<void> {
        const levelData = this.levelData;
        if (!levelData) return;
        const scriptFileName = (request.scriptName.toLowerCase().endsWith(".scr") ? request.scriptName : `${request.scriptName}.scr`).toLowerCase();
        const source = await decodeScript(Paths.LEVEL_SCRIPT(levelData.levelName, levelData.gameMode, scriptFileName));
        if (generation !== this.generation) return;
        const handlers = request.phase === "enter"
            ? ["OnEnter", "OnHover"] as const
            : request.phase === "click"
                ? ["OnClick"] as const
                : ["OnLeave"] as const;
        for (const handler of handlers) {
            const body = extractSCREventHandler(source, handler);
            if (body?.trim()) this.scr.execute(body, `${levelData.levelName}/${scriptFileName}:${handler}`);
        }
    }

    private callHost(name: string, arguments_: readonly SCRValue[]): SCRValue | undefined {
        switch (name) {
            case "wd_loadarea": {
                const levelData = this.requireLevel(name);
                this.options.onLoadArea({
                    gameMode: levelData.gameMode,
                    level: stringArgument(arguments_, 0, name).toLowerCase(),
                    entrance: typeof arguments_[1] === "string" ? arguments_[1] : undefined,
                });
                return 1;
            }
            case "rs_globalmap":
                this.options.onGlobalMap?.();
                return 1;
            case "rs_startdialog":
                this.options.onDialog?.(arguments_);
                return 1;
            case "rs_gettribesrelation":
                return relationScores[this.factions.get(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name))];
            case "rs_settribesrelation":
                this.factions.set(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name), relationFromScript(arguments_[2] ?? 1));
                return 1;
            case "rs_ispersonexistsi": {
                const personIndex = typeof arguments_[1] === "string" ? 1 : 0;
                return this.persons.get(stringArgument(arguments_, personIndex, name)) === true ? 1 : 0;
            }
            case "rs_delperson":
                return this.setPersonPresence(stringArgument(arguments_, 0, name), false);
            case "rs_addperson_1":
                return this.stageDynamicPerson(arguments_, name);
            case "rs_addperson_2":
                return this.materializeDynamicPerson(arguments_, name);
            case "rs_testpersonhasitem":
                return this.itemCount(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name)) > 0 ? 1 : 0;
            case "rs_getitemcounti":
                return this.itemCount(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name));
            case "rs_persontransferitemi":
                return this.transferItem(
                    stringArgument(arguments_, 0, name),
                    stringArgument(arguments_, 1, name),
                    stringArgument(arguments_, 2, name),
                    numberArgument(arguments_, 3, name),
                );
            case "rs_persontransferallitemsi":
                return this.transferAllItems(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name));
            case "rs_personadditem":
            case "rs_personadditemtotrade":
                return this.changeItemCount(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name), arguments_[2] === undefined ? 1 : numberArgument(arguments_, 2, name));
            case "rs_personremoveitem":
            case "rs_personremoveitemtotrade":
                return this.changeItemCount(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name), -(arguments_[2] === undefined ? 1 : numberArgument(arguments_, 2, name)));
            case "rs_getmoney":
                return this.itemCount("Hero", "MON_1_0_1");
            case "rs_getpersonparameteri":
            case "rs_getpersonskilli":
                return this.getPersonParameter(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name));
            case "rs_setpersonparameteri":
                return this.setPersonParameter(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name), numberArgument(arguments_, 2, name));
            case "rs_addexp":
                this.experience += numberArgument(arguments_, 0, name);
                return this.experience;
            case "rs_questcomplete":
                this.questFlags.set(stringArgument(arguments_, 0, name), true);
                return 1;
            case "rs_questenable":
            case "rs_storylinequestenable":
                this.questFlags.set(stringArgument(arguments_, 0, name), false);
                return 1;
            case "rs_stagecomplete":
                this.stageFlags.set(`${stringArgument(arguments_, 0, name)}:${stringArgument(arguments_, 1, name)}`, true);
                return 1;
            case "rs_stageenable":
                this.stageFlags.set(`${stringArgument(arguments_, 0, name)}:${stringArgument(arguments_, 1, name)}`, false);
                return 1;
            case "rs_setlocationaccess":
                this.locationAccess.set(stringArgument(arguments_, 0, name).toLowerCase(), numberArgument(arguments_, 1, name));
                return 1;
            case "rs_enabletrigger":
                this.requireScenario(name).setTriggerActive(stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
                return 1;
            case "wd_setvisible":
                this.requireScenario(name).setTriggerVisible(stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
                return 1;
            case "rs_setdoorstate":
                this.requireScenario(name).setDoorOpened(stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
                return 1;
            case "rs_getdaysfrombeginningi":
                return Math.floor(this.elapsedMinutes / (24 * 60));
            case "rs_getcurrenttimeofdayi":
                return Math.floor(this.elapsedMinutes / 60) % 24;
            case "rs_getdayornight": {
                const hour = Math.floor(this.elapsedMinutes / 60) % 24;
                return hour >= 6 && hour < 20 ? 1 : 0;
            }
            case "rs_addtime": {
                const hours = integerArgument(arguments_, 0, name);
                const minutes = integerArgument(arguments_, 1, name);
                if (hours < 0 || minutes < 0 || minutes >= 60) throw new Error(`${name} requires non-negative hours and 0..59 minutes`);
                this.advanceClock(hours * 60 + minutes);
                return 1;
            }
            case "rs_getrandminmaxi": {
                const minimum = Math.ceil(numberArgument(arguments_, 0, name));
                const maximum = Math.floor(numberArgument(arguments_, 1, name));
                if (maximum < minimum) throw new Error(`${name} maximum must be at least the minimum`);
                return minimum + Math.floor(this.random() * (maximum - minimum + 1));
            }
            case "rs_setevent":
                this.questFlags.set(`event:${stringArgument(arguments_, 0, name)}`, true);
                return 1;
            case "rs_getevent":
                return this.questFlags.get(`event:${stringArgument(arguments_, 0, name)}`) === true ? 1 : 0;
            case "rs_clearevent":
                this.questFlags.set(`event:${stringArgument(arguments_, 0, name)}`, false);
                return 1;
            case "rs_addtoheropartyname":
                this.questFlags.set(`party:${stringArgument(arguments_, 0, name)}`, true);
                return 1;
            case "rs_removefromheropartyname":
                this.questFlags.set(`party:${stringArgument(arguments_, 0, name)}`, false);
                return 1;
            case "rs_testherohaspartyname":
                return this.questFlags.get(`party:${stringArgument(arguments_, 0, name)}`) === true ? 1 : 0;
            case "rs_setspecialperk": {
                const perk = integerArgument(arguments_, 0, name);
                if (perk < 0 || (this.options.addonMode && perk > 31)) {
                    throw new Error(`${name} perk must be ${this.options.addonMode ? "a bit index from 0 to 31" : "a non-negative mask"}`);
                }
                const mask = this.options.addonMode ? 1 << perk : perk;
                const current = this.getPersonParameter("Hero", "special_perks");
                this.setPersonParameter("Hero", "special_perks", current | mask);
                return 1;
            }
            case "rs_getdialogenabled":
                numberArgument(arguments_, 0, name);
                return this.dialogEnabled();
            case "rs_passtotradepanel":
                this.options.onTrade?.();
                return 1;
            case "rs_showmessage":
                this.options.onMessage?.(arguments_[0] ?? "");
                return 1;
            case "rs_setweather": {
                const weather = integerArgument(arguments_, 0, name);
                this.options.onWeather?.(weather === 1 ? 1 : weather === 2 ? 2 : 0);
                return 1;
            }
            case "d_playsound":
                this.options.onSound?.(arguments_);
                return 1;
            case "rs_allycmd": {
                const person = stringArgument(arguments_, 0, name);
                const commandName = stringArgument(arguments_, 1, name).toUpperCase();
                const command = ALLY_COMMANDS[commandName];
                if (command === undefined) throw new Error(`${name} has unknown ally command ${commandName}`);
                this.setPersonParameter(person, "ally_command", command);
                return 1;
            }
            case "wd_setcellsgroupflag":
                return 1;
            case "rs_setundeadstate":
            case "rs_setinjured":
                return this.setPersonCondition(name, stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
            case "le_casteffect":
            case "le_castmagic":
                return this.setPersonCondition(name, String(arguments_[0] ?? "world"), String(arguments_[1] ?? "effect"));
            case "le_deleffect":
                return 1;
            case "c_finished":
                this.options.onFinished?.(numberArgument(arguments_, 0, name));
                return 1;
            default:
                throw new Error(`Unsupported SCR host function ${name}`);
        }
    }

    private stageDynamicPerson(arguments_: readonly SCRValue[], call: string): number {
        const routeType = enumArgument(optionalStringArgument(arguments_, 0, call), ROUTE_TYPES, call, 0);
        const route = optionalStringArgument(arguments_, 1, call);
        const radius = numberArgument(arguments_, 2, call);
        const delayMin = numberArgument(arguments_, 3, call);
        const delayMax = numberArgument(arguments_, 4, call);
        if (radius < 0 || delayMin < 0 || delayMax < delayMin) throw new Error(`${call} route bounds are invalid`);
        this.pendingDynamicRoute = { routeType, route: route || undefined, radius, delayMin, delayMax };
        return 1;
    }

    private materializeDynamicPerson(arguments_: readonly SCRValue[], call: string): number {
        const route = this.pendingDynamicRoute;
        if (!route) throw new Error(`${call} requires a preceding RS_AddPerson_1 call`);
        this.pendingDynamicRoute = undefined;

        const name = stringArgument(arguments_, 0, call);
        const x = numberArgument(arguments_, 1, call);
        const y = numberArgument(arguments_, 2, call);
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error(`${call} position must use safe integer cells`);
        const person: DynamicPersonDefinition = {
            name,
            position: { x, y },
            direction: enumArgument(optionalStringArgument(arguments_, 3, call), DIRECTIONS, call, 3),
            literaryLabel: optionalStringArgument(arguments_, 4, call),
            tribe: optionalStringArgument(arguments_, 5, call) || undefined,
            scriptDialog: optionalStringArgument(arguments_, 6, call) || undefined,
            scriptInventory: optionalStringArgument(arguments_, 7, call) || undefined,
            ...route,
        };
        this.dynamicPersons.push(person);
        const levelPersons = this.dynamicPersonsByLevel.get(this.currentDynamicPersonLevel) ?? [];
        levelPersons.push({ ...person, position: { ...person.position } });
        this.dynamicPersonsByLevel.set(this.currentDynamicPersonLevel, levelPersons);
        this.setPersonPresence(name, true);
        this.options.onDynamicPerson?.({ ...person, position: { ...person.position } });

        const generation = this.generation;
        const load = loadPersonCombatAssets(name).then((assets) => {
            if (generation !== this.generation) return;
            this.registerPersonCombatant(person, assets);
        });
        this.pendingDynamicCombatLoads.push(load);
        void load.catch((error) => console.error(`Failed to load dynamic person ${name}`, error));
        return 1;
    }

    private requireLevel(call: string): LevelData {
        if (!this.levelData) throw new Error(`${call} requires a loaded level`);
        return this.levelData;
    }

    private requireScenario(call: string): ScenarioRuntime {
        if (!this.scenario) throw new Error(`${call} requires a loaded scenario`);
        return this.scenario;
    }

    private createCombatants(levelData: LevelData, assets: ReadonlyMap<string, PersonCombatAssets>, heroAssets: PersonCombatAssets): void {
        this.combatants.clear();
        this.combatProfiles.clear();
        this.combatItems.clear();
        this.combatProfileSources.clear();
        this.combatantPositions.clear();
        this.persons.clear();
        this.personSounds.clear();
        this.corpseInventorySources.clear();
        this.lootableCorpses.clear();
        this.setCombatMode(false);

        this.refreshHeroCombatProfile();
        if (heroAssets.sounds) this.personSounds.set("hero", heroAssets.sounds);
        for (const person of levelData.sefData.persons) this.registerPersonCombatant(person, assets.get(person.name.toLowerCase()));
    }

    private registerPersonCombatant(person: SEFPerson, personAssets?: PersonCombatAssets): void {
        this.persons.set(person.name, true);
        this.combatantPositions.set(person.name, cellToWorld(person.position));
        if (personAssets?.sounds) this.personSounds.set(person.name.toLowerCase(), personAssets.sounds);
        const normalizedName = person.name.toLowerCase();
        if (person.scriptInventory) this.corpseInventorySources.set(normalizedName, person.scriptInventory);
        if (personAssets?.resource?.containerAfterDie) this.lootableCorpses.add(normalizedName);
        const template = personAssets?.template;
        const parameters: Record<string, number> = template
            ? { ...template.attributes, ...template.skills }
            : {};
        const items = personAssets ? this.selectPersonWeapons(personAssets) : [];
        const base = {
            baseHealth: personAssets?.monster?.health,
            baseEnergy: personAssets?.monster?.energy,
            baseHitChance: personAssets?.monster?.hitChance,
            baseActionPoints: personAssets?.monster?.actionPoints,
            baseArmorClass: personAssets?.monster?.armorClass,
        };
        this.combatItems.set(person.name, items);
        this.combatProfileSources.set(person.name, { parameters, items, base });
        const profile = this.createProfile(parameters, items, base, person.name);
        this.combatProfiles.set(person.name, profile);
        this.combatants.set(person.name, createCombatant({
            id: person.name,
            factionId: person.tribe ?? person.name,
            maxHealth: profile.maxHealth,
            maxMana: profile.maxEnergy,
        }));
        for (const [name, value] of Object.entries(parameters)) this.setPersonParameter(person.name, name, value);
        this.syncCombatParameters(person.name);
    }

    private refreshHeroCombatProfile(): void {
        const parameterOwner = this.resolveParameterOwner("hero") ?? "Hero";
        const parameters = Object.fromEntries(this.personParameters.get(parameterOwner) ?? []);
        parameters.experience = this.experience;
        const items = Object.values(this.equipped)
            .map((name) => name && this.registeredItems.get(name.toLowerCase()))
            .filter((item): item is ShippedItem => item !== undefined);
        this.combatItems.set("hero", items);
        this.combatProfileSources.set("hero", { parameters, items, base: {} });
        const profile = this.createProfile(parameters, items, {}, "hero");
        const existing = this.combatants.get("hero");
        const health = Math.min(profile.maxHealth, Math.max(1, existing?.health ?? parameters.health ?? profile.maxHealth));
        const mana = Math.min(profile.maxEnergy, Math.max(0, existing?.mana ?? parameters.energy ?? profile.maxEnergy));
        this.combatProfiles.set("hero", profile);
        this.combatants.set("hero", createCombatant({
            id: "hero",
            factionId: "hero",
            maxHealth: profile.maxHealth,
            health,
            maxMana: profile.maxEnergy,
            mana,
        }));
        if (this.combatActive) this.remainingActionPoints.set("hero", Math.min(this.remainingActionPoints.get("hero") ?? profile.actionPoints, profile.actionPoints));
        this.syncCombatParameters("hero");
    }

    private createProfile(
        sourceParameters: Readonly<Record<string, number>>,
        items: readonly ShippedItem[],
        base: Partial<Pick<Parameters<typeof createOriginalCombatProfile>[0], "baseHealth" | "baseEnergy" | "baseHitChance" | "baseActionPoints" | "baseArmorClass">> = {},
        targetName?: string,
    ): OriginalCombatProfile {
        const parameters = { ...sourceParameters };
        const modifiers: Record<string, number> = {};
        const add = (name: string, amount: number): void => { modifiers[name] = (modifiers[name] ?? 0) + amount; };
        const attributeBySpecial: Readonly<Record<number, string>> = {
            6: "strength", 7: "constitution", 8: "perception", 9: "dexterity", 10: "intelligence", 11: "wisdom", 12: "luck",
        };
        for (const item of items) {
            for (const effect of item.specialEffects) {
                const attribute = attributeBySpecial[effect.specialId];
                if (attribute) parameters[attribute] = (parameters[attribute] ?? 0) + effect.amount;
                else {
                    const modifier = COMBAT_SPECIAL_MODIFIERS[effect.specialId];
                    if (modifier) add(modifier, effect.amount);
                }
            }
        }
        if (targetName) {
            for (const effect of this.activeMagicEffects) {
                if (effect.targetName !== targetName) continue;
                const attribute = MAGIC_ATTRIBUTE_PARAMETERS[effect.specialId];
                const modifier = MAGIC_PROFILE_MODIFIERS[effect.specialId];
                if (attribute) parameters[attribute] = (parameters[attribute] ?? 0) + effect.value;
                else if (modifier) add(modifier, effect.value);
                else if (effect.specialId === "IDSPEC_DMG_THROWING") add("throwingDamage", effect.value);
            }
        }
        const weaponItem = items.find((item) => item.weaponProfile);
        let weapon: OriginalWeaponProfile | undefined = weaponItem?.weaponProfile;
        if (weapon) {
            weapon = {
                ...weapon,
                damage: {
                    crushing: shiftedDamage(weapon.damage.crushing, (modifiers.crushingDamage ?? 0) + (modifiers.throwingDamage ?? 0)),
                    hacking: shiftedDamage(weapon.damage.hacking, (modifiers.hackingDamage ?? 0) + (modifiers.throwingDamage ?? 0)),
                    pricking: shiftedDamage(weapon.damage.pricking, (modifiers.prickingDamage ?? 0) + (modifiers.throwingDamage ?? 0)),
                },
            };
        }
        const profile = createOriginalCombatProfile({ parameters, weapon, modifiers, ...base });
        const actionPointModifier = targetName
            ? this.activeMagicEffects.filter((effect) => effect.targetName === targetName && effect.specialId === "IDSPEC_ACTION_POINTS")
                .reduce((sum, effect) => sum + effect.value, 0)
            : 0;
        return actionPointModifier < 0 && profile.actionPoints === 1 ? { ...profile, actionPoints: 0 } : profile;
    }

    private selectPersonWeapons(assets: PersonCombatAssets): readonly ShippedItem[] {
        const references = assets.template?.weapons ?? [];
        if (references.length === 0 || assets.weapons.length === 0) return [];
        const selectedIndex = references.findIndex((reference) => this.random() * 100 < reference.chance);
        return [assets.weapons[selectedIndex < 0 ? 0 : selectedIndex]];
    }

    private performCombatAttack(attackerName: string, targetName: string): OriginalAttackResult | undefined {
        const attacker = this.combatants.get(attackerName);
        const target = this.combatants.get(targetName);
        const attackerProfile = this.combatProfiles.get(attackerName);
        const targetProfile = this.combatProfiles.get(targetName);
        if (!attacker || !target || !attackerProfile || !targetProfile || attacker.isDead || target.isDead) return undefined;
        const remaining = this.remainingActionPoints.get(attackerName) ?? attackerProfile.actionPoints;
        if (remaining < attackerProfile.weapon.actionPointCost) {
            this.combatMessage = "Недостаточно очков действия";
            return undefined;
        }

        const result = resolveOriginalAttack(attackerProfile, targetProfile, target.health, this.random);
        this.remainingActionPoints.set(attackerName, remaining - result.actionPointCost);
        target.health = result.healthAfter;
        target.isDead = result.killed;
        const heroKilled = result.killed && targetName.toLowerCase() === "hero";
        if (heroKilled) this.options.onHeroDeath?.();
        this.options.onCombatAnimation?.(attackerName, "attack");
        if (result.hit) this.options.onCombatAnimation?.(targetName, result.killed ? "die" : "suffer");
        const attackSound = this.findPersonSound(attackerName, result.hit ? ["attack_0.hit", "attack_0"] : ["attack_0.miss", "attack_0"]);
        if (attackSound) this.options.onPersonSound?.(attackSound);
        if (result.hit) {
            const reactionSound = this.findPersonSound(targetName, result.killed ? ["die", "suffer"] : ["suffer"]);
            if (reactionSound) this.options.onPersonSound?.(reactionSound);
        }
        this.combatMessage = heroKilled
            ? "Игра окончена."
            : result.critical
                ? `Критический удар: ${result.appliedDamage}`
                : result.hit
                    ? `Урон: ${result.appliedDamage}`
                    : result.criticalMiss ? "Критический промах" : "Промах";
        this.syncCombatParameters(attackerName);
        this.syncCombatParameters(targetName);
        return result;
    }

    private performHeroMagic(magicId: number, technicalName: string): MagicCastResult | undefined {
        const magic = this.magicDefinitions.get(magicId);
        if (!magic?.executable) return undefined;
        if (this.getPersonParameter("Hero", magicSpellParameter(magicId)) === 0) return undefined;
        if (this.activeMagicEffects.some((effect) => effect.targetName === "hero" && effect.specialId === "IDSPEC_SILENCE")) {
            this.combatMessage = `${magic.literaryName}: герой не может колдовать`;
            return undefined;
        }
        const primaryTargetName = magic.target === "ally" ? "hero" : this.resolveCombatantName(technicalName);
        if (!primaryTargetName || (magic.target === "enemy" && primaryTargetName.toLowerCase() === "hero")) return undefined;
        const caster = this.combatants.get("hero");
        const primaryTarget = this.combatants.get(primaryTargetName);
        if (!caster || !primaryTarget || caster.isDead || primaryTarget.isDead) return undefined;

        if (!this.combatActive && (!magic.realtime || magic.target === "enemy")) this.setCombatMode(true);
        if (this.combatActive && this.currentCombatant !== "hero") return undefined;
        const actionPointsBefore = this.remainingActionPoints.get("hero") ?? this.combatProfiles.get("hero")?.actionPoints ?? 0;
        const actionPointCost = this.combatActive ? magicActionPointCost(magic) : 0;
        const energyCost = magicEnergyCost(magic);
        if (actionPointsBefore < actionPointCost) {
            this.combatMessage = `${magic.literaryName}: недостаточно очков действия`;
            return undefined;
        }
        if (caster.mana < energyCost) {
            this.combatMessage = `${magic.literaryName}: недостаточно энергии`;
            return undefined;
        }

        const energyBefore = caster.mana;
        caster.mana -= energyCost;
        if (this.combatActive) this.remainingActionPoints.set("hero", actionPointsBefore - actionPointCost);
        const targetNames = this.magicTargetNames(magic, primaryTargetName);
        let primaryResisted = false;
        let damage = 0;
        let healing = 0;
        let energyChange = 0;
        let actionPointChange = 0;
        let effectsApplied = 0;

        for (const targetName of targetNames) {
            const target = this.combatants.get(targetName);
            const targetProfile = this.combatProfiles.get(targetName);
            if (!target || !targetProfile || target.isDead) continue;
            if (magic.target === "enemy") this.activeEnemies.add(targetName);
            const damageBeforeTarget = damage;
            const immunity = magic.target === "enemy" ? Math.max(0, Math.min(100, targetProfile.magicImmunity[magic.school])) : 0;
            const resisted = immunity > 0 && this.random() * 100 < immunity;
            if (targetName === primaryTargetName) primaryResisted = resisted;
            if (!resisted) {
                for (const special of magic.specials) {
                    const applied = this.applyMagicSpecial(magic, special, targetName);
                    damage += applied.damage;
                    healing += applied.healing;
                    energyChange += applied.energyChange;
                    actionPointChange += applied.actionPointChange;
                    effectsApplied += applied.effectsApplied;
                }
            }
            target.isDead = target.health === 0;
            if (target.isDead && targetName.toLowerCase() === "hero") this.options.onHeroDeath?.();
            this.options.onMagicEffect?.(magic.technicalName, targetName);
            if (damage > damageBeforeTarget) this.options.onCombatAnimation?.(targetName, target.isDead ? "die" : "suffer");
            if (target.isDead) this.activeEnemies.delete(targetName);
            this.syncCombatParameters(targetName);
        }

        if (magic.healing && magic.target === "enemy" && damage > 0) {
            const before = caster.health;
            const heroMaximum = this.combatProfiles.get("hero")?.maxHealth ?? caster.maxHealth;
            caster.health = Math.min(heroMaximum, caster.health + damage);
            healing += caster.health - before;
        }
        this.options.onCombatAnimation?.("hero", "attack");
        const result: MagicCastResult = {
            spellId: magic.id,
            technicalName: magic.technicalName,
            target: primaryTargetName,
            resisted: primaryResisted,
            energyBefore,
            energyAfter: caster.mana,
            actionPointsBefore,
            actionPointsAfter: this.remainingActionPoints.get("hero") ?? actionPointsBefore,
            damage,
            healing,
            energyChange,
            actionPointChange,
            killed: primaryTarget.isDead,
            effectsApplied,
        };
        this.combatMessage = primaryResisted
            ? `${magic.literaryName}: цель сопротивляется`
            : damage > 0 ? `${magic.literaryName}: урон ${damage}`
                : healing > 0 ? `${magic.literaryName}: восстановлено ${healing}`
                    : `${magic.literaryName}: эффект применён`;
        this.syncCombatParameters("hero");
        return result;
    }

    private magicResistance(profile: OriginalCombatProfile, channel: MagicDamageChannel): number {
        if (channel === "crushing" || channel === "hacking" || channel === "pricking") return profile.damageResistance[channel];
        if (channel === "fire" || channel === "cold" || channel === "poison") return profile.elementalResistance[channel];
        return profile.magicResistance[channel];
    }

    private magicTargetNames(magic: MagicDefinition, primaryTargetName: string): readonly string[] {
        if (magic.target !== "enemy" || magic.radius <= 0) return [primaryTargetName];
        const center = this.combatantPositions.get(primaryTargetName);
        if (!center) return [primaryTargetName];
        const maximumDistanceSquared = magic.radius * magic.radius;
        return [...this.combatants]
            .filter(([name, combatant]) => name !== "hero" && !combatant.isDead && this.persons.get(name) !== false)
            .filter(([name]) => {
                const position = this.combatantPositions.get(name);
                if (!position) return name === primaryTargetName;
                const dx = position.x - center.x;
                const dy = position.y - center.y;
                return dx * dx + dy * dy <= maximumDistanceSquared;
            })
            .map(([name]) => name);
    }

    private applyMagicSpecial(magic: MagicDefinition, special: MagicSpecialDefinition, targetName: string): {
        damage: number; healing: number; energyChange: number; actionPointChange: number; effectsApplied: number;
    } {
        const target = this.combatants.get(targetName)!;
        const profile = this.combatProfiles.get(targetName)!;
        const rawValue = magicValue(special);
        const channel = magicDamageChannel(special.id);
        if (channel) {
            const applied = Math.max(0, Math.round(Math.abs(rawValue)) - this.magicResistance(profile, channel));
            const before = target.health;
            target.health = Math.max(0, target.health - applied);
            return { damage: before - target.health, healing: 0, energyChange: 0, actionPointChange: 0, effectsApplied: 1 };
        }
        if (special.id === "IDSPEC_HEALTH_CURRENT") {
            const amount = this.magicAmount(special, rawValue, target.health);
            const before = target.health;
            target.health = Math.max(0, Math.min(profile.maxHealth, target.health + amount));
            return {
                damage: Math.max(0, before - target.health),
                healing: Math.max(0, target.health - before),
                energyChange: 0,
                actionPointChange: 0,
                effectsApplied: 1,
            };
        }
        if (special.id === "IDSPEC_ENERGY_CURRENT") {
            const amount = this.magicAmount(special, rawValue, target.mana);
            const before = target.mana;
            target.mana = Math.max(0, Math.min(profile.maxEnergy, target.mana + amount));
            return { damage: 0, healing: 0, energyChange: target.mana - before, actionPointChange: 0, effectsApplied: 1 };
        }
        if (special.id === "IDSPEC_DISPELL") {
            const removed = this.removeMagicEffects(targetName);
            return { damage: 0, healing: 0, energyChange: 0, actionPointChange: 0, effectsApplied: Math.max(1, removed) };
        }
        const summonResource = SUMMON_SPECIALS[special.id];
        if (summonResource) {
            const duration = Math.max(1, magicDuration(special));
            this.summonMagicPerson(summonResource, magic.id, duration);
            return { damage: 0, healing: 0, energyChange: 0, actionPointChange: 0, effectsApplied: 1 };
        }
        const duration = magicDuration(special);
        if (special.id === "IDSPEC_ACTION_POINTS" && duration === 0) {
            const current = this.remainingActionPoints.get(targetName) ?? profile.actionPoints;
            const amount = this.magicAmount(special, rawValue, current);
            const next = Math.max(0, current + amount);
            this.remainingActionPoints.set(targetName, next);
            return { damage: 0, healing: 0, energyChange: 0, actionPointChange: next - current, effectsApplied: 1 };
        }
        if (special.id === "IDSPEC_MAP_WALKER" && duration === 0) {
            this.setPersonCondition(targetName, "map_walker", rawValue);
            return { damage: 0, healing: 0, energyChange: 0, actionPointChange: 0, effectsApplied: 1 };
        }
        if (duration > 0) {
            const current = this.magicSpecialCurrentValue(special.id, targetName);
            const value = this.magicAmount(special, rawValue, current);
            this.setTimedMagicEffect({ spellId: magic.id, specialId: special.id, targetName, value, remainingMinutes: duration });
            return { damage: 0, healing: 0, energyChange: 0, actionPointChange: 0, effectsApplied: 1 };
        }
        return { damage: 0, healing: 0, energyChange: 0, actionPointChange: 0, effectsApplied: 0 };
    }

    private magicAmount(special: MagicSpecialDefinition, rawValue: number, currentValue: number): number {
        if (special.valueMode === "relative") {
            const amount = currentValue * rawValue / 100;
            return special.id === "IDSPEC_HEALTH_REGENERATE_TIME" || special.id === "IDSPEC_ENERGY_REGENERATE_TIME" ? amount : Math.round(amount);
        }
        if (special.valueMode === "replace") return rawValue - currentValue;
        return rawValue;
    }

    private magicSpecialCurrentValue(specialId: string, targetName: string): number {
        const profile = this.combatProfiles.get(targetName);
        const source = this.combatProfileSources.get(targetName);
        const attribute = MAGIC_ATTRIBUTE_PARAMETERS[specialId];
        if (attribute) return source?.parameters[attribute] ?? 0;
        if (!profile) return 0;
        switch (specialId) {
            case "IDSPEC_ACTION_POINTS": return profile.actionPoints;
            case "IDSPEC_ARMOR_CLASS": return profile.armorClass;
            case "IDSPEC_CHT_CRITICAL_HIT": return profile.criticalChance;
            case "IDSPEC_CHT_CRITICAL_MISS": return profile.criticalMissChance;
            case "IDSPEC_CHT_HIT":
            case "IDSPEC_CHT_HIT_THROWING": return profile.hitChance;
            case "IDSPEC_MAX_HEALTH": return profile.maxHealth;
            case "IDSPEC_INITIATIVE": return profile.initiative;
            case "IDSPEC_CRUSHING_RES": return profile.damageResistance.crushing;
            case "IDSPEC_HACKING_RES": return profile.damageResistance.hacking;
            case "IDSPEC_PRICKING_RES": return profile.damageResistance.pricking;
            case "IDSPEC_FIRE_RES": return profile.elementalResistance.fire;
            case "IDSPEC_COLD_RES": return profile.elementalResistance.cold;
            case "IDSPEC_POISON_RES": return profile.elementalResistance.poison;
            case "IDSPEC_GODS_MAGIC_RES": return profile.magicResistance.gods;
            case "IDSPEC_ELEMENTS_MAGIC_RES": return profile.magicResistance.elements;
            case "IDSPEC_LIGHTNESS_MAGIC_RES": return profile.magicResistance.light;
            case "IDSPEC_DARKNESS_MAGIC_RES": return profile.magicResistance.dark;
            case "IDSPEC_SHADOWS_MAGIC_RES": return profile.magicResistance.shadows;
            case "IDSPEC_NATURE_MAGIC_RES": return profile.magicResistance.nature;
            case "IDSPEC_GODS_MAGIC_IMMUN": return profile.magicImmunity.gods;
            case "IDSPEC_ELEMENTS_MAGIC_IMMUN": return profile.magicImmunity.elements;
            case "IDSPEC_LIGHTNESS_MAGIC_IMMUN": return profile.magicImmunity.light;
            case "IDSPEC_DARKNESS_MAGIC_IMMUN": return profile.magicImmunity.dark;
            case "IDSPEC_SHADOWS_MAGIC_IMMUN": return profile.magicImmunity.shadows;
            case "IDSPEC_NATURE_MAGIC_IMMUN": return profile.magicImmunity.nature;
            case "IDSPEC_MOD_CRITICAL_HIT": return profile.criticalDamage;
            case "IDSPEC_DMG_THROWING": return profile.weapon.damage.crushing.max + profile.weapon.damage.hacking.max + profile.weapon.damage.pricking.max;
            case "IDSPEC_HEALTH_REGENERATE_TIME": return profile.healthRegenerationTime;
            case "IDSPEC_ENERGY_REGENERATE_TIME": return profile.energyRegenerationTime;
            default: return 0;
        }
    }

    private setTimedMagicEffect(effect: ActiveMagicEffect): void {
        const previous = this.activeMagicEffects.findIndex((candidate) => candidate.targetName === effect.targetName && candidate.specialId === effect.specialId);
        if (previous >= 0) this.activeMagicEffects.splice(previous, 1);
        this.activeMagicEffects.push(effect);
        if (effect.specialId === "IDSPEC_MAP_WALKER") this.setPersonCondition(effect.targetName, "map_walker", true);
        else if (!effect.specialId.startsWith("SUMMON:") && !MAGIC_ATTRIBUTE_PARAMETERS[effect.specialId] && !MAGIC_PROFILE_MODIFIERS[effect.specialId] && effect.specialId !== "IDSPEC_DMG_THROWING") {
            this.setPersonCondition(effect.targetName, effect.specialId.toLowerCase(), effect.value);
        }
        this.refreshCombatantProfile(effect.targetName);
    }

    private removeMagicEffects(targetName: string): number {
        let removed = 0;
        for (let index = this.activeMagicEffects.length - 1; index >= 0; index -= 1) {
            if (this.activeMagicEffects[index].targetName !== targetName) continue;
            const [effect] = this.activeMagicEffects.splice(index, 1);
            if (effect.specialId === "IDSPEC_MAP_WALKER") this.setPersonCondition(targetName, "map_walker", false);
            else if (!effect.specialId.startsWith("SUMMON:") && !MAGIC_ATTRIBUTE_PARAMETERS[effect.specialId] && !MAGIC_PROFILE_MODIFIERS[effect.specialId] && effect.specialId !== "IDSPEC_DMG_THROWING") {
                this.setPersonCondition(targetName, effect.specialId.toLowerCase(), false);
            }
            removed += 1;
        }
        if (removed > 0) this.refreshCombatantProfile(targetName);
        return removed;
    }

    private refreshCombatantProfile(targetName: string): void {
        if (targetName === "hero") {
            this.refreshHeroCombatProfile();
            return;
        }
        const source = this.combatProfileSources.get(targetName);
        const existing = this.combatants.get(targetName);
        if (!source || !existing) return;
        const profile = this.createProfile(source.parameters, source.items, source.base, targetName);
        this.combatProfiles.set(targetName, profile);
        this.combatants.set(targetName, createCombatant({
            id: existing.id,
            factionId: existing.factionId,
            maxHealth: profile.maxHealth,
            health: Math.min(existing.health, profile.maxHealth),
            maxMana: profile.maxEnergy,
            mana: Math.min(existing.mana, profile.maxEnergy),
        }));
        this.syncCombatParameters(targetName);
    }

    private summonMagicPerson(resource: string, spellId: number, duration: number): void {
        const name = resource;
        const position = worldToCell(this.lastPlayerPosition);
        const existing = this.dynamicPersons.find((person) => person.name === name);
        if (existing) {
            this.setPersonPresence(name, true);
        } else {
            const person: DynamicPersonDefinition = {
                name,
                position,
                direction: "DOWN",
                literaryLabel: resource,
                tribe: "hero",
                routeType: "STAY",
            };
            this.dynamicPersons.push(person);
            const levelPersons = this.dynamicPersonsByLevel.get(this.currentDynamicPersonLevel) ?? [];
            levelPersons.push({ ...person, position: { ...position } });
            this.dynamicPersonsByLevel.set(this.currentDynamicPersonLevel, levelPersons);
            this.setPersonPresence(name, true);
            this.options.onDynamicPerson?.({ ...person, position: { ...position } });
            const generation = this.generation;
            const load = loadPersonCombatAssets(name).then((assets) => {
                if (generation === this.generation) this.registerPersonCombatant(person, assets);
            });
            this.pendingDynamicCombatLoads.push(load);
            void load.catch((error) => console.error(`Failed to load summoned person ${name}`, error));
        }
        this.setTimedMagicEffect({ spellId, specialId: `SUMMON:${resource}`, targetName: name, value: 1, remainingMinutes: duration });
    }

    private advanceRegeneration(minutes: number): void {
        if (minutes <= 0) return;
        for (const [name, combatant] of this.combatants) {
            const profile = this.combatProfiles.get(name);
            if (!profile || combatant.isDead || this.persons.get(name) === false) continue;

            let healthTicks = 0;
            if (profile.healthRegenerationTime > 0) {
                const elapsed = (this.healthRegenerationElapsed.get(name) ?? 0) + minutes;
                healthTicks = Math.floor(elapsed / profile.healthRegenerationTime);
                this.healthRegenerationElapsed.set(name, elapsed - healthTicks * profile.healthRegenerationTime);
            }

            let energyTicks = 0;
            if (profile.energyRegenerationTime > 0) {
                const elapsed = (this.energyRegenerationElapsed.get(name) ?? 0) + minutes;
                energyTicks = Math.floor(elapsed / profile.energyRegenerationTime);
                this.energyRegenerationElapsed.set(name, elapsed - energyTicks * profile.energyRegenerationTime);
            }

            const healthBefore = combatant.health;
            const energyBefore = combatant.mana;
            combatant.health = Math.min(profile.maxHealth, combatant.health + healthTicks);
            combatant.mana = Math.min(profile.maxEnergy, combatant.mana + energyTicks);
            if (combatant.health !== healthBefore || combatant.mana !== energyBefore) this.syncCombatParameters(name);
        }
    }

    private advanceMagicEffects(minutes: number): void {
        if (minutes <= 0 || this.activeMagicEffects.length === 0) return;
        const changedTargets = new Set<string>();
        for (let index = this.activeMagicEffects.length - 1; index >= 0; index -= 1) {
            const effect = this.activeMagicEffects[index];
            effect.remainingMinutes -= minutes;
            if (effect.remainingMinutes > 0) continue;
            this.activeMagicEffects.splice(index, 1);
            if (effect.specialId.startsWith("SUMMON:")) {
                this.setPersonPresence(effect.targetName, false);
                this.activeEnemies.delete(effect.targetName);
                continue;
            }
            if (effect.specialId === "IDSPEC_MAP_WALKER") this.setPersonCondition(effect.targetName, "map_walker", false);
            if (!MAGIC_ATTRIBUTE_PARAMETERS[effect.specialId] && !MAGIC_PROFILE_MODIFIERS[effect.specialId] && effect.specialId !== "IDSPEC_DMG_THROWING") {
                this.setPersonCondition(effect.targetName, effect.specialId.toLowerCase(), false);
            }
            changedTargets.add(effect.targetName);
        }
        for (const targetName of changedTargets) this.refreshCombatantProfile(targetName);
    }

    private findPersonSound(technicalName: string, candidates: readonly string[]): SoundShaderDefinition | undefined {
        const shaders = this.personSounds.get(technicalName.toLowerCase())?.shaders;
        if (!shaders) return undefined;
        for (const candidate of candidates) {
            const exact = shaders[candidate];
            if (exact) return exact;
            const normalized = candidate.toLowerCase();
            for (const [name, shader] of Object.entries(shaders)) {
                if (name.toLowerCase() === normalized) return shader;
            }
        }
        return undefined;
    }

    private syncCombatParameters(name: string): void {
        const combatant = this.combatants.get(name);
        const profile = this.combatProfiles.get(name);
        if (!combatant || !profile) return;
        const owner = this.resolveParameterOwner(name) ?? (name === "hero" ? "Hero" : name);
        this.setPersonParameter(owner, "health", combatant.health);
        this.setPersonParameter(owner, "max_health", profile.maxHealth);
        this.setPersonParameter(owner, "max_life", profile.maxHealth);
        this.setPersonParameter(owner, "energy", combatant.mana);
        this.setPersonParameter(owner, "max_energy", profile.maxEnergy);
        this.setPersonParameter(owner, "max_mana", profile.maxEnergy);
        this.setPersonParameter(owner, "action_points", this.remainingActionPoints.get(name) ?? profile.actionPoints);
        this.setPersonParameter(owner, "max_action_points", profile.actionPoints);
    }

    private combatSnapshot(): CombatRuntimeSnapshot {
        return {
            active: this.combatActive,
            round: this.combatRound,
            currentCombatant: this.currentCombatant,
            message: this.combatMessage,
            combatants: Object.fromEntries([...this.combatants].map(([name, combatant]) => {
                const profile = this.combatProfiles.get(name)!;
                return [name, {
                    health: combatant.health,
                    maximumHealth: combatant.maxHealth,
                    energy: combatant.mana,
                    maximumEnergy: combatant.maxMana,
                    actionPoints: this.remainingActionPoints.get(name) ?? profile.actionPoints,
                    maximumActionPoints: profile.actionPoints,
                    initiative: profile.initiative,
                    dead: combatant.isDead,
                    profile,
                }];
            })),
        };
    }

    private resolveCombatantName(name: string): string | undefined {
        const normalized = name.toLowerCase();
        return [...this.combatants.keys()].find((candidate) => candidate.toLowerCase() === normalized);
    }

    private resolveParameterOwner(name: string): string | undefined {
        const normalized = name.toLowerCase();
        return [...this.personParameters.keys()].find((candidate) => candidate.toLowerCase() === normalized);
    }

    private setPersonPresence(name: string, present: boolean): number {
        this.persons.set(name, present);
        this.options.onPersonPresence?.(name, present);
        return 1;
    }

    private itemCount(owner: string, item: string): number {
        return this.inventories.get(this.inventoryOwner(owner))?.get(item) ?? 0;
    }

    private inventoryOwner(owner: string): string {
        const normalized = owner.toLowerCase();
        return [...this.inventories.keys()].find((candidate) => candidate.toLowerCase() === normalized) ?? owner;
    }

    private changeItemCount(owner: string, item: string, delta: number): number {
        if (!Number.isSafeInteger(delta)) throw new Error("Inventory quantity must be a safe integer");
        const resolvedOwner = this.inventoryOwner(owner);
        const inventory = this.inventories.get(resolvedOwner) ?? new Map<string, number>();
        const next = (inventory.get(item) ?? 0) + delta;
        if (next < 0) return 0;
        if (next === 0) inventory.delete(item);
        else inventory.set(item, next);
        this.inventories.set(resolvedOwner, inventory);
        return 1;
    }

    private transferItem(source: string, destination: string, item: string, quantity: number): number {
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Transfer quantity must be a positive safe integer");
        if (this.itemCount(source, item) < quantity) return 0;
        this.changeItemCount(source, item, -quantity);
        this.changeItemCount(destination, item, quantity);
        return 1;
    }

    private transferAllItems(source: string, destination: string): number {
        const sourceInventory = this.inventories.get(source);
        if (!sourceInventory || sourceInventory.size === 0) return 1;
        for (const [item, quantity] of [...sourceInventory]) {
            this.transferItem(source, destination, item, quantity);
        }
        return 1;
    }

    private getPersonParameter(person: string, parameter: string): number {
        const owner = this.resolveParameterOwner(person);
        return owner ? this.personParameters.get(owner)?.get(parameter.toLowerCase()) ?? 0 : 0;
    }

    private setPersonParameter(person: string, parameter: string, value: number): number {
        const owner = this.resolveParameterOwner(person) ?? (person.toLowerCase() === "hero" ? "Hero" : person);
        const values = this.personParameters.get(owner) ?? new Map<string, number>();
        values.set(parameter.toLowerCase(), value);
        this.personParameters.set(owner, values);
        return value;
    }

    private dialogEnabled(): number {
        const speech = this.getPersonParameter("Hero", "skill_speech");
        if (speech <= 0) return 0;
        if (speech >= 15) return 1;

        const effectiveReputation = Math.max(1, Math.min(30, Math.round(
            this.getPersonParameter("Hero", "reputation")
            + this.getPersonParameter("Hero", "item_special_10")
            + (speech >= 10 ? 2 : 0),
        )));
        let chance = effectiveReputation
            + Math.trunc(speech) * 4
            + 10
            + this.getPersonParameter("Hero", "item_special_54");
        if (this.getPersonParameter("Hero", "skill_alchemy") >= 10) chance += 20;
        if (this.options.addonMode) {
            const perks = Math.trunc(this.getPersonParameter("Hero", "special_perks"));
            if ((perks & 0x10) !== 0) chance += 30;
            if ((perks & 0x100000) !== 0) chance += 10;
            if ((perks & 0x200000) !== 0) chance += 15;
        }
        chance = Math.max(0, Math.min(100, Math.round(chance)));
        return this.random() < chance / 100 ? 1 : 0;
    }

    private setPersonCondition(kind: string, person: string, value: number | boolean | string): number {
        const conditions = this.personConditions.get(person) ?? new Map<string, number | boolean>();
        conditions.set(kind, typeof value === "string" ? true : value);
        this.personConditions.set(person, conditions);
        return 1;
    }
}
