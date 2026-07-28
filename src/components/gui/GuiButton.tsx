import type { GuiControlProps } from "./GuiControlSupport.tsx";
import {
    GuiStateImages,
    guiObjectStyle,
    guiTextStyle,
    labelFor,
    playClickSound,
} from "./GuiControlSupport.tsx";
import styles from "./GuiSimpleButton.module.scss";

export const GuiSimpleButton = ({
    object,
    value,
    content,
    ariaLabel,
    onAction,
    inactive,
    canvasWidth,
    canvasHeight,
}: GuiControlProps) => {
    const valueText = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
    const text = valueText ?? object.text;
    const contents = <>
        <GuiStateImages object={object} classes={styles} />
        {text !== undefined && <span className={styles.buttonText} style={guiTextStyle(object)}>{text}</span>}
        {content}
    </>;
    const activate = (): void => {
        playClickSound(object);
        if (!inactive) onAction?.(object);
    };
    return <button className={styles.button} style={guiObjectStyle(object, canvasWidth, canvasHeight)}
        type="button" disabled={!object.enabled} aria-disabled={inactive || undefined}
        aria-label={ariaLabel ?? text ?? labelFor(object)} data-gui-id={object.id}
        data-gui-type={object.type} data-gui-visible={object.visible}
        data-gui-value={valueText !== undefined || undefined}
        onClick={(event) => { if (event.button === 0) activate(); }}>{contents}</button>;
};
