import { useEffect, useRef, useState } from "react";
import { ColorKeyImage } from "../ColorKeyImage.tsx";
import { drawGuiFrame, guiFramePromise, type GuiFrameImages } from "./GuiFrame.ts";
import styles from "./NativeMessageBox.module.scss";

interface NativeMessageBoxProps {
    readonly text: string;
    readonly onConfirm: () => void;
    readonly onCancel?: () => void;
}

const MESSAGE_BOX_WIDTH = 160;
const MESSAGE_BOX_HEIGHT = 120;

export const NativeMessageBox = ({ text, onConfirm, onCancel }: NativeMessageBoxProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [frameImages, setFrameImages] = useState<GuiFrameImages | null>(null);

    useEffect(() => {
        let cancelled = false;
        void guiFramePromise.then((images) => { if (!cancelled) setFrameImages(images); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas && frameImages) drawGuiFrame(canvas, frameImages, MESSAGE_BOX_WIDTH, MESSAGE_BOX_HEIGHT);
    }, [frameImages]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Enter" && event.key !== "Escape" && event.key !== " ") return;
            event.preventDefault();
            if (event.key === "Escape" && onCancel) onCancel();
            else onConfirm();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onCancel, onConfirm]);

    return <div className={styles.blocker} role="presentation">
        <section className={styles.messageBox} role="alertdialog" aria-modal="true" aria-label={text}>
            <canvas ref={canvasRef} className={styles.frame} aria-hidden="true" />
            <p className={styles.text}>{text}</p>
            <button className={styles.confirm} type="button" aria-label="ОК" autoFocus onClick={onConfirm}>
                <ColorKeyImage className={styles.up} src="/assets/engineres/msg_box/buttons_for_hints/ok up.bmp" />
                <ColorKeyImage className={styles.hover} src="/assets/engineres/msg_box/buttons_for_hints/ok up light.bmp" />
                <ColorKeyImage className={styles.down} src="/assets/engineres/msg_box/buttons_for_hints/ok down light.bmp" />
            </button>
            {onCancel && <button className={styles.cancel} type="button" aria-label="Отмена" onClick={onCancel}>
                <ColorKeyImage className={styles.up} src="/assets/engineres/msg_box/buttons_for_hints/closed up.bmp" />
                <ColorKeyImage className={styles.hover} src="/assets/engineres/msg_box/buttons_for_hints/closed up light.bmp" />
                <ColorKeyImage className={styles.down} src="/assets/engineres/msg_box/buttons_for_hints/closed down light.bmp" />
            </button>}
        </section>
    </div>;
};
