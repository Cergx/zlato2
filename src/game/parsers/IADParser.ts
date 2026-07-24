export interface IADAnimation {
    readonly action: number;
    readonly frameCount: number;
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly compositeWidth: number;
    readonly compositeHeight: number;
    readonly duration: number;
}

export class IADParser {
    private readonly animations = new Map<number, IADAnimation>();

    public constructor(data: ArrayBuffer) {
        const view = new DataView(data);
        if (view.byteLength < 36 || view.getUint32(0, true) !== 0x20444149) {
            throw new Error("Invalid IAD header");
        }

        let offset = 4;
        while (offset < view.byteLength) {
            if (offset + 32 > view.byteLength) throw new Error(`Truncated IAD record at ${offset}`);
            const action = view.getUint32(offset, true);
            const recordSize = view.getUint32(offset + 4, true);
            const nextOffset = offset + 4 + recordSize;
            if (recordSize < 28 || nextOffset > view.byteLength) {
                throw new Error(`Invalid IAD record size ${recordSize} at ${offset + 4}`);
            }
            const animation: IADAnimation = {
                action,
                frameCount: view.getUint32(offset + 8, true),
                frameWidth: view.getUint32(offset + 12, true),
                frameHeight: view.getUint32(offset + 16, true),
                compositeWidth: view.getUint32(offset + 20, true),
                compositeHeight: view.getUint32(offset + 24, true),
                duration: view.getUint32(offset + 28, true),
            };
            if (animation.frameCount === 0 || animation.frameWidth === 0 || animation.frameHeight === 0) {
                throw new Error(`Invalid IAD geometry for action 0x${action.toString(16)}`);
            }
            this.animations.set(action, animation);
            offset = nextOffset;
        }
    }

    public getAnimation(action: number): IADAnimation {
        const animation = this.animations.get(action);
        if (!animation) throw new Error(`IAD action 0x${action.toString(16)} is missing`);
        return animation;
    }
}
