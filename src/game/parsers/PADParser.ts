export interface PADAnimation {
    action: number;
    resourceId: number;
    frameCount: number;
    frameWidth: number;
    frameHeight: number;
    anchorX: number;
    anchorY: number;
    movementX: number;
    movementY: number;
    duration: number;
}

export class PADParser {
    private readonly animations = new Map<number, PADAnimation>();

    constructor(data: ArrayBuffer) {
        const view = new DataView(data);
        if (view.byteLength < 16 || view.getUint32(0, true) !== 0x20444150) {
            throw new Error("Invalid PAD header");
        }

        const recordsEnd = view.getUint32(4, true);
        if (recordsEnd < 12 || recordsEnd > view.byteLength) {
            throw new Error(`Invalid PAD record end ${recordsEnd} for ${view.byteLength}-byte file`);
        }

        let offset = 12;
        while (offset < recordsEnd) {
            if (offset + 44 > recordsEnd) throw new Error(`Truncated PAD record at ${offset}`);

            const action = view.getUint32(offset, true);
            const recordOffset = offset + 4;
            const recordSize = view.getUint32(recordOffset, true);
            if (recordSize < 40 || recordOffset + recordSize > recordsEnd) {
                const nextRecordOffset = offset + 76;
                if (nextRecordOffset + 44 <= recordsEnd) {
                    const nextRecordSize = view.getUint32(nextRecordOffset + 4, true);
                    if (nextRecordSize >= 40 && nextRecordOffset + 4 + nextRecordSize <= recordsEnd) {
                        offset = nextRecordOffset;
                        continue;
                    }
                }
                throw new Error(`Invalid PAD record size ${recordSize} at ${recordOffset}`);
            }

            this.animations.set(action, {
                action,
                resourceId: view.getUint32(recordOffset + 4, true),
                frameCount: view.getUint32(recordOffset + 8, true),
                frameWidth: view.getUint32(recordOffset + 12, true),
                frameHeight: view.getUint32(recordOffset + 16, true),
                anchorX: view.getUint32(recordOffset + 20, true),
                anchorY: view.getUint32(recordOffset + 24, true),
                movementX: view.getFloat32(recordOffset + 28, true),
                movementY: view.getFloat32(recordOffset + 32, true),
                duration: view.getUint32(recordOffset + 36, true),
            });

            offset = recordOffset + recordSize;
        }
    }

    public hasAnimation(action: number): boolean {
        return this.animations.has(action);
    }

    public getAnimation(action: number): PADAnimation {
        const animation = this.animations.get(action);
        if (!animation) throw new Error(`PAD action 0x${action.toString(16)} is missing`);
        return animation;
    }
}
