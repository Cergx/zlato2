import { useCursor } from "../../context/CursorContext.tsx";
import { CursorType } from "../../enums/CursorTypes.ts";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { loadCSX, loadImage } from "../../game/Assets.ts";
import {
    GOLDENLAND_START_DAY,
    GOLDENLAND_START_MONTH,
    GOLDENLAND_START_YEAR,
} from "../../game/PersistenceRuntime.ts";
import type { WorldMapPoint, WorldMapState } from "../../game/WorldMapRuntime.ts";
import { GuiTooltip } from "../gui/GuiTooltip.tsx";
import { NativeMessageBox } from "../gui/NativeMessageBox.tsx";
import { OriginalGuiLayer } from "../OriginalGuiLayer.tsx";
import styles from "./WorldMapPanel.module.css";

const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1200;
const VIEW_WIDTH = 1024;
const VIEW_HEIGHT = 768;
const EDGE_SIZE = 28;
const CAMERA_SPEED = 0.32;
const MAP_ROOT = "/assets/engineres/globalmap";
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"] as const;

interface WorldMapPanelProps {
    readonly state: WorldMapState;
    readonly onMove: (x: number, y: number, locationId?: string) => boolean;
    readonly onTick: (elapsedMs: number) => void;
    readonly onAnswerEncounter: (accept: boolean) => void;
    readonly onContinueArrival: () => void;
    readonly onSelectArrival: (level: string) => void;
    readonly onClose: () => void;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const cameraFor = (point: WorldMapPoint): WorldMapPoint => ({
    x: clamp(point.x - VIEW_WIDTH / 2, 0, MAP_WIDTH - VIEW_WIDTH),
    y: clamp(point.y - VIEW_HEIGHT / 2, 0, MAP_HEIGHT - VIEW_HEIGHT),
});

const formatClock = (elapsedMinutes: number): { date: string; time: string } => {
    const wholeMinutes = Math.max(0, Math.floor(elapsedMinutes));
    const day = Math.floor(wholeMinutes / 1440);
    const minuteOfDay = wholeMinutes % 1440;
    const date = new Date(Date.UTC(GOLDENLAND_START_YEAR, GOLDENLAND_START_MONTH - 1, GOLDENLAND_START_DAY + day));
    return {
        date: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
        time: `${Math.floor(minuteOfDay / 60)}:${String(minuteOfDay % 60).padStart(2, "0")}`,
    };
};

const routeDots = (route: readonly WorldMapPoint[]): readonly WorldMapPoint[] => {
    const points: WorldMapPoint[] = [];
    for (let index = route.length - 1; index > 0; index -= 1) {
        const from = route[index];
        const to = route[index - 1];
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        for (let offset = 12; offset < length; offset += 12) {
            points.push({ x: from.x + (to.x - from.x) * offset / length, y: from.y + (to.y - from.y) * offset / length });
        }
    }
    return points;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const keyedImageCache = new Map<string, Promise<HTMLCanvasElement>>();
const csxCache = new Map<string, Promise<HTMLCanvasElement | undefined>>();

const cachedImage = (src: string): Promise<HTMLImageElement> => {
    const cached = imageCache.get(src);
    if (cached) return cached;
    const promise = loadImage(src);
    imageCache.set(src, promise);
    return promise;
};

const cachedCsx = (src: string): Promise<HTMLCanvasElement | undefined> => {
    const cached = csxCache.get(src);
    if (cached) return cached;
    const promise = loadCSX(src);
    csxCache.set(src, promise);
    return promise;
};

const cachedKeyedImage = (src: string): Promise<HTMLCanvasElement> => {
    const cached = keyedImageCache.get(src);
    if (cached) return cached;
    const promise = cachedImage(src).then((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error(`Global-map image canvas has no 2D context: ${src}`);
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
            if (pixels.data[offset] > 253 && pixels.data[offset + 1] < 2 && pixels.data[offset + 2] > 252) {
                pixels.data[offset + 3] = 0;
            }
        }
        context.putImageData(pixels, 0, 0);
        return canvas;
    });
    keyedImageCache.set(src, promise);
    return promise;
};
interface MapCanvasProps {
    readonly state: WorldMapState;
    readonly style?: CSSProperties;
}

const MapCanvas = ({ state, style }: MapCanvasProps) => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let active = true;
        const pictures = state.locations
            .filter((location) => location.discovered && location.picture)
            .map((location) => ({
                location,
                source: `${MAP_ROOT}/pictures_sprite/${location.picture!.source}`,
            }));
        void Promise.all([
            cachedImage(`${MAP_ROOT}/map_visible.bmp`),
            ...pictures.map(({ source }) => cachedKeyedImage(source).catch(() => undefined)),
            cachedCsx(`${MAP_ROOT}/target.csx`),
            cachedKeyedImage(`${MAP_ROOT}/other/route_img.bmp`).catch(() => undefined),
            cachedCsx(`${MAP_ROOT}/hero.csx`),
        ]).then(([base, ...resources]) => {
            const canvas = ref.current;
            if (!active || !canvas || !(base instanceof HTMLImageElement)) return;
            canvas.width = MAP_WIDTH;
            canvas.height = MAP_HEIGHT;
            const context = canvas.getContext("2d");
            if (!context) return;
            context.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
            context.drawImage(base, 0, 0, MAP_WIDTH, MAP_HEIGHT);
            const pictureResources = resources.slice(0, pictures.length) as Array<HTMLCanvasElement | undefined>;
            pictures.forEach(({ location }, index) => {
                const picture = pictureResources[index];
                if (picture && location.picture) context.drawImage(picture, location.picture.x, location.picture.y);
            });
            context.textBaseline = "alphabetic";
            context.textAlign = "left";
            context.fillStyle = "#1e1300";
            context.font = 'italic 400 14px ZlatoPalatino, "Palatino Linotype", Palatino, serif';
            state.regions.forEach((region) => context.fillText(region.text, region.x, region.y));
            context.font = '400 10px ZlatoPalatino, "Palatino Linotype", Palatino, serif';
            context.fillStyle = "#ffffff";
            state.locations.filter((location) => location.discovered).forEach((location) => context.fillText(location.label, location.x, location.y));
            const target = resources[pictures.length] as HTMLCanvasElement | undefined;
            if (target && state.destination) context.drawImage(target, state.destination.x - 16, state.destination.y - 16);
            const route = resources[pictures.length + 1] as HTMLCanvasElement | undefined;
            if (route) routeDots(state.routePath).forEach((dot) => context.drawImage(route, dot.x - 4, dot.y - 4));
            const hero = resources[pictures.length + 2] as HTMLCanvasElement | undefined;
            if (hero) context.drawImage(hero, state.position.x - 13, state.position.y - 13);
        });
        return () => { active = false; };
    }, [state]);
    return <canvas ref={ref} className={styles.map} style={style} aria-label="Карта мира" />;
};

const WheelSprite = ({ elapsedMinutes }: { elapsedMinutes: number }) => {
    const ref = useRef<HTMLCanvasElement>(null);
    const minuteOfDay = ((Math.floor(elapsedMinutes) % 1440) + 1440) % 1440;
    const rotatedMinutes = minuteOfDay >= 14 * 60 ? minuteOfDay - 14 * 60 : minuteOfDay + 10 * 60;
    const frame = Math.floor(rotatedMinutes / 20);
    useEffect(() => {
        let active = true;
        const image = new Image();
        image.onload = () => {
            const target = ref.current;
            if (!active || !target) return;
            target.width = 70;
            target.height = 63;
            const context = target.getContext("2d", { willReadFrequently: true });
            if (!context) return;
            context.drawImage(image, 0, frame * 63, 70, 63, 0, 0, 70, 63);
            const pixels = context.getImageData(0, 0, 70, 63);
            for (let offset = 0; offset < pixels.data.length; offset += 4) {
                if (pixels.data[offset] === 255 && pixels.data[offset + 1] === 0 && pixels.data[offset + 2] === 255) pixels.data[offset + 3] = 0;
            }
            context.putImageData(pixels, 0, 0);
        };
        image.src = `${MAP_ROOT}/interface/koleso_gm.bmp`;
        return () => { active = false; };
    }, [frame]);
    return <canvas ref={ref} className={styles.wheel} aria-hidden="true" />;
};

export const WorldMapPanel = ({ state, onMove, onTick, onAnswerEncounter, onContinueArrival, onSelectArrival, onClose }: WorldMapPanelProps) => {
    const { setCursor } = useCursor();
    const [camera, setCamera] = useState(() => cameraFor(state.position));
    const panRef = useRef({ x: 0, y: 0 });
    const cameraRef = useRef(camera);
    cameraRef.current = camera;

    const arrival = state.arrivalPrompt;
    const arrivalAnchor = useMemo(() => {
        if (!arrival) return undefined;
        const location = state.locations.find((candidate) => candidate.id === arrival.locationId);
        if (!location) return undefined;
        return { left: location.x - camera.x, top: location.y - camera.y };
    }, [arrival, state.locations, camera.x, camera.y]);

    useEffect(() => {
        if (state.moving) setCamera(cameraFor(state.position));
    }, [state.moving, state.position.x, state.position.y]);

    useEffect(() => {
        const finish = (): void => setCursor(CursorType.NORMAL);
        window.addEventListener("pointermove", finish);
        return () => window.removeEventListener("pointermove", finish);
    }, [setCursor]);


    useEffect(() => {
        let frame = 0;
        let previous = performance.now();
        const animate = (now: number): void => {
            const elapsed = Math.min(100, now - previous);
            previous = now;
            onTick(elapsed);
            const pan = panRef.current;
            if (pan.x !== 0 || pan.y !== 0) {
                setCamera((current) => ({
                    x: clamp(current.x + pan.x * elapsed * CAMERA_SPEED, 0, MAP_WIDTH - VIEW_WIDTH),
                    y: clamp(current.y + pan.y * elapsed * CAMERA_SPEED, 0, MAP_HEIGHT - VIEW_HEIGHT),
                }));
            }
            frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frame);
    }, [onTick]);
    const clock = useMemo(() => formatClock(state.elapsedMinutes), [state.elapsedMinutes]);

    const mapPointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): WorldMapPoint => {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: cameraRef.current.x + (event.clientX - rect.left) * VIEW_WIDTH / rect.width,
            y: cameraRef.current.y + (event.clientY - rect.top) * VIEW_HEIGHT / rect.height,
        };
    };
    const locationAt = (position: WorldMapPoint): WorldMapState["locations"][number] | undefined =>
        state.locations.find((location) => location.discovered && Math.hypot(location.x - position.x, location.y - position.y) <= 28);

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const rect = event.currentTarget.getBoundingClientRect();
        const viewportX = (event.clientX - rect.left) * VIEW_WIDTH / rect.width;
        const viewportY = (event.clientY - rect.top) * VIEW_HEIGHT / rect.height;
        const edgeX = viewportX < EDGE_SIZE ? -1 : viewportX > VIEW_WIDTH - EDGE_SIZE ? 1 : 0;
        const edgeY = viewportY < EDGE_SIZE ? -1 : viewportY > VIEW_HEIGHT - EDGE_SIZE ? 1 : 0;
        panRef.current = { x: edgeX, y: edgeY };
        if (edgeX !== 0 || edgeY !== 0) {
            const cursor = edgeY < 0 ? (edgeX < 0 ? CursorType.LUP : edgeX > 0 ? CursorType.RUP : CursorType.UP)
                : edgeY > 0 ? (edgeX < 0 ? CursorType.LDOWN : edgeX > 0 ? CursorType.RDOWN : CursorType.DOWN)
                    : edgeX < 0 ? CursorType.LEFT : CursorType.RIGHT;
            setCursor(cursor);
        } else {
            setCursor(CursorType.NORMAL);
        }
    };
    const handlePointerLeave = (): void => {
        panRef.current = { x: 0, y: 0 };
        setCursor(CursorType.NORMAL);
    };
    const handleMapClick = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (state.prompt || state.arrivalPrompt || !state.canTravel) return;
        const position = mapPointFromEvent(event);
        const location = locationAt(position);
        if (location) {
            if (location.available && !state.moving) onMove(location.x, location.y, location.id);
            return;
        }
        onMove(position.x, position.y);
    };

    return (
        <section
            className={styles.panel}
            aria-label="Глобальная карта"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onClick={handleMapClick}
        >
            <MapCanvas state={state} style={{ left: -camera.x, top: -camera.y }} />
            <img className={styles.leftBottom} src={`${MAP_ROOT}/interface/left_bottom.png`} alt="" draggable={false} />
            <img className={`${styles.frame} ${styles.frameTop}`} src={`${MAP_ROOT}/interface/top.png`} alt="" draggable={false} />
            <img className={`${styles.frame} ${styles.frameBottom}`} src={`${MAP_ROOT}/interface/bottom.png`} alt="" draggable={false} />
            <img className={`${styles.frame} ${styles.frameLeft}`} src={`${MAP_ROOT}/interface/left.png`} alt="" draggable={false} />
            <img className={`${styles.frame} ${styles.frameRight}`} src={`${MAP_ROOT}/interface/right.png`} alt="" draggable={false} />
            <img className={`${styles.frame} ${styles.frameBottomRight}`} src={`${MAP_ROOT}/interface/right_bottom.png`} alt="" draggable={false} />
            <WheelSprite elapsedMinutes={state.elapsedMinutes} />
            <div className={styles.clockDate}>{clock.date}</div>
            <div className={styles.clockTime}>{clock.time}</div>
            <OriginalGuiLayer
                script="globalmap"
                objectIds={[1, 2]}
                labels={{ 1: "Закрыть глобальную карту", 2: `${clock.date} ${clock.time}` }}
                onAction={(object) => {
                    if (object.id === 1 && !state.arrivalPrompt) onClose();
                }}
            />
            {state.prompt && (
                <div className={styles.prompt} onClick={(event) => event.stopPropagation()}>
                    <NativeMessageBox text={state.prompt.text} onConfirm={() => onAnswerEncounter(true)} onCancel={() => onAnswerEncounter(false)} />
                </div>
            )}
            {state.arrivalPrompt && arrivalAnchor && (
                <GuiTooltip
                    text={state.arrivalPrompt.locationLabel}
                    anchor={{ left: arrivalAnchor.left, top: arrivalAnchor.top, width: 1, height: 1 }}
                    canvasWidth={VIEW_WIDTH}
                    canvasHeight={VIEW_HEIGHT}
                    interactive
                >
                    <div className={styles.arrivalContent} onClick={(event) => event.stopPropagation()}>
                        <div className={styles.arrivalTitle}>{state.arrivalPrompt.locationLabel}</div>
                        <div className={styles.arrivalOptions}>
                            {state.arrivalPrompt.options.map((option) => (
                                <button key={option.level} type="button" className={styles.arrivalOption}
                                    onClick={() => onSelectArrival(option.level)}>
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <button type="button" className={styles.continueButton} onClick={onContinueArrival}>Продолжить...</button>
                    </div>
                </GuiTooltip>
            )}
        </section>
    );
};
