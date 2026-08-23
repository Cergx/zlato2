type AniMetadata = {
    // Data structure size (in bytes)
    cbSize: number;

    // Number of images (also known as frames) stored in the file
    nFrames: number;

    // Number of frames to be displayed before the animation repeats
    nSteps: number;

    // Width of frame (in pixels)
    iWidth: number;

    // Height of frame (in pixels)
    iHeight: number;

    // Number of bits per pixel
    iBitCount: number;

    // Number of color planes
    nPlanes: number;

    // Default frame display rate (measured in 1/60th-of-a-second units)
    iDispRate: number;

    // ANI attribute bit flags
    bfAttributes: number;
};

export type ParsedAni = {
    rate: number[];
    seq: number[] | null;
    images: Uint8Array[];
    metadata: AniMetadata;
    artist?: string;
    title?: string;
    frames: string[];
    rateSum: number;
};

export class ANIParser {
    private data: Uint8Array;
    private view: DataView;
    private offset: number = 0;

    constructor(arrayBuffer: ArrayBuffer) {
        this.data = new Uint8Array(arrayBuffer);
        this.view = new DataView(arrayBuffer);
    }

    private readUint32(): number {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    private readString(length: number): string {
        const bytes = this.data.subarray(this.offset, this.offset + length);
        this.offset += length;
        return new TextDecoder("utf-8").decode(bytes).replace(/\0/g, "");
    }

    public parse(): ParsedAni {
        if (this.readString(4) !== "RIFF") {
            throw new Error("Invalid ANI file: Missing RIFF header");
        }

        this.readUint32(); // Размер файла

        if (this.readString(4) !== "ACON") {
            throw new Error("Invalid ANI file: Not an ACON format");
        }

        let metadata = {} as AniMetadata;
        const images: Uint8Array[] = [];
        const rate: number[] = [];
        const seq: number[] = [];
        const frames: string[] = [];
        let rateSum = 0;

        while (this.offset < this.data.length) {
            const chunkId = this.readString(4);
            const chunkSize = this.readUint32();
            const chunkEnd = this.offset + chunkSize;

            if (chunkId === "anih") {
                metadata = {
                    cbSize: this.readUint32(),
                    nFrames: this.readUint32(),
                    nSteps: this.readUint32(),
                    iWidth: this.readUint32(),
                    iHeight: this.readUint32(),
                    iBitCount: this.readUint32(),
                    nPlanes: this.readUint32(),
                    iDispRate: this.readUint32(),
                    bfAttributes: this.readUint32(),
                };
            } else if (chunkId === "rate") {
                while (this.offset < chunkEnd) {
                    const frameTick = this.readUint32();
                    rateSum += frameTick;
                    rate.push(frameTick);
                }
            } else if (chunkId === "seq ") {
                while (this.offset < chunkEnd) {
                    seq.push(this.readUint32());
                }
            } else if (chunkId === "LIST") {
                const format = this.readString(4);
                if (format === "fram") {
                    while (this.offset < chunkEnd) {
                        if (this.readString(4) === "icon") {
                            const iconSize = this.readUint32();
                            const image = this.data.slice(this.offset, this.offset + iconSize);
                            images.push(image);
                            frames.push(URL.createObjectURL(new Blob([image], { type: "image/x-icon" })));
                            this.offset += iconSize;
                        }
                    }
                }
            } else {
                this.offset = chunkEnd;
            }
        }

        return { metadata, images, rate, seq, frames, rateSum };
    }
}
export type AniCursorStep = {
    readonly frameIndex: number;
    readonly percent: number;
};

export const buildAniCursorSteps = (ani: ParsedAni): { steps: AniCursorStep[]; rateSum: number } => {
    const nSteps = ani.metadata.nSteps || ani.frames.length;
    const defaultTick = ani.metadata.iDispRate || 10;
    const rates = ani.rate.length ? ani.rate : Array.from({ length: nSteps }, () => defaultTick);
    const sequence = ani.seq && ani.seq.length ? ani.seq : Array.from({ length: nSteps }, (_, index) => index);
    const rateSum = rates.reduce((sum, tick) => sum + tick, 0);

    let cumulative = 0;
    const steps: AniCursorStep[] = [];
    for (let step = 0; step < nSteps; step += 1) {
        const frameIndex = sequence[step] ?? step;
        if (frameIndex >= ani.frames.length) continue;
        steps.push({ frameIndex, percent: (cumulative / rateSum) * 100 });
        cumulative += rates[step] ?? defaultTick;
    }
    return { steps, rateSum };
};
