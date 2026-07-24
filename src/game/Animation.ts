import { loadCSX } from "./Assets";

export class Animation {
    private img: HTMLImageElement | HTMLCanvasElement | undefined;
    private frameCount: number;
    public readonly frameHeight: number;
    public frameWidth: number;
    private currentFrame: number;
    private frameDuration: number;
    private elapsedFrameTime: number;
    private isLoaded: boolean;

    constructor(imgSrc: string, frameHeight: number, frameDuration: number) {
        this.frameHeight = frameHeight;
        this.frameDuration = frameDuration;

        this.img = new Image();
        this.frameCount = 0;
        this.frameWidth = 0;
        this.currentFrame = 0;
        this.elapsedFrameTime = 0;
        this.isLoaded = false;

        if (imgSrc.endsWith(".csx")) {
            this.loadCSX(imgSrc);
        } else {
            this.loadPNG(imgSrc);
        }
    }

    private async loadCSX(path: string) {
        this.img = await loadCSX(path);

        if (!this.img) return;

        this.frameWidth = this.img.width;
        this.frameCount = this.img.height / this.frameHeight;
        this.isLoaded = true;
    }

    private loadPNG(path: string) {
        const image = new Image();
        image.src = path;
        image.onload = () => {
            this.img = image;
            this.frameWidth = image.width;
            this.frameCount = image.height / this.frameHeight;
            this.isLoaded = true;
        };
    }

    update(elapsedMs: number) {
        if (!this.isLoaded || this.frameCount === 0) return;

        const frameDuration = Math.max(1, this.frameDuration);
        this.elapsedFrameTime += elapsedMs;
        while (this.elapsedFrameTime >= frameDuration) {
            this.currentFrame = (this.currentFrame + 1) % this.frameCount;
            this.elapsedFrameTime -= frameDuration;
        }
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number) {
        const image = this.img;
        if (!this.isLoaded || !image || this.frameWidth === 0) return;

        ctx.drawImage(
            image,
            0, this.currentFrame * this.frameHeight, this.frameWidth, this.frameHeight,
            x, y, this.frameWidth, this.frameHeight
        );
    }
}
