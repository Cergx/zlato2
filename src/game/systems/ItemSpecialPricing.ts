import type { ItemSpecialEffect } from "../ItemCatalogRuntime.ts";

interface SpecialPriceDefinition {
    readonly valuePrices: readonly number[];
    readonly timePrices: readonly number[];
}

export type ItemSpecialPriceTable = Readonly<Record<number, SpecialPriceDefinition>>;

const VALUE_FLAGS = [0x40, 0x80, 0x100] as const;
const TIME_FLAGS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20] as const;

export const parseItemSpecialPriceTable = (source: string): ItemSpecialPriceTable => {
    const table: Record<number, SpecialPriceDefinition> = {};
    const blockPattern = /\bspecial_desc\s+\S+(?:\s+random_sign)?\s*\{([\s\S]*?)\}/gi;
    let specialId = 0;
    for (const match of source.matchAll(blockPattern)) {
        const rows = match[1]
            .replace(/\/\/.*$/gm, "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => line.split(/\s+/))
            .filter((tokens) => tokens.length >= 4);
        if (rows.length < VALUE_FLAGS.length + TIME_FLAGS.length) {
            throw new Error(`Special price definition ${specialId} is incomplete`);
        }
        const prices = rows.map((tokens) => Number(tokens[tokens.length - 1]));
        if (prices.some((price) => !Number.isFinite(price))) {
            throw new Error(`Special price definition ${specialId} contains a non-numeric price`);
        }
        table[specialId] = {
            valuePrices: prices.slice(0, VALUE_FLAGS.length),
            timePrices: prices.slice(VALUE_FLAGS.length, VALUE_FLAGS.length + TIME_FLAGS.length),
        };
        specialId += 1;
    }
    if (specialId === 0) throw new Error("The shipped special price script contains no definitions");
    return table;
};

export const itemSpecialPriceContribution = (effect: ItemSpecialEffect, table: ItemSpecialPriceTable): number => {
    const definition = table[effect.specialId];
    if (!definition) return 0;
    const valueIndex = VALUE_FLAGS.indexOf((effect.flags & 0x1c0) as typeof VALUE_FLAGS[number]);
    const timeIndex = TIME_FLAGS.indexOf((effect.flags & 0x3f) as typeof TIME_FLAGS[number]);
    if (valueIndex < 0 || timeIndex < 0) return 0;
    return effect.amount * definition.valuePrices[valueIndex] * definition.timePrices[timeIndex];
};
