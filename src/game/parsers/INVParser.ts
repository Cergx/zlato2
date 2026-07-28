export interface InventoryScriptEntry {
    readonly technicalName: string;
    readonly minimumLevel: number;
    readonly maximumLevel: number;
    readonly chance: number;
    readonly minimumQuantity: number;
    readonly maximumQuantity: number;
}

export interface InventoryScript {
    readonly entries: readonly InventoryScriptEntry[];
    readonly levelOffset: number;
    readonly regenerateChance: number;
    readonly chanceDecrease: number;
    readonly quantityDecrease: number;
}

export interface InventoryMaterializationOptions {
    readonly level?: number;
    readonly random?: () => number;
    readonly periodicSecondPass?: boolean;
}

const ITEM_PATTERN = /^\s*item\s+"([^"]+)"\s+(.+?)\s*$/i;

export function parseInventoryScript(source: string): InventoryScript {
    const entries: InventoryScriptEntry[] = [];
    const settings = Object.fromEntries(
        [...source.replace(/\/\/.*$/gm, "").matchAll(/^\s*(regenerate_chance|chance_decrease|quantity_decrease|level_offset)\s+(-?\d+(?:\.\d+)?)\s*$/gim)]
            .map((match) => [match[1].toLowerCase(), Number(match[2])]),
    );
    for (const originalLine of source.split(/\r?\n/)) {
        const line = originalLine.replace(/\/\/.*$/, "");
        const match = ITEM_PATTERN.exec(line);
        if (!match) continue;
        const values = match[2].trim().split(/\s+/).map(Number);
        if (values.length !== 5 || values.some((value) => !Number.isFinite(value))) continue;
        const [minimumLevel, maximumLevel, chance, minimumQuantity, maximumQuantity] = values;
        if (!Number.isSafeInteger(minimumLevel) || !Number.isSafeInteger(maximumLevel) || minimumLevel > maximumLevel
            || !Number.isSafeInteger(minimumQuantity) || !Number.isSafeInteger(maximumQuantity)
            || minimumQuantity < 0 || maximumQuantity < minimumQuantity) {
            throw new Error(`Invalid inventory entry for ${match[1]}`);
        }
        entries.push({ technicalName: match[1], minimumLevel, maximumLevel, chance, minimumQuantity, maximumQuantity });
    }
    return {
        entries,
        levelOffset: settings.level_offset ?? 0,
        regenerateChance: settings.regenerate_chance ?? 100,
        chanceDecrease: settings.chance_decrease ?? 1,
        quantityDecrease: settings.quantity_decrease ?? 1,
    };
}

export function materializeInventory(
    script: InventoryScript,
    options: InventoryMaterializationOptions = {},
): Readonly<Record<string, number>> {
    const inventory: Record<string, number> = {};
    const random = options.random ?? Math.random;
    const level = options.level ?? 1;
    const materializePass = (chanceDivisor: number, quantityDivisor: number): void => {
        for (const entry of script.entries) {
            const minimumLevel = script.levelOffset + entry.minimumLevel;
            const maximumLevel = script.levelOffset + entry.maximumLevel;
            if (level < minimumLevel || level > maximumLevel) continue;
            const chance = chanceDivisor <= 0 ? Number.POSITIVE_INFINITY : entry.chance / chanceDivisor;
            if (chance <= 0 || (chance <= 100 && random() * 100 >= chance)) continue;
            const divisor = quantityDivisor <= 0 ? Number.POSITIVE_INFINITY : quantityDivisor;
            const minimumQuantity = Math.ceil(entry.minimumQuantity / divisor);
            const maximumQuantity = Math.ceil(entry.maximumQuantity / divisor);
            const quantity = maximumQuantity <= minimumQuantity
                ? minimumQuantity
                : minimumQuantity + Math.floor(random() * (maximumQuantity - minimumQuantity + 1));
            if (quantity > 0) inventory[entry.technicalName] = (inventory[entry.technicalName] ?? 0) + quantity;
        }
    };
    materializePass(1, 1);
    if (options.periodicSecondPass !== false && Object.keys(inventory).length < 4) {
        materializePass(script.chanceDecrease, script.quantityDecrease);
    }
    return inventory;
}
