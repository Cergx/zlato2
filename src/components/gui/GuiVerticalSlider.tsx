import type { CSSProperties } from "react";
import type { GuiControlProps } from "./GuiControlSupport.tsx";
import {
    guiObjectStyle,
    labelFor,
    playClickSound,
    useGuiSliderThumb,
} from "./GuiControlSupport.tsx";
import styles from "./GuiVerticalSlider.module.scss";

export const GuiVerticalSlider = ({ object, value, onValueChange, inactive, canvasWidth, canvasHeight }: GuiControlProps) => {
    const thumb = useGuiSliderThumb(object.imageLighted);
    const minimum = object.sliderLowLimit ?? 0;
    const maximum = object.sliderHighLimit ?? 100;
    const current = typeof value === "number" ? value : Math.min(maximum, Math.max(minimum, object.sliderValue ?? minimum));
    return <input className={styles.slider} style={{
        ...guiObjectStyle(object, canvasWidth, canvasHeight),
        "--gui-thumb": thumb ? `url(${JSON.stringify(thumb)})` : "none",
    } as CSSProperties} type="range" aria-label={labelFor(object)} aria-disabled={inactive || undefined}
        data-gui-id={object.id} data-gui-type={object.type} data-gui-visible={object.visible}
        disabled={!object.enabled} min={minimum} max={maximum} step={object.sliderStep ?? 1} value={current}
        onChange={(event) => { if (!inactive) onValueChange?.(object, event.currentTarget.valueAsNumber); }}
        onPointerUp={() => playClickSound(object)} />;
};
