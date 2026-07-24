import { useEffect, useState, type CSSProperties, type SyntheticEvent } from "react";

interface ProcessedImage {
    readonly url: string;
    readonly width: number;
    readonly height: number;
}

const imageCache = new Map<string, Promise<ProcessedImage>>();

const loadImage = async (source: string): Promise<HTMLImageElement> => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
};

export const loadColorKeyImage = (source: string): Promise<ProcessedImage> => {
    let cached = imageCache.get(source);
    if (!cached) {
        cached = loadImage(source).then(async (image) => {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) return { url: source, width: image.naturalWidth, height: image.naturalHeight };
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            let changed = false;
            for (let index = 0; index < pixels.data.length; index += 4) {
                if (pixels.data[index] >= 250 && pixels.data[index + 1] <= 5 && pixels.data[index + 2] >= 250) {
                    pixels.data[index + 3] = 0;
                    changed = true;
                }
            }
            if (!changed) return { url: source, width: image.naturalWidth, height: image.naturalHeight };
            context.putImageData(pixels, 0, 0);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
            return {
                url: blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png"),
                width: image.naturalWidth,
                height: image.naturalHeight,
            };
        });
        imageCache.set(source, cached);
    }
    return cached;
};

interface ColorKeyImageProps {
    readonly src: string;
    readonly className?: string;
    readonly style?: CSSProperties;
    readonly draggable?: boolean;
    readonly onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

export const ColorKeyImage = ({ src, className, style, draggable = false, onLoad }: ColorKeyImageProps) => {
    const [processed, setProcessed] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        setProcessed(null);
        void loadColorKeyImage(src).then((image) => { if (!cancelled) setProcessed(image.url); });
        return () => { cancelled = true; };
    }, [src]);
    return processed ? <img className={className} src={processed} alt="" style={style} draggable={draggable} onLoad={onLoad} /> : null;
};
