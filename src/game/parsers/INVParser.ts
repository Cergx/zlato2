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
    readonly pass?: "normal" | "decreased";
    readonly resolveMaximumStack?: (technicalName: string) => number;
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
    const stacksByTechnicalName = new Map<string, { technicalName: string; quantities: number[] }>();
    const random = options.random ?? Math.random;
    const level = options.level ?? 1;
    const decreased = options.pass === "decreased";
    const chanceDivisor = decreased ? script.chanceDecrease : 1;
    const quantityDivisor = decreased ? script.quantityDecrease : 1;
    for (const entry of script.entries) {
        const minimumLevel = script.levelOffset + entry.minimumLevel;
        const maximumLevel = script.levelOffset + entry.maximumLevel;
        if (level < minimumLevel || level > maximumLevel) continue;
        const chance = chanceDivisor <= 0 ? Number.POSITIVE_INFINITY : entry.chance / chanceDivisor / 100;
        if (chance <= 0) continue;
        if (chance <= 1 && random() >= chance) continue;
        const divisor = quantityDivisor <= 0 ? Number.POSITIVE_INFINITY : quantityDivisor;
        const minimumQuantity = Math.ceil(entry.minimumQuantity / divisor);
        const maximumQuantity = Math.ceil(entry.maximumQuantity / divisor);
        const quantity = maximumQuantity <= minimumQuantity
            ? minimumQuantity
            : minimumQuantity + Math.floor(random() * (maximumQuantity - minimumQuantity + 1));
        if (quantity <= 0) continue;
        const normalizedTechnicalName = entry.technicalName.toLowerCase();
        let generated = stacksByTechnicalName.get(normalizedTechnicalName);
        if (!generated) {
            generated = { technicalName: entry.technicalName, quantities: [] };
            stacksByTechnicalName.set(normalizedTechnicalName, generated);
        }
        const resolvedMaximumStack = options.resolveMaximumStack?.(entry.technicalName) ?? 0x7fffffff;
        const maximumStack = Number.isSafeInteger(resolvedMaximumStack) && resolvedMaximumStack > 0
            ? resolvedMaximumStack
            : 0x7fffffff;
        const existingStack = maximumStack > 1
            ? generated.quantities.findIndex((stackQuantity) => stackQuantity < maximumStack)
            : -1;
        if (existingStack >= 0) {
            generated.quantities[existingStack] += 1;
        } else {
            generated.quantities.push(Math.min(quantity, maximumStack));
        }
    }
    const inventory: Record<string, number> = {};
    for (const { technicalName, quantities } of stacksByTechnicalName.values()) {
        inventory[technicalName] = quantities.reduce((total, quantity) => total + quantity, 0);
    }
    return inventory;
}

