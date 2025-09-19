import { MapSize } from './parsers/LVLParser.ts';

export interface ScrollerPosition {
    x: number;
    y: number;
}

export const scrollerDefaultPosition: ScrollerPosition = { x: 0, y: 0 };

export class MapScroller {
    private canvas: HTMLCanvasElement;
    private mapSize: MapSize;
    private offset: ScrollerPosition = { ...scrollerDefaultPosition };
    private readonly scrollSpeed: number = 7;
    private readonly edgeThreshold: number = 10;

    private mouseX: number = 0;
    private mouseY: number = 0;
    private isMouseInEdge: boolean = false;
    private scrollInterval: number | null = null;

    constructor(canvas: HTMLCanvasElement, mapSize: MapSize) {
        this.canvas = canvas;
        this.mapSize = mapSize;

        // сразу рассчитаем стартовую позицию
        this.offset = this.getInitialOffset();
        this.setupMouseScrolling();
    }

    /** Если карта меньше экрана, центрируем её */
    private getInitialOffset(): ScrollerPosition {
        const offsetX = this.mapSize.width <= this.canvas.width ? -(this.canvas.width - this.mapSize.width) / 2 : 0;

        const offsetY = this.mapSize.height <= this.canvas.height ? -(this.canvas.height - this.mapSize.height) / 2 : 0;

        return { x: offsetX, y: offsetY };
    }

    private setupMouseScrolling() {
        this.canvas.addEventListener('mousemove', (event) => {
            this.mouseX = event.offsetX;
            this.mouseY = event.offsetY;
            this.checkMousePosition();
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isMouseInEdge = false;
            if (this.scrollInterval) {
                clearInterval(this.scrollInterval);
                this.scrollInterval = null;
            }
        });
    }

    private checkMousePosition() {
        const inLeftEdge = this.mouseX < this.edgeThreshold;
        const inRightEdge = this.mouseX > this.canvas.width - this.edgeThreshold;
        const inTopEdge = this.mouseY < this.edgeThreshold;
        const inBottomEdge = this.mouseY > this.canvas.height - this.edgeThreshold;

        this.isMouseInEdge = inLeftEdge || inRightEdge || inTopEdge || inBottomEdge;

        if (this.isMouseInEdge && !this.scrollInterval) {
            this.startScrolling();
        }
    }

    private startScrolling() {
        this.scrollInterval = window.setInterval(() => {
            // двигаем только если карта больше экрана
            if (this.mapSize.width > this.canvas.width) {
                if (this.mouseX < this.edgeThreshold) {
                    this.offset.x = Math.max(this.offset.x - this.scrollSpeed, 0);
                } else if (this.mouseX > this.canvas.width - this.edgeThreshold) {
                    this.offset.x = Math.min(this.offset.x + this.scrollSpeed, this.mapSize.width - this.canvas.width);
                }
            }

            if (this.mapSize.height > this.canvas.height) {
                if (this.mouseY < this.edgeThreshold) {
                    this.offset.y = Math.max(this.offset.y - this.scrollSpeed, 0);
                } else if (this.mouseY > this.canvas.height - this.edgeThreshold) {
                    this.offset.y = Math.min(
                        this.offset.y + this.scrollSpeed,
                        this.mapSize.height - this.canvas.height
                    );
                }
            }

            if (!this.isMouseInEdge) {
                if (this.scrollInterval) {
                    clearInterval(this.scrollInterval);
                    this.scrollInterval = null;
                }
            }
        }, 16);
    }

    public reset() {
        this.offset = this.getInitialOffset();
    }

    public getOffset() {
        return this.offset;
    }
}
