import { useEffect, useMemo, useState } from "react";
import type { Game } from "../../game/Game.ts";
import type { GameRuntimeSnapshot } from "../../game/GameStateRuntime.ts";
import { SDBParser, type SDBData } from "../../game/parsers/SDBParser.ts";
import { loadGuiDefinition, type GuiDefinition } from "../../game/GuiDefinitionRuntime.ts";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
import { guiObjectStyle, OriginalGuiLayer, type GuiControlValue } from "../OriginalGuiLayer.tsx";
import styles from "./GameMenuPanel.module.scss";

interface MagicBookPanelProps {
    readonly game: Game;
    readonly snapshot: GameRuntimeSnapshot | null;
    readonly onClose: () => void;
}

interface MagicBookData {
    readonly spellNames: SDBData;
    readonly spellDescriptions: SDBData;
    readonly spellTechnicalNames: SDBData;
}

const MAGIC_SCHOOLS = [
    { name: "Магия богов", magicIds: [36, 27, 30, 33, 28, 32, 29, 34, 37, 26, 31, 35, 38] },
    { name: "Магия света", magicIds: [45, 40, 47, 42, 43, 46, 39, 50, 51, 48, 44, 41, 49] },
    { name: "Магия природы", magicIds: [53, 60, 62, 52, 56, 61, 54, 59, 63, 58, 64, 55, 57] },
    { name: "Магия стихий", magicIds: [15, 17, 18, 16, 21, 24, 14, 20, 23, 13, 25, 19, 22] },
    { name: "Магия теней", magicIds: [66, 69, 77, 73, 72, 70, 65, 71, 74, 68, 75, 76, 67] },
    { name: "Магия тьмы", magicIds: [1, 11, 8, 0, 6, 12, 3, 9, 4, 2, 5, 7, 10] },
] as const;
const SPELLS_PER_SCHOOL = 13;

const loadSdb = async (path: string): Promise<SDBData> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Magic database request failed for ${path}: HTTP ${response.status}`);
    return new SDBParser(await response.arrayBuffer()).getData();
};

const loadMagicBookData = async (): Promise<MagicBookData> => {
    const [spellNames, spellDescriptions, spellTechnicalNames] = await Promise.all([
        loadSdb("/assets/sdb/magic/magiclitnames.sdb"),
        loadSdb("/assets/sdb/magic/magicdescription.sdb"),
        loadSdb("/assets/sdb/magic/magictechnames.sdb"),
    ]);
    return { spellNames, spellDescriptions, spellTechnicalNames };
};

const playMagicSound = (sound: "panel" | "select" | "close"): void => {
    const source = sound === "panel"
        ? "/assets/sounds/ui/magic_panel.wav"
        : sound === "select"
            ? "/assets/sounds/ui/inventory/select.wav"
            : "/assets/sounds/ui/inventory/okcancelclick.wav";
    void new Audio(source).play().catch(() => undefined);
};

const spellIcon = (technicalName: string, highlighted: boolean): string =>
    `/assets/engineres/interface/magic_book/magic_icons/${highlighted ? "cast" : "glow"}/${technicalName}.bmp`;


export const MagicBookPanel = ({ game, snapshot, onClose }: MagicBookPanelProps) => {
    const [data, setData] = useState<MagicBookData | null>(null);
    const [guiDefinition, setGuiDefinition] = useState<GuiDefinition | null>(null);
    const [school, setSchool] = useState(0);
    const [selectedMagicId, setSelectedMagicId] = useState<number | null>(null);
    const [hoveredMagicId, setHoveredMagicId] = useState<number | null>(null);
    const [pressedMagicId, setPressedMagicId] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        void Promise.all([loadMagicBookData(), loadGuiDefinition("magic_book")]).then(([loaded, gui]) => {
            if (cancelled) return;
            setData(loaded);
            setGuiDefinition(gui);
        }).catch(console.error);
        playMagicSound("panel");
        return () => { cancelled = true; };
    }, []);

    const knownSpells = new Set(snapshot?.magic.knownSpellIds ?? []);
    const visibleMagicIds = MAGIC_SCHOOLS[school].magicIds;
    const selectedName = selectedMagicId === null ? "" : data?.spellNames[selectedMagicId] ?? `Заклинание ${selectedMagicId}`;
    const selectedDescription = selectedMagicId === null ? "" : data?.spellDescriptions[selectedMagicId] ?? "";
    const schoolName = MAGIC_SCHOOLS[school].name;
    const guiObjects = useMemo(
        () => new Map(guiDefinition?.objects.map((object) => [object.id, object]) ?? []),
        [guiDefinition],
    );
    const controlValues: Record<number, GuiControlValue> = Object.fromEntries(
        MAGIC_SCHOOLS.map((_, index) => [index + 3, school === index]),
    );

    const selectSpell = (magicId: number): void => {
        setSelectedMagicId(magicId);
        playMagicSound("select");
    };
    const assignFirstFreeSlot = (magicId: number): void => {
        const slots = snapshot?.magic.hotbarSpellIds ?? [];
        const freeSlot = slots.findIndex((value) => value === null);
        if (freeSlot >= 0 && game.setHeroMagicHotbar(freeSlot, magicId)) playMagicSound("select");
    };
    const setSchoolAndReset = (nextSchool: number): void => {
        setSchool(nextSchool);
        setSelectedMagicId(null);
    };

    return <section className={`${styles.panel} ${styles.magic}`} role="dialog" aria-label="Книга магии">
        <img className={styles.background} src="/assets/engineres/interface/magic_book/background.bmp" alt="" draggable={false} />

        <div className={styles.magicSpellTree} aria-label={`Заклинания: ${schoolName}`}>
            {visibleMagicIds.map((magicId, index) => {
                const object = guiObjects.get(index + 9);
                if (!object || !knownSpells.has(magicId)) return null;
                return <button
                    key={magicId}
                    type="button"
                    className={styles.magicSpell}
                    style={guiObjectStyle(object)}
                    aria-label={data?.spellNames[magicId] ?? `Заклинание ${magicId}`}
                    aria-pressed={selectedMagicId === magicId}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/x-zlato-magic", String(magicId))}
                    onMouseEnter={() => setHoveredMagicId(magicId)}
                    onMouseLeave={() => { setHoveredMagicId(null); setPressedMagicId(null); }}
                    onMouseDown={() => setPressedMagicId(magicId)}
                    onMouseUp={() => setPressedMagicId(null)}
                    onClick={() => selectSpell(magicId)}
                    onDoubleClick={() => assignFirstFreeSlot(magicId)}
                >{data?.spellTechnicalNames[magicId] && <ColorKeyImage src={spellIcon(data.spellTechnicalNames[magicId], pressedMagicId === magicId || hoveredMagicId === magicId || selectedMagicId === magicId)} />}</button>;
            })}
        </div>

        <article className={styles.magicDescription} aria-live="polite">
            {selectedMagicId === null
                ? <><h2>{schoolName}</h2><p>Изучено заклинаний: {visibleMagicIds.filter((magicId) => knownSpells.has(magicId)).length} из {SPELLS_PER_SCHOOL}</p></>
                : <><h2>{selectedName}</h2><p>{selectedDescription || "Описание заклинания отсутствует."}</p></>}
        </article>
        <article className={styles.magicHint}>
            <h3>{selectedMagicId === null ? "Книга заклинаний" : selectedName}</h3>
            <p>{selectedMagicId === null
                ? "Изученные заклинания появляются в дереве школы. Перетащите заклинание в нижнюю панель или дважды нажмите на него."
                : "Перетащите заклинание в один из девяти слотов быстрого доступа."}</p>
        </article>

        <OriginalGuiLayer className={styles.magicAuthoredControls} script="magic_book"
            objectIds={[1, 2, 3, 4, 5, 6, 7, 8]}
            values={controlValues}
            inactiveObjectIds={selectedMagicId === null ? [2] : []}
            onValueChange={(object, value) => {
                if (value === true && object.id >= 3 && object.id <= 8) setSchoolAndReset(object.id - 3);
            }}
            onAction={(object) => {
                if (object.id === 1) onClose();
                else if (object.id === 2 && selectedMagicId !== null) assignFirstFreeSlot(selectedMagicId);
            }}
        />

        <div className={styles.magicHotbar} aria-label="Быстрый доступ к магии">
            {(snapshot?.magic.hotbarSpellIds ?? Array.from({ length: 9 }, () => null)).map((magicId, slot) => {
                const object = guiObjects.get(slot + 22);
                if (!object) return null;
                return <button
                    key={slot}
                    className={styles.magicHotbarSlot}
                    style={guiObjectStyle(object)}
                    type="button"
                    aria-label={magicId === null ? `Пустой слот ${slot + 1}` : `${slot + 1}: ${data?.spellNames[magicId] ?? `Заклинание ${magicId}`}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                        event.preventDefault();
                        const droppedId = Number(event.dataTransfer.getData("application/x-zlato-magic"));
                        if (Number.isSafeInteger(droppedId) && game.setHeroMagicHotbar(slot, droppedId)) playMagicSound("select");
                    }}
                    onClick={() => { if (magicId !== null) selectSpell(magicId); }}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        if (game.setHeroMagicHotbar(slot, null)) playMagicSound("select");
                    }}
                >{magicId !== null && data?.spellTechnicalNames[magicId] && <ColorKeyImage src={spellIcon(data.spellTechnicalNames[magicId], selectedMagicId === magicId)} />}</button>;
            })}
        </div>

    </section>;
};
