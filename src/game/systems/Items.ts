export type ItemId = string;

export type DamageKind = "physical" | "magical";

export interface DamageRange {
    readonly min: number;
    readonly max: number;
}

export type EquipmentSlot =
    | "mainHand"
    | "offHand"
    | "ammo"
    | "head"
    | "body"
    | "arms"
    | "bracelet"
    | "amulet"
    | "ringLeft"
    | "ringRight";

export type ItemClass =
    | "sword"
    | "axe"
    | "spear"
    | "bow"
    | "crossbow"
    | "firearm"
    | "staff"
    | "mace"
    | "ammo"
    | "bolts"
    | "arrows"
    | "helmet"
    | "armor"
    | "shield"
    | "bracers"
    | "bracelet"
    | "amulet"
    | "ring"
    | "money"
    | "potion"
    | "food"
    | "book"
    | "scroll"
    | "material"
    | "reagent"
    | "questItem"
    | "recipe"
    | "garbage"
    | "stone"
    | "unknown";

export interface WeaponDefinition {
    readonly damage: DamageRange;
    readonly damageKind: DamageKind;
    readonly accuracyBonus?: number;
    readonly criticalChance?: number;
    readonly criticalMultiplier?: number;
}

export type ItemEffect =
    | { readonly kind: "damage"; readonly damage: DamageRange; readonly damageKind: DamageKind }
    | { readonly kind: "heal"; readonly amount: DamageRange }
    | { readonly kind: "restoreMana"; readonly amount: DamageRange };

export interface ItemDefinition {
    /** Stable asset or script-facing item identifier. */
    readonly id: ItemId;
    readonly itemClass: ItemClass;
    /** Maximum number of compatible instances in one inventory stack. */
    readonly maxStack: number;
    /** Source `.itm` id, retained as a string rather than converted into a runtime number. */
    readonly assetId?: string;
    readonly worldImagePath?: string;
    readonly iconPath?: string;
    readonly equipSlots?: readonly EquipmentSlot[];
    readonly weapon?: WeaponDefinition;
    readonly effects?: readonly ItemEffect[];
}

/**
 * Mutable game state which belongs to a physical item.  Its id may be a script
 * id, a save-game id, or a caller-assigned id; inventory stack compatibility is
 * based on the immutable properties that affect gameplay rather than this label.
 */
export interface ItemInstance {
    readonly id: string;
    readonly definitionId: ItemId;
    readonly durability?: number;
    readonly charges?: number;
}

export interface ItemInstanceOptions {
    readonly id?: string;
    readonly durability?: number;
    readonly charges?: number;
}

export interface ParsedItemAsset {
    readonly id: string;
    readonly formatVersion: number;
    readonly typeCode: number;
    readonly itemClass: ItemClass;
    readonly flags: number;
    readonly maxStack: number;
    readonly worldImagePath: string;
    readonly iconPath: string;
    /** Native signed 32-bit fields after the common item header. */
    readonly nativeProperties: readonly number[];
}

export interface ItemDefinitionOverrides {
    readonly id?: ItemId;
    readonly equipSlots?: readonly EquipmentSlot[];
    readonly weapon?: WeaponDefinition;
    readonly effects?: readonly ItemEffect[];
}

const ITEM_CLASSES: Readonly<Record<number, ItemClass>> = {
    0: "sword",
    1: "axe",
    2: "spear",
    3: "bow",
    4: "crossbow",
    5: "firearm",
    6: "staff",
    7: "mace",
    8: "ammo",
    9: "bolts",
    10: "arrows",
    11: "helmet",
    12: "armor",
    13: "shield",
    14: "bracers",
    15: "bracelet",
    16: "amulet",
    17: "ring",
    18: "money",
    19: "potion",
    20: "food",
    21: "book",
    22: "scroll",
    23: "material",
    24: "reagent",
    25: "questItem",
    26: "recipe",
    27: "garbage",
    28: "stone",
};

const DEFAULT_EQUIPMENT_SLOTS: Readonly<Partial<Record<ItemClass, readonly EquipmentSlot[]>>> = {
    sword: ["mainHand", "offHand"],
    axe: ["mainHand", "offHand"],
    spear: ["mainHand", "offHand"],
    bow: ["mainHand", "offHand"],
    crossbow: ["mainHand", "offHand"],
    firearm: ["mainHand", "offHand"],
    staff: ["mainHand", "offHand"],
    mace: ["mainHand", "offHand"],
    ammo: ["ammo"],
    bolts: ["ammo"],
    arrows: ["ammo"],
    helmet: ["head"],
    armor: ["body"],
    shield: ["mainHand", "offHand"],
    bracers: ["arms"],
    bracelet: ["bracelet"],
    amulet: ["amulet"],
    ring: ["ringLeft", "ringRight"],
};

export class ItemCatalog {
    private readonly definitions = new Map<ItemId, ItemDefinition>();

    constructor(definitions: readonly ItemDefinition[] = []) {
        for (const definition of definitions) this.define(definition);
    }

    define(definition: ItemDefinition): void {
        validateDefinition(definition);
        if (this.definitions.has(definition.id)) throw new Error(`Item definition ${definition.id} is already registered`);
        this.definitions.set(definition.id, definition);
    }

    get(id: ItemId): ItemDefinition {
        const definition = this.definitions.get(id);
        if (!definition) throw new Error(`Unknown item definition ${id}`);
        return definition;
    }

    has(id: ItemId): boolean {
        return this.definitions.has(id);
    }

    createInstance(definitionId: ItemId, options: ItemInstanceOptions = {}): ItemInstance {
        this.get(definitionId);
        return createItemInstance(definitionId, options);
    }
}

export function createItemInstance(definitionId: ItemId, options: ItemInstanceOptions = {}): ItemInstance {
    assertNonEmptyString(definitionId, "Item definition id");
    const id = options.id ?? definitionId;
    assertNonEmptyString(id, "Item instance id");
    if (options.durability !== undefined) assertNonNegativeInteger(options.durability, "Item durability");
    if (options.charges !== undefined) assertNonNegativeInteger(options.charges, "Item charges");
    return { id, definitionId, durability: options.durability, charges: options.charges };
}

export function itemInstancesCanStack(left: ItemInstance, right: ItemInstance): boolean {
    return left.definitionId === right.definitionId
        && left.durability === right.durability
        && left.charges === right.charges;
}

/** Parses the shared binary header used by shipped `items/data/*.itm` files. */
export function parseItemAsset(data: ArrayBuffer | Uint8Array): ParsedItemAsset {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.byteLength < 24) throw new Error(`Malformed item asset: expected at least 24 bytes, got ${bytes.byteLength}`);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const formatVersion = view.getUint32(offset, true);
    offset += 4;
    if (formatVersion !== 4) throw new Error(`Unsupported item asset version ${formatVersion}; expected 4`);

    const numericId = view.getUint32(offset, true);
    offset += 4;
    const typeCode = view.getUint32(offset, true);
    offset += 4;
    const flags = view.getUint32(offset, true);
    offset += 4;
    const maxStack = view.getUint32(offset, true);
    offset += 4;
    if (maxStack === 0) throw new Error(`Malformed item asset ${numericId}: max stack must be positive`);

    const worldImage = readLengthPrefixedString(view, bytes, offset, `item asset ${numericId} world image`);
    offset = worldImage.nextOffset;
    const icon = readLengthPrefixedString(view, bytes, offset, `item asset ${numericId} icon`);
    offset = icon.nextOffset;

    const nativeProperties: number[] = [];
    if ((bytes.byteLength - offset) % 4 !== 0 && typeCode === 28) {
        const weaponPrefixWords = 11;
        if (bytes.byteLength - offset < weaponPrefixWords * 4 + 4) {
            throw new Error(`Malformed item asset ${numericId}: truncated weapon property block`);
        }
        for (let index = 0; index < weaponPrefixWords; index++) {
            nativeProperties.push(view.getInt32(offset, true));
            offset += 4;
        }
        const weaponTemplate = readLengthPrefixedString(view, bytes, offset, `item asset ${numericId} weapon template`);
        offset = weaponTemplate.nextOffset;
    }

    const remaining = bytes.byteLength - offset;
    if (remaining < 0 || remaining % 4 !== 0) {
        throw new Error(`Malformed item asset ${numericId}: invalid native property block of ${remaining} bytes`);
    }

    while (offset < bytes.byteLength) {
        nativeProperties.push(view.getInt32(offset, true));
        offset += 4;
    }

    return {
        id: String(numericId),
        formatVersion,
        typeCode,
        itemClass: ITEM_CLASSES[typeCode] ?? "unknown",
        flags,
        maxStack,
        worldImagePath: worldImage.value,
        iconPath: icon.value,
        nativeProperties,
    };
}

export function createItemDefinitionFromAsset(
    asset: ParsedItemAsset,
    overrides: ItemDefinitionOverrides = {},
): ItemDefinition {
    const id = overrides.id ?? asset.id;
    const equipSlots = overrides.equipSlots ?? DEFAULT_EQUIPMENT_SLOTS[asset.itemClass];
    const definition: ItemDefinition = {
        id,
        assetId: asset.id,
        itemClass: asset.itemClass,
        maxStack: asset.maxStack,
        worldImagePath: asset.worldImagePath || undefined,
        iconPath: asset.iconPath || undefined,
        equipSlots,
        weapon: overrides.weapon,
        effects: overrides.effects,
    };
    validateDefinition(definition);
    return definition;
}

function readLengthPrefixedString(
    view: DataView,
    bytes: Uint8Array,
    offset: number,
    label: string,
): { value: string; nextOffset: number } {
    if (offset + 4 > bytes.byteLength) throw new Error(`Malformed ${label}: missing length`);
    const length = view.getUint32(offset, true);
    const contentOffset = offset + 4;
    if (length > bytes.byteLength - contentOffset) {
        throw new Error(`Malformed ${label}: declared ${length} bytes beyond asset boundary`);
    }
    try {
        return {
            value: new TextDecoder("windows-1251", { fatal: true }).decode(bytes.subarray(contentOffset, contentOffset + length)),
            nextOffset: contentOffset + length,
        };
    } catch {
        throw new Error(`Malformed ${label}: invalid Windows-1251 text`);
    }
}

function validateDefinition(definition: ItemDefinition): void {
    assertNonEmptyString(definition.id, "Item definition id");
    assertPositiveInteger(definition.maxStack, `Item definition ${definition.id} max stack`);
    if (definition.equipSlots) {
        const knownSlots = new Set<EquipmentSlot>();
        for (const slot of definition.equipSlots) {
            if (knownSlots.has(slot)) throw new Error(`Item definition ${definition.id} repeats equipment slot ${slot}`);
            knownSlots.add(slot);
        }
    }
    if (definition.weapon) validateWeapon(definition.id, definition.weapon);
    if (definition.effects) for (const effect of definition.effects) validateEffect(definition.id, effect);
}

function validateWeapon(itemId: ItemId, weapon: WeaponDefinition): void {
    validateDamageRange(weapon.damage, `Weapon ${itemId} damage`);
    if (weapon.accuracyBonus !== undefined) assertFiniteNumber(weapon.accuracyBonus, `Weapon ${itemId} accuracy bonus`);
    if (weapon.criticalChance !== undefined) assertPercentage(weapon.criticalChance, `Weapon ${itemId} critical chance`);
    if (weapon.criticalMultiplier !== undefined && weapon.criticalMultiplier < 1) {
        throw new Error(`Weapon ${itemId} critical multiplier must be at least 1`);
    }
}

function validateEffect(itemId: ItemId, effect: ItemEffect): void {
    if (effect.kind === "damage") {
        validateDamageRange(effect.damage, `Item ${itemId} damage effect`);
    } else {
        validateDamageRange(effect.amount, `Item ${itemId} ${effect.kind} effect`);
    }
}

export function validateDamageRange(range: DamageRange, label = "Damage range"): void {
    assertNonNegativeInteger(range.min, `${label} minimum`);
    assertNonNegativeInteger(range.max, `${label} maximum`);
    if (range.min > range.max) throw new Error(`${label} minimum cannot exceed maximum`);
}

export function assertPercentage(value: number, label: string): void {
    assertFiniteNumber(value, label);
    if (value < 0 || value > 100) throw new Error(`${label} must be between 0 and 100`);
}

export function assertFiniteNumber(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}

function assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function assertNonEmptyString(value: string, label: string): void {
    if (value.trim() === "") throw new Error(`${label} must not be empty`);
}
