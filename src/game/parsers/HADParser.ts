import type { PADAnimation } from "./PADParser.ts";

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

            this.animations.set(action, {
                action,
                resourceId: view.getUint32(recordOffset + 4, true),
                frameCount: view.getUint32(recordOffset + 8, true),
                compositeWidth: view.getUint32(recordOffset + 12, true),
                compositeHeight: view.getUint32(recordOffset + 16, true),
                frameWidth: view.getUint32(recordOffset + 20, true),
                frameHeight: view.getUint32(recordOffset + 24, true),
                anchorX: view.getUint32(recordOffset + 28, true),
                anchorY: view.getUint32(recordOffset + 32, true),
                movementX: view.getFloat32(recordOffset + 36, true),
                movementY: view.getFloat32(recordOffset + 40, true),
                duration: view.getUint32(recordOffset + 44, true),
            });
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
