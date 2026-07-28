#!/usr/bin/env node
import assert from "node:assert/strict";
import {
    nativeDurabilityPriceFactor,
    nativeTradePriceMultiplier,
    nativeTradeUnitPrice,
    quoteTrade,
} from "../src/game/systems/Trade.ts";

const item = (technicalName, basePrice, specialPriceContributions = [], durability = 100) => ({
    technicalName,
    basePrice,
    specialPriceContributions,
    durability,
    stackKey: `${technicalName}:${durability}`,
    definition: { itemClass: "weapon" },
});

assert.equal(nativeTradePriceMultiplier(0, false, 0), 2.5);
assert.equal(nativeTradePriceMultiplier(10, false, 0), 1.5);
assert.equal(nativeTradePriceMultiplier(15, false, 0), 1);
assert.equal(nativeTradePriceMultiplier(0, true, 0x10), 2.125);
assert.ok(Math.abs(nativeTradePriceMultiplier(0, true, 0x410) - 1.95625) < 1e-12);
assert.equal(nativeDurabilityPriceFactor(100), 1);
assert.equal(nativeDurabilityPriceFactor(0), 0.75);

const barrel = item("BRL_1_01_2", 40);
const axe = item("AXE_2_8_1", 846);
assert.equal(nativeTradeUnitPrice(barrel, "buy", 2.5), 100);
assert.equal(nativeTradeUnitPrice(barrel, "sell", 2.5), 16);
assert.equal(nativeTradeUnitPrice(axe, "buy", 2.5), 2115);
assert.equal(nativeTradeUnitPrice(axe, "sell", 2.5), 338);

const specialFoodFresh = item("FOD_1_15_1", 180, [200, 1500], 100);
const specialFoodBroken = item("FOD_1_15_1", 180, [200, 1500], 0);
assert.equal(nativeTradeUnitPrice(specialFoodFresh, "buy", 1, 100), 1880);
assert.equal(nativeTradeUnitPrice(specialFoodBroken, "buy", 1, 0), 1835);

const quote = quoteTrade(
    { [axe.stackKey]: 1 },
    { [barrel.stackKey]: 2 },
    [axe],
    [barrel],
    2.5,
);
assert.deepEqual(quote, { buyCost: 200, sellCredit: 338, balance: -138 });

console.log("Verified native trade multipliers, durability, special pricing, direction, and stack quantities");
