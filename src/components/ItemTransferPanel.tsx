import { useCallback, useEffect, useState } from "react";
import type { Game } from "../game/Game";
import type { HeroInventoryItemView } from "../game/ItemCatalogRuntime";
import { loadImage } from "../game/Assets";
import { guiObjectStyle, OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import { loadGuiDefinition, type GuiDefinition, type GuiObjectDefinition } from "../game/GuiDefinitionRuntime.ts";
import { ColorKeyImage } from "./ColorKeyImage.tsx";
import styles from "./ItemTransferPanel.module.scss";

interface ItemTransferPanelProps {
    readonly game: Game;
    readonly owner: string;
    readonly title: string;
    readonly mode: "loot" | "trade";
    readonly onClose: () => void;
}


interface SelectedStack {
    readonly owner: string;
    readonly item: HeroInventoryItemView;
}

type TradeOffer = Readonly<Record<string, number>>;


const ItemIcon = ({ item }: { readonly item: HeroInventoryItemView }) => {
    const [source, setSource] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!item.iconUrl) return;
        void loadImage(item.iconUrl).then((image) => {
            if (cancelled) return;
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) return;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            for (let index = 0; index < pixels.data.length; index += 4) {
                if (pixels.data[index] >= 250 && pixels.data[index + 1] <= 5 && pixels.data[index + 2] >= 250) pixels.data[index + 3] = 0;
            }
            context.putImageData(pixels, 0, 0);
            setSource(canvas.toDataURL("image/png"));
        });
        return () => { cancelled = true; };
    }, [item.iconUrl]);
    return source ? <img src={source} alt="" draggable={false} /> : <span>{item.literaryName.slice(0, 1)}</span>;
};

interface ItemStripProps {
    readonly items: readonly HeroInventoryItemView[];
    readonly owner: string;
    readonly container?: GuiObjectDefinition;
    readonly columns: number;
    readonly offset?: number;
    readonly offer?: TradeOffer;
    readonly onActivate: (stack: SelectedStack, amount: number) => void;
}

const ItemStrip = ({ items, owner, container, columns, offset = 0, offer, onActivate }: ItemStripProps) => {
    const visible = items
        .map((item) => offer ? { ...item, quantity: offer[item.technicalName] ?? 0 } : item)
        .filter((item) => item.quantity > 0)
        .slice(offset, offset + columns);
    if (!container) return null;
    return (
        <div className={styles.itemStrip} style={{ ...guiObjectStyle(container), gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {visible.map((item) => (
                <button key={item.technicalName} type="button" aria-label={`${item.literaryName}, ${item.quantity}`}
                    onClick={() => onActivate({ owner, item }, 1)}
                    onDoubleClick={() => onActivate({ owner, item }, item.quantity)}>
                    <ItemIcon item={item} />
                    {item.quantity > 1 && <strong>{item.quantity}</strong>}
                    <span className={styles.tooltip}><b>{item.literaryName}</b>{item.description}</span>
                </button>
            ))}
        </div>
    );
};

const changeOffer = (offer: TradeOffer, item: HeroInventoryItemView, delta: number): TradeOffer => {
    const quantity = Math.max(0, Math.min(item.quantity, (offer[item.technicalName] ?? 0) + delta));
    const next = { ...offer };
    if (quantity === 0) delete next[item.technicalName];
    else next[item.technicalName] = quantity;
    return next;
};

export const ItemTransferPanel = ({ game, owner, title, mode, onClose }: ItemTransferPanelProps) => {
    const [heroItems, setHeroItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [otherItems, setOtherItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [selected, setSelected] = useState<SelectedStack | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [heroOffer, setHeroOffer] = useState<TradeOffer>({});
    const [otherOffer, setOtherOffer] = useState<TradeOffer>({});
    const [heroOffset, setHeroOffset] = useState(0);
    const [otherOffset, setOtherOffset] = useState(0);
    const [error, setError] = useState("");
    const [definition, setDefinition] = useState<GuiDefinition | null>(null);
    const [stackDefinition, setStackDefinition] = useState<GuiDefinition | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [hero, other] = await Promise.all([game.getInventoryItems("Hero"), game.getInventoryItems(owner)]);
            setHeroItems(hero);
            setOtherItems(other);
            setError("");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }, [game, owner]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
        let cancelled = false;
        const script = mode === "trade" ? "trade" : "gpanel_new";
        void loadGuiDefinition(script).then(
            (loaded) => { if (!cancelled) setDefinition(loaded); },
            (caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); },
        );
        return () => { cancelled = true; };
    }, [mode]);
    useEffect(() => {
        let cancelled = false;
        void loadGuiDefinition("stacks_gui").then(
            (loaded) => { if (!cancelled) setStackDefinition(loaded); },
            (caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); },
        );
        return () => { cancelled = true; };
    }, []);
    useEffect(() => {
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [onClose]);

    const guiObject = (id: number): GuiObjectDefinition | undefined => definition?.objects.find((object) => object.id === id);
    const stackGuiObject = (id: number): GuiObjectDefinition | undefined => stackDefinition?.objects.find((object) => object.id === id);

    const transfer = async (stack: SelectedStack, requested = quantity): Promise<void> => {
        const destination = stack.owner.toLowerCase() === "hero" ? owner : "Hero";
        const amount = Math.max(1, Math.min(stack.item.quantity, requested));
        if (!game.transferInventoryItem(stack.owner, destination, stack.item.technicalName, amount)) return;
        setSelected(null);
        setQuantity(1);
        await refresh();
    };

    const takeAll = async (): Promise<void> => {
        game.transferInventoryAll(owner, "Hero");
        setSelected(null);
        await refresh();
    };

    const exchange = async (): Promise<void> => {
        for (const [technicalName, amount] of Object.entries(heroOffer)) game.transferInventoryItem("Hero", owner, technicalName, amount);
        for (const [technicalName, amount] of Object.entries(otherOffer)) game.transferInventoryItem(owner, "Hero", technicalName, amount);
        setHeroOffer({});
        setOtherOffer({});
        await refresh();
    };

    const selectLootStack = (stack: SelectedStack, amount: number): void => {
        setSelected(stack);
        setQuantity(Math.max(1, Math.min(stack.item.quantity, amount)));
    };

    const selectTradeSource = (stack: SelectedStack, amount: number): void => {
        if (stack.owner.toLowerCase() === "hero") setHeroOffer((current) => changeOffer(current, stack.item, amount));
        else setOtherOffer((current) => changeOffer(current, stack.item, amount));
    };

    const removeTradeOffer = (stack: SelectedStack, amount: number): void => {
        if (stack.owner.toLowerCase() === "hero") setHeroOffer((current) => changeOffer(current, stack.item, -amount));
        else setOtherOffer((current) => changeOffer(current, stack.item, -amount));
    };

    if (mode === "loot") {
        return (
            <section className={`${styles.panel} ${styles.lootPanel}`} role="dialog" aria-label={`Содержимое: ${title}`}>
                <img className={styles.lootBackground} src="/assets/engineres/gpanel/exchange.bmp" alt="" draggable={false} />
                <div className={styles.lootTitle}>{title}</div>
                <ItemStrip items={otherItems} owner={owner} columns={8} offset={otherOffset}
                    container={guiObject(22)} onActivate={selectLootStack} />
                <ItemStrip items={heroItems} owner="Hero" columns={8} offset={heroOffset}
                    container={guiObject(23)} onActivate={selectLootStack} />
                <OriginalGuiLayer className={styles.authoredControls} script="gpanel_new" objectIds={[9, 10, 11, 12, 20, 21]} onAction={(object) => {
                    if (object.id === 9) setOtherOffset(Math.max(0, otherOffset - 8));
                    if (object.id === 10) setOtherOffset(Math.min(Math.max(0, otherItems.length - 8), otherOffset + 8));
                    if (object.id === 11) setHeroOffset(Math.max(0, heroOffset - 8));
                    if (object.id === 12) setHeroOffset(Math.min(Math.max(0, heroItems.length - 8), heroOffset + 8));
                    if (object.id === 20) void takeAll();
                    if (object.id === 21) onClose();
                }} />
                {selected && (
                    <div className={styles.stackDialog}>
                        <ColorKeyImage src="/assets/engineres/stacks/main.bmp" draggable={false} />
                        <div className={styles.stackItem} style={stackGuiObject(5) ? guiObjectStyle(stackGuiObject(5)!, 246, 201) : undefined}>
                            <ItemIcon item={selected.item} />
                            {quantity > 1 && <strong>{quantity}</strong>}
                        </div>
                        <OriginalGuiLayer script="stacks_gui" canvasWidth={246} canvasHeight={201} values={{ 4: quantity }}
                            onValueChange={(object, value) => { if (object.id === 4 && typeof value === "number") setQuantity(Math.max(1, Math.min(selected.item.quantity, value))); }}
                            onAction={(object) => {
                                if (object.id === 1) void transfer(selected);
                                if (object.id === 2) setSelected(null);
                                if (object.id === 3) void transfer(selected, selected.item.quantity);
                                if (object.id === 7) setQuantity((current) => Math.max(1, current - 1));
                                if (object.id === 8) setQuantity((current) => Math.min(selected.item.quantity, current + 1));
                            }} />
                    </div>
                )}
                {error && <output className={styles.error}>{error}</output>}
            </section>
        );
    }

    return (
        <section className={`${styles.panel} ${styles.tradePanel}`} role="dialog" aria-label={`Торговля: ${title}`}>
            <img className={styles.background} src="/assets/engineres/trade/trade.bmp" alt="" draggable={false} />
            <div className={styles.traderName}>{title}</div>
            <ItemStrip items={heroItems} owner="Hero" columns={12} offset={heroOffset}
                container={guiObject(1)} onActivate={selectTradeSource} />
            <ItemStrip items={otherItems} owner={owner} columns={10} offset={otherOffset}
                container={guiObject(50)} onActivate={selectTradeSource} />
            <ItemStrip items={heroItems} owner="Hero" columns={10} offer={heroOffer}
                container={guiObject(48)} onActivate={removeTradeOffer} />
            <ItemStrip items={otherItems} owner={owner} columns={10} offer={otherOffer}
                container={guiObject(49)} onActivate={removeTradeOffer} />
            <OriginalGuiLayer className={styles.authoredControls} script="trade" onAction={(object) => {
                if (object.id === 3) setHeroOffset(Math.max(0, heroOffset - 12));
                if (object.id === 4) setHeroOffset(Math.min(Math.max(0, heroItems.length - 12), heroOffset + 12));
                if (object.id === 41) setOtherOffset(Math.max(0, otherOffset - 10));
                if (object.id === 42) setOtherOffset(Math.min(Math.max(0, otherItems.length - 10), otherOffset + 10));
                if (object.id === 44) void exchange();
                if (object.id === 7) onClose();
            }} />
            {error && <output className={styles.error}>{error}</output>}
        </section>
    );
};
