import { loadCSX } from './Assets';

export class Animation {
    private img: HTMLImageElement | HTMLCanvasElement;
    private frameCount: number;
    public readonly frameHeight: number;
    public frameWidth: number;
    private currentFrame: number;
    private frameDuration: number;
    private lastUpdateTime: number;
    private isLoaded: boolean;

    constructor(imgSrc: string, frameHeight: number, frameDuration: number) {
        this.frameHeight = frameHeight;
        this.frameDuration = frameDuration;

        this.img = new Image();
        this.frameCount = 0;
        this.frameWidth = 0;
        this.currentFrame = 0;
        this.lastUpdateTime = performance.now();
        this.isLoaded = false;

        if (imgSrc.endsWith('.csx')) {
            this.loadCSX(imgSrc);
        } else {
            this.loadPNG(imgSrc);
        }
    }

    private async loadCSX(path: string) {
        this.img = await loadCSX(path);

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

    update() {
        if (!this.isLoaded) return;

        const now = performance.now();
        if (now - this.lastUpdateTime > this.frameDuration) {
            this.currentFrame = (this.currentFrame + 1) % this.frameCount;
            this.lastUpdateTime = now;
        }
    }

    draw(ctx: CanvasRenderingContext2D, x: number, y: number) {
        if (!this.isLoaded || this.frameWidth === 0) return; // Не рисуем, пока изображение не загружено

        ctx.drawImage(
            this.img,
            0,
            this.currentFrame * this.frameHeight,
            this.frameWidth,
            this.frameHeight, // Исходные координаты
            x,
            y,
            this.frameWidth,
            this.frameHeight // Координаты отрисовки
        );
    }
}
