export interface MDFSpriteReference {
    readonly path: string;
    readonly offset: number;
    readonly frameCount: number;
    readonly startMs: number;
    readonly endMs: number;
}

export interface MDFData {
    readonly durationMs: number;
    readonly headerWords: readonly number[];
    readonly sprites: readonly MDFSpriteReference[];
}

const HEADER_SIZE = 52;
const decoder = new TextDecoder("windows-1251");

const isSpritePath = (bytes: Uint8Array): boolean => {
    if (bytes.length < 5 || bytes.some((byte) => byte < 0x20 || byte > 0x7e)) return false;
    return /\.(?:bmp|csx)$/i.test(decoder.decode(bytes));
};

export class MDFParser {
    private readonly view: DataView;
    private readonly bytes: Uint8Array;

    public constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
        this.bytes = new Uint8Array(buffer);
        if (buffer.byteLength < HEADER_SIZE) throw new Error(`MDF is shorter than ${HEADER_SIZE} bytes`);
        if (decoder.decode(this.bytes.subarray(0, 4)) !== "MDF ") throw new Error("Invalid MDF signature");
    }

    public getData(): MDFData {
        const headerWords = Array.from({ length: 12 }, (_, index) => this.view.getInt32(4 + index * 4, true));
        const sprites: MDFSpriteReference[] = [];
        let offset = 12;
        while (offset + 4 <= this.bytes.length) {
            const length = this.view.getUint32(offset, true);
            const end = offset + 4 + length;
            if (length >= 5 && length <= 512 && end <= this.bytes.length) {
                const pathBytes = this.bytes.subarray(offset + 4, end);
                if (isSpritePath(pathBytes) && end + 84 <= this.bytes.length) {
                    const frameCount = this.view.getInt32(end + 56, true) + 1;
                    const startMs = this.view.getInt32(end + 40, true);
                    const endMs = this.view.getInt32(end + 80, true);
                    if (frameCount > 0 && frameCount <= 10_000 && startMs >= 0 && endMs >= startMs) {
                        sprites.push({ path: decoder.decode(pathBytes), offset, frameCount, startMs, endMs });
                        offset = end;
                        continue;
                    }
                }
            }
            offset += 1;
        }
        return {
            durationMs: this.view.getUint32(4, true),
            headerWords,
            sprites,
        };
    }
}

export const mdfSpriteUrl = (reference: string): string => {
    const normalized = reference.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    return `/assets/magic/bitmap/${normalized}`;
};
