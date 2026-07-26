import { useEffect, useState, type CSSProperties, type DragEvent } from "react";
import {
    guiImageUrl,
    guiSoundUrl,
    type GuiObjectDefinition,
} from "../../game/GuiDefinitionRuntime.ts";
import { ColorKeyImage, loadColorKeyImage } from "../ColorKeyImage.tsx";

export type GuiControlValue = boolean | number | string;
export type GuiActionHandler = (object: GuiObjectDefinition) => void;
export type GuiValueChangeHandler = (object: GuiObjectDefinition, value: GuiControlValue) => void;
export type GuiDragHandler = (object: GuiObjectDefinition, event: DragEvent<HTMLElement>) => void;

export interface GuiControlProps {
    readonly object: GuiObjectDefinition;
    readonly value: GuiControlValue | undefined;
    readonly listItems: readonly string[] | undefined;
    readonly ariaLabel: string | undefined;
    readonly onAction: GuiActionHandler | undefined;
    readonly onValueChange: GuiValueChangeHandler | undefined;
    readonly onDragOver: GuiDragHandler | undefined;
    readonly onDrop: GuiDragHandler | undefined;
    readonly inactive: boolean;
    readonly canvasWidth: number;
    readonly canvasHeight: number;
}

export const guiObjectStyle = (object: GuiObjectDefinition, _canvasWidth = 1024, _canvasHeight = 768): CSSProperties => ({
    left: `${object.left}px`,
    top: `${object.top}px`,
    width: `${object.width}px`,
    height: `${object.height}px`,
});

const guiTextColor = (value: number | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const color = value >>> 0;
    const red = color & 0xff;
    const green = color >>> 8 & 0xff;
    const blue = color >>> 16 & 0xff;
    return `rgb(${red} ${green} ${blue})`;
};

export const guiTextStyle = (object: GuiObjectDefinition): CSSProperties => ({
    color: guiTextColor(object.textColor),
    fontFamily: object.font ? `"${object.font}", "GoldenLand", Georgia, serif` : undefined,
});

export const labelFor = (object: GuiObjectDefinition): string => object.text || `${object.type} ${object.id}`;

export const playClickSound = (object: GuiObjectDefinition): void => {
    const url = guiSoundUrl(object.clickSound);
    if (!url) return;
    const audio = new Audio(url);
    audio.volume = 0.7;
    void audio.play().catch(() => undefined);
};

export type GuiStateImageClasses = Readonly<Record<string, string>>;

interface GuiStateImagesProps {
    readonly object: GuiObjectDefinition;
    readonly classes: GuiStateImageClasses;
}

export const GuiStateImages = ({ object, classes }: GuiStateImagesProps) => {
    const base = guiImageUrl(object.imageBase);
    const lighted = guiImageUrl(object.imageLighted);
    const pressed = guiImageUrl(object.imagePressed);
    const additional = guiImageUrl(object.imageAdditional);
    return (
        <>
            {base && <ColorKeyImage className={classes.baseImage} src={base} />}
            {lighted && <ColorKeyImage className={classes.lightedImage} src={lighted} />}
            {pressed && <ColorKeyImage className={classes.pressedImage} src={pressed} />}
            {additional && <ColorKeyImage className={classes.additionalImage} src={additional} />}
        </>
    );
};

export const useGuiSliderThumb = (reference: string | undefined): string | null => {
    const [thumb, setThumb] = useState<string | null>(null);
    useEffect(() => {
        const source = guiImageUrl(reference);
        if (!source) {
            setThumb(null);
            return;
        }
        let cancelled = false;
        void loadColorKeyImage(source).then((image) => { if (!cancelled) setThumb(image.url); });
        return () => { cancelled = true; };
    }, [reference]);
    return thumb;
};
