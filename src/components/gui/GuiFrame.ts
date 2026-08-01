import { loadColorKeyImage } from "../ColorKeyImage.tsx";

type FramePart = "main" | "top" | "bottom" | "left" | "right" | "lt" | "rt" | "lb" | "rb";
export type GuiFrameImages = Readonly<Record<FramePart, HTMLImageElement>>;

const FRAME_PARTS: readonly FramePart[] = ["main", "top", "bottom", "left", "right", "lt", "rt", "lb", "rb"];

const loadFrameImage = async (part: FramePart): Promise<readonly [FramePart, HTMLImageElement]> => {
    const processed = await loadColorKeyImage(`/assets/engineres/msg_box/hints/${part}.bmp`);
    const image = new Image();
    image.src = processed.url;
    await image.decode();
    return [part, image];
};

export const guiFramePromise = Promise.all(FRAME_PARTS.map(loadFrameImage))
    .then((entries) => Object.fromEntries(entries) as GuiFrameImages);

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

export const drawGuiFrame = (canvas: HTMLCanvasElement, images: GuiFrameImages, width: number, height: number): void => {
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
