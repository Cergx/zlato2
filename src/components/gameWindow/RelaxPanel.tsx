import { useMemo, useState } from "react";
import type { Game } from "../../game/Game.ts";
import { OriginalGuiLayer } from "../OriginalGuiLayer.tsx";
import styles from "./RelaxPanel.module.scss";

interface RelaxPanelProps {
    readonly game: Game;
    readonly onClose: () => void;
}

const clockText = (elapsedMinutes: number): string => {
    const day = Math.floor(elapsedMinutes / (24 * 60)) + 1;
    const minuteOfDay = elapsedMinutes % (24 * 60);
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;
    return `День ${day}\n${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export const RelaxPanel = ({ game, onClose }: RelaxPanelProps) => {
    const [hours, setHours] = useState(8);
    const currentClock = useMemo(() => clockText(game.getRuntimeSnapshot()?.elapsedMinutes ?? 0), [game]);
    return (
        <section className={styles.overlay} aria-label="Ожидание">
            <img className={styles.background} src="/assets/engineres/relax/normal.bmp" alt="" draggable={false} />
            <div className={styles.period}>{hours} ч.</div>
            <div className={styles.calendar}>{currentClock.split("\n").map((line) => <span key={line}>{line}</span>)}</div>
            <OriginalGuiLayer
                script="relax"
                onAction={(object) => {
                    if (object.id === 1) setHours((value) => value === 1 ? 24 : value - 1);
                    if (object.id === 2) setHours((value) => value === 24 ? 1 : value + 1);
                    if (object.id === 3) {
                        game.rest(hours * 60);
                        onClose();
                    }
                    if (object.id === 4) onClose();
                }}
            />
        </section>
    );
};
