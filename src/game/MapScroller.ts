import { MapSize } from "./parsers/LVLParser.ts";

export interface ScrollerPosition  {
    x: number;
    y: number;
}

export const scrollerDefaultPosition = { x: 0, y: 0 };

export class MapScroller {
    private canvas: HTMLCanvasElement;
    private mapSize: MapSize;
    private offset: ScrollerPosition = scrollerDefaultPosition;
    private readonly scrollSpeed: number = 7;
    private readonly edgeThreshold: number = 10;

    private mouseX: number = 0;
    private mouseY: number = 0;
    private mouse: ScrollerPosition = scrollerDefaultPosition;
    private isMouseInEdge: boolean = false;
    private scrollInterval: number | null = null;

    constructor(canvas: HTMLCanvasElement, mapSize: MapSize) {
        this.canvas = canvas;
        this.mapSize = mapSize;

        this.setupMouseScrolling();
    }

    private setupMouseScrolling() {
        this.canvas.addEventListener("mousemove", (event) => {
            this.mouseX = event.offsetX;
            this.mouseY = event.offsetY;
            this.checkMousePosition();
        });

        this.canvas.addEventListener("mouseleave", () => {
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
            if (this.mouseX < this.edgeThreshold) {
                this.offset.x = Math.max(this.offset.x - this.scrollSpeed, 0);
            } else if (this.mouseX > this.canvas.width - this.edgeThreshold) {
                this.offset.x = Math.min(this.offset.x + this.scrollSpeed, this.mapSize.width - this.canvas.width);
            }

            if (this.mouseY < this.edgeThreshold) {
                this.offset.y = Math.max(this.offset.y - this.scrollSpeed, 0);
            } else if (this.mouseY > this.canvas.height - this.edgeThreshold) {
                this.offset.y = Math.min(this.offset.y + this.scrollSpeed, this.mapSize.height - this.canvas.height);
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

    }

    public getOffset() {
        return this.offset;
    }
}
