import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
    INVENTORY_CHARACTER_NAME_DRAW,
    INVENTORY_NATIVE_TEXT_DRAWS,
    GUI_TOOLTIP_DELAY_MS,
    INVENTORY_CHARACTERISTIC_UPGRADE_OBJECT_IDS,
    INVENTORY_DYNAMIC_HINT_STRING_IDS,
    INVENTORY_SKILL_UPGRADE_BINDINGS,
    INVENTORY_ROLE_STATE_OBJECT_IDS,
    INVENTORY_STATIC_HINT_BINDINGS,
    NATIVE_HERO_STATE_BINDINGS,
    NATIVE_HERO_STATE_EFFECT_GROUPS,
    type InventoryTextDraw,
    HERO_GENERATOR_NATIVE_LAYOUT,
} from "../constants/clientDll.ts";
import {
    HEADS_INTERFACE_FONT,
    MAIN_INTERFACE_FONT,
    type ShippedFontDefinition,
} from "../constants/fontsScr.ts";
import { INVENTORY_QUICK_ACCESS_SLOTS } from "../constants/temporary/invGuiScr.ts";
import { INVENTORY_EQUIPMENT_RECTS, type InventoryRect } from "../constants/temporary/inventorySkillsBmp.ts";

import type { Game } from "../game/Game.ts";
import type { GameRuntimeSnapshot } from "../game/GameStateRuntime.ts";
import type { HeroInventoryItemView, HeroInventoryView } from "../game/ItemCatalogRuntime.ts";
import type { EquipmentSlot } from "../game/systems/Items.ts";
import { originalExperienceThreshold, originalLevelForExperience } from "../game/systems/Combat.ts";
import { loadImage } from "../game/Assets.ts";
import { loadGuiDefinition, type GuiDefinition, type GuiObjectDefinition } from "../game/GuiDefinitionRuntime.ts";
import { SDBParser, type SDBData } from "../game/parsers/SDBParser.ts";
import { ColorKeyImage } from "./ColorKeyImage.tsx";
import { guiObjectStyle, OriginalGuiLayer, type GuiControlValue } from "./OriginalGuiLayer.tsx";
import { ItemContainer } from "./ItemContainer.tsx";
import { drawChromaKeyImage, ItemIcon } from "./ItemIcon.tsx";

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


interface DraggedItem {
    readonly technicalName: string;
    readonly stackKey?: string;
    readonly equippedSlot?: EquipmentSlot;
}


const CHARACTERISTICS = [
    "strength", "constitution", "dexterity", "perception", "wisdom", "intelligence", "luck",
] as const;

const SKILLS = HERO_GENERATOR_NATIVE_LAYOUT.skills.map(({ parameter }) => parameter);

// Client.dll stores these host-composition resources beside each other at file
// offsets 0x10db54, 0x10db7c, and 0x10dbc0. inv_gui.scr defines controls only.
const INVENTORY_NATIVE_RESOURCES = Object.freeze({
    script: "inv_gui",
    backgrounds: Object.freeze({
        characteristics: "/assets/engineres/newinv/inventory_secondary.bmp",
        skills: "/assets/engineres/newinv/inventory_skills.bmp",
    }),
});


const positionStyle = ({ left, top, width, height }: InventoryRect): CSSProperties => ({
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
});

const shippedFontStyle = (font: ShippedFontDefinition): CSSProperties => ({
    fontFamily: `ZlatoPalatino, "${font.typeFace}", serif`,
    fontSize: `${font.size}px`,
    fontWeight: font.weight,
});

const nativeTextStyle = (draw: InventoryTextDraw): CSSProperties => ({
    left: `${draw.x}px`,
    top: `${draw.y}px`,
    ...(draw.boxWidth === -1 ? {} : { width: `${draw.boxWidth}px`, textAlign: "center" }),
    ...(draw.boxHeight === -1 ? {} : { height: `${draw.boxHeight}px`, display: "grid", alignItems: "center" }),
    ...shippedFontStyle(draw.stringId === 1 || draw.stringId === 2 ? HEADS_INTERFACE_FONT : MAIN_INTERFACE_FONT),
});

const characterNameStyle: CSSProperties = {
    left: `${INVENTORY_CHARACTER_NAME_DRAW.x}px`,
    top: `${INVENTORY_CHARACTER_NAME_DRAW.y}px`,
    width: `${INVENTORY_CHARACTER_NAME_DRAW.boxWidth}px`,
    height: `${INVENTORY_CHARACTER_NAME_DRAW.boxHeight}px`,
    ...shippedFontStyle(HEADS_INTERFACE_FONT),
};

const equipmentClass = (slot: EquipmentSlot): string => `inventory-equipment-slot inventory-equipment-${slot}`;

const COMMON_GUI_IDS = [
    1, 2,
    ...Array.from({ length: 27 }, (_, index) => 3 + index),
    84, 85,
    ...Array.from({ length: 9 }, (_, index) => 90 + index),
    99,
] as const;
const SKILLS_GUI_IDS = [
    ...Array.from({ length: 54 }, (_, index) => 30 + index),
    ...Array.from({ length: 28 }, (_, index) => 100 + index),
] as const;
const CHARACTERISTICS_GUI_IDS = Array.from({ length: 44 }, (_, index) => 160 + index);
const SECONDARY_VALUE_RIGHT: Readonly<Record<number, number>> = Object.freeze({
    160: 632, 161: 632, 162: 632,
    163: 632, 164: 632, 165: 632, 166: 632, 167: 632, 168: 632, 169: 632,
    170: 632, 171: 632, 172: 632, 173: 632, 174: 632, 175: 630,
    176: 1002, 177: 1002, 178: 1002, 179: 1002, 180: 1002, 181: 1002,
    182: 1002, 183: 1002, 184: 1002, 185: 1002, 186: 1002, 187: 1002,
    188: 820, 189: 820, 190: 820, 191: 1002, 192: 1002, 193: 1002,
});
const INVENTORY_PAGE_SIZE = 12;

const nativeRoleStateIds = (snapshot: GameRuntimeSnapshot | null): readonly number[] => {
    const effects = snapshot?.magic.activeEffects
        .filter(({ targetName }) => targetName.toLowerCase() === "hero") ?? [];
    const stateIds: number[] = [];
    for (const group of NATIVE_HERO_STATE_EFFECT_GROUPS) {
        const value = effects
            .filter(({ specialId }) => group.specialIds.includes(specialId))
            .reduce((sum, effect) => sum + effect.value, 0);
        if (value > 0) stateIds.push(group.positiveStateId);
        else if (value < 0 && group.negativeStateId !== undefined) stateIds.push(group.negativeStateId);
    }
    return stateIds.sort((left, right) => left - right);
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



export default function InventoryPanel({ game, onClose, initialView = "inventory" }: InventoryPanelProps) {
    const [inventory, setInventory] = useState<HeroInventoryView | null>(null);
    const [snapshot, setSnapshot] = useState<GameRuntimeSnapshot | null>(() => game.getRuntimeSnapshot());
    const [view, setView] = useState<"skills" | "characteristics">(
        initialView === "characteristics" ? "characteristics" : "skills",
    );
    const [dragged, setDragged] = useState<DraggedItem | null>(null);
    const draggedRef = useRef<DraggedItem | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [heroName, setHeroName] = useState("Герой");
    const initialParameters = useRef<Readonly<Record<string, number>> | null>(null);
    const [definition, setDefinition] = useState<GuiDefinition | null>(null);
    const [heroStateStrings, setHeroStateStrings] = useState<SDBData>({});
    const [interfaceStrings, setInterfaceStrings] = useState<SDBData>({});
    const [hintStrings, setHintStrings] = useState<SDBData>({});
    const [inventoryOffset, setInventoryOffset] = useState(0);
    const [activeFilterId, setActiveFilterId] = useState<number | null>(9);

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
        let cancelled = false;
        void Promise.all([
            loadGuiDefinition(INVENTORY_NATIVE_RESOURCES.script),
            fetch("/assets/sdb/user_interface.sdb").then(async (response) => {
                if (!response.ok) throw new Error(`Interface strings failed: HTTP ${response.status}`);
                return new SDBParser(await response.arrayBuffer()).getData();
            }),
            fetch("/assets/sdb/hints.sdb").then(async (response) => {
                if (!response.ok) throw new Error(`Hint strings failed: HTTP ${response.status}`);
                return new SDBParser(await response.arrayBuffer()).getData();
            }),
            fetch("/assets/sdb/hero.sdb").then(async (response) => {
                if (!response.ok) throw new Error(`Hero state strings failed: HTTP ${response.status}`);
                return new SDBParser(await response.arrayBuffer()).getData();
            }),
        ]).then(
            ([loadedDefinition, loadedStrings, loadedHints, loadedHeroStates]) => {
                if (cancelled) return;
                setDefinition(loadedDefinition);
                setInterfaceStrings(loadedStrings);
                setHintStrings(loadedHints);
                setHeroStateStrings(loadedHeroStates);
            },
            (caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); },
        );
        return () => { cancelled = true; };
    }, []);
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
    const draggedItem = dragged && (inventory?.items.find((item) => item.stackKey === dragged.stackKey
        || (!dragged.stackKey && item.technicalName === dragged.technicalName))
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
                ? await game.useHeroItem(item.technicalName, item.stackKey)
                : await game.equipHeroItem(item.technicalName, undefined, item.stackKey);
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
            const changed = await game.equipHeroItem(item.technicalName, slot, item.stackKey);
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
            const dropped = await game.dropHeroItem(item.technicalName, item.stackKey);
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


    const characteristic = (name: string): number => parameterValue(name);
    const heroCombat = snapshot?.combat.combatants.hero;
    const profile = heroCombat?.profile;
    const level = originalLevelForExperience(snapshot?.experience ?? 0);
    const formatRange = (range?: Readonly<{ readonly min: number; readonly max: number }>): string => {
        if (!range) return "0";
        return range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
    };
    const secondaryValues: readonly (number | string)[] = [
        level,
        `${snapshot?.experience ?? 0}/${originalExperienceThreshold(level)}`,
        characteristic("reputation"),
        `${heroCombat?.health ?? characteristic("health")}/${profile?.maxHealth ?? characteristic("max_health")}`,
        `${heroCombat?.energy ?? characteristic("energy")}/${profile?.maxEnergy ?? characteristic("max_energy")}`,
        `${heroCombat?.actionPoints ?? characteristic("action_points")}/${profile?.actionPoints ?? characteristic("max_action_points")}`,
        formatRange(profile?.weapon.damage.crushing),
        formatRange(profile?.weapon.damage.pricking),
        formatRange(profile?.weapon.damage.hacking),
        formatRange(profile?.elementalDamage.fire),
        formatRange(profile?.elementalDamage.cold),
        formatRange(profile?.elementalDamage.poison),
        profile?.hitChance ?? 0,
        profile?.criticalChance ?? 0,
        profile?.armorClass ?? 0,
        `0/${profile?.maxWeight ?? 0}`,
        profile?.damageResistance.crushing ?? 0,
        profile?.damageResistance.pricking ?? 0,
        profile?.damageResistance.hacking ?? 0,
        profile?.magicResistance.shadows ?? 0,
        profile?.magicResistance.nature ?? 0,
        profile?.magicResistance.gods ?? 0,
        profile?.magicResistance.elements ?? 0,
        profile?.magicResistance.light ?? 0,
        profile?.magicResistance.dark ?? 0,
        profile?.elementalResistance.fire ?? 0,
        profile?.elementalResistance.cold ?? 0,
        profile?.elementalResistance.poison ?? 0,
        profile?.magicImmunity.shadows ?? 0,
        profile?.magicImmunity.nature ?? 0,
        profile?.magicImmunity.gods ?? 0,
        profile?.magicImmunity.elements ?? 0,
        profile?.magicImmunity.light ?? 0,
        profile?.magicImmunity.dark ?? 0,
    ];

    const definitionById = useMemo(
        () => new Map(definition?.objects.map((object) => [object.id, object]) ?? []),
        [definition],
    );
    const guiObject = (id: number): GuiObjectDefinition | undefined => definitionById.get(id);
    const maximumOffset = Math.max(0, (inventory?.items.length ?? 0) - INVENTORY_PAGE_SIZE);
    const visibleItems = inventory?.items.slice(inventoryOffset, inventoryOffset + INVENTORY_PAGE_SIZE) ?? [];
    useEffect(() => {
        setInventoryOffset((current) => Math.min(current, maximumOffset));
    }, [maximumOffset]);
    const interfaceText = (id: number): string => interfaceStrings[id] ?? "";

    const authoredValues: Record<number, GuiControlValue> = { 84: "1", 85: "2" };
    for (let id = 9; id <= 15; id += 1) authoredValues[id] = id === activeFilterId;
    const authoredLabels = { 5: interfaceText(1), 6: interfaceText(2) };

    const inactiveObjectIds: number[] = [];
    if (inventoryOffset === 0) inactiveObjectIds.push(3);
    if (inventoryOffset >= maximumOffset) inactiveObjectIds.push(4);
    if (!draggedItem?.canDrop) inactiveObjectIds.push(8);

    const progressionValue = (name: string, minusId: number, plusId: number) => {
        const minus = guiObject(minusId);
        const plus = guiObject(plusId);
        if (!minus || !plus) return null;
        return <strong className="inventory-progression-value" key={name} style={{
            left: `${minus.left + minus.width}px`,
            top: `${minus.top}px`,
            width: `${Math.max(0, plus.left - minus.left - minus.width)}px`,
            height: `${minus.height}px`,
        }}>{parameterValue(name)}</strong>;
    };

    const fieldValue = (key: string, objectId: number, right: number, value: number | string) => {
        const object = guiObject(objectId);
        if (!object) return null;
        return <strong className="inventory-field-value" key={key} style={{
            left: `${object.left + object.width}px`,
            top: `${object.top}px`,
            width: `${Math.max(0, right - object.left - object.width)}px`,
            height: `${object.height}px`,
        }}>{value}</strong>;
    };

    const handleGuiAction = (object: GuiObjectDefinition): void => {
        if (object.id === 3) setInventoryOffset((current) => Math.max(0, current - INVENTORY_PAGE_SIZE));
        else if (object.id === 4) setInventoryOffset((current) => Math.min(maximumOffset, current + INVENTORY_PAGE_SIZE));
        else if (object.id === 5) setView("characteristics");
        else if (object.id === 6) setView("skills");
        else if (object.id === 7) onClose();
        else if (object.id >= 16 && object.id <= 22) {
            const name = CHARACTERISTICS[object.id - 16];
            void adjustProgression(name, "characteristic", -1);
        } else if (object.id >= 23 && object.id <= 29) {
            const name = CHARACTERISTICS[object.id - 23];
            void adjustProgression(name, "characteristic", 1);
        } else if (object.id >= 30 && object.id <= 83) {
            const index = Math.floor((object.id - 30) / 2);
            const name = SKILLS[index];
            void adjustProgression(name, "skill", (object.id - 30) % 2 === 0 ? -1 : 1);
        }
    };

    const activeRoleStates = useMemo(() => nativeRoleStateIds(snapshot)
        .slice(0, INVENTORY_ROLE_STATE_OBJECT_IDS.length)
        .map((stateId) => NATIVE_HERO_STATE_BINDINGS[stateId])
        .filter((binding) => binding !== undefined), [snapshot]);

    const authoredTooltips = useMemo(() => {
        const result = Object.fromEntries(INVENTORY_STATIC_HINT_BINDINGS.flatMap(({ objectId, stringId }) => {
            const text = hintStrings[stringId];
            return text ? [[objectId, text] as const] : [];
        })) as Record<number, string>;
        const characteristicRequirement = hintStrings[INVENTORY_DYNAMIC_HINT_STRING_IDS.characteristicRequirement];
        for (const objectId of INVENTORY_CHARACTERISTIC_UPGRADE_OBJECT_IDS) {
            const characteristicIndex = objectId - INVENTORY_CHARACTERISTIC_UPGRADE_OBJECT_IDS[0];
            const current = parameterValue(CHARACTERISTICS[characteristicIndex]);
            if (characteristicRequirement && current < 30) {
                result[objectId] = characteristicRequirement.replace("%d", String(current + 1));
            }
        }
        const skillRequirement = hintStrings[INVENTORY_DYNAMIC_HINT_STRING_IDS.skillRequirement];
        for (const { objectId } of INVENTORY_SKILL_UPGRADE_BINDINGS) {
            const skillIndex = (objectId - 31) / 2;
            const current = parameterValue(SKILLS[skillIndex]);
            if (!skillRequirement || current >= 15) continue;
            result[objectId] = skillRequirement.replace("%d", String(current + 1));
        }
        for (const [slot, binding] of activeRoleStates.entries()) {
            const text = heroStateStrings[binding.stringId];
            if (text) result[INVENTORY_ROLE_STATE_OBJECT_IDS[slot]] = text;
        }
        return result;
    }, [activeRoleStates, heroParameters, heroStateStrings, hintStrings]);

    const renderedGuiIds = view === "characteristics"
        ? [...COMMON_GUI_IDS, ...CHARACTERISTICS_GUI_IDS]
        : [...COMMON_GUI_IDS, ...SKILLS_GUI_IDS];
    const nativeTextDraws = [
        ...INVENTORY_NATIVE_TEXT_DRAWS.common,
        ...INVENTORY_NATIVE_TEXT_DRAWS[view],
    ];

    return <div className="inventory-panel" role="dialog" aria-label="Инвентарь и характеристики" data-item-tooltip-root>
        <img className="inventory-panel-background" src={INVENTORY_NATIVE_RESOURCES.backgrounds[view]} alt="" draggable={false} />
        <div className="inventory-character-name" style={characterNameStyle}>{heroName}</div>

        <OriginalGuiLayer
            className="inventory-authored-controls"
            script={INVENTORY_NATIVE_RESOURCES.script}
            objectIds={renderedGuiIds}
            values={authoredValues}
            labels={authoredLabels}
            tooltips={authoredTooltips}
            tooltipDelayMs={GUI_TOOLTIP_DELAY_MS}
            inactiveObjectIds={inactiveObjectIds}
            onAction={handleGuiAction}
            objectContents={{
                1: <ItemContainer columns={INVENTORY_PAGE_SIZE} rows={1} className="inventory-bag" ariaLabel="Предметы">
                    {visibleItems.map((item) => <button type="button" key={item.stackKey}
                        className="inventory-item"
                        aria-label={`${item.literaryName}, ${item.quantity}`}
                        draggable
                        onDragStart={(event) => beginDrag(event, { technicalName: item.technicalName, stackKey: item.stackKey })}
                        onDoubleClick={() => void activateInventoryItem(item)}>
                        <ItemIcon item={item} quantity={item.quantity} />
                        <ItemSelection />
                    </button>)}
                </ItemContainer>,
                99: <ItemContainer columns={INVENTORY_QUICK_ACCESS_SLOTS} rows={1}
                    className="inventory-quick-access" ariaLabel="Быстрый доступ">
                    {Array.from({ length: INVENTORY_QUICK_ACCESS_SLOTS }, (_, slot) => (
                        <div className="inventory-quick-access-slot" data-quick-access-slot={slot}
                            aria-label={`Слот быстрого доступа ${slot + 1}`} key={slot} />
                    ))}
                </ItemContainer>,
            }}
            onValueChange={(object, value) => {
                if (object.id < 9 || object.id > 15 || typeof value !== "boolean") return;
                setActiveFilterId(value ? object.id : null);
                setInventoryOffset(0);
            }}
            onDragOver={(object, event) => {
                if (object.id === 1 || object.id === 2 || (object.id === 8 && draggedItem?.canDrop)) allowDrop(event);
            }}
            onDrop={(object, event) => {
                event.preventDefault();
                if (object.id === 1) void unequipDragged();
                else if (object.id === 2) void equipDragged();
                else if (object.id === 8) {
                    const item = draggedRef.current;
                    if (item) void dropItem(item);
                }
            }}
        />

        {view === "characteristics" && activeRoleStates.map((binding, slot) => {
            const object = guiObject(INVENTORY_ROLE_STATE_OBJECT_IDS[slot]);
            return object && <ColorKeyImage key={binding.stateId} className="inventory-role-state"
                src={`/assets/engineres/hero_states/${binding.resource}.bmp`} style={guiObjectStyle(object)} />;
        })}

        {nativeTextDraws.map((draw) => (
            <span className="inventory-native-text" data-interface-string-id={draw.stringId}
                style={nativeTextStyle(draw)} key={draw.stringId}>{interfaceText(draw.stringId)}</span>
        ))}

        {CHARACTERISTICS.map((name, index) => progressionValue(name, 16 + index, 23 + index))}
        {view !== "characteristics" && SKILLS.map((name, index) => progressionValue(name, 30 + index * 2, 31 + index * 2))}
        {fieldValue("person-points", 97, 272, parameterValue("person_points"))}
        {view === "skills" && fieldValue("skill-points", 127, 790, parameterValue("skill_points"))}
        {view === "characteristics" && secondaryValues.map((value, index) => {
            const objectId = 160 + index;
            return fieldValue(`secondary-${objectId}`, objectId, SECONDARY_VALUE_RIGHT[objectId], value);
        })}

        {EQUIPMENT_SLOTS.map((slot) => {
            const rect = INVENTORY_EQUIPMENT_RECTS[slot];
            const item = inventory?.equipped[slot];
            return <button type="button" key={slot} className={equipmentClass(slot)} style={positionStyle(rect)}
                aria-label={item ? `${SLOT_LABELS[slot]}: ${item.literaryName}` : SLOT_LABELS[slot]}
                draggable={Boolean(item)}
                onDragStart={(event) => {
                    if (item) beginDrag(event, { technicalName: item.technicalName, equippedSlot: slot });
                }}
                onDragEnd={clearDragged}
                onDragOver={allowDrop}
                onDrop={(event) => { event.preventDefault(); void equipDragged(slot); }}
                onDoubleClick={() => { if (item) void game.unequipHeroItem(slot).then(async (changed) => { if (changed) await refresh(); }).catch(report); }}>
                {item && <>
                    <ItemIcon item={item} />
                    <ItemSelection small={SMALL_SELECTION_SLOTS.has(slot)} />
                </>}
            </button>;
        })}


        {error && <span className="inventory-error" role="alert">{error}</span>}
    </div>;

}
