export class CSXParser {
    private data: DataView;
    private offset: number = 0;

    constructor(arrayBuffer: ArrayBuffer) {
        this.data = new DataView(arrayBuffer);
    }

    private readInt(): number {
        const value = this.data.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    private readByte(): number {
        const value = this.data.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    private readBGRA(): [number, number, number, number] {
        const b = this.readByte();
        const g = this.readByte();
        const r = this.readByte();
        const a = this.readByte(); // alpha инвертирован

        // если цвет - magenta - делаем прозрачным
        // if (r > 253 && g < 2 && b > 252) {
        //     a = 255;
        // }

        return [r, g, b, 255 - a];
    }

    public parse(isBackgroundTransparent: boolean): HTMLCanvasElement {
        // Читаем количество цветов в палитре
        const colorCount = this.readInt();
        const fillColor = this.readBGRA();
        if (isBackgroundTransparent) fillColor[3] = 0;

        // Читаем палитру цветов
        const colors: [number, number, number, number][] = [];
        for (let i = 0; i < colorCount; i++) {
            colors.push(this.readBGRA());
        }

        // Читаем размеры изображения
        const width = this.readInt();
        const height = this.readInt();

        // Читаем индексы строк пикселей
        const byteLineIndices: number[] = [];
        for (let i = 0; i < height + 1; i++) {
            byteLineIndices.push(this.readInt());
        }

        // Читаем данные пикселей
        const bytes: number[] = [];
        for (let i = 0; i < byteLineIndices[height]; i++) {
            bytes.push(this.readByte());
        }

        // Декодируем изображение
        const pixelIndices = new Array(width * height).fill(-1);
        for (let y = 0; y < height; y++) {
            this.decodeLine(bytes, byteLineIndices[y], pixelIndices, y * width, width, byteLineIndices[y + 1] - byteLineIndices[y]);
        }

        // Конвертируем в ImageData
        const imageData = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < pixelIndices.length; i++) {
            const [r, g, b, a] = pixelIndices[i] >= 0 ? colors[pixelIndices[i]] : fillColor;
            imageData[i * 4] = r;
            imageData[i * 4 + 1] = g;
            imageData[i * 4 + 2] = b;
            imageData[i * 4 + 3] = a;
        }

        // Создаём canvas и отрисовываем ImageData
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const imgData = new ImageData(imageData, width, height);
            ctx.putImageData(imgData, 0, 0);
        }

        return canvas;
    }

    private decodeLine(bytes: number[], byteIndex: number, pixels: number[], pixelIndex: number, widthLeft: number, byteCount: number) {
        const startPixelIndex = pixelIndex;
        while (widthLeft > 0 && byteCount > 0) {
            let x = bytes[byteIndex];
            byteIndex++;
            byteCount--;

            switch (x) {
                case 107: // WTF-case
                    pixels[pixelIndex] = bytes[byteIndex];
                    if (pixelIndex !== startPixelIndex) pixels[pixelIndex - 1] = bytes[byteIndex];
                    byteIndex++;
                    byteCount--;
                    pixelIndex++;
                    widthLeft--;
                    break;
                case 105: // Прозрачный пиксель
                    pixelIndex++;
                    widthLeft--;
                    break;
                case 106: // Заполненный цвет
                    x = Math.min(widthLeft, bytes[byteIndex + 1]);
                    for (let i = 0; i < x; i++) pixels[pixelIndex + i] = bytes[byteIndex];
                    if (pixelIndex !== startPixelIndex) pixels[pixelIndex - 1] = bytes[byteIndex];
                    byteCount -= 2;
                    byteIndex += 2;
                    pixelIndex += x;
                    widthLeft -= x;
                    break;
                case 108: // Заполнение прозрачным
                    x = Math.min(bytes[byteIndex], widthLeft);
                    byteIndex++;
                    byteCount--;
                    pixelIndex += x;
                    widthLeft -= x;
                    break;
                default: // Обычный цвет
                    pixels[pixelIndex] = x;
                    pixelIndex++;
                    widthLeft--;
                    break;
            }
        }
    }
}
