export interface PADAnimation {
    readonly action: number;
    readonly frameDuration: number;
    readonly frameCount: number;
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly anchorX: number;
    readonly anchorY: number;
    readonly movementX: number;
    readonly movementY: number;
    /** Quad entries are (x, y, WIDTH, HEIGHT) crops, not corner pairs (verified vs pixels). */
    hotspots?: readonly (readonly (readonly [number, number, number, number])[])[];
    /** Trailing per-record shadow table: geom[0..1] = shadow cell size, geom[2..3] = shadow anchor in cell. */
    shadowGeom?: readonly [number, number, number, number];
    /** Rows of the trailing shadow quad table (8 = idle-type sheets, 16 = movement). */
    shadowRowCount?: number;
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

            const animation: PADAnimation = {
                action,
                frameDuration: view.getUint32(recordOffset + 4, true),
                frameCount: view.getUint32(recordOffset + 8, true),
                frameWidth: view.getUint32(recordOffset + 12, true),
                frameHeight: view.getUint32(recordOffset + 16, true),
                anchorX: view.getUint32(recordOffset + 20, true),
                anchorY: view.getUint32(recordOffset + 24, true),
                movementX: view.getFloat32(recordOffset + 28, true),
                movementY: view.getFloat32(recordOffset + 32, true),
            };
            const tableSize = view.getUint32(recordOffset + 36, true);
            const rowCount = Math.floor(tableSize / 8 / animation.frameCount);
            if (rowCount > 0 && recordOffset + 40 + tableSize <= recordsEnd) {
                const hotspots: (readonly [number, number, number, number])[][] = [];
                for (let row = 0; row < rowCount; row++) {
                    const frames: (readonly [number, number, number, number])[] = [];
                    for (let frame = 0; frame < animation.frameCount; frame++) {
                        const base = recordOffset + 40 + (row * animation.frameCount + frame) * 8;
                        frames.push([
                            view.getInt16(base, true),
                            view.getInt16(base + 2, true),
                            view.getInt16(base + 4, true),
                            view.getInt16(base + 6, true),
                        ]);
                    }
                }
                animation.hotspots = hotspots;
            }
            // Trailing per-record shadow table: geom u32[4], tableSize2 u32,
            // then shadowRowCount * frameCount quads (x, y, w, h) int16.
            const recordEnd = recordOffset + recordSize;
            const shadowTail = recordOffset + 40 + tableSize;
            if (shadowTail + 20 <= recordEnd) {
                const geom: [number, number, number, number] = [
                    view.getUint32(shadowTail, true),
                    view.getUint32(shadowTail + 4, true),
                    view.getUint32(shadowTail + 8, true),
                    view.getUint32(shadowTail + 12, true),
                ];
                const shadowTableSize = view.getUint32(shadowTail + 16, true);
                const shadowRows = Math.floor(shadowTableSize / 8 / animation.frameCount);
                if (shadowTail + 20 + shadowTableSize <= recordEnd && shadowRows > 0) {
                    animation.shadowGeom = geom;
                    animation.shadowRowCount = shadowRows;
                }
            }
            this.animations.set(action, animation);

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
