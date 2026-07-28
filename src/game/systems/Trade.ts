import type { ShippedItem } from "../ItemCatalogRuntime.ts";

export const MONEY_ITEM_ID = "MON_1_0_1";

export type TradeOffer = Readonly<Record<string, number>>;

export interface TradeQuote {
    readonly buyCost: number;
    readonly sellCredit: number;
    readonly balance: number;
}

export interface TradeItemStack extends ShippedItem {
    readonly stackKey: string;
    readonly durability: number;
}

/** Client.dll 0x1206eb3b..0x1206ebdf. */
export const nativeTradePriceMultiplier = (alchemySkill: number, addonMode: boolean, specialPerks: number): number => {
    let multiplier = 2.5 - 0.1 * alchemySkill;
    if (addonMode) {
        if ((specialPerks & 0x10) !== 0) multiplier = 1 + 0.75 * (multiplier - 1);
        if ((specialPerks & 0x400) !== 0) multiplier = 1 + 0.85 * (multiplier - 1);
    }
    return Math.max(1, multiplier);
};

/** Client.dll 0x1206e967..0x1206e9a2; native item-instance durability is 0..100. */
export const nativeDurabilityPriceFactor = (durability: number): number =>
    0.75 + 0.0025 * Math.max(0, Math.min(100, durability));

/** Client.dll 0x1206e967..0x1206ec49. */
export const nativeTradeUnitPrice = (
    item: ShippedItem,
    direction: "buy" | "sell",
    multiplier: number,
    durability = 100,
): number => {
    if (item.definition.itemClass === "money") return 1;
    const durabilityAdjustedPrice = Math.trunc(item.basePrice * nativeDurabilityPriceFactor(durability));
    let adjustedPrice = durabilityAdjustedPrice;
    for (const contribution of item.specialPriceContributions) adjustedPrice = Math.trunc(adjustedPrice + contribution);
    adjustedPrice = Math.max(adjustedPrice, Math.trunc(durabilityAdjustedPrice / 3));
    const price = direction === "buy" ? adjustedPrice * multiplier : adjustedPrice / multiplier;
    return Math.max(1, Math.trunc(price));
};

export const quoteTrade = (
    heroOffer: TradeOffer,
    traderOffer: TradeOffer,
    heroItems: readonly TradeItemStack[],
    traderItems: readonly TradeItemStack[],
    multiplier: number,
): TradeQuote => {
    const offerValue = (offer: TradeOffer, items: readonly TradeItemStack[], direction: "buy" | "sell"): number => {
        const byStack = new Map(items.map((item) => [item.stackKey, item]));
        let total = 0;
        for (const [stackKey, quantity] of Object.entries(offer)) {
            const item = byStack.get(stackKey);
            if (!item || item.definition.itemClass === "money") continue;
            total += nativeTradeUnitPrice(item, direction, multiplier, item.durability) * quantity;
        }
        return total;
    };
    const buyCost = offerValue(traderOffer, traderItems, "buy");
    const sellCredit = offerValue(heroOffer, heroItems, "sell");
    return { buyCost, sellCredit, balance: buyCost - sellCredit };
};
