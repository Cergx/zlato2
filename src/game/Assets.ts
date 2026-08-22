import { CSXParser } from "./parsers/CSXParser.ts";

export const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = () => reject(`Ошибка загрузки: ${src}`);
    });
};
interface CSXLoadOptions {
    magentaTransparent?: boolean;
    backgroundTransparent?: boolean;
}

const isBmp = (bytes: Uint8Array): boolean => bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;

const convertBmpToCsx = (buffer: ArrayBuffer): ArrayBuffer => {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 54 || !isBmp(bytes)) throw new Error("Invalid BMP fallback header");
    const view = new DataView(buffer);
    const pixelOffset = view.getUint32(10, true);
    const width = view.getInt32(18, true);
    const signedHeight = view.getInt32(22, true);
    const bitsPerPixel = view.getUint16(28, true);
    const colorsUsed = view.getUint32(46, true);
    if (width <= 0 || signedHeight === 0 || bitsPerPixel !== 8) {
        throw new Error(`Unsupported BMP fallback: ${width}×${signedHeight}, ${bitsPerPixel} bpp`);
    }

    const height = Math.abs(signedHeight);
    const paletteSize = colorsUsed === 0 ? 256 : colorsUsed;
    const paletteOffset = 54;
    const paletteBytes = paletteSize * 4;
    const rowStride = (width + 3) & ~3;
    if (paletteSize > 256 || paletteOffset + paletteBytes > bytes.length
        || pixelOffset > bytes.length || pixelOffset + rowStride * height > bytes.length) {
        throw new Error("Invalid BMP fallback bounds");
    }

    const headerLength = 4 + 4 + paletteBytes + 8 + (height + 1) * 4;
    const converted = new Uint8Array(headerLength + width * height);
    const convertedView = new DataView(converted.buffer);
    let offset = 0;
    const writeUint32 = (value: number): void => {
        convertedView.setUint32(offset, value, true);
        offset += 4;
    };
    writeUint32(paletteSize);
    converted.set(bytes.subarray(paletteOffset, paletteOffset + 4), offset);
    offset += 4;
    converted.set(bytes.subarray(paletteOffset, paletteOffset + paletteBytes), offset);
    offset += paletteBytes;
    writeUint32(width);
    writeUint32(height);
    for (let line = 0; line <= height; line++) writeUint32(line * width);
    for (let line = 0; line < height; line++) {
        const sourceLine = signedHeight > 0 ? height - 1 - line : line;
        const source = pixelOffset + sourceLine * rowStride;
        converted.set(bytes.subarray(source, source + width), offset);
        offset += width;
    }
    return converted.buffer;
};

const isHtmlFallback = (response: Response, bytes: Uint8Array): boolean => {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) return true;
    const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 32)).trimStart().toLowerCase();
    return prefix.startsWith("<!doctype html") || prefix.startsWith("<html");
};

const fetchAssetBuffer = async (path: string): Promise<ArrayBuffer | undefined> => {
    const response = await fetch(path);
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    return isHtmlFallback(response, new Uint8Array(buffer)) ? undefined : buffer;
};

const fetchCSXBuffer = async (path: string): Promise<ArrayBuffer | undefined> => {
    const buffer = await fetchAssetBuffer(path);
    if (buffer) return isBmp(new Uint8Array(buffer)) ? convertBmpToCsx(buffer) : buffer;
    if (!path.toLowerCase().endsWith(".csx")) return undefined;
    const bmpBuffer = await fetchAssetBuffer(`${path.slice(0, -4)}.bmp`);
    return bmpBuffer ? convertBmpToCsx(bmpBuffer) : undefined;
};

const loadFetchedCSX = async (path: string, options: CSXLoadOptions): Promise<HTMLCanvasElement | undefined> => {
    const buffer = await fetchCSXBuffer(path);
    if (!buffer) return undefined;
    return new CSXParser(buffer).parse(options.backgroundTransparent ?? true, options.magentaTransparent ?? true);
};

export const loadOptionalCSX = async (path: string, options: CSXLoadOptions = {}): Promise<HTMLCanvasElement | undefined> => {
    try {
        return await loadFetchedCSX(path, options);
    } catch (error) {
        console.warn(`Ошибка загрузки CSX (${path}):`, error);
        return undefined;
    }
};

export const loadCSX = async (path: string, options: CSXLoadOptions = {}): Promise<HTMLCanvasElement | undefined> => {
    try {
        const canvas = await loadFetchedCSX(path, options);
        if (!canvas) throw new Error(`CSX-файл не найден: ${path}`);
        return canvas;
    } catch (error) {
        console.warn(`Ошибка загрузки CSX (${path}):`, error);
        return undefined;
    }
};
