import type { GuiControlProps } from "./GuiControlSupport.tsx";
import {
    GuiStateImages,
    guiObjectStyle,
    guiTextStyle,
    labelFor,
    playClickSound,
} from "./GuiControlSupport.tsx";
import styles from "./GuiCheckButton.module.scss";

export const GuiCheckButton = ({
    object,
    value,
    ariaLabel,
    onAction,
    onValueChange,
    inactive,
    canvasWidth,
    canvasHeight,
}: GuiControlProps) => {
    const checked = value === true;
    const contents = <>
        <GuiStateImages object={object} classes={styles} />
        {object.text !== undefined && <span className={styles.buttonText} style={guiTextStyle(object)}>{object.text}</span>}
    </>;
    const activate = (): void => {
        playClickSound(object);
        if (inactive) return;
        onValueChange?.(object, !checked);
        onAction?.(object);
    };
    return <button className={styles.button} style={guiObjectStyle(object, canvasWidth, canvasHeight)}
        type="button" disabled={!object.enabled} aria-disabled={inactive || undefined}
        aria-label={ariaLabel ?? object.text ?? labelFor(object)} aria-pressed={checked}
        data-gui-id={object.id} data-gui-type={object.type} data-gui-visible={object.visible}
        onMouseDown={(event) => { if (event.button === 0) activate(); }}
        onClick={(event) => { if (event.detail === 0) activate(); }}>{contents}</button>;
};
