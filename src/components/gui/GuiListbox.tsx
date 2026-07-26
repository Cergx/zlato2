import type { GuiControlProps } from "./GuiControlSupport.tsx";
import {
    guiObjectStyle,
    guiTextStyle,
    labelFor,
    playClickSound,
} from "./GuiControlSupport.tsx";
import styles from "./GuiListbox.module.scss";

export const GuiListbox = ({
    object,
    value,
    listItems,
    onAction,
    onValueChange,
    inactive,
    canvasWidth,
    canvasHeight,
}: GuiControlProps) => {
    const selected = typeof value === "string" || typeof value === "number" ? String(value) : "";
    return <select className={styles.listbox} style={{
        ...guiObjectStyle(object, canvasWidth, canvasHeight),
        ...guiTextStyle(object),
        lineHeight: object.listboxStringHeight ? `${object.listboxStringHeight}px` : undefined,
        paddingBlock: object.listboxStringStep
            ? `${Math.max(0, object.listboxStringStep - (object.listboxStringHeight ?? 0)) / 2}px`
            : undefined,
    }} disabled={!object.enabled} aria-disabled={inactive || undefined} aria-label={labelFor(object)}
    data-gui-id={object.id} data-gui-type={object.type} data-gui-visible={object.visible}
    value={selected} size={Math.max(1, Math.floor(object.height / Math.max(
        1,
        object.listboxStringStep ?? object.listboxStringHeight ?? object.height,
    )))} onChange={(event) => {
        playClickSound(object);
        if (inactive) return;
        onValueChange?.(object, event.currentTarget.value);
        onAction?.(object);
    }}>
        {(listItems ?? []).map((item, index) => <option key={`${index}:${item}`} value={String(index)}>{item}</option>)}
    </select>;
};
