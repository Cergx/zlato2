import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
    loadGuiDefinition,
    type GuiDefinition,
    type GuiObjectDefinition,
} from "../game/GuiDefinitionRuntime.ts";
import { GuiCheckButton } from "./gui/GuiCheckButton.tsx";
import type {
    GuiActionHandler,
    GuiControlProps,
    GuiControlValue,
    GuiDragHandler,
    GuiValueChangeHandler,
} from "./gui/GuiControlSupport.tsx";
import { GuiDragDropContainer } from "./gui/GuiDragDropContainer.tsx";
import { GuiDragDropObject } from "./gui/GuiDragDropObject.tsx";
import { GuiEdit } from "./gui/GuiEdit.tsx";
import { GuiListbox } from "./gui/GuiListbox.tsx";
import { GuiSimpleButton } from "./gui/GuiButton.tsx";
import { GuiSlider } from "./gui/GuiSlider.tsx";
import { GuiVerticalSlider } from "./gui/GuiVerticalSlider.tsx";
import { GuiTooltip, type GuiTooltipAnchor } from "./gui/GuiTooltip.tsx";
import styles from "./OriginalGuiLayer.module.scss";

export { guiObjectStyle } from "./gui/GuiControlSupport.tsx";
export type { GuiControlValue } from "./gui/GuiControlSupport.tsx";

interface OriginalGuiLayerProps {
    readonly script: string;
    readonly values?: Readonly<Record<number, GuiControlValue>>;
    readonly labels?: Readonly<Record<number, string>>;
    readonly sliderLimits?: Readonly<Record<number, { readonly minimum: number; readonly maximum: number }>>;
    readonly items?: Readonly<Record<number, readonly string[]>>;
    readonly objectContents?: Readonly<Record<number, ReactNode>>;
    readonly onAction?: GuiActionHandler;
    readonly tooltips?: Readonly<Record<number, string>>;
    readonly tooltipDelayMs?: number;
    readonly onValueChange?: GuiValueChangeHandler;
    readonly className?: string;
    readonly objectIds?: readonly number[];
    readonly inactiveObjectIds?: readonly number[];
    readonly enabledObjectIds?: readonly number[];
    readonly onDragOver?: GuiDragHandler;
    readonly onDrop?: GuiDragHandler;
    readonly canvasWidth?: number;
    readonly canvasHeight?: number;
}

const GuiObjectControl = (props: GuiControlProps) => {
    switch (props.object.type) {
        case "GUI_SIMPLE_BUTTON": return <GuiSimpleButton {...props} />;
        case "GUI_CHECK_BUTTON": return <GuiCheckButton {...props} />;
        case "GUI_SLIDER": return <GuiSlider {...props} />;
        case "GUI_VSLIDER": return <GuiVerticalSlider {...props} />;
        case "GUI_EDIT": return <GuiEdit {...props} />;
        case "GUI_LISTBOX": return <GuiListbox {...props} />;
        case "GUI_DD_OBJECT": return <GuiDragDropObject {...props} />;
        case "GUI_DD_CONTAINER": return <GuiDragDropContainer {...props} />;
    }
};

interface ActiveTooltip {
    readonly objectId: number;
    readonly text: string;
    readonly anchor: GuiTooltipAnchor;
}

const guiObjectElement = (target: EventTarget | null): HTMLElement | null => target instanceof Element
    ? target.closest<HTMLElement>("[data-gui-id]")
    : null;

export const OriginalGuiLayer = ({
    script,
    values = {},
    labels = {},
    sliderLimits = {},
    items = {},
    objectContents = {},
    tooltips = {},
    tooltipDelayMs = 0,
    onAction,
    onValueChange,
    onDragOver,
    onDrop,
    className,
    objectIds,
    inactiveObjectIds = [],
    enabledObjectIds = [],
    canvasWidth = 1024,
    canvasHeight = 768,
}: OriginalGuiLayerProps) => {
    const [definition, setDefinition] = useState<GuiDefinition | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeTooltip, setActiveTooltip] = useState<ActiveTooltip | null>(null);
    const pendingTooltipId = useRef<number | null>(null);
    const tooltipTimer = useRef<number | null>(null);

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

    useEffect(() => () => {
        if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
    }, []);

    const clearTooltip = (): void => {
        if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
        tooltipTimer.current = null;
        pendingTooltipId.current = null;
        setActiveTooltip(null);
    };

    const showTooltip = (objectElement: HTMLElement, layerElement: HTMLElement, objectId: number, text: string): void => {
        const layerRect = layerElement.getBoundingClientRect();
        const objectRect = objectElement.getBoundingClientRect();
        const scaleX = layerRect.width / canvasWidth || 1;
        const scaleY = layerRect.height / canvasHeight || 1;
        setActiveTooltip({
            objectId,
            text,
            anchor: {
                left: (objectRect.left - layerRect.left) / scaleX,
                top: (objectRect.top - layerRect.top) / scaleY,
                width: objectRect.width / scaleX,
                height: objectRect.height / scaleY,
            },
        });
    };

    const handlePointerOver = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const objectElement = guiObjectElement(event.target);
        if (!objectElement || !event.currentTarget.contains(objectElement)) return;
        const objectId = Number(objectElement.dataset.guiId);
        const text = tooltips[objectId];
        if (!text || pendingTooltipId.current === objectId || activeTooltip?.objectId === objectId) return;
        clearTooltip();
        pendingTooltipId.current = objectId;
        const layerElement = event.currentTarget;
        tooltipTimer.current = window.setTimeout(() => {
            pendingTooltipId.current = null;
            tooltipTimer.current = null;
            showTooltip(objectElement, layerElement, objectId, text);
        }, tooltipDelayMs);
    };

    const handlePointerOut = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const sourceElement = guiObjectElement(event.target);
        if (!sourceElement) return;
        const destinationElement = guiObjectElement(event.relatedTarget);
        if (destinationElement?.dataset.guiId === sourceElement.dataset.guiId) return;
        clearTooltip();
    };

    if (error) return <div className={`${styles.layer} ${className ?? ""}`} role="alert">{error}</div>;
    return <div className={`${styles.layer} ${className ?? ""}`}
        data-gui-script={script} data-gui-source={definition?.sourcePath}
        onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        {definition?.objects
            .filter((object: GuiObjectDefinition) => !objectIds || objectIds.includes(object.id))
            .map((object: GuiObjectDefinition) => {
                const limits = sliderLimits[object.id];
                const configuredObject = {
                    ...object,
                    ...(enabledObjectIds.includes(object.id) ? { enabled: true } : {}),
                    ...(limits ? { sliderLowLimit: limits.minimum, sliderHighLimit: limits.maximum } : {}),
                };
                return <GuiObjectControl key={object.id}
                    object={configuredObject} value={values[object.id]} listItems={items[object.id]}
                    content={objectContents[object.id]}
                    ariaLabel={labels[object.id]} onAction={onAction} onValueChange={onValueChange}
                    onDragOver={onDragOver} onDrop={onDrop} inactive={inactiveObjectIds.includes(object.id)}
                    canvasWidth={canvasWidth} canvasHeight={canvasHeight} />;
            })}
        {activeTooltip && <GuiTooltip text={activeTooltip.text} anchor={activeTooltip.anchor}
            canvasWidth={canvasWidth} canvasHeight={canvasHeight} />}
    </div>;
};
