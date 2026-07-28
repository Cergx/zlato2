import {
    createItemInstance,
    itemInstancesCanStack,
    type EquipmentSlot,
    type ItemDefinition,
    type ItemInstance,
} from "./Items.ts";

export interface InventoryCatalog {
    get(id: string): ItemDefinition;
}

export interface InventoryOptions {
    /** Maximum number of occupied bag stacks. Equipped items do not consume bag capacity. */
    readonly capacity: number;
    readonly equipmentSlots?: readonly EquipmentSlot[];
}

export interface InventoryStack {
    readonly item: ItemInstance;
    readonly quantity: number;
}

export interface InventorySnapshot {
    readonly capacity: number;
    readonly revision: number;
    readonly stacks: readonly InventoryStack[];
    readonly equipped: Readonly<Partial<Record<EquipmentSlot, InventoryStack>>>;
}

type InventoryOperation =
    | { readonly kind: "add"; readonly inventory: Inventory; readonly item: ItemInstance; readonly quantity: number }
    | { readonly kind: "remove"; readonly inventory: Inventory; readonly item: ItemInstance; readonly quantity: number }
    | {
        readonly kind: "transfer";
        readonly source: Inventory;
        readonly target: Inventory;
        readonly item: ItemInstance;
        readonly quantity: number;
    }
    | { readonly kind: "equip"; readonly inventory: Inventory; readonly item: ItemInstance; readonly quantity: number; readonly slot: EquipmentSlot }
    | { readonly kind: "unequip"; readonly inventory: Inventory; readonly slot: EquipmentSlot };

interface MutableStack {
    item: ItemInstance;
    quantity: number;
}

interface InventoryDraft {
    stacks: MutableStack[];
    equipped: Partial<Record<EquipmentSlot, MutableStack>>;
}

const ALL_EQUIPMENT_SLOTS: Readonly<Record<EquipmentSlot, true>> = {
    mainHand: true,
    offHand: true,
    ammo: true,
    head: true,
    body: true,
    arms: true,
    bracelet: true,
    amulet: true,
    ringLeft: true,
    ringRight: true,
};

const DEFAULT_EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
    "mainHand",
    "offHand",
    "ammo",
    "head",
    "body",
    "arms",
    "bracelet",
    "amulet",
    "ringLeft",
    "ringRight",
];

export class Inventory {
    private readonly capacity: number;
    private readonly equipmentSlots: readonly EquipmentSlot[];
    private readonly catalog: InventoryCatalog;
    private stacks: MutableStack[] = [];
    private equipped: Partial<Record<EquipmentSlot, MutableStack>> = {};
    private revision = 0;

    constructor(catalog: InventoryCatalog, options: InventoryOptions) {
        if (!Number.isSafeInteger(options.capacity) || options.capacity < 0) {
            throw new Error("Inventory capacity must be a non-negative safe integer");
        }
        this.capacity = options.capacity;
        this.catalog = catalog;
        this.equipmentSlots = options.equipmentSlots ?? DEFAULT_EQUIPMENT_SLOTS;
        const encountered: Partial<Record<EquipmentSlot, true>> = {};
        for (const slot of this.equipmentSlots) {
            if (!ALL_EQUIPMENT_SLOTS[slot]) throw new Error(`Unknown equipment slot ${String(slot)}`);
            if (encountered[slot]) throw new Error(`Inventory repeats equipment slot ${slot}`);
            encountered[slot] = true;
        }
    }

    get count(): number {
        let count = 0;
        for (const stack of this.stacks) count += stack.quantity;
        return count;
    }

    get usedCapacity(): number {
        return this.stacks.length;
    }

    get remainingCapacity(): number {
        return this.capacity - this.stacks.length;
    }

    snapshot(): InventorySnapshot {
        const equipped: Partial<Record<EquipmentSlot, InventoryStack>> = {};
        for (const slot of this.equipmentSlots) {
            const stack = this.equipped[slot];
            if (stack) equipped[slot] = { item: stack.item, quantity: stack.quantity };
        }
        return {
            capacity: this.capacity,
            revision: this.revision,
            stacks: this.stacks.map(({ item, quantity }) => ({ item, quantity })),
            equipped,
        };
    }

    restore(
        stacks: readonly InventoryStack[],
        equipped: Readonly<Partial<Record<EquipmentSlot, InventoryStack>>> = {},
    ): void {
        if (stacks.length > this.capacity) throw new Error(`Inventory capacity ${this.capacity} cannot hold ${stacks.length} stacks`);
        const restoredStacks = stacks.map(({ item, quantity }) => {
            validateItemInstance(item);
            assertPositiveQuantity(quantity);
            return { item: createItemInstance(item.definitionId, item), quantity };
        });
        const restoredEquipped: Partial<Record<EquipmentSlot, MutableStack>> = {};
        for (const [rawSlot, stack] of Object.entries(equipped)) {
            const slot = rawSlot as EquipmentSlot;
            this.assertKnownSlot(slot);
            if (!stack) continue;
            validateItemInstance(stack.item);
            assertPositiveQuantity(stack.quantity);
            restoredEquipped[slot] = {
                item: createItemInstance(stack.item.definitionId, stack.item),
                quantity: stack.quantity,
            };
        }
        this.stacks = restoredStacks;
        this.equipped = restoredEquipped;
        this.revision += 1;
    }

    countItem(definitionId: string): number {
        let count = 0;
        for (const stack of this.stacks) {
            if (stack.item.definitionId === definitionId) count += stack.quantity;
        }
        return count;
    }

    getEquipped(slot: EquipmentSlot): InventoryStack | undefined {
        this.assertKnownSlot(slot);
        const stack = this.equipped[slot];
        return stack ? { item: stack.item, quantity: stack.quantity } : undefined;
    }

    add(item: ItemInstance, quantity = 1): void {
        new InventoryTransaction().add(this, item, quantity).commit();
    }

    remove(item: ItemInstance, quantity = 1): void {
        new InventoryTransaction().remove(this, item, quantity).commit();
    }

    transferTo(target: Inventory, item: ItemInstance, quantity = 1): void {
        new InventoryTransaction().transfer(this, target, item, quantity).commit();
    }

    equip(item: ItemInstance, slot: EquipmentSlot, quantity = 1): void {
        new InventoryTransaction().equip(this, item, slot, quantity).commit();
    }

    unequip(slot: EquipmentSlot): void {
        new InventoryTransaction().unequip(this, slot).commit();
    }

    consumeEquipped(slot: EquipmentSlot, quantity = 1): void {
        this.assertKnownSlot(slot);
        assertPositiveQuantity(quantity);
        const stack = this.equipped[slot];
        if (!stack || stack.quantity < quantity) {
            throw new Error(`Equipment slot ${slot} does not contain ${quantity} items`);
        }
        stack.quantity -= quantity;
        if (stack.quantity === 0) delete this.equipped[slot];
        this.revision += 1;
    }

    damageEquipped(slot: EquipmentSlot, amount = 1): number | undefined {
        this.assertKnownSlot(slot);
        assertPositiveQuantity(amount);
        const stack = this.equipped[slot];
        if (!stack) return undefined;
        const durability = (stack.item.durability ?? 100) - amount;
        if (durability > 0) {
            stack.item = createItemInstance(stack.item.definitionId, { ...stack.item, durability });
            this.revision += 1;
            return durability;
        }
        if (stack.quantity > 1) {
            stack.quantity -= 1;
            stack.item = createItemInstance(stack.item.definitionId, { ...stack.item, durability: 100 });
            this.revision += 1;
            return 100;
        }
        delete this.equipped[slot];
        this.revision += 1;
        return 0;
    }

    private assertKnownSlot(slot: EquipmentSlot): void {
        if (!this.equipmentSlots.includes(slot)) throw new Error(`Inventory does not support equipment slot ${slot}`);
    }

    static commit(operations: readonly InventoryOperation[]): void {
        const drafts = new Map<Inventory, InventoryDraft>();
        const draftFor = (inventory: Inventory): InventoryDraft => {
            let draft = drafts.get(inventory);
            if (!draft) {
                draft = {
                    stacks: inventory.stacks.map(({ item, quantity }) => ({ item, quantity })),
                    equipped: { ...inventory.equipped },
                };
                drafts.set(inventory, draft);
            }
            return draft;
        };

        for (const operation of operations) {
            switch (operation.kind) {
                case "add":
                    Inventory.addToDraft(operation.inventory, draftFor(operation.inventory), operation.item, operation.quantity);
                    break;
                case "remove":
                    Inventory.removeFromDraft(operation.inventory, draftFor(operation.inventory), operation.item, operation.quantity);
                    break;
                case "transfer":
                    if (operation.source === operation.target) throw new Error("Cannot transfer items to the same inventory");
                    Inventory.removeFromDraft(operation.source, draftFor(operation.source), operation.item, operation.quantity);
                    Inventory.addToDraft(operation.target, draftFor(operation.target), operation.item, operation.quantity);
                    break;
                case "equip":
                    Inventory.equipInDraft(operation.inventory, draftFor(operation.inventory), operation.item, operation.slot, operation.quantity);
                    break;
                case "unequip":
                    Inventory.unequipInDraft(operation.inventory, draftFor(operation.inventory), operation.slot);
                    break;
            }
        }

        for (const [inventory, draft] of drafts) {
            inventory.stacks = draft.stacks;
            inventory.equipped = draft.equipped;
            inventory.revision += 1;
        }
    }

    private static addToDraft(inventory: Inventory, draft: InventoryDraft, item: ItemInstance, quantity: number): void {
        assertPositiveQuantity(quantity);
        const definition = inventory.catalog.get(item.definitionId);
        validateItemInstance(item);
        let remaining = quantity;
        for (const stack of draft.stacks) {
            if (!itemInstancesCanStack(stack.item, item)) continue;
            const space = definition.maxStack - stack.quantity;
            if (space <= 0) continue;
            const added = Math.min(space, remaining);
            stack.quantity += added;
            remaining -= added;
            if (remaining === 0) return;
        }
        while (remaining > 0) {
            if (draft.stacks.length >= inventory.capacity) {
                throw new Error(`Inventory capacity ${inventory.capacity} cannot hold ${quantity} of ${item.definitionId}`);
            }
            const added = Math.min(definition.maxStack, remaining);
            draft.stacks.push({ item, quantity: added });
            remaining -= added;
        }
    }

    private static removeFromDraft(inventory: Inventory, draft: InventoryDraft, item: ItemInstance, quantity: number): void {
        assertPositiveQuantity(quantity);
        inventory.catalog.get(item.definitionId);
        validateItemInstance(item);
        let remaining = quantity;
        for (let index = draft.stacks.length - 1; index >= 0 && remaining > 0; index -= 1) {
            const stack = draft.stacks[index];
            if (!itemInstancesCanStack(stack.item, item)) continue;
            const removed = Math.min(stack.quantity, remaining);
            stack.quantity -= removed;
            remaining -= removed;
            if (stack.quantity === 0) draft.stacks.splice(index, 1);
        }
        if (remaining > 0) {
            throw new Error(`Inventory contains only ${quantity - remaining} of ${item.definitionId}; cannot remove ${quantity}`);
        }
    }

    private static equipInDraft(
        inventory: Inventory,
        draft: InventoryDraft,
        item: ItemInstance,
        slot: EquipmentSlot,
        quantity: number,
    ): void {
        inventory.assertKnownSlot(slot);
        assertPositiveQuantity(quantity);
        const definition = inventory.catalog.get(item.definitionId);
        if (!definition.equipSlots?.includes(slot)) {
            throw new Error(`Item ${item.definitionId} cannot be equipped in ${slot}`);
        }
        const equippedStack = draft.equipped[slot];
        if (equippedStack && equippedStack.item.id === item.id
            && itemInstancesCanStack(equippedStack.item, item) && equippedStack.quantity === quantity) return;

        Inventory.removeFromDraft(inventory, draft, item, quantity);
        if (equippedStack) Inventory.addToDraft(inventory, draft, equippedStack.item, equippedStack.quantity);
        draft.equipped[slot] = { item: createItemInstance(item.definitionId, item), quantity };
    }

    private static unequipInDraft(inventory: Inventory, draft: InventoryDraft, slot: EquipmentSlot): void {
        inventory.assertKnownSlot(slot);
        const stack = draft.equipped[slot];
        if (!stack) throw new Error(`No item is equipped in ${slot}`);
        Inventory.addToDraft(inventory, draft, stack.item, stack.quantity);
        delete draft.equipped[slot];
    }
}

export class InventoryTransaction {
    private readonly operations: InventoryOperation[] = [];
    private closed = false;

    add(inventory: Inventory, item: ItemInstance, quantity = 1): this {
        this.assertOpen();
        assertPositiveQuantity(quantity);
        this.operations.push({ kind: "add", inventory, item, quantity });
        return this;
    }

    remove(inventory: Inventory, item: ItemInstance, quantity = 1): this {
        this.assertOpen();
        assertPositiveQuantity(quantity);
        this.operations.push({ kind: "remove", inventory, item, quantity });
        return this;
    }

    transfer(source: Inventory, target: Inventory, item: ItemInstance, quantity = 1): this {
        this.assertOpen();
        assertPositiveQuantity(quantity);
        this.operations.push({ kind: "transfer", source, target, item, quantity });
        return this;
    }

    equip(inventory: Inventory, item: ItemInstance, slot: EquipmentSlot, quantity = 1): this {
        this.assertOpen();
        assertPositiveQuantity(quantity);
        this.operations.push({ kind: "equip", inventory, item, quantity, slot });
        return this;
    }

    unequip(inventory: Inventory, slot: EquipmentSlot): this {
        this.assertOpen();
        this.operations.push({ kind: "unequip", inventory, slot });
        return this;
    }

    commit(): void {
        this.assertOpen();
        this.closed = true;
        Inventory.commit(this.operations);
    }

    private assertOpen(): void {
        if (this.closed) throw new Error("Inventory transaction is already closed");
    }
}

function assertPositiveQuantity(quantity: number): void {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error("Inventory quantity must be a positive safe integer");
    }
}

function validateItemInstance(item: ItemInstance): void {
    if (item.id.trim() === "") throw new Error("Item instance id must not be empty");
    if (item.definitionId.trim() === "") throw new Error("Item definition id must not be empty");
    if (item.durability !== undefined && (!Number.isSafeInteger(item.durability) || item.durability < 0)) {
        throw new Error("Item durability must be a non-negative safe integer");
    }
    if (item.charges !== undefined && (!Number.isSafeInteger(item.charges) || item.charges < 0)) {
        throw new Error("Item charges must be a non-negative safe integer");
    }
}
