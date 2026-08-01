import { Paths } from "../constants/paths.ts";
import { COMBAT_HISTORY_STRING_IDS } from "../constants/clientDll.ts";
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
    extractSCRHandlerSources,
    parseSCRScript,
    type SCRScript,
    type SCRHandlerSources,
    type SCRValue,
} from "./scripts/SCRRuntime.ts";
import { GOLDENLAND_START_MINUTE_OF_DAY, type GameSaveData } from "./PersistenceRuntime.ts";
import {
    FactionRelations,
    createCombatant,
    createOriginalCombatProfile,
    resolveOriginalAttack,
    originalCombatDistance,
    originalInventoryLevelForWorld,
    originalLevelForExperience,
    selectOriginalPersonWeapon,
    type Combatant,
    type FactionRelation,
    type OriginalAttackResult,
    type OriginalCombatProfile,
    type OriginalWeaponProfile,
    type PersonCombatTemplate,
} from "./systems/Combat.ts";
import {
    NATIVE_TARGET_RETRY_LIMIT,
    nativeSelfPreservationProbability,
    rankNativeCombatAiTargets,
} from "./systems/NativeCombatAi.ts";
import { cellToWorld, worldToCell, type WorldPosition } from "./WorldCoordinates.ts";
import { createItemInstance, type EquipmentSlot, type ItemClass, type ItemDefinition, type ItemInstance } from "./systems/Items.ts";
import { materializeInventory, parseInventoryScript } from "./parsers/INVParser.ts";
import { MONEY_ITEM_ID, nativeTradePriceMultiplier, type TradeOffer } from "./systems/Trade.ts";
import { Inventory, InventoryTransaction, type InventoryCatalog, type InventoryStack } from "./systems/Inventory.ts";
import { loadPersonCombatAssets, type PersonCombatAssets } from "./PersonAssetRuntime.ts";
import type { ShippedItem } from "./ItemCatalogRuntime.ts";
import type { SoundShaderDefinition } from "./SoundShaderRuntime.ts";
import type { Direction, RouteType, SEFPerson } from "./parsers/SEFParser.ts";
import { nativeDayPhase } from "./NativeDayNight.ts";
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
import {
    loadAllyPortraitMappings,
    loadNativeFactionRelations,
    loadPersonResourceName,
    type AllyPortraitMapping,
} from "./NativeCombatResources.ts";


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

export type CombatAnimationKind = "attack" | "cast" | "suffer" | "die";

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
    readonly faction: string;
    readonly relationToHero: FactionRelation;
    readonly partyMember: boolean;
    readonly portraitResource?: string;
}

export interface CombatRuntimeSnapshot {
    readonly active: boolean;
    readonly round: number;
    readonly currentCombatant?: string;
    readonly message: string;
    readonly combatants: Readonly<Record<string, CombatantRuntimeSnapshot>>;
    readonly partyMembers: readonly string[];
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


export interface InventoryStackRuntimeSnapshot {
    readonly stackKey: string;
    readonly id: string;
    readonly technicalName: string;
    readonly durability: number;
    readonly charges?: number;
    readonly quantity: number;
}

export interface GameRuntimeSnapshot {
    variables: Readonly<Record<string, SCRValue>>;
    persons: Readonly<Record<string, boolean>>;
    personStatesByLevel: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
    inventories: Readonly<Record<string, Readonly<Record<string, number>>>>;
    inventoryStacks: Readonly<Record<string, readonly InventoryStackRuntimeSnapshot[]>>;
    equipped: Readonly<Partial<Record<EquipmentSlot, string>>>;
    equippedStacks: Readonly<Partial<Record<EquipmentSlot, InventoryStack>>>;
    questFlags: Readonly<Record<string, boolean>>;
    stageFlags: Readonly<Record<string, boolean>>;
    locationAccess: Readonly<Record<string, number>>;
    bestiaryKills: Readonly<Record<string, number>>;
    personParameters: Readonly<Record<string, Readonly<Record<string, number>>> >;
    experience: number;
    lootGenerationLevel: number;
    elapsedMinutes: number;
    magic: MagicRuntimeSnapshot;
    regenerationElapsed: Readonly<Record<string, RegenerationElapsedRuntimeSnapshot>>;
    combat: CombatRuntimeSnapshot;
}

export interface RestRuntimeState {
    readonly active: boolean;
    readonly requestedMinutes: number;
    readonly remainingMinutes: number;
}

/** Client.dll defaults the rest clock multiplier to 60.0 at 0x1200282b..0x12002838. */
export const NATIVE_REST_CLOCK_MINUTES_PER_SECOND = 60;

export interface CombatMovementResult {
    readonly position: WorldPosition;
    readonly durationMs: number;
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
    resolveItemLiteraryName?: (technicalName: string) => string;
    resolveHeroName?: () => string;
    resolveInterfaceString?: (id: number) => string | undefined;
    onWeather?: (type: number) => void;
    onSound?: (arguments_: readonly SCRValue[]) => void;
    onPersonSound?: (shader: SoundShaderDefinition) => void;
    onCombatAnimation?: (technicalName: string, kind: CombatAnimationKind) => number | undefined;
    onMagicEffect?: (technicalName: string, targetName: string) => void;
    onWorldMagicEffect?: (technicalName: string, position: Readonly<WorldPosition>) => void;
    onClockChange?: (elapsedMinutes: number) => void;
    onRestChange?: (state: RestRuntimeState) => void;
    onCombatModeChange?: (active: boolean) => void;
    onCombatantPositionChange?: (technicalName: string, position: Readonly<WorldPosition>) => void;
    onCombatantMoveRequest?: (technicalName: string, targetPosition: Readonly<WorldPosition>, away: boolean) => CombatMovementResult | undefined;
    onCombatantFace?: (technicalName: string, targetPosition: Readonly<WorldPosition>) => void;
    onCombatantCanSee?: (technicalName: string, targetPosition: Readonly<WorldPosition>) => boolean;
    random?: () => number;
    now?: () => Date;
    addonMode?: boolean;
    strictScriptAbi?: boolean;
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
    readonly technicalName?: string;
    readonly bestiaryName?: string;
    readonly literaryName?: string;
    readonly template?: PersonCombatTemplate;
}
const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
    "mainHand", "offHand", "ammo", "head", "body", "arms", "bracelet", "amulet", "ringLeft", "ringRight",
];
const DURABILITY_WEAPON_CLASSES = new Set<ItemClass>(["sword", "axe", "spear", "mace"]);
const DURABILITY_ARMOR_SLOTS: readonly Readonly<{ slot: EquipmentSlot; itemClass: ItemClass }>[] = [
    { slot: "body", itemClass: "armor" },
    { slot: "head", itemClass: "helmet" },
    { slot: "arms", itemClass: "bracers" },
    { slot: "offHand", itemClass: "shield" },
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
const baseCombatantName = (name: string): string => name.replace(/#\d+$/u, "");

export class GameStateRuntime {
    private readonly scr: SCRRuntime;
    private readonly factions = new FactionRelations();
    private readonly persons = new Map<string, boolean>();
    private readonly personStatesByLevel = new Map<string, Map<string, boolean>>();
    private readonly inventories = new Map<string, Inventory>();
    private readonly initializedTriggerInventories = new Set<string>();
    private readonly questFlags = new Map<string, boolean>();
    private readonly stageFlags = new Map<string, boolean>();
    private readonly locationAccess = new Map<string, number>();
    private readonly personParameters = new Map<string, Map<string, number>>();
    private readonly bestiaryKills = new Map<string, number>();
    private readonly personConditions = new Map<string, Map<string, number | boolean>>();
    private readonly combatants = new Map<string, Combatant>();
    private readonly personSounds = new Map<string, PersonCombatAssets["sounds"]>();
    private readonly corpseInventorySources = new Map<string, string>();
    private readonly personInventoryLevels = new Map<string, number>();
    private readonly traders = new Set<string>();
    private lootGenerationLevel = 1;
    private readonly lootableCorpses = new Set<string>();
    private readonly random: () => number;
    private readonly combatProfiles = new Map<string, OriginalCombatProfile>();
    private readonly combatItems = new Map<string, readonly ShippedItem[]>();
    private readonly registeredItems = new Map<string, ShippedItem>();
    private readonly inventoryCatalog: InventoryCatalog;
    private inventorySerial = 0;
    private readonly combatProfileSources = new Map<string, CombatProfileSource>();
    private readonly combatantPositions = new Map<string, WorldPosition>();
    private readonly personResources = new Map<string, string>();
    private allyPortraitMappings: readonly AllyPortraitMapping[] = [];
    private nativeFactionRelationsLoaded = false;
    private readonly activeMagicEffects: ActiveMagicEffect[] = [];
    private readonly healthRegenerationElapsed = new Map<string, number>();
    private readonly energyRegenerationElapsed = new Map<string, number>();
    private lastPlayerPosition: WorldPosition = { x: 0, y: 0 };
    private hasPlayerPosition = false;
    private readonly activeEnemies = new Set<string>();
    private readonly magicDefinitions = new Map<number, MagicDefinition>();
    private readonly magicDefinitionsByName = new Map<string, MagicDefinition>();
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
    private aiTurnQueue: string[] = [];
    private aiNextActionTimeMs = 0;
    private lastCombatActionDurationMs = 350;
    private aiTurnEndsAfterAction = false;
    private aiCycleFoundHostileTarget = false;
    private heroLastTarget: string | undefined;
    private readonly aiPreferredTargets = new Map<string, string>();
    private scenario: ScenarioRuntime | null = null;
    private levelData: LevelData | null = null;
    private coreScript: SCRScript | null = null;
    private readonly triggerScriptSources = new Map<string, SCRHandlerSources>();
    private generation = 0;
    private experience = 0;
    private elapsedMinutes = GOLDENLAND_START_MINUTE_OF_DAY;
    private lastCoreTick = 0;
    private lastClockTimeMs: number | undefined;
    private clockAccumulatorMs = 0;
    private restRequestedMinutes = 0;
    private restRemainingMinutes = 0;
    private npcRoutes: readonly NpcRouteState[] = [];

    public constructor(private readonly options: GameStateRuntimeOptions) {
        this.random = options.random ?? Math.random;
        this.inventoryCatalog = {
            get: (id): ItemDefinition => this.registeredItems.get(id.toLowerCase())?.definition ?? {
                id,
                itemClass: "unknown",
                maxStack: 0x7fffffff,
            },
        };
        this.scr = new SCRRuntime({ host: { call: (name, arguments_) => this.callHost(name, arguments_) } });
    }

    public async loadLevel(levelData: LevelData): Promise<void> {
        const previousPersonLevel = this.currentDynamicPersonLevel;
        this.captureCurrentPersonStates();
        const generation = ++this.generation;
        this.levelData = levelData;
        this.triggerScriptSources.clear();
        this.coreScript = levelData.coreScript ? parseSCRScript(levelData.coreScript, `${levelData.levelName}/core.scr`) : null;
        if (this.coreScript && Object.keys(this.coreScript.handlers).length > 0) {
            throw new Error(`${levelData.levelName}/core.scr contains event handlers; native core context expects top-level statements`);
        }
        this.lastCoreTick = 0;
        this.lastClockTimeMs = undefined;
        this.clockAccumulatorMs = 0;
        this.pendingDynamicRoute = undefined;
        this.pendingDynamicCombatLoads = [];
        this.currentDynamicPersonLevel = dynamicPersonLevelKey(levelData);
        let savedPersonStates = new Map<string, boolean>();
        if (previousPersonLevel === this.currentDynamicPersonLevel) {
            this.personStatesByLevel.delete(this.currentDynamicPersonLevel);
        } else {
            savedPersonStates = new Map(this.personStatesByLevel.get(this.currentDynamicPersonLevel) ?? []);
        }
        this.dynamicPersons = (this.dynamicPersonsByLevel.get(this.currentDynamicPersonLevel) ?? [])
            .map((person) => ({ ...person, position: { ...person.position } }));

        const personDefinitions = [...levelData.sefData.persons, ...this.dynamicPersons];
        const [personAssets, personResources, heroAssets, magicDefinitions, nativeFactionRelations, allyPortraitMappings] = await Promise.all([
            Promise.all(personDefinitions.map(async (person) => [
                person.name.toLowerCase(),
                await loadPersonCombatAssets(person.name),
            ] as const)),
            Promise.all(personDefinitions.map(async (person) => [
                person.name.toLowerCase(),
                await loadPersonResourceName(person.name),
            ] as const)),
            loadPersonCombatAssets("hero"),
            loadMagicCatalog(),
            this.nativeFactionRelationsLoaded ? Promise.resolve([]) : loadNativeFactionRelations(),
            this.allyPortraitMappings.length > 0 ? Promise.resolve(this.allyPortraitMappings) : loadAllyPortraitMappings(),
        ]);
        if (generation !== this.generation) return;
        if (!this.nativeFactionRelationsLoaded) {
            for (const relation of nativeFactionRelations) this.factions.set(relation.from, relation.to, relation.relation);
            this.nativeFactionRelationsLoaded = true;
        }
        this.allyPortraitMappings = allyPortraitMappings;
        this.personResources.clear();
        for (const [name, resource] of personResources) this.personResources.set(name, resource);
        this.magicDefinitions.clear();
        this.magicDefinitionsByName.clear();
        for (const definition of magicDefinitions) {
            this.magicDefinitions.set(definition.id, definition);
            this.magicDefinitionsByName.set(definition.technicalName.toLowerCase(), definition);
        }
        this.scenario = new ScenarioRuntime(levelData.sefData, levelData.lvlData, levelData.triggerCells, {
            random: this.random,
            onScript: (request) => void this.executeTriggerRequest(request, generation),
            onDoorChange: (change) => this.options.onDoorChange?.(change),
            onTriggerChange: ({ trigger }) => this.options.onTriggerChange?.(trigger),
        });
        const assets = new Map(personAssets);
        this.createCombatants(levelData, assets, heroAssets);
        for (const person of this.dynamicPersons) this.registerPersonCombatant(person, assets.get(person.name.toLowerCase()));
        if (savedPersonStates) {
            for (const name of this.persons.keys()) {
                const present = savedPersonStates.get(name.toLowerCase());
                if (present !== undefined) this.setPersonPresence(name, present);
            }
        }
        if (levelData.initScript) {
            const initScript = parseSCRScript(levelData.initScript, `${levelData.levelName}/init.scr`);
            if (Object.keys(initScript.handlers).length > 0) {
                throw new Error(`${levelData.levelName}/init.scr contains event handlers; native init context expects top-level statements`);
            }
            this.scr.executeProgram(initScript.program);
        }
        await Promise.all(this.pendingDynamicCombatLoads);
    }

    public update(
        tick: number,
        simulationTimeMs: number,
        playerPosition: Readonly<WorldPosition>,
        clockTimeMs = simulationTimeMs,
    ): void {
        if (!this.scenario || !this.levelData) return;
        const playerMoved = this.hasPlayerPosition
            && Math.hypot(playerPosition.x - this.lastPlayerPosition.x, playerPosition.y - this.lastPlayerPosition.y) > 0.001;
        this.lastPlayerPosition = { ...playerPosition };
        this.hasPlayerPosition = true;
        this.combatantPositions.set("hero", worldToCell(playerPosition));
        this.scenario.setPlayerWorldPosition(playerPosition);
        if (!this.combatActive && this.lastClockTimeMs !== undefined) {
            const delta = clockTimeMs - this.lastClockTimeMs;
            if (Number.isFinite(delta) && delta >= 0) this.advanceClockTime(delta);
        }
        this.lastClockTimeMs = clockTimeMs;
        this.npcRoutes = this.scenario.advanceRoutes(simulationTimeMs);
        this.detectAutomaticCombat(playerPosition, playerMoved);
        this.advanceAiTurns(simulationTimeMs);
        if (this.coreScript && tick - this.lastCoreTick >= 20) {
            this.lastCoreTick = tick;
            const hero = this.combatants.get("hero");
            if (hero && hero.health > 0) this.scr.executeProgram(this.coreScript.program);
        }
    }
    public resetClockTimeBaseline(): void {
        this.lastClockTimeMs = undefined;
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

    public async interactTrigger(instanceKey: string): Promise<boolean> {
        const scenario = this.scenario;
        if (!scenario) return false;
        const trigger = scenario.interactTrigger(instanceKey);
        if (!trigger.active) return false;
        if (!trigger.inventoryName) return true;

        const inventoryOwner = `trigger:${trigger.instanceKey}`;
        const existingOwner = this.inventoryOwner(inventoryOwner);
        if (!this.initializedTriggerInventories.has(existingOwner)) {
            const fileName = trigger.inventoryName.toLowerCase().endsWith(".inv")
                ? trigger.inventoryName.toLowerCase()
                : `${trigger.inventoryName.toLowerCase()}.inv`;
            const response = await fetch(`${Paths.SCRIPTS}/inventory/${fileName}`);
            if (!response.ok) throw new Error(`Failed to load trigger inventory ${fileName}: HTTP ${response.status}`);
            const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
            const script = parseInventoryScript(source);
            this.initializeInventory(existingOwner, materializeInventory(script, {
                level: this.lootGenerationLevel,
                random: this.random,
                resolveMaximumStack: (technicalName) => this.inventoryCatalog.get(technicalName).maxStack,
            }));
            this.initializedTriggerInventories.add(existingOwner);
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
        const heroParameters = this.personParameters.get("Hero");
        this.lootGenerationLevel = originalInventoryLevelForWorld([{
            experience,
            criticalHitSkill: heroParameters?.get("skill_critical_hit") ?? 0,
            hackSkill: heroParameters?.get("skill_hack") ?? 0,
        }]);
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
        const inventory = this.createInventory();
        for (const [item, quantity] of Object.entries(items)) {
            if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`Invalid initial quantity for ${item}`);
            inventory.add(this.createInventoryItem(existingOwner, item), quantity);
        }
        this.inventories.set(existingOwner, inventory);
    }

    public initializeInventoryFromScript(
        owner: string,
        source: string,
        options: Readonly<{ pass?: "normal" | "decreased" }> = {},
    ): void {
        const script = parseInventoryScript(source);
        if (script.regenerateChance > 0 && script.regenerateChance <= 100) this.random();
        const normalizedOwner = owner.toLowerCase();
        const personInventoryOwner = normalizedOwner.startsWith("person:")
            ? normalizedOwner.slice("person:".length)
            : normalizedOwner.startsWith("trade:")
                ? normalizedOwner.slice("trade:".length)
                : undefined;
        const materializationLevel = personInventoryOwner === undefined
            ? this.lootGenerationLevel
            : this.personInventoryLevels.get(personInventoryOwner) ?? this.lootGenerationLevel;
        this.initializeInventory(owner, materializeInventory(script, {
            level: materializationLevel,
            random: this.random,
            pass: options.pass,
            resolveMaximumStack: (technicalName) => this.inventoryCatalog.get(technicalName).maxStack,
        }));
    }

    public getTradePriceMultiplier(): number {
        return nativeTradePriceMultiplier(
            this.getPersonParameter("Hero", "skill_alchemy"),
            this.options.addonMode ?? false,
            Math.trunc(this.getPersonParameter("Hero", "special_perks")),
        );
    }

    public exchangeTradeOffers(
        trader: string,
        heroOffer: TradeOffer,
        traderOffer: TradeOffer,
        buyCost: number,
        sellCredit: number,
    ): boolean {
        if (![buyCost, sellCredit].every((value) => Number.isSafeInteger(value) && value >= 0)) return false;
        const validateOffer = (owner: string, offer: TradeOffer): boolean => Object.entries(offer).every(([stackKey, quantity]) => {
            const stack = this.inventoryStack(owner, stackKey);
            return stack !== undefined
                && stack.item.definitionId.toLowerCase() !== MONEY_ITEM_ID.toLowerCase()
                && Number.isSafeInteger(quantity) && quantity > 0
                && stack.quantity >= quantity;
        });
        if (!validateOffer("Hero", heroOffer) || !validateOffer(trader, traderOffer)) return false;

        const balance = buyCost - sellCredit;
        if (balance > 0 && this.itemCount("Hero", MONEY_ITEM_ID) < balance) return false;
        if (balance < 0 && this.itemCount(trader, MONEY_ITEM_ID) < -balance) return false;

        const transaction = new InventoryTransaction();
        for (const [stackKey, quantity] of Object.entries(heroOffer)) {
            if (!this.queueStackTransfer(transaction, "Hero", trader, stackKey, quantity)) return false;
        }
        for (const [stackKey, quantity] of Object.entries(traderOffer)) {
            if (!this.queueStackTransfer(transaction, trader, "Hero", stackKey, quantity)) return false;
        }
        if (balance > 0 && !this.queueDefinitionTransfer(transaction, "Hero", trader, MONEY_ITEM_ID, balance)) return false;
        if (balance < 0 && !this.queueDefinitionTransfer(transaction, trader, "Hero", MONEY_ITEM_ID, -balance)) return false;
        try {
            transaction.commit();
            return true;
        } catch {
            return false;
        }
    }

    public hasInventory(owner: string): boolean {
        return this.inventories.has(this.inventoryOwner(owner));
    }

    public getInventory(owner: string): Readonly<Record<string, number>> {
        const inventory = this.inventories.get(this.inventoryOwner(owner));
        if (!inventory) return {};
        const counts = new Map<string, number>();
        for (const { item, quantity } of inventory.snapshot().stacks) {
            counts.set(item.definitionId, (counts.get(item.definitionId) ?? 0) + quantity);
        }
        return Object.fromEntries(counts);
    }

    public getInventoryStacks(owner: string): readonly InventoryStackRuntimeSnapshot[] {
        const inventory = this.inventories.get(this.inventoryOwner(owner));
        if (!inventory) return [];
        const grouped = new Map<string, InventoryStackRuntimeSnapshot>();
        for (const { item, quantity } of inventory.snapshot().stacks) {
            const stackKey = this.inventoryStackKey(item);
            const current = grouped.get(stackKey);
            grouped.set(stackKey, {
                stackKey,
                id: current?.id ?? item.id,
                technicalName: item.definitionId,
                durability: item.durability ?? 100,
                ...(item.charges === undefined ? {} : { charges: item.charges }),
                quantity: (current?.quantity ?? 0) + quantity,
            });
        }
        return [...grouped.values()];
    }

    public transferInventoryItem(source: string, destination: string, stackKey: string, quantity: number): boolean {
        const transaction = new InventoryTransaction();
        if (!this.queueStackTransfer(transaction, source, destination, stackKey, quantity)) return false;
        try {
            transaction.commit();
            return true;
        } catch {
            return false;
        }
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

        // Server.dll 0x1404B1C0 gives traders two inventories: normal merchant
        // stock and a separately rolled, decreased personal inventory retained by the corpse.
        const inventoryOwner = `person:${resolvedName ?? technicalName}`;
        if (!this.hasInventory(inventoryOwner)) {
            const fileName = inventorySource.toLowerCase().endsWith(".inv")
                ? inventorySource.toLowerCase()
                : `${inventorySource.toLowerCase()}.inv`;
            const response = await fetch(`${Paths.SCRIPTS}/inventory/${fileName}`);
            if (!response.ok) throw new Error(`Failed to load corpse inventory ${fileName}: HTTP ${response.status}`);
            const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
            this.initializeInventoryFromScript(inventoryOwner, source, {
                pass: this.traders.has(normalized) ? "decreased" : "normal",
            });
        }
        this.options.onContainerOpen?.(inventoryOwner, resolvedName ?? technicalName);
        return true;
    }

    public registerItem(item: ShippedItem): void {
        this.registeredItems.set(item.technicalName.toLowerCase(), item);
        this.refreshHeroCombatProfile();
    }

    public equipHeroItem(item: string, slot: EquipmentSlot, stackKey?: string): boolean {
        if (!EQUIPMENT_SLOTS.includes(slot)) throw new Error(`Unknown equipment slot ${slot}`);
        const inventory = this.inventories.get(this.inventoryOwner("Hero"));
        if (!inventory) return false;
        const stack = stackKey
            ? this.inventoryStack("Hero", stackKey)
            : inventory.snapshot().stacks.find(({ item: candidate }) => candidate.definitionId.toLowerCase() === item.toLowerCase());
        if (!stack || stack.item.definitionId.toLowerCase() !== item.toLowerCase()) return false;
        try {
            inventory.equip(stack.item, slot, slot === "ammo" ? stack.quantity : 1);
            this.refreshHeroCombatProfile();
            return true;
        } catch {
            return false;
        }
    }

    public unequipHeroItem(slot: EquipmentSlot): boolean {
        const inventory = this.inventories.get(this.inventoryOwner("Hero"));
        if (!inventory?.getEquipped(slot)) return false;
        try {
            inventory.unequip(slot);
            this.refreshHeroCombatProfile();
            return true;
        } catch {
            return false;
        }
    }

    public dropHeroItem(item: string, quantity = 1, stackKey?: string): boolean {
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Drop quantity must be a positive integer");
        return stackKey
            ? this.removeInventoryStack("Hero", stackKey, quantity)
            : this.changeItemCount("Hero", item, -quantity) === 1;
    }

    public useHeroItem(
        item: string,
        effects: readonly { readonly specialId: number; readonly amount: number }[],
        nutrition: number,
        stackKey?: string,
    ): boolean {
        const removed = stackKey
            ? this.removeInventoryStack("Hero", stackKey, 1)
            : this.changeItemCount("Hero", item, -1) === 1;
        if (!removed) return false;
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
    public learnHeroMagic(item: string, magicId: number, stackKey?: string): boolean {
        if (!Number.isSafeInteger(magicId) || magicId < 0 || magicId >= MAGIC_SPELL_COUNT) return false;
        if (this.getPersonParameter("Hero", magicSpellParameter(magicId)) !== 0) return false;
        const removed = stackKey
            ? this.removeInventoryStack("Hero", stackKey, 1)
            : this.changeItemCount("Hero", item, -1) === 1;
        if (!removed) return false;
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
        const inventory = this.inventories.get(this.inventoryOwner("Hero"));
        return Object.fromEntries(
            Object.entries(inventory?.snapshot().equipped ?? {}).map(([slot, stack]) => [slot, stack?.item.definitionId]),
        );
    }

    public getHeroAttackDistance(): number {
        return this.combatProfiles.get("hero")?.weapon.attackDistance ?? 6;
    }

    public setCombatantPosition(technicalName: string, worldPosition: Readonly<WorldPosition>): void {
        const resolvedName = this.resolveCombatantName(technicalName);
        if (resolvedName) this.combatantPositions.set(resolvedName, worldToCell(worldPosition));
    }

    public setCombatMode(active: boolean): void {
        const changed = this.combatActive !== active;
        this.combatActive = active;
        this.selectedMagicId = undefined;
        this.activeEnemies.clear();
        this.aiTurnQueue = [];
        this.aiNextActionTimeMs = 0;
        this.aiTurnEndsAfterAction = false;
        this.aiCycleFoundHostileTarget = false;
        this.combatRound = active ? 1 : 0;
        this.currentCombatant = active ? "hero" : undefined;
        this.remainingActionPoints.clear();
        this.combatMessage = "";
        if (active) {
            const profile = this.combatProfiles.get("hero");
            if (profile) this.remainingActionPoints.set("hero", profile.actionPoints);
        }
        if (changed) this.options.onCombatModeChange?.(active);
    }

    public consumeCombatMovementActionPoint(technicalName = "hero"): boolean {
        if (!this.combatActive) return true;
        const name = this.resolveCombatantName(technicalName);
        if (!name || this.currentCombatant !== name) return false;
        const remaining = this.remainingActionPoints.get(name) ?? this.combatProfiles.get(name)?.actionPoints ?? 0;
        if (remaining < 1) {
            this.combatMessage = "Недостаточно очков действия";
            return false;
        }
        this.remainingActionPoints.set(name, remaining - 1);
        this.syncCombatParameters(name);
        return true;
    }
    public getHeroCombatActionPoints(): number {
        return this.remainingActionPoints.get("hero") ?? this.combatProfiles.get("hero")?.actionPoints ?? 0;
    }

    public completeHeroCombatAction(): boolean {
        if (!this.combatActive || this.currentCombatant !== "hero" || this.getHeroCombatActionPoints() > 0) return false;
        return this.endCombatTurn();
    }


    public endCombatTurn(): boolean {
        if (!this.combatActive) {
            this.setCombatMode(true);
            return true;
        }
        if (this.currentCombatant !== "hero") return false;
        const hero = this.combatants.get("hero");
        if (!hero || hero.isDead) return false;

        this.aiTurnQueue = [...this.combatants.keys()]
            .filter((name) => name !== "hero" && this.isCombatantPresent(name) && !this.combatants.get(name)?.isDead)
            .sort((left, right) => (this.combatProfiles.get(right)?.initiative ?? 0) - (this.combatProfiles.get(left)?.initiative ?? 0));
        this.aiCycleFoundHostileTarget = false;
        this.aiNextActionTimeMs = 0;
        this.aiTurnEndsAfterAction = false;
        if (this.aiTurnQueue.length === 0) {
            this.finishAiCycle();
            return true;
        }
        this.beginNextAiTurn();
        return true;
    }

    private isCombatantPresent(name: string): boolean {
        return name === "hero" || this.persons.get(name) !== false;
    }

    private detectAutomaticCombat(heroPosition: Readonly<WorldPosition>, heroMoved: boolean): void {
        if (this.combatActive || this.combatants.get("hero")?.isDead) return;
        const heroCell = worldToCell(heroPosition);
        for (const [name, combatant] of this.combatants) {
            if (name === "hero" || combatant.isDead || !this.isCombatantPresent(name) || this.isPartyMember(name)) continue;
            if (!this.factions.isHostile(combatant.factionId, this.combatants.get("hero")?.factionId ?? "hero")) continue;
            const template = this.combatProfileSources.get(name)?.template;
            const position = this.combatantPositions.get(name);
            if (!template || !position) continue;
            const distance = originalCombatDistance(position, heroCell);
            const seesHero = template.radiusSee > 0
                && distance <= template.radiusSee
                && (this.options.onCombatantCanSee?.(name, heroPosition) ?? true);
            const hearsHero = heroMoved && template.radiusHear > 0 && distance <= template.radiusHear;
            if (!seesHero && !hearsHero) continue;
            this.setCombatMode(true);
            this.activeEnemies.add(name);
            return;
        }
    }

    private beginNextAiTurn(): void {
        while (true) {
            const name = this.aiTurnQueue.shift();
            if (!name) {
                this.finishAiCycle();
                return;
            }
            const profile = this.combatProfiles.get(name);
            const combatant = this.combatants.get(name);
            if (!profile || !combatant || combatant.isDead || !this.isCombatantPresent(name)
                || this.nativeCombatTargetsFor(name).length === 0) continue;

            this.currentCombatant = name;
            this.remainingActionPoints.set(name, profile.actionPoints);
            this.combatMessage = "";
            this.aiNextActionTimeMs = 0;
            this.aiTurnEndsAfterAction = false;
            this.syncCombatParameters(name);
            return;
        }
    }

    private finishAiCycle(): void {
        const hero = this.combatants.get("hero");
        if (!hero || hero.isDead) {
            this.currentCombatant = undefined;
            this.aiTurnQueue = [];
            return;
        }
        if (!this.aiCycleFoundHostileTarget) {
            this.setCombatMode(false);
            return;
        }
        this.advanceMagicEffects(1);
        this.combatRound += 1;
        this.currentCombatant = "hero";
        const heroProfile = this.combatProfiles.get("hero");
        if (heroProfile) this.remainingActionPoints.set("hero", heroProfile.actionPoints);
        this.combatMessage = "";
        this.syncCombatParameters("hero");
    }

    private nativeCombatTargetsFor(actorName: string): readonly string[] {
        const actor = this.combatants.get(actorName);
        if (!actor) return [];
        let candidates = [...this.combatants.entries()]
            .filter(([name, combatant]) => name !== actorName && this.isCombatantPresent(name) && !combatant.isDead
                && this.factions.isHostile(actor.factionId, combatant.factionId))
            .map(([name]) => name);
        let primary = this.aiPreferredTargets.get(actorName);
        let secondary: string | undefined;

        if (this.isPartyMember(actorName)) {
            const command = this.getPersonParameter(actorName, "ally_command");
            if (command === ALLY_COMMANDS.CMD_ALLY_DO_NOT_FIGHT) return [];
            if (command === ALLY_COMMANDS.CMD_ALLY_HERO_TARGET) {
                if (!this.heroLastTarget || !candidates.includes(this.heroLastTarget)) return [];
                candidates = [this.heroLastTarget];
                primary = this.heroLastTarget;
            }
            if (command === ALLY_COMMANDS.CMD_ALLY_NOT_HERO_TARGET && this.heroLastTarget) {
                candidates = candidates.filter((name) => name !== this.heroLastTarget);
            }
            if (command === ALLY_COMMANDS.CMD_ALLY_HERO_DANGER) {
                const heroPosition = this.combatantPositions.get("hero");
                if (!heroPosition) return [];
                candidates = candidates.filter((name) => {
                    const position = this.combatantPositions.get(name);
                    return position && originalCombatDistance(heroPosition, position) <= 8;
                });
            }
            if (command === ALLY_COMMANDS.CMD_ALLY_WEAK_TARGET) {
                primary = [...candidates].sort((left, right) =>
                    (this.combatants.get(left)?.health ?? 0) - (this.combatants.get(right)?.health ?? 0))[0];
            }
            secondary = this.heroLastTarget;
        }

        return rankNativeCombatAiTargets(candidates.map((name, rosterOrder) => ({
            id: name,
            marker: 0,
            priority: 0,
            relationRank: relationScores[this.factions.get(actor.factionId, this.combatants.get(name)!.factionId)],
            rosterOrder,
        })), { primary, secondary }).map(({ id }) => id);
    }


    private availableAiMagic(actorName: string): readonly MagicDefinition[] {
        const actor = this.combatants.get(actorName);
        const template = this.combatProfileSources.get(actorName)?.template;
        if (!actor || !template || template.spells.length === 0) return [];
        if (this.activeMagicEffects.some((effect) => effect.targetName === actorName && effect.specialId === "IDSPEC_SILENCE")) return [];
        const actionPoints = this.remainingActionPoints.get(actorName) ?? 0;
        return template.spells
            .map((spell) => this.magicDefinitionsByName.get(spell.spellId.toLowerCase()))
            .filter((magic): magic is MagicDefinition => magic !== undefined && magic.executable)
            .filter((magic) => magicActionPointCost(magic) <= actionPoints && magicEnergyCost(magic) <= actor.mana);
    }

    private aiSelfPreservationChoice(actorName: string): MagicDefinition | undefined {
        const actor = this.combatants.get(actorName);
        const profile = this.combatProfiles.get(actorName);
        const template = this.combatProfileSources.get(actorName)?.template;
        if (!actor || !profile || !template || template.lifeHealing <= 0) return undefined;
        const threshold = profile.maxHealth * template.lifeHealing / 100;
        const probability = nativeSelfPreservationProbability(actor.health, threshold);
        if (probability <= 0 || this.random() >= probability) return undefined;
        return this.availableAiMagic(actorName).find((magic) => magic.target === "ally" && magic.healing);
    }

    private aiCombatMagicChoice(actorName: string, enemyTargetName: string): Readonly<{ magic: MagicDefinition; targetName: string }> | undefined {
        const template = this.combatProfileSources.get(actorName)?.template;
        if (!template || template.battleMagicUse <= 0 || this.random() * 100 >= template.battleMagicUse) return undefined;
        const available = this.availableAiMagic(actorName).filter((magic) => !magic.healing);
        const offensive = available.filter((magic) => magic.target === "enemy");
        const support = available.filter((magic) => magic.target === "ally")
            .filter((magic) => !magic.specials.some((special) =>
                this.activeMagicEffects.some((effect) => effect.targetName === actorName && effect.specialId === special.id)));
        const candidates = [...offensive, ...support];
        if (candidates.length === 0) return undefined;
        const magic = candidates[Math.floor(this.random() * candidates.length)];
        return { magic, targetName: magic.target === "enemy" ? enemyTargetName : actorName };
    }

    private moveAiCombatant(actorName: string, targetName: string, away: boolean): number | undefined {
        const targetPosition = this.combatantPositions.get(targetName);
        const remaining = this.remainingActionPoints.get(actorName) ?? 0;
        if (!targetPosition || remaining <= 0) return undefined;
        const movement = this.options.onCombatantMoveRequest?.(actorName, cellToWorld(targetPosition), away);
        if (!movement) return undefined;
        this.combatantPositions.set(actorName, worldToCell(movement.position));
        this.remainingActionPoints.set(actorName, remaining - 1);
        return movement.durationMs;
    }

    private scheduleAiActionCompletion(actorName: string, simulationTimeMs: number, durationMs: number): void {
        this.aiNextActionTimeMs = simulationTimeMs + Math.max(1, durationMs);
        this.aiTurnEndsAfterAction = (this.remainingActionPoints.get(actorName) ?? 0) <= 0;
    }

    private advanceAiTurns(simulationTimeMs: number): void {
        if (!this.combatActive || !this.currentCombatant || this.currentCombatant === "hero") return;
        if (this.aiNextActionTimeMs === 0) {
            this.aiNextActionTimeMs = simulationTimeMs + 350;
            return;
        }
        if (simulationTimeMs < this.aiNextActionTimeMs) return;
        if (this.aiTurnEndsAfterAction) {
            this.aiTurnEndsAfterAction = false;
            this.beginNextAiTurn();
            return;
        }
        const actorName = this.currentCombatant;
        const actor = this.combatants.get(actorName);
        const profile = this.combatProfiles.get(actorName);
        const template = this.combatProfileSources.get(actorName)?.template;
        if (!actor || actor.isDead || !profile) {
            this.beginNextAiTurn();
            return;
        }

        const preservation = this.aiSelfPreservationChoice(actorName);
        if (preservation && this.performCombatantMagic(actorName, preservation, actorName)) {
            this.scheduleAiActionCompletion(actorName, simulationTimeMs, this.lastCombatActionDurationMs);
            return;
        }

        const targetNames = this.nativeCombatTargetsFor(actorName);
        if (targetNames.length === 0) {
            this.beginNextAiTurn();
            return;
        }
        this.aiCycleFoundHostileTarget = true;

        const magicChoice = this.aiCombatMagicChoice(actorName, targetNames[0]);
        if (magicChoice && this.performCombatantMagic(actorName, magicChoice.magic, magicChoice.targetName)) {
            this.scheduleAiActionCompletion(actorName, simulationTimeMs, this.lastCombatActionDurationMs);
            return;
        }

        const healthThreshold = profile.maxHealth * (template?.lifeEscape ?? 0) / 100;
        if (healthThreshold > 0 && actor.health < healthThreshold) {
            if ((this.remainingActionPoints.get(actorName) ?? 0) <= 3) {
                this.remainingActionPoints.set(actorName, 0);
                this.beginNextAiTurn();
            } else {
                const movementDuration = this.moveAiCombatant(actorName, targetNames[0], true);
                if (movementDuration !== undefined) this.scheduleAiActionCompletion(actorName, simulationTimeMs, movementDuration);
                else {
                    this.remainingActionPoints.set(actorName, 0);
                    this.beginNextAiTurn();
                }
            }
            return;
        }

        for (const targetName of targetNames.slice(0, NATIVE_TARGET_RETRY_LIMIT)) {
            const actorPosition = this.combatantPositions.get(actorName);
            const targetPosition = this.combatantPositions.get(targetName);
            if (!actorPosition || !targetPosition) continue;
            if (originalCombatDistance(actorPosition, targetPosition) > profile.weapon.attackDistance) {
                const movementDuration = this.moveAiCombatant(actorName, targetName, false);
                if (movementDuration === undefined) continue;
                this.scheduleAiActionCompletion(actorName, simulationTimeMs, movementDuration);
                return;
            }

            if ((this.remainingActionPoints.get(actorName) ?? 0) < profile.weapon.actionPointCost) {
                this.remainingActionPoints.set(actorName, 0);
                this.beginNextAiTurn();
                return;
            }
            const result = this.performCombatAttack(actorName, targetName);
            if (!result) continue;
            this.scheduleAiActionCompletion(actorName, simulationTimeMs, this.lastCombatActionDurationMs);
            return;
        }

        this.remainingActionPoints.set(actorName, 0);
        this.beginNextAiTurn();
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
        if (this.sharesHeroPartyOwner("hero", targetName)) return undefined;
        this.activeEnemies.add(targetName);
        this.heroLastTarget = targetName;
        const result = this.performCombatAttack("hero", targetName);
        if (target.isDead) this.activeEnemies.delete(targetName);
        return result;
    }

    public restoreScriptVariables(variables: GameSaveData["scriptVariables"]): void {
        this.scr.clearVariables();
        for (const [name, value] of Object.entries(variables)) this.scr.setVariable(name, value);
    }

    public restore(save: GameSaveData): void {
        this.cancelRest();
        this.restoreScriptVariables(save.scriptVariables);
        this.inventories.clear();
        this.initializedTriggerInventories.clear();
        for (const [owner, stacks] of Object.entries(save.inventories)) {
            const inventory = this.createInventory();
            inventory.restore(stacks.map(({ quantity, ...item }) => ({ item, quantity })));
            this.inventories.set(owner, inventory);
            if (owner.toLowerCase().startsWith("trigger:")) {
                this.initializedTriggerInventories.add(this.inventoryOwner(owner));
            }
        }
        const heroOwner = this.inventoryOwner("Hero");
        const heroInventory = this.inventories.get(heroOwner) ?? this.createInventory();
        heroInventory.restore(
            heroInventory.snapshot().stacks,
            Object.fromEntries(Object.entries(save.equipped).map(([slot, stack]) => [
                slot,
                stack && { item: { ...stack }, quantity: stack.quantity },
            ])),
        );
        this.inventories.set(heroOwner, heroInventory);
        this.questFlags.clear();
        for (const [name, value] of Object.entries(save.questFlags)) this.questFlags.set(name, value);
        if (Object.keys(save.persons).length > 0) {
            this.persons.clear();
            for (const [name, present] of Object.entries(save.persons)) this.setPersonPresence(name, present);
        }
        this.personStatesByLevel.clear();
        for (const [level, persons] of Object.entries(save.personStatesByLevel)) {
            this.personStatesByLevel.set(level, new Map(
                Object.entries(persons).map(([name, present]) => [name.toLowerCase(), present]),
            ));
        }
        this.stageFlags.clear();
        for (const [name, value] of Object.entries(save.stageFlags)) this.stageFlags.set(name, value);
        this.locationAccess.clear();
        for (const [name, value] of Object.entries(save.locationAccess)) {
            this.locationAccess.set(name, value);
            this.scr.setVariable(`${name}_state`, value);
        }
        this.personParameters.clear();
        for (const [person, values] of Object.entries(save.personParameters)) {
            this.personParameters.set(person, new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value])));
        }
        this.bestiaryKills.clear();
        for (const [name, count] of Object.entries(save.bestiaryKills)) this.bestiaryKills.set(name.toLowerCase(), count);
        this.experience = save.experience;
        this.lootGenerationLevel = save.lootGenerationLevel;
        this.personInventoryLevels.clear();
        this.elapsedMinutes = save.clock.day * 24 * 60 + save.clock.minuteOfDay;
        this.clockAccumulatorMs = 0;
        this.lastClockTimeMs = undefined;
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
    public beginRest(minutes: number): boolean {
        if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes <= 0) {
            throw new Error("Rest duration must be a positive integer number of minutes");
        }
        if (this.restRemainingMinutes > 0) return false;
        this.clockAccumulatorMs = 0;
        this.restRequestedMinutes = minutes;
        this.restRemainingMinutes = minutes;
        this.publishRestState();
        return true;
    }

    public cancelRest(): boolean {
        if (this.restRemainingMinutes <= 0) return false;
        this.clockAccumulatorMs = 0;
        this.restRequestedMinutes = 0;
        this.restRemainingMinutes = 0;
        this.publishRestState();
        return true;
    }

    public getRestState(): RestRuntimeState {
        return Object.freeze({
            active: this.restRemainingMinutes > 0,
            requestedMinutes: this.restRequestedMinutes,
            remainingMinutes: this.restRemainingMinutes,
        });
    }

    public advanceClockTime(deltaMs: number): void {
        if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error("Clock delta must be a non-negative finite number");
        const resting = this.restRemainingMinutes > 0;
        this.clockAccumulatorMs += deltaMs * (resting ? NATIVE_REST_CLOCK_MINUTES_PER_SECOND : 1);
        let elapsedGameMinutes = Math.floor(this.clockAccumulatorMs / 1000);
        if (elapsedGameMinutes <= 0) return;
        if (resting) elapsedGameMinutes = Math.min(elapsedGameMinutes, this.restRemainingMinutes);
        this.clockAccumulatorMs -= elapsedGameMinutes * 1000;
        this.advanceClock(elapsedGameMinutes);
        if (!resting) return;
        this.restRemainingMinutes -= elapsedGameMinutes;
        if (this.restRemainingMinutes > 0) return;
        this.clockAccumulatorMs = 0;
        this.restRequestedMinutes = 0;
        this.publishRestState();
    }

    private publishRestState(): void {
        this.options.onRestChange?.(this.getRestState());
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
        if (minutes > 0) this.options.onClockChange?.(this.elapsedMinutes);
    }
    public getElapsedMinutes(): number {
        return this.elapsedMinutes;
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
            personStatesByLevel: this.personStatesByLevelSnapshot(),
            inventories: Object.fromEntries([...this.inventories.keys()].map((owner) => [owner, this.getInventory(owner)])),
            inventoryStacks: Object.fromEntries([...this.inventories.keys()].map((owner) => [owner, this.getInventoryStacks(owner)])),
            equipped: this.getEquippedItems(),
            equippedStacks: { ...(this.inventories.get(this.inventoryOwner("Hero"))?.snapshot().equipped ?? {}) },
            questFlags: Object.fromEntries(this.questFlags),
            stageFlags: Object.fromEntries(this.stageFlags),
            locationAccess: Object.fromEntries(this.locationAccess),
            personParameters: Object.fromEntries([...this.personParameters].map(([person, values]) => [person, Object.fromEntries(values)])),
            bestiaryKills: Object.fromEntries(this.bestiaryKills),
            experience: this.experience,
            lootGenerationLevel: this.lootGenerationLevel,
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
        const handlers = request.phase === "enter"
            ? ["OnEnter", "OnHover"] as const
            : request.phase === "click"
                ? ["OnClick"] as const
                : ["OnLeave"] as const;
        const sourcePath = Paths.LEVEL_SCRIPT(levelData.levelName, levelData.gameMode, scriptFileName);
        if (generation !== this.generation) return;
        const cacheKey = `${levelData.gameMode}:${levelData.levelName.toLowerCase()}:${scriptFileName}`;
        let script = this.triggerScriptSources.get(cacheKey);
        if (!script) {
            const source = await decodeScript(sourcePath);
            if (generation !== this.generation) return;
            script = extractSCRHandlerSources(source);
            this.triggerScriptSources.set(cacheKey, script);
        }
        for (const handler of handlers) {
            const body = script[handler];
            if (body !== undefined) this.scr.execute(body, `${levelData.levelName}/${scriptFileName}:${handler}`);
        }
    }

    private unrecoveredHostCall(name: string): never {
        throw new Error(`${name} is not recovered; native host semantics are unavailable`);
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
                return 0;
            }
            case "rs_globalmap":
                this.options.onGlobalMap?.();
                return 0;
            case "rs_startdialog":
                this.options.onDialog?.(arguments_);
                return 0;
            case "rs_gettribesrelation":
                return relationScores[this.factions.get(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name))];
            case "rs_settribesrelation":
                this.factions.set(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name), relationFromScript(arguments_[2] ?? 1));
                return 0;
            case "rs_ispersonexistsi": {
                const level = stringArgument(arguments_, 0, name);
                const person = stringArgument(arguments_, 1, name);
                const currentLevel = this.levelData?.levelName;
                if (currentLevel && currentLevel.toLowerCase() === level.toLowerCase()) {
                    if (person.toLowerCase() === "hero") return this.combatants.has("hero") ? 1 : 0;
                    const present = [...this.persons].find(([candidate]) => candidate.toLowerCase() === person.toLowerCase())?.[1];
                    return present === true ? 1 : 0;
                }
                const stored = this.personStatesByLevel.get(`${this.levelData?.gameMode ?? "single"}:${level.toLowerCase()}`);
                return stored ? (stored.get(person.toLowerCase()) === true ? 1 : 0) : 1;
            }
            case "rs_delperson":
                this.setPersonPresence(stringArgument(arguments_, 0, name), false);
                return 0;
            case "rs_addperson_1":
                this.stageDynamicPerson(arguments_, name);
                return 0;
            case "rs_addperson_2":
                this.materializeDynamicPerson(arguments_, name);
                return 0;
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
            // Server.dll 0x140412A4/0x14041320/0x14041400/0x14041478 accept (string, string, number) and return 0.0.
            case "rs_personadditem":
            case "rs_personadditemtotrade": {
                if (arguments_.length !== 3) return 0;
                const owner = stringArgument(arguments_, 0, name);
                const inventoryOwner = name === "rs_personadditemtotrade" ? this.tradeInventoryOwner(owner) : owner;
                const item = stringArgument(arguments_, 1, name);
                const quantity = numberArgument(arguments_, 2, name);
                const changed = this.changeItemCount(inventoryOwner, item, quantity);
                if (changed === 1 && quantity > 0 && this.inventoryOwner(inventoryOwner).toLowerCase() === "hero") {
                    this.notifyItemReceived(item, quantity);
                }
                return 0;
            }
            case "rs_personremoveitem":
            case "rs_personremoveitemtotrade":
                if (arguments_.length !== 3) return 0;
                this.changeItemCount(
                    name === "rs_personremoveitemtotrade"
                        ? this.tradeInventoryOwner(stringArgument(arguments_, 0, name))
                        : stringArgument(arguments_, 0, name),
                    stringArgument(arguments_, 1, name),
                    -numberArgument(arguments_, 2, name),
                );
                return 0;
            case "rs_getmoney":
                return this.itemCount("Hero", "MON_1_0_1");
            case "rs_getpersonparameteri":
            case "rs_getpersonskilli":
                return this.getPersonParameter(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name));
            case "rs_setpersonparameteri":
                this.setPersonParameter(stringArgument(arguments_, 0, name), stringArgument(arguments_, 1, name), numberArgument(arguments_, 2, name));
                return 0;
            case "rs_addexp":
                this.addHeroExperience(numberArgument(arguments_, 0, name));
                return 0;
            case "rs_questcomplete":
                this.questFlags.set(stringArgument(arguments_, 0, name), true);
                return 0;
            case "rs_questenable":
            case "rs_storylinequestenable": {
                const quest = stringArgument(arguments_, 0, name);
                const isNew = !this.questFlags.has(quest);
                this.questFlags.set(quest, false);
                if (isNew) this.options.onMessage?.("Добавлена запись в журнал");
                return 0;
            }
            case "rs_stagecomplete":
                this.stageFlags.set(`${stringArgument(arguments_, 0, name)}:${stringArgument(arguments_, 1, name)}`, true);
                return 0;
            case "rs_stageenable":
                this.stageFlags.set(`${stringArgument(arguments_, 0, name)}:${stringArgument(arguments_, 1, name)}`, false);
                return 0;
            case "rs_setlocationaccess": {
                const location = stringArgument(arguments_, 0, name);
                const access = numberArgument(arguments_, 1, name);
                this.locationAccess.set(location.toLowerCase(), access);
                this.scr.setVariable(`${location}_state`, access);
                return 0;
            }
            case "rs_enabletrigger":
                this.requireScenario(name).setTriggerActive(stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
                return 0;
            case "wd_setvisible":
                this.requireScenario(name).setTriggerVisible(stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
                return 0;
            case "rs_setdoorstate":
                this.requireScenario(name).setDoorOpened(stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
                return 0;
            case "rs_getdaysfrombeginningi":
                return Math.floor(this.elapsedMinutes / (24 * 60));
            case "rs_getcurrenttimeofdayi":
                return Math.floor(this.elapsedMinutes / 60) % 24;
            case "rs_getdayornight":
                return nativeDayPhase(this.elapsedMinutes) === "day" ? 1 : 0;
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
            case "rs_addtoheropartyname": {
                const member = stringArgument(arguments_, 0, name).toLowerCase();
                this.questFlags.set(`party:${member}`, true);
                const combatantName = this.resolveCombatantName(member);
                const combatant = combatantName ? this.combatants.get(combatantName) : undefined;
                if (combatant) {
                    this.factions.set("hero", combatant.factionId, "friendly");
                    this.factions.set(combatant.factionId, "hero", "friendly");
                }
                return 1;
            }
            case "rs_removefromheropartyname":
                this.questFlags.set(`party:${stringArgument(arguments_, 0, name).toLowerCase()}`, false);
                return 1;
            case "rs_testherohaspartyname":
                return this.questFlags.get(`party:${stringArgument(arguments_, 0, name).toLowerCase()}`) === true ? 1 : 0;
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
                return this.unrecoveredHostCall(name);
            case "rs_setundeadstate":
            case "rs_setinjured":
                this.setPersonCondition(name, stringArgument(arguments_, 0, name), numberArgument(arguments_, 1, name) !== 0);
                return 0;
            case "le_casteffect": {
                const technicalName = stringArgument(arguments_, 1, name);
                const x = numberArgument(arguments_, 2, name);
                const y = numberArgument(arguments_, 3, name);
                this.options.onWorldMagicEffect?.(technicalName, { x, y });
                return 0;
            }
            case "le_castmagic": {
                const technicalName = stringArgument(arguments_, 0, name);
                const x = numberArgument(arguments_, 1, name);
                const y = numberArgument(arguments_, 2, name);
                this.options.onWorldMagicEffect?.(technicalName, { x, y });
                return 0;
            }
            case "le_deleffect":
                return this.unrecoveredHostCall(name);
            case "c_finished":
                this.options.onFinished?.(numberArgument(arguments_, 0, name));
                return 0;
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
        this.personInventoryLevels.clear();
        this.traders.clear();
        this.lootableCorpses.clear();
        this.setCombatMode(false);

        this.refreshHeroCombatProfile();
        if (heroAssets.sounds) this.personSounds.set("hero", heroAssets.sounds);
        for (const person of levelData.levelPersons) {
            this.registerPersonCombatant(person, assets.get(person.name.toLowerCase()), person.combatantId);
        }
    }

    private registerPersonCombatant(person: SEFPerson, personAssets?: PersonCombatAssets, combatantId = person.name): void {
        this.persons.set(combatantId, true);
        this.combatantPositions.set(combatantId, { ...person.position });
        if (personAssets?.sounds) this.personSounds.set(combatantId.toLowerCase(), personAssets.sounds);
        const normalizedId = combatantId.toLowerCase();
        if (person.scriptInventory) this.corpseInventorySources.set(normalizedId, person.scriptInventory);
        // Server.dll stores one world loot rating at +0x26C4. Person and trigger
        // inventories created later use that persisted rating, not current XP.
        this.personInventoryLevels.set(normalizedId, this.lootGenerationLevel);
        if (personAssets?.resource?.containerAfterDie) this.lootableCorpses.add(normalizedId);
        const template = personAssets?.template;
        if (template && Object.values(template.trade).some((capability) => capability !== 0)) this.traders.add(normalizedId);
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
        this.combatItems.set(combatantId, items);
        this.combatProfileSources.set(combatantId, {
            parameters,
            items,
            base,
            technicalName: person.name,
            literaryName: person.literaryName === undefined
                ? person.literaryLabel
                : this.levelData?.sdbData[person.literaryName] ?? person.literaryLabel,
            bestiaryName: (template?.resourceId ?? person.name).toLowerCase(),
            template,
        });
        const profile = this.createProfile(parameters, items, base, combatantId);
        this.combatProfiles.set(combatantId, profile);
        this.combatants.set(combatantId, createCombatant({
            id: combatantId,
            factionId: person.tribe ?? person.name,
            maxHealth: profile.maxHealth,
            maxMana: profile.maxEnergy,
        }));
        for (const [name, value] of Object.entries(parameters)) this.setPersonParameter(combatantId, name, value);
        this.syncCombatParameters(combatantId);
    }

    private refreshHeroCombatProfile(): void {
        const parameterOwner = this.resolveParameterOwner("hero") ?? "Hero";
        const parameters = Object.fromEntries(this.personParameters.get(parameterOwner) ?? []);
        parameters.experience = this.experience;
        const items = Object.values(this.getEquippedItems())
            .map((name) => name && this.registeredItems.get(name.toLowerCase()))
            .filter((item): item is ShippedItem => item !== undefined);
        this.combatItems.set("hero", items);
        this.combatProfileSources.set("hero", {
            parameters,
            items,
            base: {},
            literaryName: this.options.resolveHeroName?.() ?? "Герой",
        });
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
            6: "strength", 7: "constitution", 8: "dexterity", 9: "perception", 10: "intelligence", 11: "wisdom", 12: "luck",
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
        const template = assets.template;
        if (!template || template.weapons.length === 0 || assets.weapons.length === 0) return [];
        const reference = selectOriginalPersonWeapon(
            template.weapons,
            template.weaponLevelOffset,
            originalLevelForExperience(this.experience),
            this.random,
        );
        if (!reference) return [];
        const weapon = assets.weapons.find(({ technicalName }) =>
            technicalName.toLowerCase() === reference.itemId.toLowerCase());
        if (!weapon) throw new Error(`Unknown selected shipped item ${reference.itemId}`);
        return [weapon];
    }

    public getCombatantLiteraryName(name: string): string {
        return this.combatProfileSources.get(name)?.literaryName
            ?? this.combatProfileSources.get(name)?.technicalName
            ?? baseCombatantName(name);
    }

    private publishNativeCombatMessage(id: number, ...values: readonly (string | number)[]): void {
        const template = this.options.resolveInterfaceString?.(id);
        if (!template) return;
        let valueIndex = 0;
        const message = template.replace(/%[sd]/g, () => String(values[valueIndex++] ?? ""));
        this.options.onMessage?.(message);
    }

    private sharesHeroPartyOwner(leftName: string, rightName: string): boolean {
        const belongsToHeroParty = (name: string): boolean => name.toLowerCase() === "hero" || this.isPartyMember(name);
        return belongsToHeroParty(leftName) && belongsToHeroParty(rightName);
    }

    private registerDamageHostility(targetName: string, attackerName: string): void {
        const targetFaction = this.combatants.get(targetName)?.factionId;
        const attackerFaction = this.combatants.get(attackerName)?.factionId;
        if (targetFaction && attackerFaction && targetFaction !== attackerFaction) {
            this.factions.set(targetFaction, attackerFaction, "hostile");
        }
        this.aiPreferredTargets.set(targetName, attackerName);
    }

    private performCombatAttack(attackerName: string, targetName: string): OriginalAttackResult | undefined {
        const attacker = this.combatants.get(attackerName);
        const target = this.combatants.get(targetName);
        const attackerProfile = this.combatProfiles.get(attackerName);
        const targetProfile = this.combatProfiles.get(targetName);
        if (!attacker || !target || !attackerProfile || !targetProfile || attacker.isDead || target.isDead
            || this.sharesHeroPartyOwner(attackerName, targetName)) return undefined;
        const remaining = this.remainingActionPoints.get(attackerName) ?? attackerProfile.actionPoints;
        if (remaining < attackerProfile.weapon.actionPointCost) {
            this.combatMessage = "Недостаточно очков действия";
            return undefined;
        }
        const attackerPosition = this.combatantPositions.get(attackerName);
        const targetPosition = this.combatantPositions.get(targetName);
        if (attackerPosition && targetPosition
            && originalCombatDistance(attackerPosition, targetPosition) > attackerProfile.weapon.attackDistance) {
            this.combatMessage = "Слишком большая дистанция для атаки";
            return undefined;
        }
        if (targetPosition) this.options.onCombatantFace?.(attackerName, cellToWorld(targetPosition));
        if (!this.consumeAttackResource(attackerName, attackerProfile.weapon.itemId)) return undefined;


        const result = resolveOriginalAttack(attackerProfile, targetProfile, target.health, this.random);
        this.remainingActionPoints.set(attackerName, remaining - result.actionPointCost);
        target.health = result.healthAfter;
        target.isDead = result.killed;
        if (result.hit) this.registerDamageHostility(targetName, attackerName);
        if (result.hit) this.damageAttackWeapon(attackerName, attackerProfile.weapon.itemId);
        if (result.hit) this.damageTargetArmor(targetName);
        if (result.killed) this.processCombatDeath(targetName, attackerName);
        const attackDuration = this.options.onCombatAnimation?.(attackerName, "attack") ?? 350;
        const reactionDuration = result.hit
            ? this.options.onCombatAnimation?.(targetName, result.killed ? "die" : "suffer") ?? 0
            : 0;
        this.lastCombatActionDurationMs = Math.max(attackDuration, reactionDuration);
        const attackSound = this.findPersonSound(attackerName, result.hit ? ["attack_0.hit", "attack_0"] : ["attack_0.miss", "attack_0"]);
        if (attackSound) this.options.onPersonSound?.(attackSound);
        if (result.hit) {
            const reactionSound = this.findPersonSound(targetName, result.killed ? ["die", "suffer"] : ["suffer"]);
            if (reactionSound) this.options.onPersonSound?.(reactionSound);
        }
        this.combatMessage = "";
        const attackerLiteraryName = this.getCombatantLiteraryName(attackerName);
        const targetLiteraryName = this.getCombatantLiteraryName(targetName);
        if (result.hit) {
            if (result.critical) {
                this.publishNativeCombatMessage(COMBAT_HISTORY_STRING_IDS.criticalHit, attackerLiteraryName);
            }
            this.publishNativeCombatMessage(
                COMBAT_HISTORY_STRING_IDS.damage,
                attackerLiteraryName,
                targetLiteraryName,
                result.appliedDamage,
            );
            if (result.killed) this.publishNativeCombatMessage(COMBAT_HISTORY_STRING_IDS.died, targetLiteraryName);
        } else {
            this.publishNativeCombatMessage(
                result.criticalMiss ? COMBAT_HISTORY_STRING_IDS.criticalMiss : COMBAT_HISTORY_STRING_IDS.miss,
                attackerLiteraryName,
            );
        }
        this.syncCombatParameters(attackerName);
        this.syncCombatParameters(targetName);
        return result;
    }

    private consumeAttackResource(attackerName: string, weaponItemId: string): boolean {
        if (attackerName.toLowerCase() !== "hero") return true;
        const inventory = this.inventories.get(this.inventoryOwner("Hero"));
        if (!inventory) return true;
        const weapon = this.registeredItems.get(weaponItemId.toLowerCase());
        const requiredAmmoClass = weapon?.definition.itemClass === "bow"
            ? "arrows"
            : weapon?.definition.itemClass === "crossbow"
                ? "bolts"
                : weapon?.definition.itemClass === "firearm"
                    ? "ammo"
                    : undefined;
        if (!requiredAmmoClass) return true;
        const ammoStack = inventory.getEquipped("ammo");
        const ammo = ammoStack && this.registeredItems.get(ammoStack.item.definitionId.toLowerCase());
        if (!ammoStack || ammo?.definition.itemClass !== requiredAmmoClass) {
            this.combatMessage = "Нет подходящих боеприпасов";
            return false;
        }
        inventory.consumeEquipped("ammo", 1);
        this.refreshHeroCombatProfile();
        return true;
    }

    private damageAttackWeapon(attackerName: string, weaponItemId: string): void {
        if (attackerName.toLowerCase() !== "hero") return;
        const inventory = this.inventories.get(this.inventoryOwner("Hero"));
        const weapon = this.registeredItems.get(weaponItemId.toLowerCase());
        if (!inventory || !weapon || !DURABILITY_WEAPON_CLASSES.has(weapon.definition.itemClass)
            || weapon.ignoresDurabilityLoss || weapon.durabilityLossChance <= 0
            || this.random() * 100 >= weapon.durabilityLossChance) return;
        const slot = (["mainHand", "offHand"] as const).find((candidate) =>
            inventory.getEquipped(candidate)?.item.definitionId.toLowerCase() === weaponItemId.toLowerCase());
        if (!slot) return;
        const durabilityBefore = inventory.getEquipped(slot)?.item.durability ?? 100;
        inventory.damageEquipped(slot, 1);
        if (durabilityBefore === 11) this.options.onMessage?.(`${weapon.literaryName} почти разрушен`);
        if (durabilityBefore <= 1) this.options.onMessage?.(`Предмет ${weapon.literaryName} разрушен`);
        this.refreshHeroCombatProfile();
    }

    private damageTargetArmor(targetName: string): void {
        if (targetName.toLowerCase() !== "hero") return;
        const inventory = this.inventories.get(this.inventoryOwner("Hero"));
        if (!inventory) return;
        const candidates = DURABILITY_ARMOR_SLOTS.flatMap(({ slot, itemClass }) => {
            const stack = inventory.getEquipped(slot);
            const item = stack && this.registeredItems.get(stack.item.definitionId.toLowerCase());
            return item && item.definition.itemClass === itemClass && !item.ignoresDurabilityLoss
                ? [{ slot, item }]
                : [];
        });
        if (candidates.length === 0) return;
        const selected = candidates.length === 1
            ? candidates[0]
            : candidates[Math.floor(this.random() * candidates.length)];
        if (selected.item.durabilityLossChance <= 0
            || (selected.item.durabilityLossChance <= 100 && this.random() * 100 >= selected.item.durabilityLossChance)) return;
        const durabilityBefore = inventory.getEquipped(selected.slot)?.item.durability ?? 100;
        inventory.damageEquipped(selected.slot, 1);
        if (durabilityBefore === 11) this.options.onMessage?.(`${selected.item.literaryName} почти разрушен`);
        if (durabilityBefore <= 1) this.options.onMessage?.(`Предмет ${selected.item.literaryName} разрушен`);
        this.refreshHeroCombatProfile();
    }

    /**
     * Server.dll 0x140183E0..0x14018509 credits the victim's authored
     * `experience_value`, applies `reputation_delta`, then updates bestiary state.
     * The native owner record at person +0x69C makes hero-party attacks share the
     * hero owner in single-player.
     */
    private processCombatDeath(targetName: string, attackerName: string): void {
        if (targetName.toLowerCase() === "hero") {
            this.options.onHeroDeath?.();
            return;
        }
        if (attackerName.toLowerCase() !== "hero" && !this.isPartyMember(attackerName)) return;
        const template = this.combatProfileSources.get(targetName)?.template;
        if (template) {
            this.addHeroExperience(template.experienceValue);
            const reputation = this.getPersonParameter("Hero", "reputation");
            this.setPersonParameter("Hero", "reputation", reputation + template.reputationDelta);
        }
        this.recordBestiaryKill(targetName);
    }

    private addHeroExperience(amount: number): void {
        if (!Number.isFinite(amount)) throw new Error("Hero experience delta must be finite");
        this.experience = Math.max(0, this.experience + amount);
        this.refreshHeroCombatProfile();
    }

    private recordBestiaryKill(targetName: string): void {
        const bestiaryName = this.combatProfileSources.get(targetName)?.bestiaryName;
        if (!bestiaryName) return;
        this.bestiaryKills.set(bestiaryName, Math.min(0xffff, (this.bestiaryKills.get(bestiaryName) ?? 0) + 1));
    }

    private performHeroMagic(magicId: number, technicalName: string): MagicCastResult | undefined {
        const magic = this.magicDefinitions.get(magicId);
        if (!magic?.executable) return undefined;
        if (this.getPersonParameter("Hero", magicSpellParameter(magicId)) === 0) return undefined;
        const primaryTargetName = magic.target === "ally" ? "hero" : this.resolveCombatantName(technicalName);
        if (!primaryTargetName || (magic.target === "enemy" && primaryTargetName === "hero")) return undefined;
        if (!this.combatActive && (!magic.realtime || magic.target === "enemy")) this.setCombatMode(true);
        return this.performCombatantMagic("hero", magic, primaryTargetName);
    }

    private performCombatantMagic(casterName: string, magic: MagicDefinition, primaryTargetName: string): MagicCastResult | undefined {
        const caster = this.combatants.get(casterName);
        const casterProfile = this.combatProfiles.get(casterName);
        const primaryTarget = this.combatants.get(primaryTargetName);
        if (!caster || !casterProfile || !primaryTarget || caster.isDead || primaryTarget.isDead) return undefined;
        if (this.activeMagicEffects.some((effect) => effect.targetName === casterName && effect.specialId === "IDSPEC_SILENCE")) {
            this.combatMessage = `${magic.literaryName}: ${this.getCombatantLiteraryName(casterName)} не может колдовать`;
            return undefined;
        }
        if (this.combatActive && this.currentCombatant !== casterName) return undefined;
        const targetRelation = this.factions.get(caster.factionId, primaryTarget.factionId);
        if (magic.target === "enemy" ? targetRelation !== "hostile" : targetRelation === "hostile") return undefined;

        const actionPointsBefore = this.remainingActionPoints.get(casterName) ?? casterProfile.actionPoints;
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
        if (this.combatActive) this.remainingActionPoints.set(casterName, actionPointsBefore - actionPointCost);
        const targetNames = this.magicTargetNames(casterName, magic, primaryTargetName);
        let primaryResisted = false;
        let damage = 0;
        let healing = 0;
        let energyChange = 0;
        let actionPointChange = 0;
        let effectsApplied = 0;
        const casterLiteraryName = this.getCombatantLiteraryName(casterName);
        this.combatMessage = "";
        this.publishNativeCombatMessage(COMBAT_HISTORY_STRING_IDS.castMagic, casterLiteraryName, magic.literaryName);

        let reactionDurationMs = 0;
        for (const targetName of targetNames) {
            const target = this.combatants.get(targetName);
            const targetProfile = this.combatProfiles.get(targetName);
            if (!target || !targetProfile || target.isDead) continue;
            if (magic.target === "enemy" && casterName === "hero") this.activeEnemies.add(targetName);
            const damageBeforeTarget = damage;
            const immunity = magic.target === "enemy" ? Math.max(0, Math.min(100, targetProfile.magicImmunity[magic.school])) : 0;
            const resisted = immunity > 0 && this.random() * 100 < immunity;
            if (targetName === primaryTargetName) primaryResisted = resisted;
            if (!resisted) {
                for (const special of magic.specials) {
                    const applied = this.applyMagicSpecial(casterName, magic, special, targetName);
                    damage += applied.damage;
                    healing += applied.healing;
                    energyChange += applied.energyChange;
                    actionPointChange += applied.actionPointChange;
                    effectsApplied += applied.effectsApplied;
                }
            }
            const targetDamage = damage - damageBeforeTarget;
            const targetLiteraryName = this.getCombatantLiteraryName(targetName);
            if (!resisted && targetDamage > 0) {
                this.publishNativeCombatMessage(
                    COMBAT_HISTORY_STRING_IDS.damage,
                    casterLiteraryName,
                    targetLiteraryName,
                    targetDamage,
                );
            }
            target.isDead = target.health === 0;
            if (target.isDead) this.processCombatDeath(targetName, casterName);
            this.options.onMagicEffect?.(magic.technicalName, targetName);
            if (damage > damageBeforeTarget) {
                reactionDurationMs = Math.max(
                    reactionDurationMs,
                    this.options.onCombatAnimation?.(targetName, target.isDead ? "die" : "suffer") ?? 0,
                );
            }
            if (target.isDead) this.activeEnemies.delete(targetName);
            if (target.isDead) this.publishNativeCombatMessage(COMBAT_HISTORY_STRING_IDS.died, targetLiteraryName);
            this.syncCombatParameters(targetName);
        }

        if (magic.healing && magic.target === "enemy" && damage > 0) {
            const before = caster.health;
            caster.health = Math.min(casterProfile.maxHealth, caster.health + damage);
            healing += caster.health - before;
        }
        const castDurationMs = this.options.onCombatAnimation?.(casterName, "cast") ?? 350;
        this.lastCombatActionDurationMs = Math.max(castDurationMs, reactionDurationMs);
        const result: MagicCastResult = {
            spellId: magic.id,
            technicalName: magic.technicalName,
            target: primaryTargetName,
            resisted: primaryResisted,
            energyBefore,
            energyAfter: caster.mana,
            actionPointsBefore,
            actionPointsAfter: this.remainingActionPoints.get(casterName) ?? actionPointsBefore,
            damage,
            healing,
            energyChange,
            actionPointChange,
            killed: primaryTarget.isDead,
            effectsApplied,
        };
        this.syncCombatParameters(casterName);
        return result;
    }

    private magicResistance(profile: OriginalCombatProfile, channel: MagicDamageChannel): number {
        if (channel === "crushing" || channel === "hacking" || channel === "pricking") return profile.damageResistance[channel];
        if (channel === "fire" || channel === "cold" || channel === "poison") return profile.elementalResistance[channel];
        return profile.magicResistance[channel];
    }

    private magicTargetNames(casterName: string, magic: MagicDefinition, primaryTargetName: string): readonly string[] {
        if (magic.target !== "enemy" || magic.radius <= 0) return [primaryTargetName];
        const caster = this.combatants.get(casterName);
        const center = this.combatantPositions.get(primaryTargetName);
        if (!caster || !center) return [primaryTargetName];
        return [...this.combatants]
            .filter(([, combatant]) => !combatant.isDead && this.persons.get(combatant.id) !== false)
            .filter(([, combatant]) => this.factions.get(caster.factionId, combatant.factionId) === "hostile")
            .filter(([name]) => {
                const position = this.combatantPositions.get(name);
                return position ? originalCombatDistance(position, center) <= magic.radius : name === primaryTargetName;
            })
            .map(([name]) => name);
    }

    private applyMagicSpecial(casterName: string, magic: MagicDefinition, special: MagicSpecialDefinition, targetName: string): {
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
            this.summonMagicPerson(summonResource, magic.id, duration, casterName);
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

    private summonMagicPerson(resource: string, spellId: number, duration: number, casterName = "hero"): void {
        const name = resource;
        const position = { ...(this.combatantPositions.get(casterName) ?? worldToCell(this.lastPlayerPosition)) };
        const factionId = this.combatants.get(casterName)?.factionId ?? "hero";
        const existing = this.dynamicPersons.find((person) => person.name === name);
        if (existing) {
            this.setPersonPresence(name, true);
        } else {
            const person: DynamicPersonDefinition = {
                name,
                position,
                direction: "DOWN",
                literaryLabel: resource,
                tribe: factionId,
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
        const normalized = technicalName.toLowerCase();
        const shaders = (this.personSounds.get(normalized) ?? this.personSounds.get(baseCombatantName(normalized)))?.shaders;
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
    public getCombatVisualState(name: string): Readonly<{ relation: FactionRelation; current: boolean; active: boolean }> {
        const resolved = this.resolveCombatantName(name);
        return {
            relation: resolved ? this.getCombatantRelationToHero(resolved) : "friendly",
            current: resolved !== undefined && resolved === this.currentCombatant,
            active: this.combatActive && resolved !== undefined && this.isCombatantPresent(resolved),
        };
    }


    public getCombatantRelationToHero(name: string): FactionRelation {
        const resolved = this.resolveCombatantName(name);
        const faction = resolved ? this.combatants.get(resolved)?.factionId : undefined;
        return faction ? this.factions.get(faction, "hero") : "friendly";
    }

    public isPartyMember(name: string): boolean {
        const normalized = name.toLowerCase();
        return this.questFlags.get(`party:${normalized}`) === true
            || this.questFlags.get(`party:${baseCombatantName(normalized)}`) === true;
    }

    private portraitResourceFor(name: string): string | undefined {
        const technicalName = this.combatProfileSources.get(name)?.technicalName ?? baseCombatantName(name);
        const personResource = this.personResources.get(technicalName.toLowerCase());
        return personResource
            ? this.allyPortraitMappings.find((mapping) => mapping.personResource === personResource)?.portraitResource
            : undefined;
    }

    private combatSnapshot(): CombatRuntimeSnapshot {
        const partyMembers = [...this.combatants.keys()].filter((name) => name !== "hero" && this.isPartyMember(name));
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
                    faction: combatant.factionId,
                    relationToHero: this.factions.get(combatant.factionId, "hero"),
                    partyMember: this.isPartyMember(name),
                    portraitResource: this.portraitResourceFor(name),
                }];
            })),
            partyMembers,
        };
    }

    private resolveCombatantName(name: string): string | undefined {
        const normalized = name.toLowerCase();
        const candidates = [...this.combatants.keys()];
        return candidates.find((candidate) => candidate.toLowerCase() === normalized)
            ?? candidates.find((candidate) => baseCombatantName(candidate.toLowerCase()) === normalized);
    }

    private resolveParameterOwner(name: string): string | undefined {
        const normalized = name.toLowerCase();
        return [...this.personParameters.keys()].find((candidate) => candidate.toLowerCase() === normalized);
    }

    private captureCurrentPersonStates(): void {
        if (!this.currentDynamicPersonLevel || this.persons.size === 0) return;
        this.personStatesByLevel.set(this.currentDynamicPersonLevel, new Map(
            [...this.persons].map(([name, present]) => [name.toLowerCase(), present]),
        ));
    }

    private personStatesByLevelSnapshot(): Readonly<Record<string, Readonly<Record<string, boolean>>>> {
        const levels = new Map(this.personStatesByLevel);
        if (this.currentDynamicPersonLevel && this.persons.size > 0) {
            levels.set(this.currentDynamicPersonLevel, new Map(
                [...this.persons].map(([name, present]) => [name.toLowerCase(), present]),
            ));
        }
        return Object.fromEntries([...levels].map(([level, persons]) => [level, Object.fromEntries(persons)]));
    }

    private setPersonPresence(name: string, present: boolean): number {
        const normalized = name.toLowerCase();
        const matches = [...this.persons.keys()].filter((candidate) => {
            const candidateName = candidate.toLowerCase();
            return candidateName === normalized || baseCombatantName(candidateName) === normalized;
        });
        const affected = matches.length > 0 ? matches : [name];
        for (const combatantId of affected) this.persons.set(combatantId, present);
        if (this.currentDynamicPersonLevel) {
            const level = this.personStatesByLevel.get(this.currentDynamicPersonLevel) ?? new Map<string, boolean>();
            for (const combatantId of affected) level.set(combatantId.toLowerCase(), present);
            this.personStatesByLevel.set(this.currentDynamicPersonLevel, level);
        }
        this.options.onPersonPresence?.(baseCombatantName(name), present);
        return 1;
    }

    private itemCount(owner: string, item: string): number {
        const inventory = this.inventories.get(this.inventoryOwner(owner));
        if (!inventory) return 0;
        const normalized = item.toLowerCase();
        return inventory.snapshot().stacks.reduce(
            (total, stack) => total + (stack.item.definitionId.toLowerCase() === normalized ? stack.quantity : 0),
            0,
        );
    }

    private inventoryOwner(owner: string): string {
        const normalized = owner.toLowerCase();
        const exact = [...this.inventories.keys()].find((candidate) => candidate.toLowerCase() === normalized);
        if (exact) return exact;
        if (!normalized.includes(":")) {
            const resolvedPerson = this.resolveCombatantName(owner);
            if (resolvedPerson && resolvedPerson.toLowerCase() !== "hero") return `person:${resolvedPerson}`;
        }
        return normalized === "hero" ? "Hero" : owner;
    }

    private tradeInventoryOwner(owner: string): string {
        if (owner.toLowerCase().startsWith("trade:")) return owner;
        return `trade:${owner.replace(/^person:/iu, "")}`;
    }

    private createInventory(): Inventory {
        return new Inventory(this.inventoryCatalog, { capacity: 0x7fffffff });
    }

    private createInventoryItem(owner: string, definitionId: string, durability = 100, charges?: number): ItemInstance {
        this.inventorySerial += 1;
        return createItemInstance(definitionId, {
            id: `${owner}:${definitionId}:${this.inventorySerial}`,
            durability,
            ...(charges === undefined ? {} : { charges }),
        });
    }

    private inventoryStackKey(item: ItemInstance): string {
        return JSON.stringify([item.definitionId.toLowerCase(), item.durability ?? 100, item.charges ?? null]);
    }

    private inventoryStack(owner: string, stackKey: string): { readonly item: ItemInstance; readonly quantity: number } | undefined {
        const inventory = this.inventories.get(this.inventoryOwner(owner));
        if (!inventory) return undefined;
        const matching = inventory.snapshot().stacks.filter(({ item }) => this.inventoryStackKey(item) === stackKey);
        if (matching.length === 0) return undefined;
        return {
            item: matching[0].item,
            quantity: matching.reduce((total, stack) => total + stack.quantity, 0),
        };
    }

    private notifyItemReceived(item: string, quantity: number): void {
        if (quantity <= 0) return;
        if (item.toLowerCase() === MONEY_ITEM_ID.toLowerCase()) {
            this.options.onMessage?.(`Получено ${quantity} монет`);
            return;
        }
        const literaryName = this.options.resolveItemLiteraryName?.(item)
            ?? this.registeredItems.get(item.toLowerCase())?.literaryName
            ?? item;
        this.options.onMessage?.(`Получен предмет: ${literaryName}`);
    }

    private changeItemCount(owner: string, item: string, delta: number): number {
        if (!Number.isSafeInteger(delta)) throw new Error("Inventory quantity must be a safe integer");
        if (delta === 0) return 1;
        const resolvedOwner = this.inventoryOwner(owner);
        const inventory = this.inventories.get(resolvedOwner) ?? this.createInventory();
        if (delta > 0) {
            inventory.add(this.createInventoryItem(resolvedOwner, item), delta);
            this.inventories.set(resolvedOwner, inventory);
            return 1;
        }
        const quantity = -delta;
        if (this.itemCount(resolvedOwner, item) < quantity) return 0;
        const transaction = new InventoryTransaction();
        if (!this.queueDefinitionRemoval(transaction, resolvedOwner, item, quantity)) return 0;
        transaction.commit();
        return 1;
    }

    private removeInventoryStack(owner: string, stackKey: string, quantity: number): boolean {
        if (!Number.isSafeInteger(quantity) || quantity <= 0) return false;
        const inventory = this.inventories.get(this.inventoryOwner(owner));
        const stack = this.inventoryStack(owner, stackKey);
        if (!inventory || !stack || stack.quantity < quantity) return false;
        try {
            new InventoryTransaction().remove(inventory, stack.item, quantity).commit();
            return true;
        } catch {
            return false;
        }
    }

    private queueStackTransfer(
        transaction: InventoryTransaction,
        source: string,
        destination: string,
        stackKey: string,
        quantity: number,
    ): boolean {
        if (!Number.isSafeInteger(quantity) || quantity <= 0) return false;
        const sourceInventory = this.inventories.get(this.inventoryOwner(source));
        const stack = this.inventoryStack(source, stackKey);
        if (!sourceInventory || !stack || stack.quantity < quantity) return false;
        const destinationOwner = this.inventoryOwner(destination);
        const destinationInventory = this.inventories.get(destinationOwner) ?? this.createInventory();
        this.inventories.set(destinationOwner, destinationInventory);
        transaction.transfer(sourceInventory, destinationInventory, stack.item, quantity);
        return true;
    }

    private queueDefinitionTransfer(
        transaction: InventoryTransaction,
        source: string,
        destination: string,
        definitionId: string,
        quantity: number,
    ): boolean {
        const sourceInventory = this.inventories.get(this.inventoryOwner(source));
        if (!sourceInventory || this.itemCount(source, definitionId) < quantity) return false;
        const destinationOwner = this.inventoryOwner(destination);
        const destinationInventory = this.inventories.get(destinationOwner) ?? this.createInventory();
        this.inventories.set(destinationOwner, destinationInventory);
        let remaining = quantity;
        for (const stack of sourceInventory.snapshot().stacks) {
            if (stack.item.definitionId.toLowerCase() !== definitionId.toLowerCase()) continue;
            const moved = Math.min(remaining, stack.quantity);
            transaction.transfer(sourceInventory, destinationInventory, stack.item, moved);
            remaining -= moved;
            if (remaining === 0) return true;
        }
        return false;
    }

    private queueDefinitionRemoval(
        transaction: InventoryTransaction,
        owner: string,
        definitionId: string,
        quantity: number,
    ): boolean {
        const inventory = this.inventories.get(this.inventoryOwner(owner));
        if (!inventory || this.itemCount(owner, definitionId) < quantity) return false;
        let remaining = quantity;
        for (const stack of inventory.snapshot().stacks) {
            if (stack.item.definitionId.toLowerCase() !== definitionId.toLowerCase()) continue;
            const removed = Math.min(remaining, stack.quantity);
            transaction.remove(inventory, stack.item, removed);
            remaining -= removed;
            if (remaining === 0) return true;
        }
        return false;
    }

    private transferItem(source: string, destination: string, item: string, quantity: number): number {
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Transfer quantity must be a positive safe integer");
        const transaction = new InventoryTransaction();
        if (!this.queueDefinitionTransfer(transaction, source, destination, item, quantity)) return 0;
        try {
            transaction.commit();
            return 1;
        } catch {
            return 0;
        }
    }

    private transferAllItems(source: string, destination: string): number {
        const sourceInventory = this.inventories.get(this.inventoryOwner(source));
        if (!sourceInventory || sourceInventory.count === 0) return 1;
        const transaction = new InventoryTransaction();
        for (const stack of sourceInventory.snapshot().stacks) {
            const destinationOwner = this.inventoryOwner(destination);
            const destinationInventory = this.inventories.get(destinationOwner) ?? this.createInventory();
            this.inventories.set(destinationOwner, destinationInventory);
            transaction.transfer(sourceInventory, destinationInventory, stack.item, stack.quantity);
        }
        try {
            transaction.commit();
            return 1;
        } catch {
            return 0;
        }
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

        const effectiveIntelligence = Math.max(1, Math.min(30, Math.round(
            this.getPersonParameter("Hero", "intelligence")
            + this.getPersonParameter("Hero", "item_special_10")
            + (speech >= 10 ? 2 : 0),
        )));
        let chance = effectiveIntelligence
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
