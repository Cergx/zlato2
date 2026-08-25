export interface LAOData {
    height: number;
    duration: number;
}

/**
 * Level animation metadata (goldenLand2 FINDINGS, verified on 83/83 sheets):
 * a .lao file is a flat array of u32-le pairs —
 *   u32 frameHeight (cell height of the vertical strip anim_<i>.csx),
 *   u32 delay       (per-frame delay, engine time units).
 */
export class LAOParser {
    private data: LAOData[] = [];

    constructor(private filePath: string) {}

    private async loadFile(): Promise<ArrayBuffer> {
        const response = await fetch(this.filePath);
        return response.arrayBuffer();
    }

    async parse(): Promise<void> {
        const buffer = await this.loadFile();
        const recordSize = 8;

        if (buffer.byteLength === 0 || buffer.byteLength % recordSize !== 0) {
            return;
        }
        const view = new DataView(buffer);

        for (let i = 0; i + recordSize <= buffer.byteLength; i += recordSize) {
            // Keep index alignment with BLK_ADSC resourceIndex even for degenerate rows.
            this.data.push({
                height: view.getUint32(i, true),
                duration: view.getUint32(i + 4, true),
            });
        }
    }

    getData() {
        return this.data;
    }
}
