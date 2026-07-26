import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
    DIALOGUE_PANEL_RECT,
    DIALOGUE_SCROLL_OBJECT_IDS,
    DIALOGUE_TRADE_OBJECT_ID,
    DIALOGUE_TEXT_RECT,
    type NativeRect,
} from "../../constants/clientDll.ts";
import { MAIN_INTERFACE_FONT } from "../../constants/fontsScr.ts";
import type { DialogueOption, DialogueState } from "../../game/dialogue/DialogueRuntime.ts";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
import { OriginalGuiLayer } from "../OriginalGuiLayer.tsx";
import styles from "./DialoguePanel.module.scss";

export interface DialoguePanelProps {
    state: DialogueState;
    onChoose: (optionId: number) => void;
    canTrade?: boolean;
    onTrade?: () => void;
    disabled?: boolean;
    className?: string;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName;
    return target.isContentEditable || tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA";
}

const nativeRectStyle = ({ left, top, width, height }: NativeRect): CSSProperties => ({
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
});

const DIALOGUE_LINE_SCROLL = 20;
const DIALOGUE_CONTROL_OBJECT_IDS = Object.freeze([
    DIALOGUE_TRADE_OBJECT_ID,
    ...DIALOGUE_SCROLL_OBJECT_IDS,
]);

export const DialoguePanel = ({
    state,
    onChoose,
    canTrade = false,
    onTrade,
    disabled = false,
    className,
}: DialoguePanelProps) => {
    const phraseId = useId();
    const contentRef = useRef<HTMLDivElement>(null);
    const [scrollValue, setScrollValue] = useState(0);


    const updateScrollValue = (): void => {
        const content = contentRef.current;
        if (!content) return;
        const maximum = Math.max(0, content.scrollHeight - content.clientHeight);
        setScrollValue(maximum === 0 ? 0 : Math.round(content.scrollTop / maximum * 100));
    };

    const setScrollPercentage = (value: number): void => {
        const content = contentRef.current;
        if (!content) return;
        const maximum = Math.max(0, content.scrollHeight - content.clientHeight);
        const nextValue = maximum === 0 ? 0 : value;
        content.scrollTop = maximum * nextValue / 100;
        setScrollValue(nextValue);
    };

    const scrollBy = (delta: number): void => {
        contentRef.current?.scrollBy({ top: delta });
        window.requestAnimationFrame(updateScrollValue);
    };
    useEffect(() => {
        if (state.status !== "active" || disabled) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isTextEntryTarget(event.target)) return;
            const shortcut = Number(event.key);
            if (!Number.isInteger(shortcut) || shortcut < 1 || shortcut > 9) return;
            const option = state.options[shortcut - 1];
            if (!option?.enabled) return;
            event.preventDefault();
            onChoose(option.id);
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [disabled, onChoose, state]);

    useEffect(() => {
        contentRef.current?.scrollTo({ top: 0 });
        setScrollValue(0);
    }, [state.revision]);

    if (state.status !== "active" || state.speaker === null || state.text === null) return null;

    const panelClassName = className ? `${styles.panel} ${className}` : styles.panel;
    return (
        <section className={panelClassName} aria-describedby={phraseId}>
            <ColorKeyImage className={styles.background} style={nativeRectStyle(DIALOGUE_PANEL_RECT)}
                src="/assets/engineres/gpanel/dialog_panel.bmp" />
            <div className={styles.content} ref={contentRef} tabIndex={0}
                style={{
                    ...nativeRectStyle(DIALOGUE_TEXT_RECT),
                    fontFamily: `ZlatoPalatino, "${MAIN_INTERFACE_FONT.typeFace}", serif`,
                    fontSize: `${MAIN_INTERFACE_FONT.size}px`,
                    fontWeight: MAIN_INTERFACE_FONT.weight,
                }}
                onScroll={updateScrollValue}>
                <p className={styles.phrase} id={phraseId} aria-live="polite">
                    <span className={styles.speaker}>{state.speaker}: </span>{state.text}
                </p>
                <ol className={styles.options} aria-label="Варианты ответа">
                    {state.options.map((option) => (
                        <DialogueChoice key={option.id} option={option}
                            disabled={disabled} onChoose={onChoose} />
                    ))}
                </ol>
            </div>
            <OriginalGuiLayer className={styles.scrollControls} script="gpanel_new"
                objectIds={DIALOGUE_CONTROL_OBJECT_IDS}
                enabledObjectIds={canTrade ? [DIALOGUE_TRADE_OBJECT_ID] : []}
                labels={{ [DIALOGUE_TRADE_OBJECT_ID]: "Торговля" }}
                values={{ 46: scrollValue }}
                inactiveObjectIds={disabled ? DIALOGUE_CONTROL_OBJECT_IDS : []}
                onAction={(object) => {
                    if (object.id === DIALOGUE_TRADE_OBJECT_ID) onTrade?.();
                    if (object.id === 44) scrollBy(-DIALOGUE_LINE_SCROLL);
                    if (object.id === 45) scrollBy(DIALOGUE_LINE_SCROLL);
                }}
                onValueChange={(object, value) => {
                    if (object.id === 46 && typeof value === "number") setScrollPercentage(value);
                }}
            />
        </section>
    );
};

interface DialogueChoiceProps {
    option: DialogueOption;
    disabled: boolean;
    onChoose: (optionId: number) => void;
}

const DialogueChoice = ({ option, disabled, onChoose }: DialogueChoiceProps) => (
    <li className={styles.optionItem}>
        <button
            className={styles.option}
            type="button"
            disabled={disabled || !option.enabled}
            aria-keyshortcuts={option.shortcut === undefined ? undefined : String(option.shortcut)}
            onClick={() => onChoose(option.id)}
        >
            <span>{option.text}</span>
        </button>
    </li>
);
