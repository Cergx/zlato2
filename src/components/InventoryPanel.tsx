import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
    INVENTORY_CHARACTER_NAME_DRAW,
    INVENTORY_NATIVE_TEXT_DRAWS,
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
import { SDBParser, type SDBData } from "../game/parsers/SDBParser.ts";
import { HeroCharacteristicsBlock } from "./HeroCharacteristicsBlock.tsx";
import { HeroSkillsBlock } from "./HeroSkillsBlock.tsx";
import { HeroStatsBlock } from "./HeroStatsBlock.tsx";
import { InventoryBlock } from "./InventoryBlock.tsx";
import { OriginalGuiLayer, type GuiControlValue } from "./OriginalGuiLayer.tsx";
import { ItemContainer } from "./ItemContainer.tsx";
import { ItemIcon } from "./ItemIcon.tsx";

import "./InventoryPanel.css";

interface InventoryPanelProps {
    readonly game: Game;
    readonly onClose: () => void;
    readonly initialView?: "inventory" | "skills" | "characteristics";
    readonly tooltipDelayMs: number;
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

const BASE_GUI_IDS = [2, 5, 6, 7, 84, 85, 98, 99] as const;
const STATS_EXTRA_GUI_IDS = Array.from({ length: 8 }, (_, index) => 90 + index);
const SKILLS_EXTRA_GUI_IDS = Array.from({ length: 28 }, (_, index) => 100 + index);
const INVENTORY_FILTER_IDS = Array.from({ length: 7 }, (_, index) => 9 + index);
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






export default function InventoryPanel({ game, onClose, tooltipDelayMs, initialView = "inventory" }: InventoryPanelProps) {
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
    const [heroStateStrings, setHeroStateStrings] = useState<SDBData>({});
    const [interfaceStrings, setInterfaceStrings] = useState<SDBData>({});
    const [hintStrings, setHintStrings] = useState<SDBData>({});
    const [perkNames, setPerkNames] = useState<SDBData>({});
    const [perkDescriptions, setPerkDescriptions] = useState<SDBData>({});
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
            fetch("/assets/sdb/perks/perks_lit.sdb").then(async (response) => {
                if (!response.ok) throw new Error(`Perk names failed: HTTP ${response.status}`);
                return new SDBParser(await response.arrayBuffer()).getData();
            }),
            fetch("/assets/sdb/perks/perks_desc.sdb").then(async (response) => {
                if (!response.ok) throw new Error(`Perk descriptions failed: HTTP ${response.status}`);
                return new SDBParser(await response.arrayBuffer()).getData();
            }),
        ]).then(
            ([loadedStrings, loadedHints, loadedHeroStates, loadedPerkNames, loadedPerkDescriptions]) => {
                if (cancelled) return;
                setInterfaceStrings(loadedStrings);
                setHintStrings(loadedHints);
                setHeroStateStrings(loadedHeroStates);
                setPerkNames(loadedPerkNames);
                setPerkDescriptions(loadedPerkDescriptions);
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

    const heroParameters = useMemo(() => Object.entries(snapshot?.personParameters ?? {})
        .find(([name]) => name.toLowerCase() === "hero")?.[1] ?? {}, [snapshot?.personParameters]);
    const normalizedHeroParameters = Object.fromEntries(
        Object.entries(heroParameters).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const parameterValue = useCallback((name: string): number => Object.entries(heroParameters)
        .find(([candidate]) => candidate.toLowerCase() === name)?.[1] ?? 0, [heroParameters]);
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

    const maximumOffset = Math.max(0, (inventory?.items.length ?? 0) - INVENTORY_PAGE_SIZE);
    const visibleItems = inventory?.items.slice(inventoryOffset, inventoryOffset + INVENTORY_PAGE_SIZE) ?? [];
    useEffect(() => {
        setInventoryOffset((current) => Math.min(current, maximumOffset));
    }, [maximumOffset]);
    const interfaceText = (id: number): string => interfaceStrings[id] ?? "";

    const authoredValues: Record<number, GuiControlValue> = { 84: "1", 85: "2" };
    const authoredLabels = { 5: interfaceText(1), 6: interfaceText(2) };

    const handleGuiAction = (objectId: number): void => {
        if (objectId === 5) setView("characteristics");
        else if (objectId === 6) setView("skills");
        else if (objectId === 7) onClose();
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
    }, [activeRoleStates, heroStateStrings, hintStrings, parameterValue]);


    return <div className="inventory-panel" role="dialog" aria-label="Инвентарь и характеристики" data-item-tooltip-root>
        <img className="inventory-panel-background" src={INVENTORY_NATIVE_RESOURCES.backgrounds[view]} alt="" draggable={false} />
        <div className="inventory-character-name" style={characterNameStyle}>{heroName}</div>

        <OriginalGuiLayer
            className="inventory-authored-controls"
            script={INVENTORY_NATIVE_RESOURCES.script}
            objectIds={BASE_GUI_IDS}
            values={authoredValues}
            labels={authoredLabels}
            tooltips={authoredTooltips}
            tooltipDelayMs={tooltipDelayMs}
            onAction={(object) => handleGuiAction(object.id)}
            objectContents={{
                99: <ItemContainer columns={INVENTORY_QUICK_ACCESS_SLOTS} rows={1}
                    className="inventory-quick-access" ariaLabel="Быстрый доступ">
                    {Array.from({ length: INVENTORY_QUICK_ACCESS_SLOTS }, (_, slot) => (
                        <div className="inventory-quick-access-slot" data-quick-access-slot={slot}
                            aria-label={`Слот быстрого доступа ${slot + 1}`} key={slot} />
                    ))}
                </ItemContainer>,
            }}
            onDragOver={(object, event) => { if (object.id === 2) allowDrop(event); }}
            onDrop={(object, event) => {
                if (object.id !== 2) return;
                event.preventDefault();
                void equipDragged();
            }}
        />

        <InventoryBlock script={INVENTORY_NATIVE_RESOURCES.script}
            containerObjectId={1} previousObjectId={3} nextObjectId={4} dropObjectId={8}
            filterObjectIds={INVENTORY_FILTER_IDS} activeFilterId={activeFilterId}
            canGoPrevious={inventoryOffset > 0} canGoNext={inventoryOffset < maximumOffset}
            canDrop={Boolean(draggedItem?.canDrop)} tooltips={authoredTooltips} tooltipDelayMs={tooltipDelayMs}
            onPrevious={() => setInventoryOffset((current) => Math.max(0, current - INVENTORY_PAGE_SIZE))}
            onNext={() => setInventoryOffset((current) => Math.min(maximumOffset, current + INVENTORY_PAGE_SIZE))}
            onFilterChange={(objectId) => { setActiveFilterId(objectId); setInventoryOffset(0); }}
            onDragOver={(object, event) => {
                if (object.id === 1 || (object.id === 8 && draggedItem?.canDrop)) allowDrop(event);
            }}
            onDrop={(object, event) => {
                event.preventDefault();
                if (object.id === 1) void unequipDragged();
                else if (object.id === 8) {
                    const item = draggedRef.current;
                    if (item) void dropItem(item);
                }
            }}
            content={<ItemContainer columns={INVENTORY_PAGE_SIZE} rows={1} className="inventory-bag" ariaLabel="Предметы">
                {visibleItems.map((item) => <button type="button" key={item.stackKey}
                    className="inventory-item"
                    aria-label={`${item.literaryName}, ${item.quantity}`}
                    draggable
                    onDragStart={(event) => beginDrag(event, { technicalName: item.technicalName, stackKey: item.stackKey })}
                    onDoubleClick={() => void activateInventoryItem(item)}>
                    <ItemIcon item={item} quantity={item.quantity} />
                </button>)}
            </ItemContainer>} />

        <HeroStatsBlock script={INVENTORY_NATIVE_RESOURCES.script}
            parameters={normalizedHeroParameters} strings={interfaceStrings}
            extraObjectIds={STATS_EXTRA_GUI_IDS} tooltips={authoredTooltips} tooltipDelayMs={tooltipDelayMs}
            onAdjust={(parameter, direction) => void adjustProgression(parameter, "characteristic", direction)} />

        {view === "skills"
            ? <HeroSkillsBlock script={INVENTORY_NATIVE_RESOURCES.script}
                parameters={normalizedHeroParameters} strings={interfaceStrings}
                perkNames={perkNames} perkDescriptions={perkDescriptions}
                derivedValues={{ initiative: profile?.initiative, effectiveIntelligence: profile?.effectiveAttributes.intelligence }}
                extraObjectIds={SKILLS_EXTRA_GUI_IDS} tooltips={authoredTooltips} tooltipDelayMs={tooltipDelayMs}
                onAdjust={(parameter, direction) => void adjustProgression(parameter, "skill", direction)} />
            : <HeroCharacteristicsBlock script={INVENTORY_NATIVE_RESOURCES.script}
                strings={interfaceStrings} values={secondaryValues} roleStates={activeRoleStates}
                tooltips={authoredTooltips} tooltipDelayMs={tooltipDelayMs} />}

        {INVENTORY_NATIVE_TEXT_DRAWS.common.slice(0, 2).map((draw) => (
            <span className="inventory-native-text" data-interface-string-id={draw.stringId}
                style={nativeTextStyle(draw)} key={draw.stringId}>{interfaceText(draw.stringId)}</span>
        ))}

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
                </>}
            </button>;
        })}


        {error && <span className="inventory-error" role="alert">{error}</span>}
    </div>;

}
