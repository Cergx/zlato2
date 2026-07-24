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
}


export const loadCSX = async (path: string, options: CSXLoadOptions = {}): Promise<HTMLCanvasElement | undefined> => {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`CSX-файл не найден: ${path}`);

        const buffer = await response.arrayBuffer();
        const parser = new CSXParser(buffer);
        return parser.parse(true, options.magentaTransparent ?? true);
    } catch (error) {
        console.warn(`Ошибка загрузки CSX (${path}):`, error);
        return undefined; // Если ошибка, просто возвращаем null
    }
};
