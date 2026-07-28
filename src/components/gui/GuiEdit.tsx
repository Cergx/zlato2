import type { GuiControlProps } from "./GuiControlSupport.tsx";
import { guiObjectStyle, guiTextStyle, labelFor } from "./GuiControlSupport.tsx";
import styles from "./GuiEdit.module.scss";

export const GuiEdit = ({ object, value, ariaLabel, onValueChange, inactive, canvasWidth, canvasHeight }: GuiControlProps) => (
    <input className={styles.edit} style={{
        ...guiObjectStyle(object, canvasWidth, canvasHeight),
        ...guiTextStyle(object),
    }} disabled={!object.enabled} readOnly={inactive} aria-disabled={inactive || undefined}
    aria-label={ariaLabel ?? labelFor(object)} data-gui-id={object.id} data-gui-type={object.type}
    data-gui-visible={object.visible}
    maxLength={object.editboxMaxLength}
    value={typeof value === "string" ? value : object.text ?? ""}
    onChange={(event) => onValueChange?.(object, event.currentTarget.value)} />
);
