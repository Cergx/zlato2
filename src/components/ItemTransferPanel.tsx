import { useCallback, useEffect, useState } from "react";
import type { Game } from "../game/Game";
import type { HeroInventoryItemView } from "../game/ItemCatalogRuntime";
import { loadImage } from "../game/Assets";
import styles from "./ItemTransferPanel.module.scss";

interface ItemTransferPanelProps {
    readonly game: Game;
    readonly owner: string;
    readonly title: string;
    readonly mode: "loot" | "trade";
    readonly onClose: () => void;
}

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

interface SelectedStack {
    readonly owner: string;
    readonly item: HeroInventoryItemView;
}

export const ItemTransferPanel = ({ game, owner, title, mode, onClose }: ItemTransferPanelProps) => {
    const [heroItems, setHeroItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [otherItems, setOtherItems] = useState<readonly HeroInventoryItemView[]>([]);
    const [selected, setSelected] = useState<SelectedStack | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [error, setError] = useState("");

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
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [onClose]);

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

    const renderInventory = (items: readonly HeroInventoryItemView[], inventoryOwner: string, label: string) => (
        <section className={styles.inventory} aria-label={label}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault();
                const technicalName = event.dataTransfer.getData("application/x-zlato-item");
                const sourceOwner = event.dataTransfer.getData("application/x-zlato-owner");
                const item = (sourceOwner.toLowerCase() === "hero" ? heroItems : otherItems).find((candidate) => candidate.technicalName === technicalName);
                if (item && sourceOwner.toLowerCase() !== inventoryOwner.toLowerCase()) {
                    setSelected({ owner: sourceOwner, item });
                    setQuantity(1);
                }
            }}>
            <h2>{label}</h2>
            <div className={styles.grid}>
                {items.map((item) => <button key={item.technicalName} type="button" draggable
                    aria-pressed={selected?.owner === inventoryOwner && selected.item.technicalName === item.technicalName}
                    onClick={() => { setSelected({ owner: inventoryOwner, item }); setQuantity(1); }}
                    onDoubleClick={() => void transfer({ owner: inventoryOwner, item }, 1)}
                    onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-zlato-item", item.technicalName);
                        event.dataTransfer.setData("application/x-zlato-owner", inventoryOwner);
                    }}>
                    <ItemIcon item={item} />
                    {item.quantity > 1 && <strong>{item.quantity}</strong>}
                    <span className={styles.tooltip}><b>{item.literaryName}</b>{item.description}</span>
                </button>)}
            </div>
        </section>
    );

    return (
        <section className={styles.panel} role="dialog" aria-label={mode === "trade" ? "Торговля" : "Содержимое"}>
            <img className={styles.background} src="/assets/engineres/trade/trade.bmp" alt="" draggable={false} />
            <h1>{mode === "trade" ? `Торговля: ${title}` : title}</h1>
            <div className={styles.panes}>
                {renderInventory(otherItems, owner, mode === "trade" ? title : "Сундук")}
                {renderInventory(heroItems, "Hero", "Герой")}
            </div>
            {selected && (
                <div className={styles.stackDialog}>
                    <img src="/assets/engineres/stacks/main.bmp" alt="" draggable={false} />
                    <strong>{selected.item.literaryName}</strong>
                    <label>Количество <input type="number" min={1} max={selected.item.quantity} value={quantity}
                        onChange={(event) => setQuantity(Math.max(1, Math.min(selected.item.quantity, event.currentTarget.valueAsNumber || 1)))} /></label>
                    <button type="button" onClick={() => void transfer(selected)}>Переместить</button>
                    <button type="button" onClick={() => void transfer(selected, selected.item.quantity)}>Весь стек</button>
                </div>
            )}
            {mode === "loot" && <button className={styles.takeAll} type="button" onClick={() => void takeAll()}>Взять всё</button>}
            <button className={styles.close} type="button" onClick={onClose} aria-label="Закрыть" />
            {error && <output className={styles.error}>{error}</output>}
        </section>
    );
};
