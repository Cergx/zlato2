import type { GuiControlProps } from "./GuiControlSupport.tsx";
import {
    GuiStateImages,
    guiObjectStyle,
    guiTextStyle,
    labelFor,
} from "./GuiControlSupport.tsx";
import styles from "./GuiDragDropContainer.module.scss";

export const GuiDragDropContainer = ({
    object,
    onDragOver,
    onDrop,
    inactive,
    canvasWidth,
    canvasHeight,
    content,
}: GuiControlProps) => {
    const interactive = object.enabled && !inactive;
    return <div className={styles.dropContainer} style={guiObjectStyle(object, canvasWidth, canvasHeight)}
        data-gui-type={object.type} data-gui-id={object.id} data-gui-visible={object.visible}
        aria-label={labelFor(object)}
        aria-disabled={inactive || undefined}
        onDragOver={interactive && onDragOver ? (event) => onDragOver(object, event) : undefined}
        onDrop={interactive && onDrop ? (event) => onDrop(object, event) : undefined}>
        {object.visible && <GuiStateImages object={object} classes={styles} />}
        {object.visible && object.text && <span className={styles.buttonText} style={guiTextStyle(object)}>{object.text}</span>}
        {content}
    </div>;
};
