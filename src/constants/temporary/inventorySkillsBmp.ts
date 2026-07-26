import type { EquipmentSlot } from "../../game/systems/Items.ts";

export interface InventoryRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** TEMPORARY: visually measured from inventory_skills.bmp; replace with native hit-test geometry. */
export const INVENTORY_EQUIPMENT_RECTS = Object.freeze({
    head: { left: 68, top: 308, width: 53, height: 53 },
    body: { left: 174, top: 314, width: 43, height: 43 },
    amulet: { left: 16, top: 370, width: 21, height: 21 },
    bracelet: { left: 249, top: 370, width: 22, height: 21 },
    ringLeft: { left: 16, top: 415, width: 29, height: 28 },
    ringRight: { left: 242, top: 415, width: 28, height: 28 },
    mainHand: { left: 20, top: 472, width: 51, height: 48 },
    offHand: { left: 215, top: 472, width: 51, height: 48 },
    arms: { left: 17, top: 548, width: 52, height: 53 },
    ammo: { left: 215, top: 548, width: 55, height: 52 },
} satisfies Readonly<Record<EquipmentSlot, InventoryRect>>);
