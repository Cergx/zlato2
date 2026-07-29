export class CSXParser {
    private readonly bytes: Uint8Array;
    private readonly data: DataView;
    private offset = 0;

    constructor(arrayBuffer: ArrayBuffer) {
        this.bytes = new Uint8Array(arrayBuffer);
        this.data = new DataView(arrayBuffer);
    }

    private require(byteLength: number, field: string): void {
        if (!Number.isSafeInteger(byteLength) || byteLength < 0 || this.offset + byteLength > this.data.byteLength) {
            throw new Error(`Invalid CSX: ${field} at ${this.offset} needs ${byteLength} bytes; ${this.data.byteLength - this.offset} remain`);
        }
    }

    private readInt(field: string): number {
        this.require(4, field);
        const value = this.data.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    private readByte(field: string): number {
        this.require(1, field);
        return this.bytes[this.offset++];
    }

    private readBGRA(magentaTransparent: boolean, field: string): [number, number, number, number] {
        const b = this.readByte(`${field}.blue`);
        const g = this.readByte(`${field}.green`);
        const r = this.readByte(`${field}.red`);
        const a = this.readByte(`${field}.alpha`);
        const isMagenta = r > 253 && g < 2 && b > 252;
        return [r, g, b, magentaTransparent && isMagenta ? 0 : 255 - a];
    }

    public parse(isBackgroundTransparent: boolean, magentaTransparent = true): HTMLCanvasElement {
        const colorCount = this.readInt("palette size");
        if (colorCount < 0 || colorCount > 256) throw new Error(`Invalid CSX: palette size ${colorCount} is outside 0..256`);

        const fillColor = this.readBGRA(magentaTransparent, "fill color");
        if (isBackgroundTransparent) fillColor[3] = 0;

        const colors: [number, number, number, number][] = [];
        for (let i = 0; i < colorCount; i++) colors.push(this.readBGRA(magentaTransparent, `palette[${i}]`));

        const width = this.readInt("width");
        const height = this.readInt("height");
        const pixelCount = width * height;
        if (width <= 0 || height <= 0 || !Number.isSafeInteger(pixelCount)) {
            throw new Error(`Invalid CSX: dimensions ${width}×${height}`);
        }

        const byteLineIndices: number[] = [];
        for (let i = 0; i <= height; i++) byteLineIndices.push(this.readInt(`line offset ${i}`));
        const compressedLength = this.data.byteLength - this.offset;
        if (byteLineIndices[0] !== 0) throw new Error(`Invalid CSX: first line offset is ${byteLineIndices[0]}, expected 0`);
        if (byteLineIndices[height] !== compressedLength) {
            throw new Error(`Invalid CSX: final line offset is ${byteLineIndices[height]}, expected ${compressedLength}`);
        }

        const compressed = this.bytes.subarray(this.offset);
        const pixelIndices = new Int16Array(pixelCount);
        pixelIndices.fill(-1);
        for (let y = 0; y < height; y++) {
            const start = byteLineIndices[y];
            const end = byteLineIndices[y + 1];
            if (start < 0 || start > end || end > compressed.length) {
                throw new Error(`Invalid CSX: line ${y} range [${start}, ${end}) exceeds ${compressed.length} compressed bytes`);
            }
            this.decodeLine(compressed, start, end, pixelIndices, y * width, width, colorCount, y);
        }

        const imageData = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0; i < pixelIndices.length; i++) {
            const paletteIndex = pixelIndices[i];
            const [r, g, b, a] = paletteIndex >= 0 ? colors[paletteIndex] : fillColor;
            imageData[i * 4] = r;
            imageData[i * 4 + 1] = g;
            imageData[i * 4 + 2] = b;
            imageData[i * 4 + 3] = a;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (context) context.putImageData(new ImageData(imageData, width, height), 0, 0);
        return canvas;
    }

    private decodeLine(
        bytes: Uint8Array,
        start: number,
        end: number,
        pixels: Int16Array,
        pixelStart: number,
        width: number,
        colorCount: number,
        line: number,
    ): void {
        let byteIndex = start;
        let pixelIndex = pixelStart;
        const pixelEnd = pixelStart + width;
        const requireBytes = (count: number, command: string): void => {
            if (byteIndex + count > end) throw new Error(`Invalid CSX: line ${line} ${command} needs ${count} bytes; ${end - byteIndex} remain`);
        };
        const requirePaletteIndex = (index: number, command: string): void => {
            if (index >= colorCount) throw new Error(`Invalid CSX: line ${line} ${command} palette index ${index} exceeds ${colorCount - 1}`);
        };

        while (pixelIndex < pixelEnd && byteIndex < end) {
            const opcode = bytes[byteIndex++];
            switch (opcode) {
                case 105:
                    pixelIndex++;
                    break;
                case 106: {
                    requireBytes(2, "run");
                    const color = bytes[byteIndex++];
                    const count = bytes[byteIndex++];
                    if (count === 0) throw new Error(`Invalid CSX: line ${line} has a zero-length run`);
                    requirePaletteIndex(color, "run");
                    const applied = Math.min(count, pixelEnd - pixelIndex);
                    pixels.fill(color, pixelIndex, pixelIndex + applied);
                    pixelIndex += applied;
                    break;
                }
                case 107: {
                    requireBytes(1, "escaped literal");
                    const color = bytes[byteIndex++];
                    requirePaletteIndex(color, "escaped literal");
                    pixels[pixelIndex++] = color;
                    break;
                }
                case 108: {
                    requireBytes(1, "transparent run");
                    const count = bytes[byteIndex++];
                    if (count === 0) throw new Error(`Invalid CSX: line ${line} has a zero-length transparent run`);
                    pixelIndex += Math.min(count, pixelEnd - pixelIndex);
                    break;
                }
                default:
                    requirePaletteIndex(opcode, "literal");
                    pixels[pixelIndex++] = opcode;
                    break;
            }
        }
        if (pixelIndex !== pixelEnd) throw new Error(`Invalid CSX: line ${line} decoded ${pixelIndex - pixelStart}/${width} pixels`);
        if (byteIndex !== end) throw new Error(`Invalid CSX: line ${line} left ${end - byteIndex} compressed bytes`);
    }
}
