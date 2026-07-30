import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Game } from "../game/Game";
import type { GameRuntimeSnapshot } from "../game/GameStateRuntime.ts";
import type { HeroInventoryItemView } from "../game/ItemCatalogRuntime";
import { SDBParser, type SDBData } from "../game/parsers/SDBParser.ts";
import { HeroStatsBlock } from "./HeroStatsBlock.tsx";
import { InventoryBlock } from "./InventoryBlock.tsx";
import { OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import { ItemContainer } from "./ItemContainer.tsx";
import { ItemIcon } from "./ItemIcon.tsx";
import { StackQuantityDialog } from "./StackQuantityDialog.tsx";
import styles from "./ItemTransferPanel.module.scss";
import { MONEY_ITEM_ID, quoteTrade, type TradeOffer } from "../game/systems/Trade.ts";
import { INVENTORY_CHARACTER_NAME_DRAW, LOOT_EXCHANGE_BACKGROUND_RECT } from "../constants/clientDll.ts";
import type { PersonTradeCapabilities } from "../game/systems/Combat.ts";

interface ItemTransferPanelProps {
    readonly game: Game;
    readonly owner: string;
    readonly title: string;
    readonly mode: "loot" | "trade";
    readonly selectStackQuantity: boolean;
    readonly onClose: () => void;
}

const LOOT_STRIP_CAPACITY = 7;
const lootLastPageOffset = (itemCount: number): number => Math.floor(Math.max(0, itemCount - 1) / LOOT_STRIP_CAPACITY) * LOOT_STRIP_CAPACITY;
const TRADE_SERVICE_STRING_IDS: Readonly<Record<number, number>> = {
    43: 99,
    44: 101,
    45: 102,
    46: 100,
    47: 103,
};
const TRADE_SERVICE_CAPABILITY_BY_OBJECT_ID = {
    43: "repair",
    45: "identification",
    46: "charging",
    47: "takeOffCurse",
} as const satisfies Readonly<Record<number, keyof PersonTradeCapabilities>>;
let tradeStringsPromise: Promise<SDBData> | null = null;
const loadTradeStrings = (): Promise<SDBData> => {
    tradeStringsPromise ??= fetch("/assets/sdb/user_interface.sdb").then(async (response) => {
        if (!response.ok) throw new Error(`Trade captions failed: HTTP ${response.status}`);
        return new SDBParser(await response.arrayBuffer()).getData();
    });
    return tradeStringsPromise;
};


interface SelectedStack {
    readonly owner: string;
    readonly item: HeroInventoryItemView;
    readonly quantity: number;
}
type QuantityAction = "loot" | "trade-add" | "trade-remove";


interface ItemStripProps {
    readonly items: readonly HeroInventoryItemView[];
    readonly owner: string;
    readonly columns: number;
    readonly offset?: number;
    readonly offer?: TradeOffer;
    readonly subtractOffer?: boolean;
    readonly onActivate?: (stack: SelectedStack, amount: number) => void;
    readonly onDoubleActivate: (stack: SelectedStack, shiftKey: boolean) => void;
}

interface ItemButtonProps {
    readonly stack: SelectedStack;
    readonly onActivate?: (stack: SelectedStack, amount: number) => void;
    readonly onDoubleActivate: (stack: SelectedStack, shiftKey: boolean) => void;
}

const ItemButton = ({ stack, onActivate, onDoubleActivate }: ItemButtonProps) => {
    const clickTimer = useRef<number | null>(null);
    const cancelClick = (): void => {
        if (clickTimer.current === null) return;
        window.clearTimeout(clickTimer.current);
        clickTimer.current = null;
    };
    useEffect(() => cancelClick, []);
    const handleClick = (): void => {
        if (!onActivate) return;
        cancelClick();
        clickTimer.current = window.setTimeout(() => {
            clickTimer.current = null;
            onActivate(stack, 1);
        }, 250);
    };
    const handleDoubleClick = (event: MouseEvent<HTMLButtonElement>): void => {
        cancelClick();
        onDoubleActivate(stack, event.shiftKey);
    };
    return <button type="button" className={styles.itemButton}
        aria-label={`${stack.item.literaryName}, ${stack.quantity}`}
        onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <ItemIcon item={stack.item} quantity={stack.quantity} />
    </button>;
};

const ItemStrip = ({ items, owner, columns, offset = 0, offer, subtractOffer = false, onActivate, onDoubleActivate }: ItemStripProps) => {
    const visible = items
        .map((item) => ({
            item,
            quantity: offer
                ? subtractOffer
                    ? Math.max(0, item.quantity - (offer[item.stackKey] ?? 0))
                    : Math.min(item.quantity, offer[item.stackKey] ?? 0)
                : item.quantity,
        }))
        .filter((stack) => stack.quantity > 0)
        .slice(offset, offset + columns);
    return <ItemContainer className={styles.itemStrip} columns={columns} rows={1} ariaLabel="Предметы">
        {visible.map(({ item, quantity }) => <ItemButton key={item.stackKey} stack={{ owner, item, quantity }}
            onActivate={onActivate} onDoubleActivate={onDoubleActivate} />)}
    </ItemContainer>;
};

const changeOffer = (offer: TradeOffer, item: HeroInventoryItemView, delta: number): TradeOffer => {
    const quantity = Math.max(0, Math.min(item.quantity, (offer[item.stackKey] ?? 0) + delta));
    const next = { ...offer };
    if (quantity === 0) delete next[item.stackKey];
    else next[item.stackKey] = quantity;
    return next;
};

export const ItemTransferPanel = ({ game, owner, title, mode, selectStackQuantity, onClose }: ItemTransferPanelProps) => {
    const [heroItems, setHeroItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [otherItems, setOtherItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [selected, setSelected] = useState<SelectedStack | null>(null);
    const [quantityAction, setQuantityAction] = useState<QuantityAction>("loot");
    const [heroOffer, setHeroOffer] = useState<TradeOffer>({});
    const [otherOffer, setOtherOffer] = useState<TradeOffer>({});
    const [heroOffset, setHeroOffset] = useState(0);
    const [otherOffset, setOtherOffset] = useState(0);
    const [error, setError] = useState("");
    const [heroOfferOffset, setHeroOfferOffset] = useState(0);
    const [otherOfferOffset, setOtherOfferOffset] = useState(0);
    const [heroFilterId, setHeroFilterId] = useState<number | null>(9);
    const [otherFilterId, setOtherFilterId] = useState<number | null>(30);
    const [snapshot, setSnapshot] = useState<GameRuntimeSnapshot | null>(() => game.getRuntimeSnapshot());
    const initialParameters = useRef<Readonly<Record<string, number>> | null>(null);
    const [heroName, setHeroName] = useState("");
    const [interfaceStrings, setInterfaceStrings] = useState<SDBData>({});
    const [tradeCapabilities, setTradeCapabilities] = useState<PersonTradeCapabilities | null>(null);
    const tradeMultiplier = game.getTradePriceMultiplier();
    const tradeQuote = useMemo(
        () => quoteTrade(heroOffer, otherOffer, heroItems, otherItems, tradeMultiplier),
        [heroItems, heroOffer, otherItems, otherOffer, tradeMultiplier],
    );
    const heroMoney = heroItems.find((item) => item.technicalName.toLowerCase() === MONEY_ITEM_ID.toLowerCase())?.quantity ?? 0;
    const traderMoney = otherItems.find((item) => item.technicalName.toLowerCase() === MONEY_ITEM_ID.toLowerCase())?.quantity ?? 0;
    const tradeHeroItems = useMemo(() => heroItems.filter((item) => item.definition.itemClass !== "money"), [heroItems]);
    const tradeOtherItems = useMemo(() => otherItems.filter((item) => item.definition.itemClass !== "money"), [otherItems]);
    const heroAvailableCount = tradeHeroItems.filter((item) => item.quantity - (heroOffer[item.stackKey] ?? 0) > 0).length;
    const otherAvailableCount = tradeOtherItems.filter((item) => item.quantity - (otherOffer[item.stackKey] ?? 0) > 0).length;
    const heroMaximumOffset = Math.max(0, heroAvailableCount - 12);
    const otherMaximumOffset = Math.max(0, otherAvailableCount - 10);
    const heroOfferCount = tradeHeroItems.filter((item) => (heroOffer[item.stackKey] ?? 0) > 0).length;
    const otherOfferCount = tradeOtherItems.filter((item) => (otherOffer[item.stackKey] ?? 0) > 0).length;
    const heroOfferMaximumOffset = Math.max(0, heroOfferCount - 10);
    const otherOfferMaximumOffset = Math.max(0, otherOfferCount - 10);

    const refresh = useCallback(async () => {
        try {
            const [hero, other, nextHeroName, nextTradeCapabilities] = await Promise.all([
                game.getInventoryItems("Hero"),
                game.getInventoryItems(owner),
                game.getHeroName(),
                mode === "trade" ? game.getPersonTradeCapabilities(owner) : Promise.resolve(null),
            ]);
            const nextSnapshot = game.getRuntimeSnapshot();
            setHeroItems(hero);
            setOtherItems(other);
            setHeroName(nextHeroName);
            setTradeCapabilities(nextTradeCapabilities);
            setSnapshot(nextSnapshot);
            if (!initialParameters.current && nextSnapshot) {
                const parameters = Object.entries(nextSnapshot.personParameters)
                    .find(([name]) => name.toLowerCase() === "hero")?.[1] ?? {};
                initialParameters.current = Object.fromEntries(
                    Object.entries(parameters).map(([name, value]) => [name.toLowerCase(), value]),
                );
            }
            setError("");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }, [game, mode, owner]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
        if (mode !== "trade") return;
        let cancelled = false;
        void loadTradeStrings().then(
            (strings) => { if (!cancelled) setInterfaceStrings(strings); },
            (reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); },
        );
        return () => { cancelled = true; };
    }, [mode]);
    const heroParameters = Object.entries(snapshot?.personParameters ?? {})
        .find(([name]) => name.toLowerCase() === "hero")?.[1] ?? {};
    const normalizedHeroParameters = Object.fromEntries(
        Object.entries(heroParameters).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const tradeServiceLabels = Object.fromEntries(Object.entries(TRADE_SERVICE_STRING_IDS).flatMap(([objectId, stringId]) => {
        const caption = interfaceStrings[stringId];
        return caption ? [[Number(objectId), caption] as const] : [];
    }));
    const adjustProgression = async (parameter: string, direction: -1 | 1): Promise<void> => {
        const minimum = initialParameters.current?.[parameter] ?? normalizedHeroParameters[parameter] ?? 0;
        if (game.adjustHeroProgression(parameter, "characteristic", direction, minimum)) await refresh();
    };
    useEffect(() => { setHeroOffset((current) => Math.min(current, heroMaximumOffset)); }, [heroMaximumOffset]);
    useEffect(() => { setOtherOffset((current) => Math.min(current, otherMaximumOffset)); }, [otherMaximumOffset]);
    useEffect(() => { setHeroOfferOffset((current) => Math.min(current, heroOfferMaximumOffset)); }, [heroOfferMaximumOffset]);
    useEffect(() => { setOtherOfferOffset((current) => Math.min(current, otherOfferMaximumOffset)); }, [otherOfferMaximumOffset]);
    const disabledTradeServiceIds = Object.entries(TRADE_SERVICE_CAPABILITY_BY_OBJECT_ID).flatMap(([objectId, capability]) =>
        (tradeCapabilities?.[capability] ?? 0) > 0 ? [] : [Number(objectId)],
    );
    useEffect(() => {
        const close = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (selected) setSelected(null);
            else onClose();
        };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [onClose, selected]);


    const transfer = async (stack: SelectedStack, requested: number): Promise<void> => {
        const destination = stack.owner.toLowerCase() === "hero" ? owner : "Hero";
        const amount = Math.max(1, Math.min(stack.quantity, requested));
        if (!game.transferInventoryItem(stack.owner, destination, stack.item.stackKey, amount)) return;
        setSelected(null);
        await refresh();
    };

    const takeAll = async (): Promise<void> => {
        game.transferInventoryAll(owner, "Hero");
        setSelected(null);
        await refresh();
    };

    const exchange = async (): Promise<void> => {
        if (!game.exchangeTradeOffers(owner, heroOffer, otherOffer, tradeQuote.buyCost, tradeQuote.sellCredit)) {
            setError(tradeQuote.balance > 0
                ? `Недостаточно денег: требуется ${tradeQuote.balance}, имеется ${heroMoney}`
                : `У торговца недостаточно денег: требуется ${-tradeQuote.balance}, имеется ${traderMoney}`);
            return;
        }
        setHeroOffer({});
        setOtherOffer({});
        setError("");
        await refresh();
    };

    const openQuantityDialog = (stack: SelectedStack, action: QuantityAction): void => {
        setSelected(stack);
        setQuantityAction(action);
    };

    const activateLootStack = (stack: SelectedStack, shiftKey: boolean): void => {
        if (shiftKey || selectStackQuantity && stack.quantity > 1) openQuantityDialog(stack, "loot");
        else void transfer(stack, stack.quantity);
    };

    const selectTradeSource = (stack: SelectedStack, amount: number): void => {
        if (stack.owner.toLowerCase() === "hero") setHeroOffer((current) => changeOffer(current, stack.item, amount));
        else setOtherOffer((current) => changeOffer(current, stack.item, amount));
    };

    const removeTradeOffer = (stack: SelectedStack, amount: number): void => {
        if (stack.owner.toLowerCase() === "hero") setHeroOffer((current) => changeOffer(current, stack.item, -amount));
        else setOtherOffer((current) => changeOffer(current, stack.item, -amount));
    };

    const applySelectedQuantity = (requested: number): void => {
        if (!selected) return;
        if (quantityAction === "loot") {
            void transfer(selected, requested);
            return;
        }
        if (quantityAction === "trade-add") selectTradeSource(selected, requested);
        else removeTradeOffer(selected, requested);
        setSelected(null);
    };

    const stackDialog = selected && <StackQuantityDialog item={selected.item} maximum={selected.quantity}
        onConfirm={applySelectedQuantity} onCancel={() => setSelected(null)} />;

    if (mode === "loot") {
        return (
            <section className={`${styles.panel} ${styles.lootPanel}`} role="dialog" aria-label={`Содержимое: ${title}`}
                data-item-tooltip-root>
                <img className={styles.lootBackground} style={LOOT_EXCHANGE_BACKGROUND_RECT}
                    src="/assets/engineres/gpanel/exchange.bmp" alt="" draggable={false} />
                <OriginalGuiLayer className={styles.authoredControls} script="gpanel_new"
                    objectIds={[9, 10, 11, 12, 20, 21, 22, 23]}
                    objectContents={{
                        22: <ItemStrip items={otherItems} owner={owner} columns={LOOT_STRIP_CAPACITY}
                            offset={otherOffset} onDoubleActivate={activateLootStack} />,
                        23: <ItemStrip items={heroItems} owner="Hero" columns={LOOT_STRIP_CAPACITY}
                            offset={heroOffset} onDoubleActivate={activateLootStack} />,
                    }}
                    onAction={(object) => {
                        if (object.id === 9) setOtherOffset(Math.max(0, otherOffset - LOOT_STRIP_CAPACITY));
                        if (object.id === 10) setOtherOffset(Math.min(lootLastPageOffset(otherItems.length), otherOffset + LOOT_STRIP_CAPACITY));
                        if (object.id === 11) setHeroOffset(Math.max(0, heroOffset - LOOT_STRIP_CAPACITY));
                        if (object.id === 12) setHeroOffset(Math.min(lootLastPageOffset(heroItems.length), heroOffset + LOOT_STRIP_CAPACITY));
                        if (object.id === 20) void takeAll();
                        if (object.id === 21) onClose();
                    }} />
                {stackDialog}
                {error && <output className={styles.error}>{error}</output>}
            </section>
        );
    }

    return (
        <section className={`${styles.panel} ${styles.tradePanel}`} role="dialog" aria-label={`Торговля: ${title}`}
            data-item-tooltip-root>
            <img className={styles.background} src="/assets/engineres/trade/trade.bmp" alt="" draggable={false} />
            <div className={styles.heroName} style={{
                left: INVENTORY_CHARACTER_NAME_DRAW.x,
                top: INVENTORY_CHARACTER_NAME_DRAW.y,
                width: INVENTORY_CHARACTER_NAME_DRAW.boxWidth,
                height: INVENTORY_CHARACTER_NAME_DRAW.boxHeight,
            }}>{heroName}</div>
            <OriginalGuiLayer className={styles.authoredControls} script="trade"
                objectIds={[2, 7, 43, 44, 45, 46, 47, 84, 85, 98, 99, 101, 102, 103]}
                labels={tradeServiceLabels}
                values={tradeServiceLabels}
                disabledObjectIds={disabledTradeServiceIds}
                objectContents={{
                    101: <output className={styles.tradeValue} aria-label="Деньги торговца">{traderMoney}</output>,
                    102: <output className={styles.tradeValue} aria-label="Баланс сделки">{tradeQuote.balance}</output>,
                    103: <output className={styles.tradeValue} aria-label="Деньги героя">{heroMoney}</output>,
                }}
                onAction={(object) => {
                    if (object.id === 44) void exchange();
                    if (object.id === 7) onClose();
                }} />

            <HeroStatsBlock script="trade" parameters={normalizedHeroParameters} strings={interfaceStrings}
                extraObjectIds={Array.from({ length: 8 }, (_, index) => 90 + index)}
                onAdjust={(parameter, direction) => void adjustProgression(parameter, direction)} />

            <InventoryBlock script="trade" containerObjectId={1} previousObjectId={3} nextObjectId={4}
                dropObjectId={8} filterObjectIds={Array.from({ length: 7 }, (_, index) => 9 + index)}
                activeFilterId={heroFilterId} canGoPrevious={heroOffset > 0}
                canGoNext={heroOffset < heroMaximumOffset} canDrop={false}
                onPrevious={() => setHeroOffset((current) => Math.max(0, current - 12))}
                onNext={() => setHeroOffset((current) => Math.min(heroMaximumOffset, current + 12))}
                onFilterChange={(objectId) => { setHeroFilterId(objectId); setHeroOffset(0); }}
                content={<ItemStrip items={tradeHeroItems} owner="Hero" columns={12} offset={heroOffset}
                    offer={heroOffer} subtractOffer onActivate={selectTradeSource}
                    onDoubleActivate={(stack, shiftKey) => shiftKey || selectStackQuantity && stack.quantity > 1 ? openQuantityDialog(stack, "trade-add") : selectTradeSource(stack, stack.quantity)} />} />

            <InventoryBlock script="trade" containerObjectId={48} previousObjectId={37} nextObjectId={38}
                filterObjectIds={Array.from({ length: 7 }, (_, index) => 30 + index)} activeFilterId={otherFilterId}
                canGoPrevious={otherOffset > 0} canGoNext={otherOffset < otherMaximumOffset}
                onPrevious={() => setOtherOffset((current) => Math.max(0, current - 10))}
                onNext={() => setOtherOffset((current) => Math.min(otherMaximumOffset, current + 10))}
                onFilterChange={(objectId) => { setOtherFilterId(objectId); setOtherOffset(0); }}
                content={<ItemStrip items={tradeOtherItems} owner={owner} columns={10} offset={otherOffset}
                    offer={otherOffer} subtractOffer onActivate={selectTradeSource}
                    onDoubleActivate={(stack, shiftKey) => shiftKey || selectStackQuantity && stack.quantity > 1 ? openQuantityDialog(stack, "trade-add") : selectTradeSource(stack, stack.quantity)} />} />

            <InventoryBlock script="trade" containerObjectId={49} previousObjectId={39} nextObjectId={40}
                canGoPrevious={otherOfferOffset > 0} canGoNext={otherOfferOffset < otherOfferMaximumOffset}
                onPrevious={() => setOtherOfferOffset((current) => Math.max(0, current - 10))}
                onNext={() => setOtherOfferOffset((current) => Math.min(otherOfferMaximumOffset, current + 10))}
                content={<ItemStrip items={tradeOtherItems} owner={owner} columns={10} offer={otherOffer} offset={otherOfferOffset}
                    onActivate={removeTradeOffer}
                    onDoubleActivate={(stack, shiftKey) => shiftKey || selectStackQuantity && stack.quantity > 1 ? openQuantityDialog(stack, "trade-remove") : removeTradeOffer(stack, stack.quantity)} />} />

            <InventoryBlock script="trade" containerObjectId={50} previousObjectId={41} nextObjectId={42}
                canGoPrevious={heroOfferOffset > 0} canGoNext={heroOfferOffset < heroOfferMaximumOffset}
                onPrevious={() => setHeroOfferOffset((current) => Math.max(0, current - 10))}
                onNext={() => setHeroOfferOffset((current) => Math.min(heroOfferMaximumOffset, current + 10))}
                content={<ItemStrip items={tradeHeroItems} owner="Hero" columns={10} offer={heroOffer} offset={heroOfferOffset}
                    onActivate={removeTradeOffer}
                    onDoubleActivate={(stack, shiftKey) => shiftKey || selectStackQuantity && stack.quantity > 1 ? openQuantityDialog(stack, "trade-remove") : removeTradeOffer(stack, stack.quantity)} />} />
            {stackDialog}
            {error && <output className={styles.error}>{error}</output>}
        </section>
    );
};
