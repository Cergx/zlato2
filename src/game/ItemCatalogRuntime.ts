import { Paths } from "../constants/paths.ts";
import { SDBParser } from "./parsers/SDBParser.ts";
import {
    createItemDefinitionFromAsset,
    parseItemAsset,
    type EquipmentSlot,
    type ItemClass,
    type ItemDefinition,
} from "./systems/Items.ts";
import type { OriginalDamageKind, OriginalWeaponProfile } from "./systems/Combat.ts";

export interface ItemSpecialEffect {
    readonly specialId: number;
    readonly amount: number;
    readonly flags: number;
    readonly duration: number;
}

export interface ShippedItem {
    readonly technicalName: string;
    readonly literaryName: string;
    readonly description: string;
    readonly definition: ItemDefinition;
    readonly iconUrl?: string;
    readonly puppetUrl?: string;
    readonly specialEffects: readonly ItemSpecialEffect[];
    readonly weaponProfile?: OriginalWeaponProfile;
    readonly nutrition: number;
    readonly magicId?: number;
    readonly canDrop: boolean;

}

const DEFAULT_SPECIAL_EFFECT_OFFSET = 20;
const WEAPON_SPECIAL_EFFECT_OFFSET = 24;
const SPECIAL_EFFECT_WORDS = 4;
const WEAPON_CLASSES = new Set<ItemClass>(["sword", "axe", "spear", "bow", "crossbow", "firearm", "staff", "mace"]);

const loadSdb = async (path: string): Promise<Record<number, string>> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Item database request failed for ${path}: HTTP ${response.status}`);
    return new SDBParser(await response.arrayBuffer()).getData();
};

const normalizeResourcePath = (path: string): string | undefined => {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    if (!normalized) return undefined;
    return normalized.startsWith("items/") ? `/assets/${normalized}` : `${Paths.ITEMS}/res/${normalized}`;
};

const parseSpecialEffects = (properties: readonly number[], offset: number): readonly ItemSpecialEffect[] => {
    const count = properties[offset] ?? 0;
    if (!Number.isSafeInteger(count) || count <= 0) return [];
    const effects: ItemSpecialEffect[] = [];
    for (let index = 0; index < count; index += 1) {
        const effectOffset = offset + 1 + index * SPECIAL_EFFECT_WORDS;
        const specialId = properties[effectOffset];
        const amount = properties[effectOffset + 1];
        const flags = properties[effectOffset + 2];
        const duration = properties[effectOffset + 3];
        if (![specialId, amount, flags, duration].every(Number.isSafeInteger)) break;
        effects.push({ specialId, amount, flags, duration });
    }
    return effects;
};

const readDamageRange = (properties: readonly number[], offset: number) => ({
    min: Math.max(0, properties[offset] ?? 0),
    max: Math.max(0, properties[offset + 1] ?? 0),
});

const createWeaponProfile = (
    technicalName: string,
    itemClass: ItemClass,
    properties: readonly number[],
): OriginalWeaponProfile | undefined => {
    if (!WEAPON_CLASSES.has(itemClass)) return undefined;
    const damage: Record<OriginalDamageKind, { readonly min: number; readonly max: number }> = {
        crushing: readDamageRange(properties, 18),
        hacking: readDamageRange(properties, 20),
        pricking: readDamageRange(properties, 22),
    };
    return {
        itemId: technicalName,
        actionPointCost: Math.max(1, properties[5] ?? 10),
        attackDistance: Math.max(1, properties[7] ?? 6),
        baseHitChance: Math.max(0, properties[9] ?? 0),
        damage,
    };
};
const itemClassCanBeDropped = (itemClass: ItemClass): boolean => itemClass !== "money" && itemClass !== "questItem";


export class ShippedItemCatalog {
    private readonly technicalToNumeric = new Map<string, number>();
    private readonly itemPromises = new Map<string, Promise<ShippedItem>>();

    private constructor(
        technicalNames: Readonly<Record<number, string>>,
        private readonly literaryNames: Readonly<Record<number, string>>,
        private readonly descriptions: Readonly<Record<number, string>>,
    ) {
        for (const [numericId, technicalName] of Object.entries(technicalNames)) {
            this.technicalToNumeric.set(technicalName.toLowerCase(), Number(numericId));
        }
    }

    public static async load(): Promise<ShippedItemCatalog> {
        const [technicalNames, literaryNames, descriptions] = await Promise.all([
            loadSdb(`${Paths.SDB}/items/tech_names.sdb`),
            loadSdb(`${Paths.SDB}/items/lit_names.sdb`),
            loadSdb(`${Paths.SDB}/items/descriptions.sdb`),
        ]);
        return new ShippedItemCatalog(technicalNames, literaryNames, descriptions);
    }

    public get(technicalName: string): Promise<ShippedItem> {
        const key = technicalName.toLowerCase();
        const cached = this.itemPromises.get(key);
        if (cached) return cached;
        const numericId = this.technicalToNumeric.get(key);
        if (numericId === undefined) return Promise.reject(new Error(`Unknown shipped item ${technicalName}`));
        const promise = fetch(`${Paths.ITEMS}/data/${numericId}.itm`).then(async (response) => {
            if (!response.ok) throw new Error(`Item asset request failed for ${technicalName}: HTTP ${response.status}`);
            const parsed = parseItemAsset(await response.arrayBuffer());
            const weaponProfile = createWeaponProfile(technicalName, parsed.itemClass, parsed.nativeProperties);
            const specialEffects = parseSpecialEffects(
                parsed.nativeProperties,
                weaponProfile ? WEAPON_SPECIAL_EFFECT_OFFSET : DEFAULT_SPECIAL_EFFECT_OFFSET,
            );
            const physicalDamage = weaponProfile && {
                min: Object.values(weaponProfile.damage).reduce((sum, range) => sum + range.min, 0),
                max: Object.values(weaponProfile.damage).reduce((sum, range) => sum + range.max, 0),
            };
            return {
                technicalName,
                literaryName: this.literaryNames[numericId] || technicalName,
                description: this.descriptions[numericId] || "",
                definition: createItemDefinitionFromAsset(parsed, {
                    id: technicalName,
                    weapon: physicalDamage ? { damage: physicalDamage, damageKind: "physical" } : undefined,
                }),
                iconUrl: normalizeResourcePath(parsed.iconPath),
                puppetUrl: normalizeResourcePath(parsed.worldImagePath),
                specialEffects,
                weaponProfile,
                nutrition: weaponProfile ? 0 : Math.max(0, parsed.nativeProperties[18] ?? 0),
                canDrop: itemClassCanBeDropped(parsed.itemClass),
                magicId: (parsed.itemClass === "book" || parsed.itemClass === "scroll")
                    && Number.isInteger(parsed.nativeProperties[18])
                    && parsed.nativeProperties[18] >= 0
                    && parsed.nativeProperties[18] < 78
                    ? parsed.nativeProperties[18]
                    : undefined,

            };
        });
        this.itemPromises.set(key, promise);
        return promise;
    }
}

export interface HeroInventoryItemView extends ShippedItem {
    readonly quantity: number;
}

export interface HeroInventoryView {
    readonly items: readonly HeroInventoryItemView[];
    readonly equipped: Readonly<Partial<Record<EquipmentSlot, ShippedItem>>>;
}

export const itemClassCanBeUsed = (itemClass: ItemClass): boolean => itemClass === "potion" || itemClass === "food" || itemClass === "book";

let shippedItemCatalogPromise: Promise<ShippedItemCatalog> | undefined;

export const loadShippedItemCatalog = (): Promise<ShippedItemCatalog> =>
    shippedItemCatalogPromise ??= ShippedItemCatalog.load();
