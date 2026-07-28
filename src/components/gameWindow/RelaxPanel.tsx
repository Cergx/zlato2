import { useEffect, useState, type CSSProperties } from "react";
import {
    REST_MENU_BACKGROUND_RECT,
    REST_MENU_CALENDAR_RECT,
    REST_MENU_PERIOD_MINUTES,
    REST_MENU_PERIOD_RECT,
    type NativeRect,
} from "../../constants/clientDll.ts";
import { MAIN_INTERFACE_FONT, type ShippedFontDefinition } from "../../constants/fontsScr.ts";
import type { Game } from "../../game/Game.ts";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
import { OriginalGuiLayer } from "../OriginalGuiLayer.tsx";
import styles from "./RelaxPanel.module.scss";

interface RelaxPanelProps {
    readonly game: Game;
    readonly onClose: () => void;
}

const nativeRectStyle = ({ left, top, width, height }: NativeRect): CSSProperties => ({
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

const clockText = (elapsedMinutes: number): string => {
    const day = Math.floor(elapsedMinutes / (24 * 60)) + 1;
    const minuteOfDay = elapsedMinutes % (24 * 60);
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;
    return `День ${day} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export const RelaxPanel = ({ game, onClose }: RelaxPanelProps) => {
    const [periodIndex, setPeriodIndex] = useState(0);
    const [currentClock, setCurrentClock] = useState(() => clockText(game.getRuntimeSnapshot()?.elapsedMinutes ?? 0));
    const [resting, setResting] = useState(() => game.getRestState().active);
    useEffect(() => {
        const updateClock = (elapsedMinutes: number): void => setCurrentClock(clockText(elapsedMinutes));
        updateClock(game.getRuntimeSnapshot()?.elapsedMinutes ?? 0);
        return game.subscribeClock(updateClock);
    }, [game]);
    useEffect(() => game.subscribeRest((state) => {
        setResting((wasResting) => {
            if (wasResting && !state.active) onClose();
            return state.active;
        });
    }), [game, onClose]);
    const periodMinutes = REST_MENU_PERIOD_MINUTES[periodIndex];
    return (
        <section className={styles.overlay} aria-label="Ожидание">
            <ColorKeyImage className={styles.background} style={nativeRectStyle(REST_MENU_BACKGROUND_RECT)}
                src="/assets/engineres/relax/normal.bmp" />
            <div className={styles.period} style={{
                ...nativeRectStyle(REST_MENU_PERIOD_RECT),
                ...shippedFontStyle(MAIN_INTERFACE_FONT),
            }}>{periodMinutes / 60}</div>
            <div className={styles.calendar} style={{
                ...nativeRectStyle(REST_MENU_CALENDAR_RECT),
                ...shippedFontStyle(MAIN_INTERFACE_FONT),
            }}>{currentClock}</div>
            <OriginalGuiLayer
                script="relax"
                onAction={(object) => {
                    if (object.id === 1 && !resting) setPeriodIndex((value) => Math.max(0, value - 1));
                    if (object.id === 2 && !resting) setPeriodIndex((value) => Math.min(REST_MENU_PERIOD_MINUTES.length - 1, value + 1));
                    if (object.id === 3 && !resting) game.rest(periodMinutes);
                    if (object.id === 4 && !game.cancelRest()) onClose();
                }}
            />
        </section>
    );
};
