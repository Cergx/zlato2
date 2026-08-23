import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
    SAVE_LOAD_DETAILS_RECT,
    SAVE_LOAD_PAGE_COUNT,
    SAVE_LOAD_PREVIEW_RECT,
    SAVE_LOAD_SLOT_RECTS,
    SAVE_LOAD_SLOTS_FRAME_RECT,
    SAVE_LOAD_SLOTS_PER_PAGE,
    SAVE_LOAD_TITLE_RECT,
    SAVE_LOAD_TITLE_STRING_IDS,
    type NativeRect,
} from "../constants/clientDll.ts";
import {
    BUTTON_HEADS_INTERFACE_FONT,
    HEADS_INTERFACE_FONT,
    MAIN_INTERFACE_FONT,
    pointSizeToPixels,
    type ShippedFontDefinition,
} from "../constants/fontsScr.ts";
import type { Game } from "../game/Game.ts";
import {
    GOLDENLAND_START_DAY,
    GOLDENLAND_START_MONTH,
    GOLDENLAND_START_YEAR,
    LocalStorageAdapter,
    PersistenceRuntime,
    type GameClock,
    type GameSaveData,
} from "../game/PersistenceRuntime.ts";
import { loadCSX } from "../game/Assets.ts";
import { SDBParser, type SDBData } from "../game/parsers/SDBParser.ts";
import { OriginalGuiLayer } from "./OriginalGuiLayer.tsx";
import styles from "./SaveLoadMenuPanel.module.scss";

const slotsForPage = (page: number): string[] => Array.from(
    { length: SAVE_LOAD_SLOTS_PER_PAGE },
    (_, index) => `slot${page * SAVE_LOAD_SLOTS_PER_PAGE + index}`,
);

const nativeRectStyle = ({ left, top, width, height }: NativeRect): CSSProperties => ({
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
});

const shippedFontStyle = (font: ShippedFontDefinition): CSSProperties => ({
    fontFamily: `ZlatoPalatino, "${font.typeFace}", serif`,
    fontSize: `${pointSizeToPixels(font.size)}px`,
    fontWeight: font.weight,
});

const CsxImage = ({ src, className, style }: {
    readonly src: string;
    readonly className: string;
    readonly style?: CSSProperties;
}) => {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        void loadCSX(src).then((canvas) => { if (!cancelled && canvas) setUrl(canvas.toDataURL("image/png")); });
        return () => { cancelled = true; };
    }, [src]);
    return url ? <img className={className} style={style} src={url} alt="" draggable={false} /> : null;
};

export interface SaveLoadMenuPanelProps {
    readonly mode: "save" | "load";
    readonly game?: Game | null;
    readonly onClose: () => void;
    readonly onLoad?: (slot: string, save: GameSaveData) => void;
}

interface SaveDescription {
    readonly title: string;
    readonly metadata: string;
    readonly details: string;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatNativeDate = (date: Date): string => `${pad2(date.getHours())}:${pad2(date.getMinutes())} ${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;

const formatGameDate = (clock: GameClock): string => {
    const date = new Date(Date.UTC(GOLDENLAND_START_YEAR, GOLDENLAND_START_MONTH - 1, GOLDENLAND_START_DAY + clock.day, 0, clock.minuteOfDay));
    return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} ${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
};

const describeSave = (save: GameSaveData | null): SaveDescription => {
    if (!save) return { title: "Пусто", metadata: "", details: "" };
    return {
        title: save.metadata.name,
        metadata: save.metadata.savedAt ? formatNativeDate(new Date(save.metadata.savedAt)) : "",
        details: `${save.metadata.locationTitle}\n${formatGameDate(save.clock)}`,
    };
};

export const SaveLoadMenuPanel = ({ mode, game, onClose, onLoad }: SaveLoadMenuPanelProps) => {
    const persistence = useMemo(() => new PersistenceRuntime(new LocalStorageAdapter(localStorage)), []);
    const [page, setPage] = useState(0);
    const [selected, setSelected] = useState(0);
    const [revision, setRevision] = useState(0);
    const [message, setMessage] = useState("");
    const [saveName, setSaveName] = useState("");
    const [interfaceStrings, setInterfaceStrings] = useState<SDBData>({});
    const slots = slotsForPage(page);
    const saves = slots.map((slot) => {
        try { return persistence.load(slot); } catch { return null; }
    });
    const descriptions = saves.map(describeSave);

    useEffect(() => {
        if (mode !== "save") return;
        const slot = slotsForPage(page)[selected];
        try {
            setSaveName(persistence.load(slot)?.metadata.name ?? "");
        } catch {
            setSaveName("");
        }
    }, [mode, page, persistence, revision, selected]);

    useEffect(() => {
        let cancelled = false;
        void fetch("/assets/sdb/user_interface.sdb").then(async (response) => {
            if (!response.ok) throw new Error(`Interface strings failed: HTTP ${response.status}`);
            return new SDBParser(await response.arrayBuffer()).getData();
        }).then((loaded) => { if (!cancelled) setInterfaceStrings(loaded); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    const commit = async (slotIndex = selected): Promise<void> => {
        const slot = slots[slotIndex];
        if (mode === "save") {
            if (!game) return;
            const name = slotIndex === selected
                ? saveName
                : saves[slotIndex]?.metadata.name ?? "";
            try {
                game.save(slot, name);
                setRevision((value) => value + 1);
                setMessage("Игра сохранена");
            } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error));
            }
            return;
        }
        const save = saves[slotIndex];
        if (!save) {
            setMessage("Слот пуст");
            return;
        }
        if (game) {
            await game.load(slot);
            onClose();
        } else {
            onLoad?.(slot, save);
        }
    };

    const titleId = SAVE_LOAD_TITLE_STRING_IDS[mode];
    const title = interfaceStrings[titleId] ?? (mode === "save" ? "Сохранить" : "Загрузить");
    const details = message || descriptions[selected]?.details || "";
    const selectedSave = saves[selected] ?? null;
    const selectedPreview = selectedSave?.metadata.preview ?? null;
    void revision;

    return (
        <section className={styles.panel} aria-label={mode === "save" ? "Сохранение игры" : "Загрузка игры"}>
            <CsxImage className={styles.background} src="/assets/engineres/interface/save_load_menu/background.csx" />
            {selectedPreview ? (
                <img className={styles.preview} style={nativeRectStyle(SAVE_LOAD_PREVIEW_RECT)}
                    src={selectedPreview} alt="" draggable={false} />
            ) : !selectedSave ? (
                <img className={styles.preview} style={nativeRectStyle(SAVE_LOAD_PREVIEW_RECT)}
                    src="/assets/engineres/interface/save_load_menu/back.bmp" alt="" draggable={false} />
            ) : null}
            <CsxImage className={styles.slotsFrame} style={nativeRectStyle(SAVE_LOAD_SLOTS_FRAME_RECT)}
                src="/assets/engineres/interface/save_load_menu/slots.csx" />
            <CsxImage className={styles.slotFocus} style={nativeRectStyle(SAVE_LOAD_SLOT_RECTS[selected])}
                src="/assets/engineres/interface/save_load_menu/focus_slot.csx" />

            <div className={styles.slotList} role="list" aria-label="Слоты сохранений">
                {descriptions.map((description, index) => (
                    <button key={slots[index]} role="listitem" type="button"
                        className={styles.slot} style={{
                            ...nativeRectStyle(SAVE_LOAD_SLOT_RECTS[index]),
                            ...shippedFontStyle(HEADS_INTERFACE_FONT),
                        }}
                        aria-pressed={selected === index}
                        onClick={() => { setSelected(index); setMessage(""); }}
                        onDoubleClick={() => { setSelected(index); void commit(index); }}>
                        {(mode !== "save" || selected !== index) && <span className={styles.slotTitle}>{description.title}</span>}
                        <span className={styles.slotMetadata}>{description.metadata}</span>
                    </button>
                ))}
            </div>
                {mode === "save" && <input key={slots[selected]}
                    className={styles.slotNameInput}
                    style={{
                        ...shippedFontStyle(HEADS_INTERFACE_FONT),
                        left: `${SAVE_LOAD_SLOT_RECTS[selected].left}px`,
                        top: `${SAVE_LOAD_SLOT_RECTS[selected].top + 5}px`,
                        width: `${SAVE_LOAD_SLOT_RECTS[selected].width}px`,
                        height: "20px",
                    }}
                    aria-label={`Название сохранения ${page * SAVE_LOAD_SLOTS_PER_PAGE + selected + 1}`}
                    autoFocus
                    maxLength={63}
                    value={saveName}
                    onChange={(event) => setSaveName(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void commit().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
                    }}
                />}

            <OriginalGuiLayer className={styles.authoredControls}
                script="save_load_menu"
                values={Object.fromEntries(Array.from({ length: SAVE_LOAD_PAGE_COUNT }, (_, index) => [3 + index, page === index]))}
                onValueChange={(object) => {
                    if (object.id < 3 || object.id >= 3 + SAVE_LOAD_PAGE_COUNT) return;
                    setPage(object.id - 3);
                    setSelected(0);
                    setMessage("");
                }}
                onAction={(object) => {
                    if (object.id === 1) onClose();
                    else if (object.id === 2) void commit().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
                }}
            />

            <h1 className={styles.title} style={{
                ...nativeRectStyle(SAVE_LOAD_TITLE_RECT),
                ...shippedFontStyle(BUTTON_HEADS_INTERFACE_FONT),
            }}>{title}</h1>
            {details && <output className={styles.details} style={{
                ...nativeRectStyle(SAVE_LOAD_DETAILS_RECT),
                ...shippedFontStyle(MAIN_INTERFACE_FONT),
            }}>{details}</output>}
        </section>
    );
};
