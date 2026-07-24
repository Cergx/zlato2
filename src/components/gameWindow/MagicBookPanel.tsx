import { useEffect, useState } from "react";
import type { Game } from "../../game/Game.ts";
import type { GameRuntimeSnapshot } from "../../game/GameStateRuntime.ts";
import { SDBParser, type SDBData } from "../../game/parsers/SDBParser.ts";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
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
    { name: "Магия стихий", magicIds: [15, 17, 18, 16, 21, 24, 14, 20, 23, 13, 25, 19, 22] },
    { name: "Магия света", magicIds: [45, 40, 47, 42, 43, 46, 39, 50, 51, 48, 44, 41, 49] },
    { name: "Магия тьмы", magicIds: [1, 11, 8, 0, 6, 12, 3, 9, 4, 2, 5, 7, 10] },
    { name: "Магия теней", magicIds: [66, 69, 77, 73, 72, 70, 65, 71, 74, 68, 75, 76, 67] },
    { name: "Магия природы", magicIds: [53, 60, 62, 52, 56, 61, 54, 59, 63, 58, 64, 55, 57] },
] as const;
const SPELLS_PER_SCHOOL = 13;
const SPELL_POSITIONS = [
    [122, 41],
    [96, 113], [144, 113],
    [77, 188], [122, 188], [168, 188],
    [65, 264], [122, 264], [176, 264],
    [48, 339], [96, 339], [144, 339], [191, 339],
] as const;

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

const schoolButton = (school: number, pressed: boolean): string =>
    `/assets/engineres/interface/magic_book/buttons/${school + 1}_${pressed ? "down" : "up"}.bmp`;

export const MagicBookPanel = ({ game, snapshot, onClose }: MagicBookPanelProps) => {
    const [data, setData] = useState<MagicBookData | null>(null);
    const [school, setSchool] = useState(0);
    const [selectedMagicId, setSelectedMagicId] = useState<number | null>(null);
    const [hoveredMagicId, setHoveredMagicId] = useState<number | null>(null);
    const [pressedMagicId, setPressedMagicId] = useState<number | null>(null);
    const [hoveredSchool, setHoveredSchool] = useState<number | null>(null);
    const [pressedSchool, setPressedSchool] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        void loadMagicBookData().then((loaded) => {
            if (!cancelled) setData(loaded);
        }).catch(console.error);
        playMagicSound("panel");
        return () => { cancelled = true; };
    }, []);

    const knownSpells = new Set(snapshot?.magic.knownSpellIds ?? []);
    const visibleMagicIds = MAGIC_SCHOOLS[school].magicIds;
    const selectedName = selectedMagicId === null ? "" : data?.spellNames[selectedMagicId] ?? `Заклинание ${selectedMagicId}`;
    const selectedDescription = selectedMagicId === null ? "" : data?.spellDescriptions[selectedMagicId] ?? "";
    const schoolName = MAGIC_SCHOOLS[school].name;

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
        playMagicSound("select");
    };

    return <section className={`${styles.panel} ${styles.magic}`} role="dialog" aria-label="Книга магии">
        <img className={styles.background} src="/assets/engineres/interface/magic_book/background.bmp" alt="" draggable={false} />

        <div className={styles.magicSpellTree} aria-label={`Заклинания: ${schoolName}`}>
            {visibleMagicIds.map((magicId, index) => knownSpells.has(magicId) && <button
                key={magicId}
                type="button"
                className={styles.magicSpell}
                style={{ left: `${SPELL_POSITIONS[index][0] / 441 * 100}%`, top: `${SPELL_POSITIONS[index][1] / 440 * 100}%` }}
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
            >{data?.spellTechnicalNames[magicId] && <ColorKeyImage src={spellIcon(data.spellTechnicalNames[magicId], pressedMagicId === magicId || hoveredMagicId === magicId || selectedMagicId === magicId)} />}</button>)}
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

        <nav className={styles.magicSchools} aria-label="Школы магии">
            {MAGIC_SCHOOLS.map((magicSchool, index) => <button
                key={magicSchool.name}
                type="button"
                aria-label={magicSchool.name}
                aria-pressed={school === index}
                onMouseEnter={() => setHoveredSchool(index)}
                onMouseLeave={() => { setHoveredSchool(null); setPressedSchool(null); }}
                onMouseDown={() => setPressedSchool(index)}
                onMouseUp={() => setPressedSchool(null)}
                onClick={() => setSchoolAndReset(index)}
            ><ColorKeyImage src={schoolButton(index, pressedSchool === index || hoveredSchool === index || school === index)} /></button>)}
        </nav>

        <div className={styles.magicHotbar} aria-label="Быстрый доступ к магии">
            {(snapshot?.magic.hotbarSpellIds ?? Array.from({ length: 9 }, () => null)).map((magicId, slot) => <button
                key={slot}
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
            >{magicId !== null && data?.spellTechnicalNames[magicId] && <ColorKeyImage src={spellIcon(data.spellTechnicalNames[magicId], selectedMagicId === magicId)} />}</button>)}
        </div>

        <button className={styles.magicCast} type="button" aria-label="Назначить выбранное заклинание" disabled={selectedMagicId === null} onClick={() => {
            if (selectedMagicId !== null) assignFirstFreeSlot(selectedMagicId);
        }} />
        <button className={styles.magicClose} type="button" aria-label="Закрыть книгу магии" onClick={() => {
            playMagicSound("close");
            onClose();
        }} />
    </section>;
};
