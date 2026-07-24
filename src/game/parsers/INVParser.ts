export interface InventoryScriptEntry {
    readonly technicalName: string;
    readonly minimumQuantity: number;
    readonly maximumQuantity: number;
}

const ITEM_PATTERN = /^\s*item\s+"([^"]+)"\s+(.+?)\s*$/i;

export function parseInventoryScript(source: string): readonly InventoryScriptEntry[] {
    const entries: InventoryScriptEntry[] = [];
    for (const originalLine of source.split(/\r?\n/)) {
        const line = originalLine.replace(/\/\/.*$/, "");
        const match = ITEM_PATTERN.exec(line);
        if (!match) continue;
        const values = match[2].trim().split(/\s+/).map(Number);
        if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
            throw new Error(`Malformed inventory entry for ${match[1]}`);
        }
        const minimumQuantity = values[values.length - 2];
        const maximumQuantity = values[values.length - 1];
        if (!Number.isSafeInteger(minimumQuantity) || !Number.isSafeInteger(maximumQuantity)
            || minimumQuantity < 0 || maximumQuantity < minimumQuantity) {
            throw new Error(`Invalid inventory quantity range for ${match[1]}`);
        }
        entries.push({ technicalName: match[1], minimumQuantity, maximumQuantity });
    }
    return entries;
}

export function materializeInventory(
    entries: readonly InventoryScriptEntry[],
    random: () => number = Math.random,
): Readonly<Record<string, number>> {
    const inventory: Record<string, number> = {};
    for (const entry of entries) {
        const span = entry.maximumQuantity - entry.minimumQuantity + 1;
        const quantity = entry.minimumQuantity + Math.floor(random() * span);
        if (quantity > 0) inventory[entry.technicalName] = (inventory[entry.technicalName] ?? 0) + quantity;
    }
    return inventory;
}
