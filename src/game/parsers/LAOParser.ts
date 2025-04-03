export interface LAOData {
    height: number;
    duration: number;
}

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

        if (buffer.byteLength%recordSize !== 0 || buffer.byteLength > 500) {
            return;
        }
        const view = new DataView(buffer);

        for (let i = 0; i < buffer.byteLength; i += recordSize) {
            const height = view.getUint16(i, true);
            const duration = view.getUint16(i + 4, true);
            this.data.push({ height, duration })
        }
    }

    getData() {
        return this.data;
    }
}
