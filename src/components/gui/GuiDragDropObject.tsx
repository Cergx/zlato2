import type { GuiControlProps } from "./GuiControlSupport.tsx";
import {
    GuiStateImages,
    guiObjectStyle,
    guiTextStyle,
    labelFor,
    playClickSound,
} from "./GuiControlSupport.tsx";
import styles from "./GuiDragDropObject.module.scss";

export const GuiDragDropObject = ({
    object,
    onAction,
    onDragOver,
    onDrop,
    inactive,
    canvasWidth,
    canvasHeight,
}: GuiControlProps) => {
    const interactive = object.enabled && !inactive;
    const activate = (): void => {
        playClickSound(object);
        onAction?.(object);
    };
    return <div className={styles.dragObject} style={guiObjectStyle(object, canvasWidth, canvasHeight)}
        data-gui-type={object.type} data-gui-id={object.id} data-gui-visible={object.visible}
        draggable={interactive} role="button" aria-label={labelFor(object)} aria-disabled={inactive || undefined}
        onClick={interactive ? activate : undefined} onDragStart={interactive ? activate : undefined}
        onDragOver={interactive && onDragOver ? (event) => onDragOver(object, event) : undefined}
        onDrop={interactive && onDrop ? (event) => onDrop(object, event) : undefined}>
        <GuiStateImages object={object} classes={styles} />
        {object.text && <span className={styles.buttonText} style={guiTextStyle(object)}>{object.text}</span>}
    </div>;
};
