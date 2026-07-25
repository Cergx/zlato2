import type { MapSize } from "./parsers/LVLParser.ts";
import type { WorldPosition } from "./WorldCoordinates.ts";

export type ScrollDirection = "left" | "right" | "up" | "down" | "left-up" | "right-up" | "left-down" | "right-down";


export class MapScroller {
    private readonly canvas: HTMLCanvasElement;
    private mapSize: MapSize;
    private readonly offset: WorldPosition = { x: 0, y: 0 };
    private scrollStep = 7;
    private readonly edgeThreshold = 10;
    private mouseX = 0;
    private mouseY = 0;
    private pointerInside = false;

    private readonly handleMouseMove = (event: MouseEvent) => {
        const bounds = this.canvas.getBoundingClientRect();
        this.mouseX = (event.clientX - bounds.left) * this.canvas.width / Math.max(1, bounds.width);
        this.mouseY = (event.clientY - bounds.top) * this.canvas.height / Math.max(1, bounds.height);
        this.pointerInside = true;
    };

    private readonly handleMouseLeave = () => {
        this.pointerInside = false;
    };

    constructor(canvas: HTMLCanvasElement, mapSize: MapSize) {
        this.canvas = canvas;
        this.mapSize = mapSize;
        this.canvas.addEventListener("mousemove", this.handleMouseMove);
        this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
    }

    public update(): ScrollDirection | undefined {
        if (!this.pointerInside) return undefined;
        const direction = this.getEdgeDirection({ x: this.mouseX, y: this.mouseY });
        if (!direction) return undefined;
        if (direction.includes("left")) this.offset.x = Math.max(this.offset.x - this.scrollStep, 0);
        if (direction.includes("right")) this.offset.x = Math.min(this.offset.x + this.scrollStep, Math.max(this.mapSize.width - this.canvas.width, 0));
        if (direction.includes("up")) this.offset.y = Math.max(this.offset.y - this.scrollStep, 0);
        if (direction.includes("down")) this.offset.y = Math.min(this.offset.y + this.scrollStep, Math.max(this.mapSize.height - this.canvas.height, 0));
        return this.getEdgeDirection({ x: this.mouseX, y: this.mouseY });
    }

    public getEdgeDirection(position: Readonly<WorldPosition>): ScrollDirection | undefined {
        const maximumX = Math.max(this.mapSize.width - this.canvas.width, 0);
        const maximumY = Math.max(this.mapSize.height - this.canvas.height, 0);
        const left = position.x <= this.edgeThreshold && this.offset.x > 0;
        const right = position.x >= this.canvas.width - this.edgeThreshold && this.offset.x < maximumX;
        const up = position.y <= this.edgeThreshold && this.offset.y > 0;
        const down = position.y >= this.canvas.height - this.edgeThreshold && this.offset.y < maximumY;
        if (left && up) return "left-up";
        if (right && up) return "right-up";
        if (left && down) return "left-down";
        if (right && down) return "right-down";
        if (left) return "left";
        if (right) return "right";
        if (up) return "up";
        if (down) return "down";
        return undefined;
    }


    public setMapSize(mapSize: MapSize) {
        this.mapSize = mapSize;
        this.reset();
    }

    public setScrollSpeed(value: number): void {
        this.scrollStep = Math.max(1, Math.min(13, 1 + Math.round(value) * 2));
    }

    public reset() {
        this.offset.x = 0;
        this.offset.y = 0;
    }

    public centerOn(position: WorldPosition) {
        this.offset.x = Math.max(0, Math.min(position.x - this.canvas.width / 2, Math.max(this.mapSize.width - this.canvas.width, 0)));
        this.offset.y = Math.max(0, Math.min(position.y - this.canvas.height / 2, Math.max(this.mapSize.height - this.canvas.height, 0)));
    }

    public destroy() {
        this.canvas.removeEventListener("mousemove", this.handleMouseMove);
        this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
    }

    public getOffset(): Readonly<WorldPosition> {
        return this.offset;
    }
}
