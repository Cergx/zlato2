import { useEffect, useRef } from "react";
import { Paths } from "../constants/paths";
import styles from "./MainMenu.module.scss";

interface MenuAnimationDefinition {
    readonly fileName: string;
    readonly frameHeight: number;
    readonly delay: number;
    readonly left: number;
    readonly top: number;
    readonly pingPong: boolean;
    readonly transparent: boolean;
}

interface LoadedMenuAnimation {
    readonly definition: MenuAnimationDefinition;
    readonly source: CanvasImageSource;
    readonly width: number;
    readonly height: number;
}

const animationCache = new Map<string, Promise<readonly MenuAnimationDefinition[]>>();

const loadAnimations = (script: string): Promise<readonly MenuAnimationDefinition[]> => {
    let cached = animationCache.get(script);
    if (!cached) {
        cached = fetch(`${Paths.SCRIPTS}/ui/${script}.scr`).then(async (response) => {
            if (!response.ok) throw new Error(`Menu object script failed: HTTP ${response.status}`);
            const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
            const objects: MenuAnimationDefinition[] = [];
            for (const match of source.matchAll(/object\s*:\s*\{([\s\S]*?)\}/gi)) {
                const attributes: Record<string, string> = {};
                for (const rawLine of match[1].replace(/\r/g, "").split("\n")) {
                    const line = rawLine.replace(/\/\/.*$/, "").trim();
                    const separator = line.indexOf(":");
                    if (separator < 0) continue;
                    attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
                }
                const [left, top] = (attributes.position ?? "0 0").split(/\s+/).map(Number);
                const frameHeight = Number(attributes.frame_height);
                const delay = Number(attributes.delay);
                if (!attributes.file_name || !Number.isFinite(frameHeight) || frameHeight <= 0 || !Number.isFinite(delay) || delay <= 0) continue;
                objects.push({
                    fileName: attributes.file_name,
                    frameHeight,
                    delay,
                    left: Number.isFinite(left) ? left : 0,
                    top: Number.isFinite(top) ? top : 0,
                    pingPong: attributes.type === "ping_pong",
                    transparent: attributes.transparent === "1",
                });
            }
            return objects;
        });
        animationCache.set(script, cached);
    }
    return cached;
};

const loadImage = async (source: string): Promise<HTMLImageElement> => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
};

const loadAnimationStrip = async (definition: MenuAnimationDefinition): Promise<LoadedMenuAnimation> => {
    const image = await loadImage(`/assets/${definition.fileName.replace(/\\/g, "/")}.bmp`);
    if (!definition.transparent) {
        return { definition, source: image, width: image.naturalWidth, height: image.naturalHeight };
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { definition, source: image, width: image.naturalWidth, height: image.naturalHeight };
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
        if (pixels.data[index] >= 250 && pixels.data[index + 1] <= 5 && pixels.data[index + 2] >= 250) {
            pixels.data[index + 3] = 0;
        }
    }
    context.putImageData(pixels, 0, 0);
    return { definition, source: canvas, width: canvas.width, height: canvas.height };
};

export const MainMenuAnimationLayer = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        let cancelled = false;
        let animationFrame = 0;
        void Promise.all([
            loadImage("/assets/engineres/interface/main_menu/background.bmp"),
            loadAnimations("main_menu_obj"),
        ]).then(async ([background, definitions]) => {
            const loaded = await Promise.all(definitions.map(async (definition) => {
                try {
                    return await loadAnimationStrip(definition);
                } catch (error) {
                    console.warn(`Menu animation failed: ${definition.fileName}`, error);
                    return null;
                }
            }));
            const canvas = canvasRef.current;
            if (!canvas || cancelled) return;
            canvas.width = background.naturalWidth;
            canvas.height = background.naturalHeight;
            const context = canvas.getContext("2d");
            if (!context) return;
            const strips = loaded.filter((strip): strip is LoadedMenuAnimation => strip !== null);
            const started = performance.now();
            const draw = (time: number): void => {
                if (cancelled) return;
                context.drawImage(background, 0, 0, canvas.width, canvas.height);
                const elapsed = time - started;
                for (const strip of strips) {
                    const { definition } = strip;
                    const frameCount = Math.max(1, Math.floor(strip.height / definition.frameHeight));
                    const cycleLength = definition.pingPong && frameCount > 1 ? frameCount * 2 - 2 : frameCount;
                    const step = Math.floor(elapsed / definition.delay) % cycleLength;
                    const frame = definition.pingPong && step >= frameCount ? cycleLength - step : step;
                    context.drawImage(
                        strip.source,
                        0, frame * definition.frameHeight, strip.width, definition.frameHeight,
                        definition.left, definition.top, strip.width, definition.frameHeight,
                    );
                }
                animationFrame = requestAnimationFrame(draw);
            };
            animationFrame = requestAnimationFrame(draw);
        }).catch((error) => console.error("Main menu canvas failed", error));

        return () => {
            cancelled = true;
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    return <canvas className={styles.backdrop} ref={canvasRef} width={1024} height={768} aria-hidden="true" />;
};
