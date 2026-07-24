import { useEffect, useId, useRef } from "react";

import type { DialogueOption, DialogueState } from "../../game/dialogue/DialogueRuntime.ts";
import styles from "./DialoguePanel.module.scss";

export interface DialoguePanelProps {
    state: DialogueState;
    onChoose: (optionId: number) => void;
    disabled?: boolean;
    className?: string;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName;
    return target.isContentEditable || tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA";
}

export const DialoguePanel = ({ state, onChoose, disabled = false, className }: DialoguePanelProps) => {
    const speakerId = useId();
    const phraseId = useId();
    const contentRef = useRef<HTMLDivElement>(null);


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
    }, [state.revision]);

    if (state.status !== "active" || state.speaker === null || state.text === null) return null;

    const panelClassName = className ? `${styles.panel} ${className}` : styles.panel;
    return (
        <section
            className={panelClassName}
            aria-labelledby={speakerId}
            aria-describedby={phraseId}
        >
            <header className={styles.header}>
                <h2 className={styles.speaker} id={speakerId}>{state.speaker}</h2>
            </header>

            <div className={styles.content} ref={contentRef} tabIndex={0}>
                <p className={styles.phrase} id={phraseId} aria-live="polite">{state.text}</p>

                <ol className={styles.options} aria-label="Dialogue choices">
                    {state.options.map((option) => (
                        <DialogueChoice
                            key={option.id}
                            option={option}
                            disabled={disabled}
                            onChoose={onChoose}
                        />
                    ))}
                </ol>
            </div>

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
            {option.shortcut !== undefined && <span className={styles.shortcut} aria-hidden="true">{option.shortcut}</span>}
            <span>{option.text}</span>
        </button>
    </li>
);
