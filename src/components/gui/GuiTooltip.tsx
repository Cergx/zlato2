import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { drawGuiFrame, guiFramePromise, type GuiFrameImages } from "./GuiFrame.ts";
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
    readonly children?: ReactNode;
    readonly interactive?: boolean;
}


export const GuiTooltip = ({ text, anchor, canvasWidth, canvasHeight, fixedWidth, children, interactive = false }: GuiTooltipProps) => {
    const elementRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [frameImages, setFrameImages] = useState<GuiFrameImages | null>(null);
    const [position, setPosition] = useState({ left: anchor.left, top: anchor.top + anchor.height });

    useEffect(() => {
        let cancelled = false;
        void guiFramePromise.then((images) => { if (!cancelled) setFrameImages(images); });
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
        if (frameCanvas && frameImages) drawGuiFrame(frameCanvas, frameImages, tooltipWidth, tooltipHeight);
    }, [anchor, canvasHeight, canvasWidth, fixedWidth, frameImages, text]);

    return <div ref={elementRef} className={styles.tooltip} role="tooltip" data-gui-tooltip="true"
        style={{ left: `${position.left}px`, top: `${position.top}px`, pointerEvents: interactive ? "auto" : "none",
            ...(fixedWidth === undefined ? {} : { width: fixedWidth, minWidth: fixedWidth, maxWidth: fixedWidth }) }}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        {children ?? <span className={styles.text} style={fixedWidth === undefined ? undefined : { maxWidth: fixedWidth - 40 }}>{text}</span>}
    </div>;
};
