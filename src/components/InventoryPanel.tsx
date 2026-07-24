import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";

import type { Game } from "../game/Game.ts";
import type { GameRuntimeSnapshot } from "../game/GameStateRuntime.ts";
import type { HeroInventoryItemView, HeroInventoryView, ShippedItem } from "../game/ItemCatalogRuntime.ts";
import type { EquipmentSlot } from "../game/systems/Items.ts";
import { originalExperienceThreshold, originalLevelForExperience } from "../game/systems/Combat.ts";
import { loadImage } from "../game/Assets.ts";

import "./InventoryPanel.css";

interface InventoryPanelProps {
    readonly game: Game;
    readonly onClose: () => void;
    readonly initialView?: "inventory" | "skills" | "characteristics";
}

const SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
    mainHand: "Оружейный комплект 1",
    offHand: "Оружейный комплект 2",
    ammo: "Боеприпасы",
    head: "Голова",
    body: "Доспех",
    arms: "Наручи",
    bracelet: "Браслет",
    amulet: "Амулет",
    ringLeft: "Кольцо",
    ringRight: "Кольцо",
};

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
    "head", "body", "amulet", "bracelet", "ringLeft", "ringRight", "mainHand", "offHand", "arms", "ammo",
];

interface UiRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

interface DraggedItem {
    readonly technicalName: string;
    readonly equippedSlot?: EquipmentSlot;
}

const EQUIPMENT_RECTS: Readonly<Record<EquipmentSlot, UiRect>> = {
    head: { left: 81, top: 305, width: 74, height: 59 },
    body: { left: 214, top: 310, width: 62, height: 55 },
    amulet: { left: 16, top: 382, width: 34, height: 32 },
    bracelet: { left: 246, top: 382, width: 32, height: 32 },
    ringLeft: { left: 14, top: 423, width: 45, height: 43 },
    ringRight: { left: 238, top: 423, width: 40, height: 43 },
    mainHand: { left: 15, top: 465, width: 81, height: 71 },
    offHand: { left: 198, top: 465, width: 78, height: 71 },
    arms: { left: 14, top: 583, width: 80, height: 75 },
    ammo: { left: 215, top: 583, width: 63, height: 75 },
};

const CHARACTERISTICS = [
    ["strength", "Сила"],
    ["constitution", "Телосложение"],
    ["dexterity", "Ловкость"],
    ["perception", "Внимание"],
    ["wisdom", "Мудрость"],
    ["intelligence", "Интеллект"],
    ["luck", "Удача"],
] as const;

const SKILLS = [
    ["skill_wpn_sword", "Мечи"], ["skill_wpn_axe", "Топоры"], ["skill_wpn_crush", "Дробящее"],
    ["skill_wpn_staff", "Посохи"], ["skill_wpn_dist", "Стрелковое"], ["skill_wpn_spear", "Копья"],
    ["skill_wpn_throw", "Метательное"], ["skill_wpn_hand", "Рукопашный бой"], ["skill_critical_hit", "Искусство боя"],
    ["skill_shadmag", "Магия теней"], ["skill_natrmag", "Магия природы"], ["skill_godsmag", "Магия богов"],
    ["skill_elemmag", "Магия стихий"], ["skill_lghtmag", "Магия света"], ["skill_darkmag", "Магия тьмы"],
    ["skill_magicuse", "Волшебство"], ["skill_alchemy", "Алхимия"], ["skill_identify", "Эрудиция"],
    ["skill_tactic", "Тактика"], ["skill_scout", "Следопыт"], ["skill_healing", "Знахарство"],
    ["skill_speech", "Красноречие"], ["skill_trade", "Торговля"], ["skill_hack", "Воровство"],
    ["skill_science", "Естествознание"], ["skill_smith", "Кузнечное дело"], ["skill_athletic", "Атлетизм"],
] as const;

const positionStyle = ({ left, top, width, height }: UiRect): CSSProperties => ({
    left: `${left / 10.24}%`,
    top: `${top / 7.68}%`,
    width: `${width / 10.24}%`,
    height: `${height / 7.68}%`,
});

const CHARACTERISTIC_HEADINGS: readonly [string, UiRect][] = [
    ["СОСТОЯНИЕ", { left: 376, top: 55, width: 212, height: 27 }],
    ["СОПРОТИВЛЕНИЕ", { left: 699, top: 55, width: 244, height: 27 }],
    ["БОЕВЫЕ ХАРАКТЕРИСТИКИ", { left: 344, top: 306, width: 244, height: 25 }],
    ["ИММУНИТЕТ К МАГИИ", { left: 689, top: 527, width: 261, height: 25 }],
];

const equipmentClass = (slot: EquipmentSlot): string => `inventory-equipment-slot inventory-equipment-${slot}`;

const drawChromaKeyImage = (canvas: HTMLCanvasElement, image: HTMLImageElement): void => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
        if (pixels.data[index] >= 250 && pixels.data[index + 1] <= 5 && pixels.data[index + 2] >= 250) {
            pixels.data[index + 3] = 0;
        }
    }
    context.putImageData(pixels, 0, 0);
};

const ItemImage = ({ item }: { readonly item: ShippedItem }): React.JSX.Element => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        let cancelled = false;
        if (item.iconUrl) {
            void loadImage(item.iconUrl).then((image) => {
                if (!cancelled && canvasRef.current) drawChromaKeyImage(canvasRef.current, image);
            });
        }
        return () => { cancelled = true; };
    }, [item.iconUrl]);

    return item.iconUrl
        ? <canvas className="inventory-item-image" ref={canvasRef} aria-hidden="true" />
        : <span>{item.literaryName.slice(0, 1)}</span>;
};


const SMALL_SELECTION_SLOTS = new Set<EquipmentSlot>(["amulet", "bracelet", "ringLeft", "ringRight"]);

const ItemSelection = ({ small = false }: { readonly small?: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        let cancelled = false;
        const source = small ? "small_sel.bmp" : "big_sel.bmp";
        void loadImage(`/assets/engineres/gpanel/${source}`).then((image) => {
            if (cancelled) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            drawChromaKeyImage(canvas, image);

        });
        return () => { cancelled = true; };
    }, [small]);

    return <canvas className="inventory-selection" ref={canvasRef} aria-hidden="true" />;
};

const ItemPopup = ({ item, quantity }: { readonly item: ShippedItem; readonly quantity?: number }) => (
    <span className="inventory-item-popup" role="tooltip">
        <strong>{item.literaryName}</strong>
        <em>{item.definition.itemClass}</em>
        {item.description && <span>{item.description}</span>}
        {quantity !== undefined && <span>Количество: {quantity}</span>}
        {item.specialEffects.map((effect) => <span key={`${effect.specialId}:${effect.amount}`}>Эффект {effect.specialId}: {effect.amount}</span>)}
    </span>
);


export default function InventoryPanel({ game, onClose, initialView = "inventory" }: InventoryPanelProps) {
    const [inventory, setInventory] = useState<HeroInventoryView | null>(null);
    const [snapshot, setSnapshot] = useState<GameRuntimeSnapshot | null>(() => game.getRuntimeSnapshot());
    const [view, setView] = useState(initialView);
    const [dragged, setDragged] = useState<DraggedItem | null>(null);
    const draggedRef = useRef<DraggedItem | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [heroName, setHeroName] = useState("Герой");
    const initialParameters = useRef<Readonly<Record<string, number>> | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [nextInventory, nextHeroName] = await Promise.all([game.getHeroInventory(), game.getHeroName()]);
            const nextSnapshot = game.getRuntimeSnapshot();
            setInventory(nextInventory);
            setHeroName(nextHeroName);
            setSnapshot(nextSnapshot);
            if (!initialParameters.current && nextSnapshot) {
                const hero = Object.entries(nextSnapshot.personParameters)
                    .find(([name]) => name.toLowerCase() === "hero")?.[1] ?? {};
                initialParameters.current = Object.fromEntries(Object.entries(hero).map(([name, value]) => [name.toLowerCase(), value]));
            }
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }, [game]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" || event.code === "KeyI") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const heroParameters = Object.entries(snapshot?.personParameters ?? {})
        .find(([name]) => name.toLowerCase() === "hero")?.[1] ?? {};
    const parameterValue = (name: string): number => Object.entries(heroParameters)
        .find(([candidate]) => candidate.toLowerCase() === name)?.[1] ?? 0;
    const minimumValue = (name: string): number => initialParameters.current?.[name] ?? parameterValue(name);
    const draggedItem = dragged && (inventory?.items.find((item) => item.technicalName === dragged.technicalName)
        ?? Object.values(inventory?.equipped ?? {}).find((item) => item?.technicalName === dragged.technicalName));

    const report = (caught: unknown): void => setError(caught instanceof Error ? caught.message : String(caught));
    const allowDrop = (event: DragEvent<HTMLElement>): void => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    };
    const clearDragged = (): void => {
        draggedRef.current = null;
        setDragged(null);
    };
    const beginDrag = (event: DragEvent<HTMLElement>, item: DraggedItem): void => {
        draggedRef.current = item;
        setDragged(item);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.technicalName);
    };

    const activateInventoryItem = async (item: HeroInventoryItemView) => {
        try {
            const changed = item.definition.itemClass === "food" || item.definition.itemClass === "potion"
                ? await game.useHeroItem(item.technicalName)
                : await game.equipHeroItem(item.technicalName);
            if (changed) await refresh();
        } catch (caught) {
            report(caught);
        }
    };

    const equipDragged = async (slot?: EquipmentSlot) => {
        const item = draggedRef.current;
        if (!item || item.equippedSlot === slot) return;
        try {
            if (item.equippedSlot && !await game.unequipHeroItem(item.equippedSlot)) return;
            const changed = await game.equipHeroItem(item.technicalName, slot);
            if (!changed && item.equippedSlot) await game.equipHeroItem(item.technicalName, item.equippedSlot);
            if (changed) await refresh();
        } catch (caught) {
            report(caught);
        } finally {
            clearDragged();
        }
    };

    const unequipDragged = async () => {
        const item = draggedRef.current;
        if (!item?.equippedSlot) return;
        try {
            if (await game.unequipHeroItem(item.equippedSlot)) await refresh();
        } catch (caught) {
            report(caught);
        } finally {
            clearDragged();
        }
    };

    const dropItem = async (item: DraggedItem) => {
        try {
            if (item.equippedSlot && !await game.unequipHeroItem(item.equippedSlot)) return;
            const dropped = await game.dropHeroItem(item.technicalName);
            if (!dropped && item.equippedSlot) await game.equipHeroItem(item.technicalName, item.equippedSlot);
            if (dropped) await refresh();
        } catch (caught) {
            report(caught);
        } finally {
            clearDragged();
        }
    };

    const adjustProgression = async (name: string, kind: "characteristic" | "skill", direction: 1 | -1) => {
        if (game.adjustHeroProgression(name, kind, direction, minimumValue(name))) await refresh();
    };

    const renderProgressionRow = (
        name: string,
        label: string,
        kind: "characteristic" | "skill",
        index: number,
    ) => {
        const value = parameterValue(name);
        const points = parameterValue(kind === "characteristic" ? "person_points" : "skill_points");
        const maximum = kind === "characteristic" ? 30 : 15;
        const rowStyle = kind === "characteristic"
            ? positionStyle({ left: 20, top: [59, 87, 115, 142, 170, 198, 225][index], width: 237, height: 26 })
            : (() => {
                const section = Math.floor(index / 9);
                const withinSection = index % 9;
                const column = Math.floor(withinSection / 3);
                const row = withinSection % 3;
                return positionStyle({
                    left: [306, 553, 798][column],
                    top: [124, 156, 189][row] + [0, 186, 371][section],
                    width: 210,
                    height: 24,
                });
            })();
        const assetIndex = kind === "characteristic" ? index + 1 : index + 1;
        const prefix = kind === "characteristic" ? "l" : "c";
        return <div className={`inventory-progression-row inventory-${kind}`} style={rowStyle} key={name}>
            <span>{label}</span>
            <button type="button" className="inventory-stat-minus" disabled={value <= minimumValue(name)}
                onClick={() => void adjustProgression(name, kind, -1)} aria-label={`Уменьшить: ${label}`}>
                <img src={`/assets/engineres/newinv/${prefix}m${assetIndex}.bmp`} alt="" />
            </button>
            <strong>{value}</strong>
            <button type="button" className="inventory-stat-plus" disabled={value >= maximum || points < value + 1}
                onClick={() => void adjustProgression(name, kind, 1)} aria-label={`Увеличить: ${label}`}>
                <img src={`/assets/engineres/newinv/${prefix}p${assetIndex}.bmp`} alt="" />
            </button>
        </div>;
    };

    const characteristic = (name: string): number => parameterValue(name);
    const heroCombat = snapshot?.combat.combatants.hero;
    const profile = heroCombat?.profile;
    const level = originalLevelForExperience(snapshot?.experience ?? 0);
    const formatRange = (range?: Readonly<{ readonly min: number; readonly max: number }>): string => {
        if (!range) return "0";
        return range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
    };
    const secondaryFields: readonly [string, number | string, UiRect][] = [
        ["Уровень", level, { left: 296, top: 102, width: 336, height: 24 }],
        ["Опыт", `${snapshot?.experience ?? 0}/${originalExperienceThreshold(level)}`, { left: 296, top: 134, width: 336, height: 23 }],
        ["Слава", characteristic("reputation"), { left: 296, top: 163, width: 336, height: 24 }],
        ["Жизнь", `${heroCombat?.health ?? characteristic("health")}/${profile?.maxHealth ?? characteristic("max_health")}`, { left: 296, top: 214, width: 336, height: 20 }],
        ["Энергия", `${heroCombat?.energy ?? characteristic("energy")}/${profile?.maxEnergy ?? characteristic("max_energy")}`, { left: 296, top: 240, width: 336, height: 20 }],
        ["Очки действия", `${heroCombat?.actionPoints ?? characteristic("action_points")}/${profile?.actionPoints ?? characteristic("max_action_points")}`, { left: 296, top: 267, width: 336, height: 20 }],
        ["Дробящее повреждение", formatRange(profile?.weapon.damage.crushing), { left: 296, top: 349, width: 336, height: 20 }],
        ["Колющее повреждение", formatRange(profile?.weapon.damage.pricking), { left: 296, top: 376, width: 336, height: 20 }],
        ["Рубящее повреждение", formatRange(profile?.weapon.damage.hacking), { left: 296, top: 403, width: 336, height: 20 }],
        ["Повреждение огнем", formatRange(profile?.elementalDamage.fire), { left: 296, top: 431, width: 336, height: 20 }],
        ["Повреждение холодом", formatRange(profile?.elementalDamage.cold), { left: 296, top: 458, width: 336, height: 20 }],
        ["Повреждение ядом", formatRange(profile?.elementalDamage.poison), { left: 296, top: 485, width: 336, height: 20 }],
        ["Базовая точность", profile?.hitChance ?? 0, { left: 296, top: 512, width: 336, height: 20 }],
        ["Шанс критического удара", profile?.criticalChance ?? 0, { left: 296, top: 539, width: 336, height: 20 }],
        ["Класс брони", profile?.armorClass ?? 0, { left: 296, top: 566, width: 336, height: 20 }],
        ["Вес", `0/${profile?.maxWeight ?? 0}`, { left: 294, top: 600, width: 336, height: 21 }],
        ["Дробящее повреждение", profile?.damageResistance.crushing ?? 0, { left: 666, top: 105, width: 336, height: 20 }],
        ["Колющее повреждение", profile?.damageResistance.pricking ?? 0, { left: 666, top: 138, width: 336, height: 20 }],
        ["Рубящее повреждение", profile?.damageResistance.hacking ?? 0, { left: 666, top: 169, width: 336, height: 20 }],
        ["Магия теней", profile?.magicResistance.shadows ?? 0, { left: 666, top: 222, width: 336, height: 20 }],
        ["Магия природы", profile?.magicResistance.nature ?? 0, { left: 666, top: 253, width: 336, height: 20 }],
        ["Магия богов", profile?.magicResistance.gods ?? 0, { left: 666, top: 283, width: 336, height: 20 }],
        ["Магия стихий", profile?.magicResistance.elements ?? 0, { left: 666, top: 314, width: 336, height: 20 }],
        ["Магия света", profile?.magicResistance.light ?? 0, { left: 666, top: 344, width: 336, height: 20 }],
        ["Магия тьмы", profile?.magicResistance.dark ?? 0, { left: 666, top: 375, width: 336, height: 20 }],
        ["Огонь", profile?.elementalResistance.fire ?? 0, { left: 666, top: 431, width: 336, height: 20 }],
        ["Холод", profile?.elementalResistance.cold ?? 0, { left: 666, top: 458, width: 336, height: 20 }],
        ["Яд", profile?.elementalResistance.poison ?? 0, { left: 666, top: 484, width: 336, height: 20 }],
        ["Теней", profile?.magicImmunity.shadows ?? 0, { left: 666, top: 570, width: 154, height: 20 }],
        ["Природы", profile?.magicImmunity.nature ?? 0, { left: 666, top: 596, width: 154, height: 20 }],
        ["Богов", profile?.magicImmunity.gods ?? 0, { left: 666, top: 622, width: 154, height: 20 }],
        ["Стихий", profile?.magicImmunity.elements ?? 0, { left: 839, top: 570, width: 163, height: 20 }],
        ["Света", profile?.magicImmunity.light ?? 0, { left: 839, top: 596, width: 163, height: 20 }],
        ["Тьмы", profile?.magicImmunity.dark ?? 0, { left: 839, top: 622, width: 163, height: 20 }],
    ];

    return <div className="inventory-panel" role="dialog" aria-label="Инвентарь и характеристики">
        <img className="inventory-panel-background" src={`/assets/engineres/newinv/${view === "characteristics" ? "inventory_secondary" : "inventory_skills"}.bmp`} alt="" draggable={false} />
        <div className="inventory-character-name">{heroName}</div>
        <button className="inventory-view-tab inventory-view-characteristics" type="button" aria-pressed={view === "characteristics"} onClick={() => setView("characteristics")}>
            ХАРАКТЕРИСТИКИ
        </button>
        <button className="inventory-view-tab inventory-view-skills" type="button" aria-pressed={view !== "characteristics"} onClick={() => setView("skills")}>
            НАВЫКИ
        </button>

        {CHARACTERISTICS.map(([name, label], index) => renderProgressionRow(name, label, "characteristic", index))}
        <div className="inventory-person-points"><span>Очки опыта</span><strong>{parameterValue("person_points")}</strong></div>
        {view === "characteristics" && CHARACTERISTIC_HEADINGS.map(([label, rect]) => (
            <div className="inventory-secondary-heading" style={positionStyle(rect)} key={label}>{label}</div>
        ))}
        {view === "characteristics" && secondaryFields.map(([label, value, rect]) => (
            <div className="inventory-secondary-field" style={positionStyle(rect)} key={`${label}:${rect.left}:${rect.top}`}><span>{label}</span><strong>{value}</strong></div>
        ))}
        {view !== "characteristics" && SKILLS.map(([name, label], index) => renderProgressionRow(name, label, "skill", index))}
        {view !== "characteristics" && <div className="inventory-skill-points"><span>Очки навыков</span><strong>{parameterValue("skill_points")}</strong></div>}

        <div className="inventory-puppet" aria-label="Экипировать на персонажа" onDragOver={allowDrop}
            onDrop={(event) => { event.preventDefault(); void equipDragged(); }} />

        {EQUIPMENT_SLOTS.map((slot) => {
            const item = inventory?.equipped[slot];
            return <button type="button" key={slot} className={equipmentClass(slot)} style={positionStyle(EQUIPMENT_RECTS[slot])}
                aria-label={item ? `${SLOT_LABELS[slot]}: ${item.literaryName}` : SLOT_LABELS[slot]}
                draggable={Boolean(item)}
                onDragStart={(event) => item && beginDrag(event, { technicalName: item.technicalName, equippedSlot: slot })}
                onDragEnd={clearDragged}
                onDragOver={allowDrop}
                onDrop={(event) => { event.preventDefault(); void equipDragged(slot); }}
                onDoubleClick={() => { if (item) void game.unequipHeroItem(slot).then(async (changed) => { if (changed) await refresh(); }).catch(report); }}>
                {item && <>
                    <ItemImage item={item} />
                    <ItemSelection small={SMALL_SELECTION_SLOTS.has(slot)} />
                    <ItemPopup item={item} />
                </>}
            </button>;
        })}

        <div className="inventory-bag" aria-label="Предметы" onDragOver={allowDrop}
            onDrop={(event) => { event.preventDefault(); void unequipDragged(); }}>
            {inventory?.items.map((item) => <button type="button" key={item.technicalName}
                className="inventory-item"
                aria-label={`${item.literaryName}, ${item.quantity}`}
                draggable
                onDragStart={(event) => beginDrag(event, { technicalName: item.technicalName })}
                onDragEnd={clearDragged}
                onDoubleClick={() => void activateInventoryItem(item)}>
                <ItemImage item={item} />
                <ItemSelection />
                <ItemPopup item={item} quantity={item.quantity} />
                {item.quantity > 1 && <span className="inventory-quantity">{item.quantity}</span>}
            </button>)}
        </div>

        {error && <span className="inventory-error" role="alert">{error}</span>}

        <button type="button" className="inventory-drop" disabled={!draggedItem?.canDrop}
            onDragOver={(event) => { if (draggedItem?.canDrop) allowDrop(event); }}
            onDrop={(event) => { event.preventDefault(); const item = draggedRef.current; if (item) void dropItem(item); }}
            aria-label="Перетащить сюда, чтобы выбросить предмет" />
        <button type="button" className="inventory-close" onClick={onClose} aria-label="Закрыть инвентарь" />
    </div>;
}
