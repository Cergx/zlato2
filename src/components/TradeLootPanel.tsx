import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Game } from "../game/Game";
import type { HeroInventoryItemView } from "../game/ItemCatalogRuntime";
import { SDBParser } from "../game/parsers/SDBParser.ts";
import { OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import { ItemContainer } from "./ItemContainer.tsx";
import { ItemIcon } from "./ItemIcon.tsx";
import { StackQuantityDialog } from "./StackQuantityDialog.tsx";
import styles from "./ItemTransferPanel.module.scss";
import { MONEY_ITEM_ID, quoteTrade, type TradeOffer } from "../game/systems/Trade.ts";
import { INVENTORY_CHARACTER_NAME_DRAW, LOOT_EXCHANGE_BACKGROUND_RECT } from "../constants/clientDll.ts";

interface ItemTransferPanelProps {
    readonly game: Game;
    readonly owner: string;
    readonly title: string;
    readonly mode: "loot" | "trade";
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
let tradeServiceLabelsPromise: Promise<Readonly<Record<number, string>>> | null = null;
const loadTradeServiceLabels = (): Promise<Readonly<Record<number, string>>> => {
    tradeServiceLabelsPromise ??= fetch("/assets/sdb/user_interface.sdb").then(async (response) => {
        if (!response.ok) throw new Error(`Trade captions failed: HTTP ${response.status}`);
        const strings = new SDBParser(await response.arrayBuffer()).getData();
        return Object.fromEntries(Object.entries(TRADE_SERVICE_STRING_IDS).map(([objectId, stringId]) => {
            const caption = strings[stringId];
            if (!caption) throw new Error(`Trade caption ${stringId} is missing`);
            return [Number(objectId), caption];
        }));
    });
    return tradeServiceLabelsPromise;
};


interface SelectedStack {
    readonly owner: string;
    readonly item: HeroInventoryItemView;
}
type QuantityAction = "loot" | "trade-add" | "trade-remove";


interface ItemStripProps {
    readonly items: readonly HeroInventoryItemView[];
    readonly owner: string;
    readonly columns: number;
    readonly offset?: number;
    readonly offer?: TradeOffer;
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
        aria-label={`${stack.item.literaryName}, ${stack.item.quantity}`}
        onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <ItemIcon item={stack.item} quantity={stack.item.quantity} />
    </button>;
};

const ItemStrip = ({ items, owner, columns, offset = 0, offer, onActivate, onDoubleActivate }: ItemStripProps) => {
    const visible = items
        .map((item) => offer ? { ...item, quantity: offer[item.stackKey] ?? 0 } : item)
        .filter((item) => item.quantity > 0)
        .slice(offset, offset + columns);
    return <ItemContainer className={styles.itemStrip} columns={columns} rows={1} ariaLabel="Предметы">
        {visible.map((item) => <ItemButton key={item.stackKey} stack={{ owner, item }}
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

export const ItemTransferPanel = ({ game, owner, title, mode, onClose }: ItemTransferPanelProps) => {
    const [heroItems, setHeroItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [otherItems, setOtherItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [selected, setSelected] = useState<SelectedStack | null>(null);
    const [quantityAction, setQuantityAction] = useState<QuantityAction>("loot");
    const [heroOffer, setHeroOffer] = useState<TradeOffer>({});
    const [otherOffer, setOtherOffer] = useState<TradeOffer>({});
    const [heroOffset, setHeroOffset] = useState(0);
    const [otherOffset, setOtherOffset] = useState(0);
    const [error, setError] = useState("");
    const [heroName, setHeroName] = useState("");
    const [tradeServiceLabels, setTradeServiceLabels] = useState<Readonly<Record<number, string>>>({});
    const tradeMultiplier = game.getTradePriceMultiplier();
    const tradeQuote = useMemo(
        () => quoteTrade(heroOffer, otherOffer, heroItems, otherItems, tradeMultiplier),
        [heroItems, heroOffer, otherItems, otherOffer, tradeMultiplier],
    );
    const heroMoney = heroItems.find((item) => item.technicalName.toLowerCase() === MONEY_ITEM_ID.toLowerCase())?.quantity ?? 0;
    const traderMoney = otherItems.find((item) => item.technicalName.toLowerCase() === MONEY_ITEM_ID.toLowerCase())?.quantity ?? 0;
    const tradeHeroItems = useMemo(() => heroItems.filter((item) => item.definition.itemClass !== "money"), [heroItems]);
    const tradeOtherItems = useMemo(() => otherItems.filter((item) => item.definition.itemClass !== "money"), [otherItems]);

    const refresh = useCallback(async () => {
        try {
            const [hero, other, nextHeroName] = await Promise.all([
                game.getInventoryItems("Hero"),
                game.getInventoryItems(owner),
                game.getHeroName(),
            ]);
            setHeroItems(hero);
            setOtherItems(other);
            setHeroName(nextHeroName);
            setError("");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }, [game, owner]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
        if (mode !== "trade") return;
        let cancelled = false;
        void loadTradeServiceLabels().then(
            (labels) => { if (!cancelled) setTradeServiceLabels(labels); },
            (reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); },
        );
        return () => { cancelled = true; };
    }, [mode]);
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
        const amount = Math.max(1, Math.min(stack.item.quantity, requested));
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
        if (shiftKey) openQuantityDialog(stack, "loot");
        else void transfer(stack, stack.item.quantity);
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

    const stackDialog = selected && <StackQuantityDialog item={selected.item} maximum={selected.item.quantity}
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
                labels={tradeServiceLabels}
                values={tradeServiceLabels}
                objectContents={{
                    101: <output className={styles.tradeValue} aria-label="Деньги торговца">{traderMoney}</output>,
                    102: <output className={styles.tradeValue} aria-label="Баланс сделки">{tradeQuote.balance}</output>,
                    103: <output className={styles.tradeValue} aria-label="Деньги героя">{heroMoney}</output>,
                    1: <ItemStrip items={tradeHeroItems} owner="Hero" columns={12} offset={heroOffset}
                        onActivate={selectTradeSource}
                        onDoubleActivate={(stack, shiftKey) => shiftKey ? openQuantityDialog(stack, "trade-add") : selectTradeSource(stack, stack.item.quantity)} />,
                    48: <ItemStrip items={tradeOtherItems} owner={owner} columns={10} offset={otherOffset}
                        onActivate={selectTradeSource}
                        onDoubleActivate={(stack, shiftKey) => shiftKey ? openQuantityDialog(stack, "trade-add") : selectTradeSource(stack, stack.item.quantity)} />,
                    50: <ItemStrip items={tradeHeroItems} owner="Hero" columns={10} offer={heroOffer}
                        onActivate={removeTradeOffer}
                        onDoubleActivate={(stack, shiftKey) => shiftKey ? openQuantityDialog(stack, "trade-remove") : removeTradeOffer(stack, stack.item.quantity)} />,
                    49: <ItemStrip items={tradeOtherItems} owner={owner} columns={10} offer={otherOffer}
                        onActivate={removeTradeOffer}
                        onDoubleActivate={(stack, shiftKey) => shiftKey ? openQuantityDialog(stack, "trade-remove") : removeTradeOffer(stack, stack.item.quantity)} />,
                }}
                onAction={(object) => {
                    if (object.id === 3) setHeroOffset(Math.max(0, heroOffset - 12));
                    if (object.id === 4) setHeroOffset(Math.min(Math.max(0, tradeHeroItems.length - 12), heroOffset + 12));
                    if (object.id === 41) setOtherOffset(Math.max(0, otherOffset - 10));
                    if (object.id === 42) setOtherOffset(Math.min(Math.max(0, tradeOtherItems.length - 10), otherOffset + 10));
                    if (object.id === 44) void exchange();
                    if (object.id === 7) onClose();
                }} />
            {stackDialog}
            {error && <output className={styles.error}>{error}</output>}
        </section>
    );
};
