import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadColorKeyImage } from "../ColorKeyImage.tsx";
import styles from "./GuiTooltip.module.scss";

export interface GuiTooltipAnchor {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

interface GuiTooltipProps {
    readonly text: string;
    readonly anchor: GuiTooltipAnchor;
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly fixedWidth?: number;
}

type FramePart = "main" | "top" | "bottom" | "left" | "right" | "lt" | "rt" | "lb" | "rb";
type FrameImages = Readonly<Record<FramePart, HTMLImageElement>>;

const FRAME_PARTS: readonly FramePart[] = ["main", "top", "bottom", "left", "right", "lt", "rt", "lb", "rb"];

const loadFrameImage = async (part: FramePart): Promise<readonly [FramePart, HTMLImageElement]> => {
    const processed = await loadColorKeyImage(`/assets/engineres/msg_box/hints/${part}.bmp`);
    const image = new Image();
    image.src = processed.url;
    await image.decode();
    return [part, image];
};

const framePromise = Promise.all(FRAME_PARTS.map(loadFrameImage))
    .then((entries) => Object.fromEntries(entries) as FrameImages);

const tile = (
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
): void => {
    if (width <= 0 || height <= 0) return;
    const pattern = context.createPattern(image, "repeat");
    if (!pattern) return;
    context.save();
    context.translate(x, y);
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, height);
    context.restore();
};

const drawFrame = (canvas: HTMLCanvasElement, images: FrameImages, width: number, height: number): void => {
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;

    const border = 20;
    const overlap = 1;
    const inset = border - overlap;
    tile(context, images.main, inset, inset, width - inset * 2, height - inset * 2);
    tile(context, images.top, inset, 0, width - inset * 2, border);
    tile(context, images.bottom, inset, height - border, width - inset * 2, border);
    tile(context, images.left, 0, inset, border, height - inset * 2);
    tile(context, images.right, width - border, inset, border, height - inset * 2);
    context.drawImage(images.lt, 0, 0);
    context.drawImage(images.rt, width - border, 0);
    context.drawImage(images.lb, 0, height - border);
    context.drawImage(images.rb, width - border, height - border);
};

export const GuiTooltip = ({ text, anchor, canvasWidth, canvasHeight, fixedWidth }: GuiTooltipProps) => {
    const elementRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [frameImages, setFrameImages] = useState<FrameImages | null>(null);
    const [position, setPosition] = useState({ left: anchor.left, top: anchor.top + anchor.height });

    useEffect(() => {
        let cancelled = false;
        void framePromise.then((images) => { if (!cancelled) setFrameImages(images); });
        return () => { cancelled = true; };
    }, []);

    useLayoutEffect(() => {
        const element = elementRef.current;
        if (!element) return;
        const tooltipWidth = element.offsetWidth;
        const tooltipHeight = element.offsetHeight;
        const availableAbove = anchor.top;
        const availableBelow = canvasHeight - anchor.top - anchor.height;
        const top = availableAbove > availableBelow
            ? anchor.top - tooltipHeight
            : anchor.top + anchor.height;
        const centeredLeft = anchor.left - (tooltipWidth - anchor.width) / 2;
        setPosition({
            left: Math.max(0, Math.min(canvasWidth - tooltipWidth, centeredLeft)),
            top: Math.max(0, Math.min(canvasHeight - tooltipHeight, top)),
        });
        const frameCanvas = canvasRef.current;
        if (frameCanvas && frameImages) drawFrame(frameCanvas, frameImages, tooltipWidth, tooltipHeight);
    }, [anchor, canvasHeight, canvasWidth, fixedWidth, frameImages, text]);

    return <div ref={elementRef} className={styles.tooltip} role="tooltip" data-gui-tooltip="true"
        style={{ left: `${position.left}px`, top: `${position.top}px`, pointerEvents: "none",
            ...(fixedWidth === undefined ? {} : { width: fixedWidth, minWidth: fixedWidth, maxWidth: fixedWidth }) }}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <span className={styles.text} style={fixedWidth === undefined ? undefined : { maxWidth: fixedWidth - 40 }}>{text}</span>
    </div>;
};
