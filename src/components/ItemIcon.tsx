import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INVENTORY_ITEM_HINT_DELAY_MS } from "../constants/clientDll.ts";
import { loadImage } from "../game/Assets.ts";
import type { ShippedItem } from "../game/ItemCatalogRuntime.ts";
import { GuiTooltip, type GuiTooltipAnchor } from "./gui/GuiTooltip.tsx";
import styles from "./ItemIcon.module.scss";

interface ItemIconProps {
    readonly item: ShippedItem;
    readonly quantity?: number;
    readonly canvasWidth?: number;
    readonly canvasHeight?: number;
    readonly tooltipRootSelector?: string;
}

interface ActiveTooltip {
    readonly root: HTMLElement;
    readonly anchor: GuiTooltipAnchor;
}

const tooltipText = (item: ShippedItem, quantity?: number): string => [
    item.literaryName,
    item.definition.itemClass,
    item.description,
    quantity === undefined ? undefined : `Количество: ${quantity}`,
    ...item.specialEffects.map((effect) => `Эффект ${effect.specialId}: ${effect.amount}`),
].filter((line): line is string => Boolean(line)).join("\n");

const drawItemImage = (
    canvas: HTMLCanvasElement,
    image: HTMLImageElement,
    alphaMask?: HTMLImageElement,
): void => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let maskPixels: Uint8ClampedArray | undefined;
    if (alphaMask) {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;
        const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
        if (maskContext) {
            maskContext.drawImage(alphaMask, 0, 0);
            maskPixels = maskContext.getImageData(0, 0, canvas.width, canvas.height).data;
        }
    }
    for (let index = 0; index < pixels.data.length; index += 4) {
        const colorKeyed = pixels.data[index] >= 250 && pixels.data[index + 1] <= 5 && pixels.data[index + 2] >= 250;
        pixels.data[index + 3] = colorKeyed ? 0 : (maskPixels?.[index] ?? pixels.data[index + 3]);
    }
    context.putImageData(pixels, 0, 0);
};

export const ItemIcon = ({
    item,
    quantity,
    canvasWidth = 1024,
    canvasHeight = 768,
    tooltipRootSelector = "[data-item-tooltip-root]",
}: ItemIconProps): React.JSX.Element => {
    const iconRef = useRef<HTMLSpanElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tooltipTimer = useRef<number | null>(null);
    const [activeTooltip, setActiveTooltip] = useState<ActiveTooltip | null>(null);

    useEffect(() => {
        let cancelled = false;
        const canvas = canvasRef.current;
        if (!item.iconUrl || !canvas) return;
        const mask = item.iconMaskUrl
            ? loadImage(item.iconMaskUrl)
            : Promise.resolve<HTMLImageElement | undefined>(undefined);
        void Promise.all([loadImage(item.iconUrl), mask]).then(([image, alphaMask]) => {
            if (!cancelled && canvasRef.current) drawItemImage(canvasRef.current, image, alphaMask);
        });
        return () => { cancelled = true; };
    }, [item.iconMaskUrl, item.iconUrl]);

    const clearTooltip = (): void => {
        if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
        tooltipTimer.current = null;
        setActiveTooltip(null);
    };

    const scheduleTooltip = (): void => {
        clearTooltip();
        const icon = iconRef.current;
        const root = icon?.closest<HTMLElement>(tooltipRootSelector);
        if (!icon || !root) return;
        const anchorElement = icon.closest<HTMLElement>("button") ?? icon;
        const rootRect = root.getBoundingClientRect();
        const anchorRect = anchorElement.getBoundingClientRect();
        const scaleX = rootRect.width / canvasWidth || 1;
        const scaleY = rootRect.height / canvasHeight || 1;
        const pending: ActiveTooltip = {
            root,
            anchor: {
                left: (anchorRect.left - rootRect.left) / scaleX,
                top: (anchorRect.top - rootRect.top) / scaleY,
                width: anchorRect.width / scaleX,
                height: anchorRect.height / scaleY,
            },
        };
        tooltipTimer.current = window.setTimeout(() => {
            tooltipTimer.current = null;
            setActiveTooltip(pending);
        }, INVENTORY_ITEM_HINT_DELAY_MS);
    };

    useEffect(() => {
        const button = iconRef.current?.closest<HTMLButtonElement>("button");
        if (!button) return;
        button.addEventListener("focus", scheduleTooltip);
        button.addEventListener("blur", clearTooltip);
        return () => {
            button.removeEventListener("focus", scheduleTooltip);
            button.removeEventListener("blur", clearTooltip);
        };
    });

    useEffect(() => clearTooltip, [item.technicalName, quantity]);

    return <>
        <span ref={iconRef} className={styles.icon} onPointerEnter={scheduleTooltip} onPointerLeave={clearTooltip}>
            {item.iconUrl
                ? <canvas ref={canvasRef} className={styles.image} aria-hidden="true" />
                : <span className={styles.fallback}>{item.literaryName.slice(0, 1)}</span>}
            {quantity !== undefined && quantity > 1 && <strong className={styles.quantity}>{quantity}</strong>}
        </span>
        {activeTooltip && createPortal(
            <GuiTooltip text={tooltipText(item, quantity)} anchor={activeTooltip.anchor}
                canvasWidth={canvasWidth} canvasHeight={canvasHeight} />,
            activeTooltip.root,
        )}
    </>;
};
