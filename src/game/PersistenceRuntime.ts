import type { GameMode } from "../constants/levels.ts";
import type { LVLData } from "./parsers/LVLParser.ts";
import type { SDBData } from "./parsers/SDBParser.ts";
import type { Direction, SEFData, TilePosition } from "./parsers/SEFParser.ts";
import type { WorldPosition } from "./WorldCoordinates.ts";
import type { EquipmentSlot } from "./systems/Items.ts";

export const SAVE_FORMAT_VERSION = 7;
export const QUICK_SAVE_SLOT = "quick";
export const DEFAULT_SAVE_KEY_PREFIX = "golden-land-2:save:";

export type ScriptVariableValue = boolean | number | string;
export type ScriptVariables = Record<string, ScriptVariableValue>;
export interface ItemInstanceSaveState {
    id: string;
    definitionId: string;
    durability: number;
    charges?: number;
}

export interface InventoryStackSaveState extends ItemInstanceSaveState {
    quantity: number;
}

export type ItemInventory = InventoryStackSaveState[];
export type Inventories = Record<string, ItemInventory>;
export type EquippedItems = Partial<Record<EquipmentSlot, InventoryStackSaveState>>;
export type DoorStates = Record<string, boolean>;

export interface TriggerState {
    active: boolean;
    visible: boolean;
}

export type TriggerStates = Record<string, TriggerState>;
export type QuestFlags = Record<string, boolean>;
export type PersonStates = Record<string, boolean>;
export type PersonStatesByLevel = Record<string, PersonStates>;
export type StageFlags = Record<string, boolean>;
export type LocationAccess = Record<string, number>;
export type PersonParameters = Record<string, Record<string, number>>;
export type BestiaryKills = Record<string, number>;
export interface MagicEffectSaveState {
    spellId: number;
    specialId: string;
    targetName: string;
    value: number;
    remainingMinutes: number;
}

export interface RegenerationElapsedSaveState {
    health: number;
    energy: number;
}

export type RegenerationElapsedStates = Record<string, RegenerationElapsedSaveState>;

export interface SaveLocation {
    gameMode: GameMode;
    level: string;
    entrance: string | null;
}

export interface PlayerSaveState {
    position: WorldPosition;
    direction: Direction;
    health: number;
    maxHealth: number;
    attributes: Record<string, number>;
}

export interface GameClock {
    day: number;
    minuteOfDay: number;
}

export interface GameSaveData {
    version: typeof SAVE_FORMAT_VERSION;
    location: SaveLocation;
    player: PlayerSaveState;
    inventories: Inventories;
    equipped: EquippedItems;
    scriptVariables: ScriptVariables;
    doors: DoorStates;
    triggers: TriggerStates;
    questFlags: QuestFlags;
    persons: PersonStates;
    personStatesByLevel: PersonStatesByLevel;
    stageFlags: StageFlags;
    locationAccess: LocationAccess;
    bestiaryKills: BestiaryKills;
    personParameters: PersonParameters;
    magicEffects: MagicEffectSaveState[];
    regenerationElapsed: RegenerationElapsedStates;
    experience: number;
    clock: GameClock;
}

/**
 * Scenario assets used to check that state saved for a level still addresses
 * real entrances, interactables, and item identifiers.
 */
export interface SaveAssetContext {
    sef: SEFData;
    lvl: LVLData;
    itemNames?: SDBData;
    levelName?: string;
}

export interface StorageAdapter {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    keys(): Iterable<string>;
}

export interface BrowserStorageLike {
    readonly length: number;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key(index: number): string | null;
}

export class SaveFormatError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "SaveFormatError";
    }
}

export class SaveVersionError extends SaveFormatError {
    public constructor(message: string) {
        super(message);
        this.name = "SaveVersionError";
    }
}

export class SaveStorageError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "SaveStorageError";
    }
}

/** Wraps a browser Storage object without consulting global window state. */
export class LocalStorageAdapter implements StorageAdapter {
    public constructor(private readonly storage: BrowserStorageLike) {}

    public getItem(key: string): string | null {
        return this.storage.getItem(key);
    }

    public setItem(key: string, value: string): void {
        this.storage.setItem(key, value);
    }

    public removeItem(key: string): void {
        this.storage.removeItem(key);
    }

    public *keys(): Iterable<string> {
        for (let index = 0; index < this.storage.length; index += 1) {
            const key = this.storage.key(index);
            if (key !== null) yield key;
        }
    }
}

/**
 * Builds a complete save with deterministic defaults. Callers can then update
 * the returned value before serializing it.
 */
export const createSaveData = (location: SaveLocation): GameSaveData => ({
    version: SAVE_FORMAT_VERSION,
    location: cloneLocation(location),
    player: {
        position: { x: 0, y: 0 },
        direction: "DOWN",
        health: 100,
        maxHealth: 100,
        attributes: {},
    },
    inventories: {},
    equipped: {},
    scriptVariables: {},
    doors: {},
    triggers: {},
    questFlags: {},
    persons: {},
    personStatesByLevel: {},
    stageFlags: {},
    locationAccess: {},
    bestiaryKills: {},
    personParameters: {},
    experience: 0,
    magicEffects: [],
    regenerationElapsed: {},
    clock: { day: 0, minuteOfDay: 0 },
});

/** Validates and clones a save, so callers never retain mutable persisted state. */
export const validateSaveData = (value: unknown): GameSaveData => {
    const record = requireRecord(value, "save");
    const version = record.version;

    if (version === undefined || version === 1) return migrateVersion1(record);
    if (version === 2) return migrateVersion2(record);
    if (version === 3) return migrateVersion3(record);
    if (version === 4) return migrateVersion4(record);
    if (version === 5) return migrateVersion5(record);
    if (version === 6) return migrateVersion6(record);
    if (version !== SAVE_FORMAT_VERSION) {
        if (typeof version === "number" && Number.isInteger(version) && version > SAVE_FORMAT_VERSION) {
            throw new SaveVersionError(`Save format version ${version} is newer than supported version ${SAVE_FORMAT_VERSION}`);
        }
        throw new SaveVersionError(`Unsupported save format version ${describeValue(version)}`);
    }

    assertOnlyKeys(record, [
        "version", "location", "player", "inventories", "equipped", "scriptVariables", "doors", "triggers", "questFlags", "clock",
        "persons", "personStatesByLevel", "stageFlags", "locationAccess", "bestiaryKills", "personParameters", "experience", "magicEffects", "regenerationElapsed",
    ], "save");

    return {
        version: SAVE_FORMAT_VERSION,
        location: readLocation(requireField(record, "location", "save"), "save.location"),
        player: readPlayer(requireField(record, "player", "save"), "save.player", false),
        inventories: readInventories(requireField(record, "inventories", "save"), "save.inventories"),
        equipped: readEquippedItems(requireField(record, "equipped", "save"), "save.equipped"),
        scriptVariables: readScriptVariables(requireField(record, "scriptVariables", "save"), "save.scriptVariables"),
        doors: readDoorStates(requireField(record, "doors", "save"), "save.doors"),
        triggers: readTriggerStates(requireField(record, "triggers", "save"), "save.triggers"),
        questFlags: readBooleanRecord(requireField(record, "questFlags", "save"), "save.questFlags"),
        clock: readClock(requireField(record, "clock", "save"), "save.clock"),
        persons: readBooleanRecord(requireField(record, "persons", "save"), "save.persons"),
        personStatesByLevel: readNestedBooleanRecord(
            requireField(record, "personStatesByLevel", "save"),
            "save.personStatesByLevel",
        ),
        stageFlags: readBooleanRecord(requireField(record, "stageFlags", "save"), "save.stageFlags"),
        locationAccess: readNumberRecord(requireField(record, "locationAccess", "save"), "save.locationAccess"),
        bestiaryKills: readBestiaryKills(requireField(record, "bestiaryKills", "save"), "save.bestiaryKills"),
        personParameters: readNestedNumberRecord(requireField(record, "personParameters", "save"), "save.personParameters"),
        experience: readNonNegativeNumber(requireField(record, "experience", "save"), "save.experience"),
        magicEffects: readMagicEffects(requireField(record, "magicEffects", "save"), "save.magicEffects"),
        regenerationElapsed: readRegenerationElapsed(requireField(record, "regenerationElapsed", "save"), "save.regenerationElapsed"),
    };
};

export const serializeSaveData = (value: unknown): string => JSON.stringify(validateSaveData(value));

export const deserializeSaveData = (serialized: string): GameSaveData => {
    if (typeof serialized !== "string") throw new SaveFormatError("Save payload must be a JSON string");

    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch (error) {
        throw new SaveFormatError(`Save payload is not valid JSON: ${errorMessage(error)}`);
    }
    return validateSaveData(parsed);
};

/** Performs asset-aware validation without retaining references to supplied assets. */
export const validateSaveAgainstAssets = (value: unknown, assets: SaveAssetContext): GameSaveData => {
    const save = validateSaveData(value);
    const { sef, lvl, itemNames, levelName } = assets;

    if (levelName !== undefined && save.location.level !== levelName) {
        throw new SaveFormatError(`Save targets level ${JSON.stringify(save.location.level)}, not ${JSON.stringify(levelName)}`);
    }
    if (!Number.isFinite(lvl.mapSize.width) || !Number.isFinite(lvl.mapSize.height) || lvl.mapSize.width <= 0 || lvl.mapSize.height <= 0) {
        throw new SaveFormatError("Level asset has invalid map dimensions");
    }
    if (save.player.position.x < 0 || save.player.position.y < 0
        || save.player.position.x >= lvl.mapSize.width || save.player.position.y >= lvl.mapSize.height) {
        throw new SaveFormatError("Saved player position is outside the level bounds");
    }

    if (save.location.entrance !== null && !sef.entrancePoints.some((point) => point.name === save.location.entrance)) {
        throw new SaveFormatError(`Saved entrance ${JSON.stringify(save.location.entrance)} does not exist in this scenario`);
    }

    const doorNames = new Set([...Object.keys(sef.doors), ...lvl.doors.map((door) => door.sefName).filter(Boolean)]);
    for (const name of Object.keys(save.doors)) {
        if (!doorNames.has(name)) throw new SaveFormatError(`Saved door ${JSON.stringify(name)} does not exist in this scenario`);
    }

    const triggerNames = new Set([...sef.triggers.map((trigger) => trigger.name), ...lvl.triggerDescription.map((trigger) => trigger.name)]);
    for (const name of Object.keys(save.triggers)) {
        if (!triggerNames.has(name)) throw new SaveFormatError(`Saved trigger ${JSON.stringify(name)} does not exist in this scenario`);
    }

    if (itemNames !== undefined) {
        for (const [owner, inventory] of Object.entries(save.inventories)) {
            for (const item of inventory) {
                if (!Object.prototype.hasOwnProperty.call(itemNames, item.definitionId)) {
                    throw new SaveFormatError(`Saved inventory ${JSON.stringify(owner)} references unknown item ID ${item.definitionId}`);
                }
            }
        }
        for (const [slot, item] of Object.entries(save.equipped)) {
            if (item && !Object.prototype.hasOwnProperty.call(itemNames, item.definitionId)) {
                throw new SaveFormatError(`Saved equipment slot ${JSON.stringify(slot)} references unknown item ID ${item.definitionId}`);
            }
        }
    }

    return save;
};

/** Returns a copied entrance tile for a save, or null for a level without an entrance target. */
export const resolveSaveEntrance = (saveValue: unknown, sef: SEFData): TilePosition | null => {
    const save = validateSaveData(saveValue);
    if (save.location.entrance === null) return null;
    const entrance = sef.entrancePoints.find((point) => point.name === save.location.entrance);
    if (entrance === undefined) {
        throw new SaveFormatError(`Saved entrance ${JSON.stringify(save.location.entrance)} does not exist in this scenario`);
    }
    return { x: entrance.position.x, y: entrance.position.y };
};

export class PersistenceRuntime {
    public constructor(
        private readonly storage: StorageAdapter,
        private readonly keyPrefix: string = DEFAULT_SAVE_KEY_PREFIX,
    ) {
        if (typeof keyPrefix !== "string" || keyPrefix.length === 0) throw new SaveStorageError("Save storage key prefix must be a non-empty string");
    }

    /** Validates before writing, so invalid input can never replace an existing slot. */
    public save(slot: string, value: unknown): void {
        const key = this.keyForSlot(slot);
        const serialized = serializeSaveData(value);
        this.write(key, serialized);
    }

    public load(slot: string): GameSaveData | null {
        const key = this.keyForSlot(slot);
        const serialized = this.read(key);
        return serialized === null ? null : deserializeSaveData(serialized);
    }

    public delete(slot: string): boolean {
        const key = this.keyForSlot(slot);
        if (this.read(key) === null) return false;
        try {
            this.storage.removeItem(key);
        } catch (error) {
            throw new SaveStorageError(`Unable to delete save slot ${JSON.stringify(slot)}: ${errorMessage(error)}`);
        }
        return true;
    }

    public listSlots(): string[] {
        let keys: string[];
        try {
            keys = Array.from(this.storage.keys());
        } catch (error) {
            throw new SaveStorageError(`Unable to list save slots: ${errorMessage(error)}`);
        }

        return keys
            .filter((key) => key.startsWith(this.keyPrefix))
            .map((key) => key.slice(this.keyPrefix.length))
            .filter((slot) => SLOT_NAME_PATTERN.test(slot))
            .sort((left, right) => left.localeCompare(right));
    }

    public quickSave(value: unknown): void {
        this.save(QUICK_SAVE_SLOT, value);
    }

    public quickLoad(): GameSaveData | null {
        return this.load(QUICK_SAVE_SLOT);
    }

    public deleteQuickSave(): boolean {
        return this.delete(QUICK_SAVE_SLOT);
    }

    private keyForSlot(slot: string): string {
        if (typeof slot !== "string" || !SLOT_NAME_PATTERN.test(slot)) {
            throw new SaveStorageError("Save slot names must be 1-64 characters of letters, digits, spaces, dots, underscores, or hyphens");
        }
        return `${this.keyPrefix}${slot}`;
    }

    private read(key: string): string | null {
        try {
            return this.storage.getItem(key);
        } catch (error) {
            throw new SaveStorageError(`Unable to read save storage: ${errorMessage(error)}`);
        }
    }

    private write(key: string, value: string): void {
        try {
            this.storage.setItem(key, value);
        } catch (error) {
            throw new SaveStorageError(`Unable to write save storage: ${errorMessage(error)}`);
        }
    }
}

const SLOT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const UNSAFE_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DIRECTIONS: readonly Direction[] = ["LEFT", "RIGHT", "UP", "DOWN", "UP_LEFT", "UP_RIGHT", "DOWN_LEFT", "DOWN_RIGHT"];
const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
    "mainHand", "offHand", "ammo", "head", "body", "arms", "bracelet", "amulet", "ringLeft", "ringRight",
];
const LEGACY_EQUIPPED_INVENTORY_OWNER = "__hero_equipped__";

type LegacyInventories = Record<string, Record<string, number>>;


type UnknownRecord = Record<string, unknown>;

function migrateVersion1(record: UnknownRecord): GameSaveData {
    assertOnlyKeys(record, [
        "version", "location", "gameMode", "mode", "level", "entrance", "player", "inventories", "scriptVariables", "doors", "triggers", "questFlags", "clock",
    ], "version 1 save");

    const location = readLegacyLocation(
        record.location === undefined
            ? { gameMode: record.gameMode ?? record.mode, level: record.level, entrance: record.entrance }
            : record.location,
        record.location === undefined ? "version 1 save" : "version 1 save.location",
    );

    return {
        version: SAVE_FORMAT_VERSION,
        location,
        player: record.player === undefined ? defaultPlayer() : readPlayer(record.player, "version 1 save.player", true),
        ...migrateLegacyInventories(
            record.inventories === undefined ? {} : readLegacyInventories(record.inventories, "version 1 save.inventories"),
        ),
        scriptVariables: record.scriptVariables === undefined ? {} : readScriptVariables(record.scriptVariables, "version 1 save.scriptVariables"),
        doors: record.doors === undefined ? {} : readDoorStates(record.doors, "version 1 save.doors"),
        triggers: record.triggers === undefined ? {} : readTriggerStates(record.triggers, "version 1 save.triggers"),
        questFlags: record.questFlags === undefined ? {} : readBooleanRecord(record.questFlags, "version 1 save.questFlags"),
        clock: record.clock === undefined ? { day: 0, minuteOfDay: 0 } : readClock(record.clock, "version 1 save.clock"),
        persons: {},
        personStatesByLevel: {},
        stageFlags: {},
        locationAccess: {},
        bestiaryKills: {},
        personParameters: {},
        experience: 0,
        magicEffects: [],
        regenerationElapsed: {},
    };
}

function migrateVersion2(record: UnknownRecord): GameSaveData {
    assertOnlyKeys(record, [
        "version", "location", "player", "inventories", "scriptVariables", "doors", "triggers", "questFlags", "clock",
    ], "version 2 save");
    return {
        version: SAVE_FORMAT_VERSION,
        location: readLocation(requireField(record, "location", "version 2 save"), "version 2 save.location"),
        player: readPlayer(requireField(record, "player", "version 2 save"), "version 2 save.player", false),
        ...migrateLegacyInventories(readLegacyInventories(requireField(record, "inventories", "version 2 save"), "version 2 save.inventories")),
        scriptVariables: readScriptVariables(requireField(record, "scriptVariables", "version 2 save"), "version 2 save.scriptVariables"),
        doors: readDoorStates(requireField(record, "doors", "version 2 save"), "version 2 save.doors"),
        triggers: readTriggerStates(requireField(record, "triggers", "version 2 save"), "version 2 save.triggers"),
        questFlags: readBooleanRecord(requireField(record, "questFlags", "version 2 save"), "version 2 save.questFlags"),
        clock: readClock(requireField(record, "clock", "version 2 save"), "version 2 save.clock"),
        persons: {},
        personStatesByLevel: {},
        stageFlags: {},
        locationAccess: {},
        bestiaryKills: {},
        personParameters: {},
        experience: 0,
        magicEffects: [],
        regenerationElapsed: {},
    };
}

function migrateVersion3(record: UnknownRecord): GameSaveData {
    assertOnlyKeys(record, [
        "version", "location", "player", "inventories", "scriptVariables", "doors", "triggers", "questFlags", "clock",
        "persons", "stageFlags", "locationAccess", "personParameters", "experience",
    ], "version 3 save");
    return {
        version: SAVE_FORMAT_VERSION,
        location: readLocation(requireField(record, "location", "version 3 save"), "version 3 save.location"),
        player: readPlayer(requireField(record, "player", "version 3 save"), "version 3 save.player", false),
        ...migrateLegacyInventories(readLegacyInventories(requireField(record, "inventories", "version 3 save"), "version 3 save.inventories")),
        scriptVariables: readScriptVariables(requireField(record, "scriptVariables", "version 3 save"), "version 3 save.scriptVariables"),
        doors: readDoorStates(requireField(record, "doors", "version 3 save"), "version 3 save.doors"),
        triggers: readTriggerStates(requireField(record, "triggers", "version 3 save"), "version 3 save.triggers"),
        questFlags: readBooleanRecord(requireField(record, "questFlags", "version 3 save"), "version 3 save.questFlags"),
        clock: readClock(requireField(record, "clock", "version 3 save"), "version 3 save.clock"),
        persons: readBooleanRecord(requireField(record, "persons", "version 3 save"), "version 3 save.persons"),
        personStatesByLevel: {},
        stageFlags: readBooleanRecord(requireField(record, "stageFlags", "version 3 save"), "version 3 save.stageFlags"),
        locationAccess: readNumberRecord(requireField(record, "locationAccess", "version 3 save"), "version 3 save.locationAccess"),
        bestiaryKills: {},
        personParameters: readNestedNumberRecord(requireField(record, "personParameters", "version 3 save"), "version 3 save.personParameters"),
        experience: readNonNegativeNumber(requireField(record, "experience", "version 3 save"), "version 3 save.experience"),
        magicEffects: [],
        regenerationElapsed: {},
    };
}

function migrateVersion4(record: UnknownRecord): GameSaveData {
    assertOnlyKeys(record, [
        "version", "location", "player", "inventories", "scriptVariables", "doors", "triggers", "questFlags", "clock",
        "persons", "stageFlags", "locationAccess", "personParameters", "experience", "magicEffects", "regenerationElapsed",
    ], "version 4 save");
    return {
        version: SAVE_FORMAT_VERSION,
        location: readLocation(requireField(record, "location", "version 4 save"), "version 4 save.location"),
        player: readPlayer(requireField(record, "player", "version 4 save"), "version 4 save.player", false),
        ...migrateLegacyInventories(readLegacyInventories(requireField(record, "inventories", "version 4 save"), "version 4 save.inventories")),
        scriptVariables: readScriptVariables(requireField(record, "scriptVariables", "version 4 save"), "version 4 save.scriptVariables"),
        doors: readDoorStates(requireField(record, "doors", "version 4 save"), "version 4 save.doors"),
        triggers: readTriggerStates(requireField(record, "triggers", "version 4 save"), "version 4 save.triggers"),
        questFlags: readBooleanRecord(requireField(record, "questFlags", "version 4 save"), "version 4 save.questFlags"),
        clock: readClock(requireField(record, "clock", "version 4 save"), "version 4 save.clock"),
        persons: readBooleanRecord(requireField(record, "persons", "version 4 save"), "version 4 save.persons"),
        personStatesByLevel: {},
        stageFlags: readBooleanRecord(requireField(record, "stageFlags", "version 4 save"), "version 4 save.stageFlags"),
        locationAccess: readNumberRecord(requireField(record, "locationAccess", "version 4 save"), "version 4 save.locationAccess"),
        bestiaryKills: {},
        personParameters: readNestedNumberRecord(requireField(record, "personParameters", "version 4 save"), "version 4 save.personParameters"),
        experience: readNonNegativeNumber(requireField(record, "experience", "version 4 save"), "version 4 save.experience"),
        magicEffects: readMagicEffects(requireField(record, "magicEffects", "version 4 save"), "version 4 save.magicEffects"),
        regenerationElapsed: readRegenerationElapsed(requireField(record, "regenerationElapsed", "version 4 save"), "version 4 save.regenerationElapsed"),
    };
}

function migrateVersion5(record: UnknownRecord): GameSaveData {
    assertOnlyKeys(record, [
        "version", "location", "player", "inventories", "scriptVariables", "doors", "triggers", "questFlags", "clock",
        "persons", "stageFlags", "locationAccess", "bestiaryKills", "personParameters", "experience", "magicEffects", "regenerationElapsed",
    ], "version 5 save");
    return {
        version: SAVE_FORMAT_VERSION,
        location: readLocation(requireField(record, "location", "version 5 save"), "version 5 save.location"),
        player: readPlayer(requireField(record, "player", "version 5 save"), "version 5 save.player", false),
        ...migrateLegacyInventories(readLegacyInventories(requireField(record, "inventories", "version 5 save"), "version 5 save.inventories")),
        scriptVariables: readScriptVariables(requireField(record, "scriptVariables", "version 5 save"), "version 5 save.scriptVariables"),
        doors: readDoorStates(requireField(record, "doors", "version 5 save"), "version 5 save.doors"),
        triggers: readTriggerStates(requireField(record, "triggers", "version 5 save"), "version 5 save.triggers"),
        questFlags: readBooleanRecord(requireField(record, "questFlags", "version 5 save"), "version 5 save.questFlags"),
        clock: readClock(requireField(record, "clock", "version 5 save"), "version 5 save.clock"),
        persons: readBooleanRecord(requireField(record, "persons", "version 5 save"), "version 5 save.persons"),
        personStatesByLevel: {},
        stageFlags: readBooleanRecord(requireField(record, "stageFlags", "version 5 save"), "version 5 save.stageFlags"),
        locationAccess: readNumberRecord(requireField(record, "locationAccess", "version 5 save"), "version 5 save.locationAccess"),
        bestiaryKills: readBestiaryKills(requireField(record, "bestiaryKills", "version 5 save"), "version 5 save.bestiaryKills"),
        personParameters: readNestedNumberRecord(requireField(record, "personParameters", "version 5 save"), "version 5 save.personParameters"),
        experience: readNonNegativeNumber(requireField(record, "experience", "version 5 save"), "version 5 save.experience"),
        magicEffects: readMagicEffects(requireField(record, "magicEffects", "version 5 save"), "version 5 save.magicEffects"),
        regenerationElapsed: readRegenerationElapsed(requireField(record, "regenerationElapsed", "version 5 save"), "version 5 save.regenerationElapsed"),
    };
}
function migrateVersion6(record: UnknownRecord): GameSaveData {
    assertOnlyKeys(record, [
        "version", "location", "player", "inventories", "equipped", "scriptVariables", "doors", "triggers", "questFlags", "clock",
        "persons", "stageFlags", "locationAccess", "bestiaryKills", "personParameters", "experience", "magicEffects", "regenerationElapsed",
    ], "version 6 save");
    return {
        version: SAVE_FORMAT_VERSION,
        location: readLocation(requireField(record, "location", "version 6 save"), "version 6 save.location"),
        player: readPlayer(requireField(record, "player", "version 6 save"), "version 6 save.player", false),
        inventories: readInventories(requireField(record, "inventories", "version 6 save"), "version 6 save.inventories"),
        equipped: readEquippedItems(requireField(record, "equipped", "version 6 save"), "version 6 save.equipped"),
        scriptVariables: readScriptVariables(requireField(record, "scriptVariables", "version 6 save"), "version 6 save.scriptVariables"),
        doors: readDoorStates(requireField(record, "doors", "version 6 save"), "version 6 save.doors"),
        triggers: readTriggerStates(requireField(record, "triggers", "version 6 save"), "version 6 save.triggers"),
        questFlags: readBooleanRecord(requireField(record, "questFlags", "version 6 save"), "version 6 save.questFlags"),
        clock: readClock(requireField(record, "clock", "version 6 save"), "version 6 save.clock"),
        persons: readBooleanRecord(requireField(record, "persons", "version 6 save"), "version 6 save.persons"),
        personStatesByLevel: {},
        stageFlags: readBooleanRecord(requireField(record, "stageFlags", "version 6 save"), "version 6 save.stageFlags"),
        locationAccess: readNumberRecord(requireField(record, "locationAccess", "version 6 save"), "version 6 save.locationAccess"),
        bestiaryKills: readBestiaryKills(requireField(record, "bestiaryKills", "version 6 save"), "version 6 save.bestiaryKills"),
        personParameters: readNestedNumberRecord(requireField(record, "personParameters", "version 6 save"), "version 6 save.personParameters"),
        experience: readNonNegativeNumber(requireField(record, "experience", "version 6 save"), "version 6 save.experience"),
        magicEffects: readMagicEffects(requireField(record, "magicEffects", "version 6 save"), "version 6 save.magicEffects"),
        regenerationElapsed: readRegenerationElapsed(requireField(record, "regenerationElapsed", "version 6 save"), "version 6 save.regenerationElapsed"),
    };
}


function readLegacyLocation(value: unknown, path: string): SaveLocation {
    const record = requireRecord(value, path);
    assertOnlyKeys(record, ["gameMode", "mode", "level", "entrance"], path);
    return readLocation({ ...record, entrance: record.entrance ?? null }, path);
}

function readLocation(value: unknown, path: string): SaveLocation {
    const record = requireRecord(value, path);
    assertOnlyKeys(record, ["gameMode", "mode", "level", "entrance"], path);
    const mode = record.gameMode ?? record.mode;
    if (record.gameMode !== undefined && record.mode !== undefined && record.gameMode !== record.mode) {
        throw new SaveFormatError(`${path}.gameMode and ${path}.mode disagree`);
    }
    if (mode !== "single" && mode !== "multiplayer") throw new SaveFormatError(`${path}.gameMode must be "single" or "multiplayer"`);

    const level = readName(requireField(record, "level", path), `${path}.level`);
    const entranceValue = requireField(record, "entrance", path);
    if (entranceValue !== null && typeof entranceValue !== "string") {
        throw new SaveFormatError(`${path}.entrance must be a string or null`);
    }

    return { gameMode: mode, level, entrance: entranceValue === null ? null : readName(entranceValue, `${path}.entrance`) };
}

function readPlayer(value: unknown, path: string, allowDefaults: boolean): PlayerSaveState {
    const record = requireRecord(value, path);
    assertOnlyKeys(record, ["position", "direction", "health", "maxHealth", "attributes"], path);
    const fallback = defaultPlayer();
    const positionValue = record.position ?? (allowDefaults ? fallback.position : undefined);
    const directionValue = record.direction ?? (allowDefaults ? fallback.direction : undefined);
    const healthValue = record.health ?? (allowDefaults ? fallback.health : undefined);
    const maxHealthValue = record.maxHealth ?? (allowDefaults ? fallback.maxHealth : undefined);
    const attributesValue = record.attributes ?? (allowDefaults ? fallback.attributes : undefined);

    const position = readPosition(positionValue, `${path}.position`);
    if (typeof directionValue !== "string" || !DIRECTIONS.includes(directionValue as Direction)) {
        throw new SaveFormatError(`${path}.direction must be a known direction`);
    }
    const health = readFiniteNumber(healthValue, `${path}.health`);
    const maxHealth = readFiniteNumber(maxHealthValue, `${path}.maxHealth`);
    if (maxHealth <= 0 || health < 0 || health > maxHealth) {
        throw new SaveFormatError(`${path}.health must be between zero and ${path}.maxHealth`);
    }

    return {
        position,
        direction: directionValue as Direction,
        health,
        maxHealth,
        attributes: readNumberRecord(attributesValue, `${path}.attributes`),
    };
}

function readPosition(value: unknown, path: string): WorldPosition {
    const record = requireRecord(value, path);
    assertOnlyKeys(record, ["x", "y"], path);
    return {
        x: readFiniteNumber(requireField(record, "x", path), `${path}.x`),
        y: readFiniteNumber(requireField(record, "y", path), `${path}.y`),
    };
}

function readInventories(value: unknown, path: string): Inventories {
    const record = requireRecord(value, path);
    const result: Inventories = {};
    for (const [owner, inventory] of Object.entries(record)) {
        assertRecordKey(owner, path);
        if (!Array.isArray(inventory)) throw new SaveFormatError(`${path}.${owner} must be an array`);
        result[owner] = inventory.map((stack, index) => {
            const stackPath = `${path}.${owner}[${index}]`;
            const item = readItemInstanceState(stack, stackPath);
            const stackRecord = requireRecord(stack, stackPath);
            assertOnlyKeys(stackRecord, ["id", "definitionId", "durability", "charges", "quantity"], stackPath);
            const quantity = readSafeInteger(requireField(stackRecord, "quantity", stackPath), `${stackPath}.quantity`);
            if (quantity <= 0) throw new SaveFormatError(`${stackPath}.quantity must be a positive integer`);
            return { ...item, quantity };
        });
    }
    return result;
}

function readEquippedItems(value: unknown, path: string): EquippedItems {
    const record = requireRecord(value, path);
    const result: EquippedItems = {};
    for (const [rawSlot, stack] of Object.entries(record)) {
        if (!EQUIPMENT_SLOTS.includes(rawSlot as EquipmentSlot)) {
            throw new SaveFormatError(`${path} contains unknown equipment slot ${rawSlot}`);
        }
        const stackPath = `${path}.${rawSlot}`;
        const stackRecord = requireRecord(stack, stackPath);
        assertOnlyKeys(stackRecord, ["id", "definitionId", "durability", "charges", "quantity"], stackPath);
        const quantity = readSafeInteger(requireField(stackRecord, "quantity", stackPath), `${stackPath}.quantity`);
        if (quantity <= 0) throw new SaveFormatError(`${stackPath}.quantity must be a positive integer`);
        result[rawSlot as EquipmentSlot] = { ...readItemInstanceState(stack, stackPath), quantity };
    }
    return result;
}

function readItemInstanceState(value: unknown, path: string): ItemInstanceSaveState {
    const record = requireRecord(value, path);
    const id = readName(requireField(record, "id", path), `${path}.id`);
    const definitionId = readName(requireField(record, "definitionId", path), `${path}.definitionId`);
    const durability = readSafeInteger(requireField(record, "durability", path), `${path}.durability`);
    if (durability < 0 || durability > 100) throw new SaveFormatError(`${path}.durability must be between 0 and 100`);
    const chargesValue = record.charges;
    const charges = chargesValue === undefined ? undefined : readSafeInteger(chargesValue, `${path}.charges`);
    if (charges !== undefined && charges < 0) throw new SaveFormatError(`${path}.charges must be non-negative`);
    return charges === undefined ? { id, definitionId, durability } : { id, definitionId, durability, charges };
}

function readLegacyInventories(value: unknown, path: string): LegacyInventories {
    const record = requireRecord(value, path);
    const result: LegacyInventories = {};
    for (const [owner, inventory] of Object.entries(record)) {
        assertRecordKey(owner, path);
        const items = requireRecord(inventory, `${path}.${owner}`);
        const copied: Record<string, number> = {};
        for (const [itemId, count] of Object.entries(items)) {
            if (itemId.length > 256) throw new SaveFormatError(`${path}.${owner} has an item ID longer than 256 characters`);
            assertRecordKey(itemId, `${path}.${owner}`);
            const itemCount = readSafeInteger(count, `${path}.${owner}.${itemId}`);
            if (itemCount <= 0) throw new SaveFormatError(`${path}.${owner}.${itemId} must be a positive integer`);
            copied[itemId] = itemCount;
        }
        result[owner] = copied;
    }
    return result;
}

function migrateLegacyInventories(legacy: LegacyInventories): Pick<GameSaveData, "inventories" | "equipped"> {
    const inventories: Inventories = {};
    for (const [owner, items] of Object.entries(legacy)) {
        if (owner === LEGACY_EQUIPPED_INVENTORY_OWNER) continue;
        inventories[owner] = Object.entries(items).map(([definitionId, quantity], index) => ({
            id: `${owner}:${definitionId}:${index}`,
            definitionId,
            durability: 100,
            quantity,
        }));
    }
    const equipped: EquippedItems = {};
    for (const encoded of Object.keys(legacy[LEGACY_EQUIPPED_INVENTORY_OWNER] ?? {})) {
        const separator = encoded.indexOf(":");
        const slot = encoded.slice(0, separator) as EquipmentSlot;
        const definitionId = encoded.slice(separator + 1);
        if (separator <= 0 || !EQUIPMENT_SLOTS.includes(slot) || !definitionId) continue;
        equipped[slot] = { id: `equipped:${slot}:${definitionId}`, definitionId, durability: 100, quantity: 1 };
    }
    return { inventories, equipped };
}

function readScriptVariables(value: unknown, path: string): ScriptVariables {
    const record = requireRecord(value, path);
    const result: ScriptVariables = {};
    for (const [name, scriptValue] of Object.entries(record)) {
        assertRecordKey(name, path);
        if (typeof scriptValue === "number") {
            result[name] = readFiniteNumber(scriptValue, `${path}.${name}`);
        } else if (typeof scriptValue === "boolean") {
            result[name] = scriptValue;
        } else if (typeof scriptValue === "string") {
            result[name] = readText(scriptValue, `${path}.${name}`);
        } else {
            throw new SaveFormatError(`${path}.${name} must be a string, finite number, or boolean`);
        }
    }
    return result;
}

function readDoorStates(value: unknown, path: string): DoorStates {
    return readBooleanRecord(value, path);
}

function readBooleanRecord(value: unknown, path: string): Record<string, boolean> {
    const record = requireRecord(value, path);
    const result: Record<string, boolean> = {};
    for (const [name, flag] of Object.entries(record)) {
        assertRecordKey(name, path);
        if (typeof flag !== "boolean") throw new SaveFormatError(`${path}.${name} must be a boolean`);
        result[name] = flag;
    }
    return result;
}

function readTriggerStates(value: unknown, path: string): TriggerStates {
    const record = requireRecord(value, path);
    const result: TriggerStates = {};
    for (const [name, state] of Object.entries(record)) {
        assertRecordKey(name, path);
        const stateRecord = requireRecord(state, `${path}.${name}`);
        assertOnlyKeys(stateRecord, ["active", "visible"], `${path}.${name}`);
        const active = requireField(stateRecord, "active", `${path}.${name}`);
        const visible = requireField(stateRecord, "visible", `${path}.${name}`);
        if (typeof active !== "boolean" || typeof visible !== "boolean") {
            throw new SaveFormatError(`${path}.${name} must contain boolean active and visible fields`);
        }
        result[name] = { active, visible };
    }
    return result;
}

function readClock(value: unknown, path: string): GameClock {
    const record = requireRecord(value, path);
    assertOnlyKeys(record, ["day", "minuteOfDay"], path);
    const day = readSafeInteger(requireField(record, "day", path), `${path}.day`);
    const minuteOfDay = readSafeInteger(requireField(record, "minuteOfDay", path), `${path}.minuteOfDay`);
    if (day < 0) throw new SaveFormatError(`${path}.day must be zero or greater`);
    if (minuteOfDay < 0 || minuteOfDay >= 24 * 60) throw new SaveFormatError(`${path}.minuteOfDay must be between 0 and 1439`);
    return { day, minuteOfDay };
}

function readNumberRecord(value: unknown, path: string): Record<string, number> {
    const record = requireRecord(value, path);
    const result: Record<string, number> = {};
    for (const [name, number] of Object.entries(record)) {
        assertRecordKey(name, path);
        result[name] = readFiniteNumber(number, `${path}.${name}`);
    }
    return result;
}

function readBestiaryKills(value: unknown, path: string): BestiaryKills {
    const record = requireRecord(value, path);
    const result: BestiaryKills = {};
    for (const [name, countValue] of Object.entries(record)) {
        assertRecordKey(name, path);
        const count = readSafeInteger(countValue, `${path}.${name}`);
        if (count < 0 || count > 0xffff) throw new SaveFormatError(`${path}.${name} must be between 0 and 65535`);
        result[name] = count;
    }
    return result;
}

function readNestedBooleanRecord(value: unknown, path: string): Record<string, Record<string, boolean>> {
    const record = requireRecord(value, path);
    const result: Record<string, Record<string, boolean>> = {};
    for (const [name, nested] of Object.entries(record)) {
        assertRecordKey(name, path);
        result[name] = readBooleanRecord(nested, `${path}.${name}`);
    }
    return result;
}

function readNestedNumberRecord(value: unknown, path: string): Record<string, Record<string, number>> {
    const record = requireRecord(value, path);
    const result: Record<string, Record<string, number>> = {};
    for (const [name, nested] of Object.entries(record)) {
        assertRecordKey(name, path);
        result[name] = readNumberRecord(nested, `${path}.${name}`);
    }
    return result;
}

function readMagicEffects(value: unknown, path: string): MagicEffectSaveState[] {
    if (!Array.isArray(value)) throw new SaveFormatError(`${path} must be an array`);
    if (value.length > 1024) throw new SaveFormatError(`${path} contains too many effects`);
    return value.map((effect, index) => {
        const effectPath = `${path}[${index}]`;
        const record = requireRecord(effect, effectPath);
        assertOnlyKeys(record, ["spellId", "specialId", "targetName", "value", "remainingMinutes"], effectPath);
        const spellId = readSafeInteger(requireField(record, "spellId", effectPath), `${effectPath}.spellId`);
        if (spellId < 0 || spellId >= 78) throw new SaveFormatError(`${effectPath}.spellId must be between 0 and 77`);
        const remainingMinutes = readNonNegativeNumber(requireField(record, "remainingMinutes", effectPath), `${effectPath}.remainingMinutes`);
        if (remainingMinutes === 0) throw new SaveFormatError(`${effectPath}.remainingMinutes must be greater than zero`);
        return {
            spellId,
            specialId: readName(requireField(record, "specialId", effectPath), `${effectPath}.specialId`),
            targetName: readName(requireField(record, "targetName", effectPath), `${effectPath}.targetName`),
            value: readFiniteNumber(requireField(record, "value", effectPath), `${effectPath}.value`),
            remainingMinutes,
        };
    });
}

function readRegenerationElapsed(value: unknown, path: string): RegenerationElapsedStates {
    const record = requireRecord(value, path);
    const result: RegenerationElapsedStates = {};
    for (const [name, elapsed] of Object.entries(record)) {
        assertRecordKey(name, path);
        const elapsedPath = `${path}.${name}`;
        const elapsedRecord = requireRecord(elapsed, elapsedPath);
        assertOnlyKeys(elapsedRecord, ["health", "energy"], elapsedPath);
        result[name] = {
            health: readNonNegativeNumber(requireField(elapsedRecord, "health", elapsedPath), `${elapsedPath}.health`),
            energy: readNonNegativeNumber(requireField(elapsedRecord, "energy", elapsedPath), `${elapsedPath}.energy`),
        };
    }
    return result;
}

function readNonNegativeNumber(value: unknown, path: string): number {
    const number = readFiniteNumber(value, path);
    if (number < 0) throw new SaveFormatError(`${path} must be zero or greater`);
    return number;
}

function cloneLocation(value: SaveLocation): SaveLocation {
    return readLocation(value, "location");
}

function defaultPlayer(): PlayerSaveState {
    return {
        position: { x: 0, y: 0 },
        direction: "DOWN",
        health: 100,
        maxHealth: 100,
        attributes: {},
    };
}

function requireRecord(value: unknown, path: string): UnknownRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new SaveFormatError(`${path} must be an object`);
    }
    return value as UnknownRecord;
}

function requireField(record: UnknownRecord, name: string, path: string): unknown {
    if (!Object.prototype.hasOwnProperty.call(record, name)) throw new SaveFormatError(`${path}.${name} is required`);
    return record[name];
}

function assertOnlyKeys(record: UnknownRecord, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(record)) {
        if (!allowed.includes(key)) throw new SaveFormatError(`${path}.${key} is not supported`);
    }
}

function assertRecordKey(key: string, path: string): void {
    if (key.length === 0 || UNSAFE_RECORD_KEYS.has(key) || hasControlCharacter(key)) {
        throw new SaveFormatError(`${path} has an unsafe or empty key ${JSON.stringify(key)}`);
    }
}

function readName(value: unknown, path: string): string {
    if (typeof value !== "string") throw new SaveFormatError(`${path} must be a string`);
    if (value.length === 0 || value.length > 256 || hasControlCharacter(value)) {
        throw new SaveFormatError(`${path} must contain 1-256 non-control characters`);
    }
    return value;
}

function readText(value: string, path: string): string {
    if (value.length > 16_384 || [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    })) {
        throw new SaveFormatError(`${path} contains unsupported text`);
    }
    return value;
}

function hasControlCharacter(value: string): boolean {
    return [...value].some((character) => character.charCodeAt(0) <= 0x1f);
}

function readFiniteNumber(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new SaveFormatError(`${path} must be a finite number`);
    return value;
}

function readSafeInteger(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new SaveFormatError(`${path} must be a safe integer`);
    return value;
}

function describeValue(value: unknown): string {
    return value === undefined ? "missing" : JSON.stringify(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
