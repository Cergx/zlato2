import { useEffect, useState, type CSSProperties } from "react";
import {
    guiImageUrl,
    guiSoundUrl,
    loadGuiDefinition,
    type GuiDefinition,
    type GuiObjectDefinition,
} from "../game/GuiDefinitionRuntime";
import { ColorKeyImage, loadColorKeyImage } from "./ColorKeyImage";
import styles from "./OriginalGuiLayer.module.scss";

export type GuiControlValue = boolean | number | string;

interface OriginalGuiLayerProps {
    readonly script: string;
    readonly values?: Readonly<Record<number, GuiControlValue>>;
    readonly onAction?: (object: GuiObjectDefinition) => void;
    readonly onValueChange?: (object: GuiObjectDefinition, value: GuiControlValue) => void;
    readonly className?: string;
    readonly objectIds?: readonly number[];
    readonly canvasWidth?: number;
    readonly canvasHeight?: number;
}

export const guiObjectStyle = (object: GuiObjectDefinition, canvasWidth = 1024, canvasHeight = 768): CSSProperties => ({
    left: `${object.left / canvasWidth * 100}%`,
    top: `${object.top / canvasHeight * 100}%`,
    width: `${object.width / canvasWidth * 100}%`,
    height: `${object.height / canvasHeight * 100}%`,
});

const playClickSound = (object: GuiObjectDefinition): void => {
    const url = guiSoundUrl(object.clickSound);
    if (!url) return;
    const audio = new Audio(url);
    audio.volume = 0.7;
    void audio.play().catch(() => undefined);
};

interface StateImagesProps {
    readonly object: GuiObjectDefinition;
}

const StateImages = ({ object }: StateImagesProps) => {
    const base = guiImageUrl(object.imageBase);
    const lighted = guiImageUrl(object.imageLighted);
    const pressed = guiImageUrl(object.imagePressed);
    const additional = guiImageUrl(object.imageAdditional);
    return (
        <>
            {base && <ColorKeyImage className={styles.baseImage} src={base} />}
            {lighted && <ColorKeyImage className={styles.lightedImage} src={lighted} />}
            {pressed && <ColorKeyImage className={styles.pressedImage} src={pressed} />}
            {additional && <ColorKeyImage className={styles.additionalImage} src={additional} />}
        </>
    );
};

const labelFor = (object: GuiObjectDefinition): string => object.text || `${object.type} ${object.id}`;

interface GuiSliderProps {
    readonly object: GuiObjectDefinition;
    readonly value: GuiControlValue | undefined;
    readonly onValueChange: OriginalGuiLayerProps["onValueChange"];
    readonly canvasWidth: number;
    readonly canvasHeight: number;
}

const GuiSlider = ({ object, value, onValueChange, canvasWidth, canvasHeight }: GuiSliderProps) => {
    const [thumb, setThumb] = useState<string | null>(null);
    useEffect(() => {
        const source = guiImageUrl(object.imageLighted);
        if (!source) return;
        let cancelled = false;
        void loadColorKeyImage(source).then((image) => { if (!cancelled) setThumb(image.url); });
        return () => { cancelled = true; };
    }, [object.imageLighted]);
    const minimum = object.sliderLowLimit ?? 0;
    const maximum = object.sliderHighLimit ?? 100;
    const current = typeof value === "number" ? value : Math.min(maximum, Math.max(minimum, object.sliderValue ?? minimum));
    return (
        <input
            className={object.type === "GUI_VSLIDER" ? styles.verticalSlider : styles.slider}
            style={{ ...guiObjectStyle(object, canvasWidth, canvasHeight), "--gui-thumb": thumb ? `url(${JSON.stringify(thumb)})` : "none" } as CSSProperties}
            type="range"
            aria-label={labelFor(object)}
            disabled={!object.enabled}
            min={minimum}
            max={maximum}
            step={object.sliderStep ?? 1}
            value={current}
            onChange={(event) => onValueChange?.(object, event.currentTarget.valueAsNumber)}
            onPointerUp={() => playClickSound(object)}
        />
    );
};

const renderObject = (
    object: GuiObjectDefinition,
    value: GuiControlValue | undefined,
    onAction: OriginalGuiLayerProps["onAction"],
    onValueChange: OriginalGuiLayerProps["onValueChange"],
    canvasWidth: number,
    canvasHeight: number,
) => {
    const style = guiObjectStyle(object, canvasWidth, canvasHeight);
    const activate = (): void => {
        playClickSound(object);
        onAction?.(object);
    };

    if (object.type === "GUI_SIMPLE_BUTTON" || object.type === "GUI_CHECK_BUTTON") {
        const checked = object.type === "GUI_CHECK_BUTTON" && value === true;
        return (
            <button
                key={object.id}
                className={styles.button}
                style={style}
                type="button"
                disabled={!object.enabled}
                aria-label={labelFor(object)}
                aria-pressed={object.type === "GUI_CHECK_BUTTON" ? checked : undefined}
                onClick={() => {
                    if (object.type === "GUI_CHECK_BUTTON") onValueChange?.(object, !checked);
                    activate();
                }}
            >
                <StateImages object={object} />
                {object.text && <span className={styles.buttonText}>{object.text}</span>}
            </button>
        );
    }

    if (object.type === "GUI_SLIDER" || object.type === "GUI_VSLIDER") {
        return <GuiSlider key={object.id} object={object} value={value} onValueChange={onValueChange} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />;
    }

    if (object.type === "GUI_EDIT") {
        return (
            <input
                key={object.id}
                className={styles.edit}
                style={style}
                disabled={!object.enabled}
                aria-label={labelFor(object)}
                value={typeof value === "string" ? value : ""}
                onChange={(event) => onValueChange?.(object, event.currentTarget.value)}
            />
        );
    }

    return <div key={object.id} className={styles.containerObject} style={style} data-gui-type={object.type} />;
};

export const OriginalGuiLayer = ({ script, values = {}, onAction, onValueChange, className, objectIds, canvasWidth = 1024, canvasHeight = 768 }: OriginalGuiLayerProps) => {
    const [definition, setDefinition] = useState<GuiDefinition | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setDefinition(null);
        setError(null);
        void loadGuiDefinition(script).then(
            (loaded) => { if (!cancelled) setDefinition(loaded); },
            (reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); },
        );
        return () => { cancelled = true; };
    }, [script]);

    if (error) return <div className={`${styles.layer} ${className ?? ""}`} role="alert">{error}</div>;
    return (
        <div className={`${styles.layer} ${className ?? ""}`} data-gui-script={script}>
            {definition?.objects.filter((object) => object.visible && (!objectIds || objectIds.includes(object.id))).map((object) => renderObject(object, values[object.id], onAction, onValueChange, canvasWidth, canvasHeight))}
        </div>
    );
};
