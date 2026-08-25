import type { PADAnimation } from "./PersonAnimationParser.ts";

export interface HADAnimation extends PADAnimation {
    compositeWidth: number;
    compositeHeight: number;
}

export class HADParser {
    private readonly animations = new Map<number, HADAnimation>();

    constructor(data: ArrayBuffer) {
        const view = new DataView(data);
        if (view.byteLength < 16 || view.getUint32(0, true) !== 0x20444148) {
            throw new Error("Invalid HAD header");
        }

        const recordsEnd = view.getUint32(4, true);
        if (recordsEnd < 12 || recordsEnd > view.byteLength) {
            throw new Error(`Invalid HAD record end ${recordsEnd} for ${view.byteLength}-byte file`);
        }

        let offset = 12;
        while (offset < recordsEnd) {
            if (offset + 52 > recordsEnd) throw new Error(`Truncated HAD record at ${offset}`);
            const action = view.getUint32(offset, true);
            const recordOffset = offset + 4;
            const recordSize = view.getUint32(recordOffset, true);
            if (recordSize < 48 || recordOffset + recordSize > recordsEnd) {
                throw new Error(`Invalid HAD record size ${recordSize} at ${recordOffset}`);
            }

            const animation: HADAnimation = {
                action,
                frameDuration: view.getUint32(recordOffset + 4, true),
                frameCount: view.getUint32(recordOffset + 8, true),
                compositeWidth: view.getUint32(recordOffset + 12, true),
                compositeHeight: view.getUint32(recordOffset + 16, true),
                frameWidth: view.getUint32(recordOffset + 20, true),
                frameHeight: view.getUint32(recordOffset + 24, true),
                anchorX: view.getUint32(recordOffset + 28, true),
                anchorY: view.getUint32(recordOffset + 32, true),
                movementX: view.getFloat32(recordOffset + 36, true),
                movementY: view.getFloat32(recordOffset + 40, true),
            };
            const tableSize = view.getUint32(recordOffset + 44, true);
            const rowCount = Math.floor(tableSize / 8 / animation.frameCount);
            if (rowCount > 0 && recordOffset + 48 + tableSize <= recordsEnd) {
                const hotspots: (readonly [number, number, number, number])[][] = [];
                for (let row = 0; row < rowCount; row++) {
                    const frames: (readonly [number, number, number, number])[] = [];
                    for (let frame = 0; frame < animation.frameCount; frame++) {
                        const base = recordOffset + 48 + (row * animation.frameCount + frame) * 8;
                        frames.push([
                            view.getInt16(base, true),
                            view.getInt16(base + 2, true),
                            view.getInt16(base + 4, true),
                            view.getInt16(base + 6, true),
                        ]);
                    }
                    hotspots.push(frames);
                }
                animation.hotspots = hotspots;
            }
            // Trailing per-record shadow table (after 8 bytes of HAD extra fields
            // when they fit): geom u32[4], tableSize2 u32, rows2 * frameCount quads.
            const recordEnd = Math.min(recordsEnd, view.byteLength);
            let shadowTail = recordOffset + 48 + tableSize;
            if (shadowTail + 28 <= recordEnd) shadowTail += 8;
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

    public getAnimation(action: number): HADAnimation {
        const animation = this.animations.get(action);
        if (!animation) throw new Error(`HAD action 0x${action.toString(16)} is missing`);
        return animation;
    }
}
