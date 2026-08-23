import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DIARY_CONTENT_RECTS, DIARY_TAB_TEXT_DRAWS, type DiaryTabTextDraw, type NativeRect } from "../../constants/clientDll.ts";
import { MAIN_INTERFACE_FONT, MAIN_INTERFACE_STRIKEOUT_FONT, pointSizeToPixels } from "../../constants/fontsScr.ts";
import type { Game } from "../../game/Game.ts";
import type { GameRuntimeSnapshot } from "../../game/GameStateRuntime.ts";
import { SDBParser, type SDBData } from "../../game/parsers/SDBParser.ts";
import { MagicBookPanel } from "./MagicBookPanel.tsx";
import { OriginalGuiLayer, type GuiControlValue } from "../OriginalGuiLayer.tsx";
import { ColorKeyImage } from "../ColorKeyImage.tsx";

import styles from "./GameMenuPanel.module.scss";

export type GameMenuPanelKind = "character" | "journal" | "magic" | "console";

interface GameMenuPanelProps {
    readonly game: Game;
    readonly kind: GameMenuPanelKind;
    readonly onClose: () => void;
}

const PANEL_TITLES: Readonly<Record<GameMenuPanelKind, string>> = {
    character: "Характеристики и умения",
    journal: "Дневник",
    magic: "Книга магии",
    console: "Состояние игры",
};

const PANEL_BACKGROUNDS: Readonly<Record<GameMenuPanelKind, string>> = {
    character: "/assets/engineres/skills/main.bmp",
    journal: "/assets/engineres/diary/main.bmp",
    magic: "/assets/engineres/interface/magic_book/background.bmp",
    console: "/assets/engineres/interface/options_menu/background.bmp",
};

const readableName = (name: string): string => name
    .replace(/^(hero|player)[._-]?/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

type CharacterTab = "identity" | "characteristics" | "skills" | "condition" | "resistance";

const CHARACTER_TABS: readonly Readonly<{ id: CharacterTab; labelId: number }>[] = [
    { id: "identity", labelId: 0 },
    { id: "characteristics", labelId: 1 },
    { id: "skills", labelId: 2 },
    { id: "condition", labelId: 3 },
    { id: "resistance", labelId: 4 },
];

const PARAMETER_LABEL_IDS: Readonly<Record<string, number>> = {
    strength: 6,
    constitution: 7,
    dexterity: 8,
    perception: 9,
    wisdom: 10,
    intelligence: 11,
    luck: 12,
    experience: 15,
    reputation: 16,
    health: 27,
    life: 27,
    energy: 28,
    skill_wpn_sword: 49,
    skill_wpn_staff: 52,
    skill_wpn_dist: 53,
    skill_tactic: 67,
    skill_scout: 68,
    skill_healing: 69,
    skill_athletic: 75,
    skill_alchemy: 79,
    skill_identify: 81,
};

type DiaryTab = "story" | "side" | "biography" | "creatures" | "history";

interface DiaryData {
    readonly interfaceStrings: SDBData;
    readonly questTechnical: SDBData;
    readonly questLiterary: SDBData;
    readonly cityTechnical: SDBData;
    readonly cityLiterary: SDBData;
    readonly rolePerks: SDBData;
    readonly rolePerkDescriptions: SDBData;
    readonly creatureTechnical: SDBData;
    readonly creatureLiterary: SDBData;
    readonly creatureDescriptions: SDBData;
    readonly historyLiterary: SDBData;
    readonly historyDescriptions: SDBData;
}

interface DiaryEntry {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly completed?: boolean;
    readonly count?: number;
}

const DIARY_TABS: readonly Readonly<{ id: DiaryTab; labelId: number; page: number; objectId: number }>[] = [
    { id: "story", labelId: 104, page: 1, objectId: 1 },
    { id: "side", labelId: 105, page: 2, objectId: 2 },
    { id: "biography", labelId: 106, page: 3, objectId: 3 },
    { id: "creatures", labelId: 107, page: 4, objectId: 4 },
    { id: "history", labelId: 108, page: 5, objectId: 5 },
];

const STORYLINE_QUESTS = new Set([
    "aldan", "amulet", "axe", "bag", "book", "five", "gold", "helm", "nature", "never",
    "orden", "politic", "road", "sailor", "spell", "stone", "sword", "temple", "tower", "zlato",
]);

const loadSdb = async (path: string): Promise<SDBData> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Не удалось загрузить дневник: HTTP ${response.status} (${path})`);
    return new SDBParser(await response.arrayBuffer()).getData();
};

const loadDiaryData = async (): Promise<DiaryData> => {
    const base = "/assets/sdb/diary";
    const [
        interfaceStrings, questTechnical, questLiterary, cityTechnical, cityLiterary, rolePerks,
        rolePerkDescriptions, creatureTechnical, creatureLiterary, creatureDescriptions,
        historyLiterary, historyDescriptions,
    ] = await Promise.all([
        loadSdb("/assets/sdb/user_interface.sdb"),
        loadSdb(`${base}/single_quest_tech.sdb`),
        loadSdb(`${base}/single_quest_lit.sdb`),
        loadSdb(`${base}/cities_tech.sdb`),
        loadSdb(`${base}/cities_lit.sdb`),
        loadSdb(`${base}/role_perks.sdb`),
        loadSdb(`${base}/role_perks_desc.sdb`),
        loadSdb(`${base}/statistics_tech.sdb`),
        loadSdb(`${base}/statistics_lit.sdb`),
        loadSdb(`${base}/statistics_desc.sdb`),
        loadSdb(`${base}/history_lit.sdb`),
        loadSdb(`${base}/history_desc.sdb`),
    ]);
    return {
        interfaceStrings, questTechnical, questLiterary, cityTechnical, cityLiterary, rolePerks,
        rolePerkDescriptions, creatureTechnical, creatureLiterary, creatureDescriptions,
        historyLiterary, historyDescriptions,
    };
};

const databaseId = (database: SDBData, value: string): number | undefined => {
    const target = value.toLowerCase();
    const entry = Object.entries(database).find(([, candidate]) => candidate.toLowerCase() === target);
    return entry === undefined ? undefined : Number(entry[0]);
};

const sideQuestCity = (technicalName: string): string => {
    const name = technicalName.toLowerCase();
    if (name.startsWith("l10_")) return "hvarung";
    if (name.startsWith("l11_")) return "cycram";
    if (name.startsWith("l9_mine") || name.startsWith("l8_")) return "dargosh";
    if (name.startsWith("l9_")) return "marmaris";
    if (name.startsWith("l6_")) return "gulthan";
    if (name.startsWith("l5_")) return "pole";
    if (name.startsWith("l4_")) return "forpost";
    if (name.startsWith("l3_")) return "ra";
    if (name.startsWith("l2_")) return "korchma";
    if (name.startsWith("l1_")) return "svetlograd";
    if (["circle", "letter", "starosta"].includes(name)) return "som";
    return "other";
};


const playDiarySound = (file: "prevnext" | "close"): void => {
    const path = file === "prevnext" ? "/assets/sounds/ui/journal/prevnext.wav" : "/assets/sounds/ui/inventory/okcancelclick.wav";
    void new Audio(path).play().catch(() => undefined);
};

const diaryTabTextStyle = (draw: DiaryTabTextDraw, selected: boolean): CSSProperties => ({
    left: `${draw.x}px`,
    top: `${selected ? draw.selectedY : draw.unselectedY}px`,
    width: `${draw.boxWidth}px`,
    height: `${draw.boxHeight}px`,
    fontFamily: `ZlatoPalatino, "${MAIN_INTERFACE_FONT.typeFace}", serif`,
    fontSize: `${pointSizeToPixels(MAIN_INTERFACE_FONT.size)}px`,
    fontWeight: MAIN_INTERFACE_FONT.weight,
    color: selected ? "#000080" : "#000000",
});

const diaryContentStyle = (rect: NativeRect): CSSProperties => ({
    position: "absolute",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    fontFamily: `ZlatoPalatino, "${MAIN_INTERFACE_FONT.typeFace}", serif`,
    fontSize: `${pointSizeToPixels(MAIN_INTERFACE_FONT.size)}px`,
    fontWeight: MAIN_INTERFACE_FONT.weight,
});


export const RecoveredGameMenuPanel = ({ game, kind, onClose }: GameMenuPanelProps) => {
    const [snapshot, setSnapshot] = useState<GameRuntimeSnapshot | null>(() => game.getRuntimeSnapshot());
    const [characterTab, setCharacterTab] = useState<CharacterTab>("characteristics");
    const [interfaceStrings, setInterfaceStrings] = useState<SDBData>({});
    const [diaryData, setDiaryData] = useState<DiaryData | null>(null);
    const [diaryTab, setDiaryTab] = useState<DiaryTab>("story");
    const [diarySelection, setDiarySelection] = useState<string | null>(null);
    const [sideCity, setSideCity] = useState<string | null>(null);
    const leftPageRef = useRef<HTMLDivElement>(null);
    const rightPageRef = useRef<HTMLElement>(null);
    const [leftScroll, setLeftScroll] = useState({ position: 0, maximum: 0 });
    const [rightScroll, setRightScroll] = useState({ position: 0, maximum: 0 });

    useEffect(() => {
        const update = () => setSnapshot(game.getRuntimeSnapshot());
        update();
        const timer = window.setInterval(update, 400);
        return () => window.clearInterval(timer);
    }, [game]);


    useEffect(() => {
        if (kind !== "character") return;
        void loadSdb("/assets/sdb/user_interface.sdb").then(setInterfaceStrings).catch(console.error);
    }, [kind]);

    useEffect(() => {
        if (kind !== "journal") return;
        void loadDiaryData().then(setDiaryData).catch(console.error);
    }, [kind]);

    useEffect(() => {
        const close = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [onClose]);

    const heroParameters = useMemo(() => {
        if (!snapshot) return [];
        const entry = Object.entries(snapshot.personParameters).find(([name]) => name.toLowerCase() === "hero");
        return Object.entries(entry?.[1] ?? {}).sort(([left], [right]) => left.localeCompare(right, "ru"));
    }, [snapshot]);

    const heroParameterMap = useMemo(() => new Map(heroParameters.map(([name, value]) => [name.toLowerCase(), value])), [heroParameters]);
    const interfaceLabel = (id: number, fallback: string): string => interfaceStrings[id] ?? fallback;
    const parameterLabel = (name: string): string => {
        const id = PARAMETER_LABEL_IDS[name.toLowerCase()];
        return id === undefined ? readableName(name) : interfaceLabel(id, readableName(name));
    };
    const characteristicNames = ["strength", "constitution", "dexterity", "perception", "intelligence", "wisdom", "luck"] as const;
    const skillParameters = heroParameters.filter(([name]) => name.toLowerCase().startsWith("skill_"));
    const conditionParameters = heroParameters.filter(([name]) => /health|life|energy|mana|nutrition|condition/i.test(name));
    const resistanceParameters = heroParameters.filter(([name]) => /resist|immun|protect|armor/i.test(name));

    const questEntries = useMemo<readonly DiaryEntry[]>(() => {
        if (!snapshot || !diaryData || (diaryTab !== "story" && diaryTab !== "side")) return [];
        return Object.entries(snapshot.questFlags)
            .filter(([name]) => STORYLINE_QUESTS.has(name.toLowerCase()) === (diaryTab === "story"))
            .map(([name, completed]) => {
                const id = databaseId(diaryData.questTechnical, name);
                const stagePrefix = `${name.toLowerCase()}:`;
                const descriptions = Object.entries(snapshot.stageFlags)
                    .filter(([stage]) => stage.toLowerCase().startsWith(stagePrefix))
                    .map(([stage]) => stage.slice(stage.indexOf(":") + 1))
                    .map((stage) => databaseId(diaryData.questTechnical, stage))
                    .filter((stageId): stageId is number => stageId !== undefined)
                    .sort((left, right) => left - right)
                    .map((stageId) => diaryData.questLiterary[stageId])
                    .filter(Boolean);
                return {
                    id: name,
                    title: id === undefined ? readableName(name) : diaryData.questLiterary[id],
                    description: descriptions.join("\n\n"),
                    completed,
                };
            })
            .sort((left, right) => left.title.localeCompare(right.title, "ru"));
    }, [diaryData, diaryTab, snapshot]);

    const sideCities = useMemo(() => {
        if (!diaryData || diaryTab !== "side") return [];
        const cities = new Set(questEntries.map((entry) => sideQuestCity(entry.id)));
        return [...cities].map((technicalName) => {
            const id = databaseId(diaryData.cityTechnical, technicalName);
            return { technicalName, title: id === undefined ? readableName(technicalName) : diaryData.cityLiterary[id] };
        }).sort((left, right) => left.title.localeCompare(right.title, "ru"));
    }, [diaryData, diaryTab, questEntries]);

    const biographyEntries = useMemo<readonly DiaryEntry[]>(() => {
        if (!diaryData || diaryTab !== "biography") return [];
        const perks = Math.trunc(heroParameterMap.get("special_perks") ?? 0);
        return Object.entries(diaryData.rolePerks)
            .map(([id, title]) => ({ id: Number(id), title }))
            .filter(({ id, title }) => title && (perks & (1 << id)) !== 0)
            .map(({ id, title }) => ({ id: String(id), title, description: diaryData.rolePerkDescriptions[id] ?? "" }));
    }, [diaryData, diaryTab, heroParameterMap]);

    const creatureEntries = useMemo<readonly DiaryEntry[]>(() => {
        if (!diaryData || !snapshot || diaryTab !== "creatures") return [];
        return Object.entries(snapshot.bestiaryKills)
            .filter(([, count]) => count > 0)
            .flatMap(([technicalName, count]): DiaryEntry[] => {
                const id = databaseId(diaryData.creatureTechnical, technicalName);
                if (id === undefined) return [];
                return [{
                    id: String(id),
                    title: diaryData.creatureLiterary[id] ?? diaryData.creatureTechnical[id],
                    description: diaryData.creatureDescriptions[id] ?? "",
                    count,
                }];
            })
            .sort((left, right) => left.title.localeCompare(right.title, "ru"));
    }, [diaryData, diaryTab, snapshot]);

    const historyEntries = useMemo<readonly DiaryEntry[]>(() => {
        if (!diaryData || diaryTab !== "history") return [];
        return Object.entries(diaryData.historyLiterary)
            .filter(([, title]) => Boolean(title))
            .map(([id, title]) => ({ id, title, description: diaryData.historyDescriptions[Number(id)] ?? "" }));
    }, [diaryData, diaryTab]);

    const activeEntries = diaryTab === "story"
        ? questEntries
        : diaryTab === "side"
            ? questEntries.filter((entry) => sideCity !== null && sideQuestCity(entry.id) === sideCity)
            : diaryTab === "biography"
                ? biographyEntries
                : diaryTab === "creatures"
                    ? creatureEntries
                    : historyEntries;
    const selectedEntry = activeEntries.find((entry) => entry.id === diarySelection) ?? activeEntries[0];
    useEffect(() => {
        const animationFrame = window.requestAnimationFrame(() => {
            const left = leftPageRef.current;
            const right = rightPageRef.current;
            if (left) {
                left.scrollTop = 0;
                setLeftScroll({ position: 0, maximum: Math.max(0, left.scrollHeight - left.clientHeight) });
            }
            if (right) {
                right.scrollTop = 0;
                setRightScroll({ position: 0, maximum: Math.max(0, right.scrollHeight - right.clientHeight) });
            }
        });
        return () => window.cancelAnimationFrame(animationFrame);
    }, [activeEntries.length, diaryData, diaryTab, selectedEntry?.description, selectedEntry?.id, sideCity]);

    const scrollDiaryPage = (
        element: HTMLElement | null,
        direction: -1 | 1,
        update: (state: { position: number; maximum: number }) => void,
    ): void => {
        if (!element) return;
        const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
        const position = Math.max(0, Math.min(maximum, element.scrollTop + direction * element.clientHeight));
        element.scrollTop = position;
        update({ position, maximum });
    };
    const diaryLabel = (id: number, fallback: string): string => diaryData?.interfaceStrings[id] ?? fallback;
    const selectDiaryTab = (tab: DiaryTab): void => {
        setDiaryTab(tab);
        setDiarySelection(null);
        setSideCity(null);
    };

    if (kind === "magic") {
        return <MagicBookPanel game={game} snapshot={snapshot} onClose={onClose} />;
    }

    if (kind === "journal") {
        const page = DIARY_TABS.find((tab) => tab.id === diaryTab)?.page ?? 1;
        const activeTab = DIARY_TABS.find((tab) => tab.id === diaryTab) ?? DIARY_TABS[0];
        const controlValues: Record<number, GuiControlValue> = Object.fromEntries(
            DIARY_TABS.map((tab) => [tab.objectId, tab.id === diaryTab]),
        );
        const controlLabels = Object.fromEntries(DIARY_TABS.map((tab) => [tab.objectId, diaryLabel(tab.labelId, tab.id)]));
        const inactiveControls = [
            ...(leftScroll.position <= 0 ? [6] : []),
            ...(leftScroll.position >= leftScroll.maximum ? [7] : []),
            ...(rightScroll.position <= 0 ? [8] : []),
            ...(rightScroll.position >= rightScroll.maximum ? [9] : []),
        ];
        return <section className={`${styles.panel} ${styles.journal}`} role="dialog" aria-label="Дневник">
            <img className={styles.background} src="/assets/engineres/diary/main.bmp" alt="" draggable={false} />
            <img className={styles.diaryPageArt} src={`/assets/engineres/diary/page${page}.bmp`} alt="" draggable={false} />
            {diaryTab === "creatures" && <ColorKeyImage className={styles.diaryCreatureFrame} src="/assets/engineres/diary/page4_add.bmp" />}
            <OriginalGuiLayer className={styles.diaryAuthoredControls} script="diary"
                objectIds={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
                values={controlValues}
                labels={{
                    ...controlLabels,
                    6: "Предыдущая страница списка",
                    7: "Следующая страница списка",
                    8: "Предыдущая страница записи",
                    9: "Следующая страница записи",
                    10: "Закрыть дневник",
                }}
                inactiveObjectIds={inactiveControls}
                onValueChange={(object, value) => {
                    if (value !== true) return;
                    const tab = DIARY_TABS.find((candidate) => candidate.objectId === object.id);
                    if (tab) selectDiaryTab(tab.id);
                }}
                onAction={(object) => {
                    if (object.id === 6) scrollDiaryPage(leftPageRef.current, -1, setLeftScroll);
                    else if (object.id === 7) scrollDiaryPage(leftPageRef.current, 1, setLeftScroll);
                    else if (object.id === 8) scrollDiaryPage(rightPageRef.current, -1, setRightScroll);
                    else if (object.id === 9) scrollDiaryPage(rightPageRef.current, 1, setRightScroll);
                    else if (object.id === 10) onClose();
                }}
            />
            {DIARY_TAB_TEXT_DRAWS.map((draw) => {
                const selected = activeTab.objectId === draw.objectId;
                return <span className={styles.diaryNativeText} style={diaryTabTextStyle(draw, selected)}
                    data-interface-string-id={draw.stringId} key={draw.objectId}>
                    {diaryLabel(draw.stringId, String(draw.stringId))}
                </span>;
            })}
            <div ref={leftPageRef} className={styles.diaryLeftPage} style={diaryContentStyle(DIARY_CONTENT_RECTS.leftList)}>
                {!diaryData && <p>Загрузка дневника…</p>}
                {diaryData && diaryTab === "side" && sideCity === null && sideCities.map((city) => <button key={city.technicalName} type="button" onClick={() => {
                    playDiarySound("prevnext");
                    setSideCity(city.technicalName);
                    setDiarySelection(null);
                }}>{city.title}</button>)}
                {diaryTab === "side" && sideCity !== null && <button className={styles.diaryBack} type="button" onClick={() => {
                    playDiarySound("prevnext");
                    setSideCity(null);
                    setDiarySelection(null);
                }}>← Города</button>}
                {(diaryTab !== "side" || sideCity !== null) && activeEntries.map((entry) => <button
                    key={entry.id}
                    type="button"
                    className={entry.id === selectedEntry?.id ? styles.diarySelected : undefined}
                    data-completed={entry.completed || undefined}
                    style={entry.completed && MAIN_INTERFACE_STRIKEOUT_FONT.strikeout
                        ? { textDecoration: "line-through" }
                        : undefined}
                    onClick={() => { playDiarySound("prevnext"); setDiarySelection(entry.id); }}
                >{entry.title}{entry.count === undefined ? "" : ` — ${entry.count}`}</button>)}
                {diaryData && ((diaryTab === "side" && sideCity === null && sideCities.length === 0) || ((diaryTab !== "side" || sideCity !== null) && activeEntries.length === 0)) && <p>Нет записей.</p>}
            </div>
            {diaryTab === "creatures" && selectedEntry && <h2 className={styles.diaryCreatureTitle}
                style={diaryContentStyle(DIARY_CONTENT_RECTS.creatureTitle)}>{selectedEntry.title}</h2>}
            <article ref={rightPageRef} className={`${styles.diaryRightPage} ${diaryTab === "creatures" ? styles.diaryCreatureText : ""}`}
                style={diaryContentStyle(diaryTab === "creatures"
                    ? DIARY_CONTENT_RECTS.creatureDescription
                    : DIARY_CONTENT_RECTS.rightList)}>
                {selectedEntry && <>
                    {selectedEntry.description.split(/\r?\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                </>}
            </article>
        </section>;
    }

    return <section className={`${styles.panel} ${styles[kind]}`} role="dialog" aria-label={PANEL_TITLES[kind]}>
        <img className={styles.background} src={PANEL_BACKGROUNDS[kind]} alt="" draggable={false} />
        <header className={styles.header}>{kind === "character"
            ? interfaceLabel(CHARACTER_TABS.find((tab) => tab.id === characterTab)?.labelId ?? 1, PANEL_TITLES.character)
            : PANEL_TITLES[kind]}</header>

        {kind === "character" && <>
            {characterTab !== "identity" && <img className={styles.characterTabArtwork} src={`/assets/engineres/skills/tab${CHARACTER_TABS.findIndex((tab) => tab.id === characterTab) + 1}.bmp`} alt="" draggable={false} />}
            <div className={styles.characterTabs} aria-label="Разделы характеристик">
                {CHARACTER_TABS.map((tab, index) => <button
                    key={tab.id}
                    type="button"
                    className={styles.characterTab}
                    data-index={index + 1}
                    aria-label={interfaceLabel(tab.labelId, tab.id)}
                    aria-pressed={characterTab === tab.id}
                    onClick={() => setCharacterTab(tab.id)}
                />)}
            </div>
        </>}

        <div className={styles.content}>
            {kind === "character" && <div className={styles.characterStats}>
                {characterTab === "identity" && <div className={styles.statGrid}>
                    <div><span>{interfaceLabel(5, "Имя")}</span><strong>Герой</strong></div>
                    <div><span>{interfaceLabel(15, "Опыт")}</span><strong>{snapshot?.experience ?? 0}</strong></div>
                    <div><span>{interfaceLabel(16, "Слава")}</span><strong>{heroParameterMap.get("reputation") ?? 0}</strong></div>
                    <div><span>Очки навыков</span><strong>{heroParameterMap.get("skill_points") ?? 0}</strong></div>
                </div>}
                {characterTab === "characteristics" && <div className={styles.statGrid}>
                    {characteristicNames.map((name) => <div key={name}><span>{parameterLabel(name)}</span><strong>{heroParameterMap.get(name) ?? 0}</strong></div>)}
                </div>}
                {characterTab === "skills" && <div className={styles.statGrid}>
                    {skillParameters.map(([name, value]) => <div key={name}><span>{parameterLabel(name)}</span><strong>{value}</strong></div>)}
                </div>}
                {characterTab === "condition" && <div className={styles.statGrid}>
                    {conditionParameters.length > 0
                        ? conditionParameters.map(([name, value]) => <div key={name}><span>{parameterLabel(name)}</span><strong>{value}</strong></div>)
                        : <p>Нет активных состояний.</p>}
                </div>}
                {characterTab === "resistance" && <div className={styles.statGrid}>
                    {resistanceParameters.length > 0
                        ? resistanceParameters.map(([name, value]) => <div key={name}><span>{parameterLabel(name)}</span><strong>{value}</strong></div>)
                        : <p>Нет модификаторов сопротивления.</p>}
                </div>}
            </div>}

            {kind === "console" && <>
                <h2>Переменные сценария</h2>
                <div className={styles.consoleList}>{Object.entries(snapshot?.variables ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => <div key={name}>
                    <code>{name}</code><span>{String(value)}</span>
                </div>)}</div>
            </>}
        </div>
        <button className={styles.close} type="button" onClick={onClose} aria-label="Закрыть">×</button>
    </section>;
};
