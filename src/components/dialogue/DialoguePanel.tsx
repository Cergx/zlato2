import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
    DIALOGUE_PANEL_RECT,
    DIALOGUE_ARROW_SCROLL_STEP,
    DIALOGUE_CONTINUATION_INDENT,
    DIALOGUE_LINE_HEIGHT,
    DIALOGUE_SCROLL_OBJECT_IDS,
    DIALOGUE_TRADE_OBJECT_ID,
    DIALOGUE_TEXT_RECT,
    DIALOGUE_WHEEL_SCROLL_STEP,
    type NativeRect,
} from "../../constants/clientDll.ts";
import { MAIN_INTERFACE_FONT, pointSizeToPixels } from "../../constants/fontsScr.ts";
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
        const content = contentRef.current;
        if (!content) return;
        content.scrollTop = content.scrollHeight;
        updateScrollValue();
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
                    fontSize: `${pointSizeToPixels(MAIN_INTERFACE_FONT.size)}px`,
                    fontWeight: MAIN_INTERFACE_FONT.weight,
                    lineHeight: `${DIALOGUE_LINE_HEIGHT}px`,
                    "--dialogue-continuation-indent": `${DIALOGUE_CONTINUATION_INDENT}px`,
                } as CSSProperties}
                onScroll={updateScrollValue}
                onWheel={(event) => {
                    event.preventDefault();
                    if (event.deltaY !== 0) scrollBy(Math.sign(event.deltaY) * DIALOGUE_WHEEL_SCROLL_STEP);
                }}>
                <div className={styles.transcript} id={phraseId} aria-live="polite">
                    {state.transcript.map((entry, index) => (
                        <p key={`${entry.owner}:${entry.phraseId}:${index}`}
                            className={`${styles.line} ${entry.owner === "hero" ? styles.heroLine : styles.npcLine}`}>
                            <span className={styles.speaker}>{entry.speaker}: </span>{entry.text}
                        </p>
                    ))}
                </div>
                <ol className={styles.options} aria-label="Варианты ответа">
                    {state.options.map((option, index) => (
                        <DialogueChoice key={option.id} option={option} ordinal={index + 1}
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
                    if (object.id === 44) scrollBy(-DIALOGUE_ARROW_SCROLL_STEP);
                    if (object.id === 45) scrollBy(DIALOGUE_ARROW_SCROLL_STEP);
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
    ordinal: number;
    disabled: boolean;
    onChoose: (optionId: number) => void;
}

const DialogueChoice = ({ option, ordinal, disabled, onChoose }: DialogueChoiceProps) => (
    <li className={styles.optionItem}>
        <button
            className={styles.option}
            type="button"
            disabled={disabled || !option.enabled}
            aria-keyshortcuts={option.shortcut === undefined ? undefined : String(option.shortcut)}
            onClick={() => onChoose(option.id)}
        >
            <span>{ordinal}. {option.text}</span>
        </button>
    </li>
);
