import { useEffect, useMemo, useState } from "react";
import type { Game } from "../game/Game";
import {
    LocalStorageAdapter,
    PersistenceRuntime,
    type GameSaveData,
} from "../game/PersistenceRuntime";
import { loadCSX } from "../game/Assets";
import { OriginalGuiLayer } from "./OriginalGuiLayer";
import styles from "./SaveLoadMenuPanel.module.scss";

const PAGE_SIZE = 10;
const slotsForPage = (page: number): string[] => Array.from({ length: PAGE_SIZE }, (_, index) => `slot-${String(page * PAGE_SIZE + index + 1).padStart(2, "0")}`);

const CsxImage = ({ src, className }: { readonly src: string; readonly className: string }) => {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        void loadCSX(src).then((canvas) => { if (!cancelled && canvas) setUrl(canvas.toDataURL("image/png")); });
        return () => { cancelled = true; };
    }, [src]);
    return url ? <img className={className} src={url} alt="" draggable={false} /> : null;
};

export interface SaveLoadMenuPanelProps {
    readonly mode: "save" | "load";
    readonly game?: Game | null;
    readonly onClose: () => void;
    readonly onLoad?: (slot: string, save: GameSaveData) => void;
}

const describeSave = (save: GameSaveData | null, slotNumber: number): string => {
    if (!save) return `${slotNumber}. Пусто`;
    const minutes = save.clock.day * 24 * 60 + save.clock.minuteOfDay;
    const hours = Math.floor((minutes % 1440) / 60).toString().padStart(2, "0");
    const minute = Math.floor(minutes % 60).toString().padStart(2, "0");
    return `${slotNumber}. ${save.location.level} · ${hours}:${minute}`;
};

export const SaveLoadMenuPanel = ({ mode, game, onClose, onLoad }: SaveLoadMenuPanelProps) => {
    const persistence = useMemo(() => new PersistenceRuntime(new LocalStorageAdapter(localStorage)), []);
    const [page, setPage] = useState(0);
    const [selected, setSelected] = useState(0);
    const [revision, setRevision] = useState(0);
    const [message, setMessage] = useState("");
    const slots = slotsForPage(page);
    const saves = slots.map((slot) => {
        try { return persistence.load(slot); } catch { return null; }
    });

    const commit = async (): Promise<void> => {
        const slot = slots[selected];
        if (mode === "save") {
            if (!game) return;
            try {
                game.save(slot);
                setRevision((value) => value + 1);
                setMessage("Игра сохранена");
            } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error));
            }
            return;
        }
        const save = saves[selected];
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

    void revision;
    return (
        <section className={styles.panel} aria-label={mode === "save" ? "Сохранение игры" : "Загрузка игры"}>
            <CsxImage className={styles.background} src="/assets/engineres/interface/save_load_menu/background.csx" />
            <CsxImage className={styles.slotsFrame} src="/assets/engineres/interface/save_load_menu/slots.csx" />
            <img className={styles.preview} src="/assets/engineres/interface/save_load_menu/back.bmp" alt="" draggable={false} />
            <ol className={styles.slotList} start={page * PAGE_SIZE + 1}>
                {saves.map((save, index) => (
                    <li key={slots[index]}>
                        <button
                            type="button"
                            aria-pressed={selected === index}
                            onClick={() => setSelected(index)}
                            onDoubleClick={() => { setSelected(index); void commit(); }}
                        >
                            {describeSave(save, page * PAGE_SIZE + index + 1)}
                        </button>
                    </li>
                ))}
            </ol>
            <OriginalGuiLayer
                script="save_load_menu"
                values={{ 3: page === 0, 4: page === 1, 5: page === 2, 6: page === 3 }}
                onValueChange={(object) => {
                    if (object.id >= 3 && object.id <= 6) {
                        setPage(object.id - 3);
                        setSelected(0);
                        setMessage("");
                    }
                }}
                onAction={(object) => {
                    if (object.id === 1) onClose();
                    else if (object.id === 2) void commit().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
                }}
            />
            <h1 className={styles.title}>{mode === "save" ? "Сохранить игру" : "Загрузить игру"}</h1>
            {message && <output className={styles.message}>{message}</output>}
        </section>
    );
};
