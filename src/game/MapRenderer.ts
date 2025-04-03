import { SEFData } from "./parsers/SEFParser.ts";
import { MapScroller, scrollerDefaultPosition, ScrollerPosition } from "./MapScroller";
import {LevelData, LevelMask, LevelStatic} from "./Level.ts";
import { MaskDescription } from "./parsers/LVLParser.ts";

export class MapRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private levelData: LevelData;
    private scroller: MapScroller | null = null;
    private offset: ScrollerPosition = scrollerDefaultPosition;

    private readonly tileWidth: number = 12;
    private readonly tileHeight: number = 9;

    constructor(canvas: HTMLCanvasElement, levelData: LevelData) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        this.levelData = levelData;
        console.log("Загруженные данные уровня:\n", levelData);

        this.scroller = new MapScroller(this.canvas, levelData.lvlData.mapSize);
    }

    public updateLevelData(levelData: LevelData) {
        console.log("Обновление данных уровня в рендерере");
        this.levelData = levelData;
    }

    public draw() {
        if (!this.ctx || !this.levelData || !this.scroller) return;

        const { sefData, levelAnimations, image } = this.levelData;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.offset = this.scroller.getOffset();

        // Отрисовка фона
        this.ctx.drawImage(image, this.offset.x, this.offset.y, this.canvas.width, this.canvas.height, 0, 0, this.canvas.width, this.canvas.height);

        // Отрисовка анимаций
        this.drawAnimations();

        // Отрисовка входных точек
        // this.drawEntrancePoints(sefData.entrancePoints, "blue");

        // Отрисовка дверей
        this.drawDoors();

        // Отрисовка NPC
        this.drawPersons(sefData.persons, "red");

        // Отрисовка всех масок
        // this.drawMasks(this.levelData.levelMasks);

        // Отрисовка групп клеток
        this.drawCellGroups(sefData.cellGroups, "green");

        // Отрисовка тайлов
        // this.drawMaskHDR();
    }

    private drawMaskHDR() {
        const ctx = this.ctx;
        if (!ctx || !this.levelData) return;

        const { maskHDR } = this.levelData.lvlData;
        if (!maskHDR || maskHDR.chunks.length === 0) return;

        const chunkSize = 2; // 2x2 тайла в одном чанке
        const tileSizeX = this.tileWidth;  // Размер одного тайла по X
        const tileSizeY = this.tileHeight; // Размер одного тайла по Y
        const chunksPerColumn = maskHDR.height;

        for (let chunkIndex = 0; chunkIndex < maskHDR.chunks.length; chunkIndex++) {
            const chunk = maskHDR.chunks[chunkIndex];

            // **Восстанавливаем координаты с учётом отрисовки по колонкам**
            const correctX = Math.floor(chunkIndex / chunksPerColumn) * chunkSize * tileSizeX - this.offset.x;
            const correctY = (chunkIndex % chunksPerColumn) * chunkSize * tileSizeY - this.offset.y;

            for (let tileIndex = 0; tileIndex < chunk.length; tileIndex++) {
                const tile = chunk[tileIndex];

                const objX = correctX + Math.floor(tileIndex / chunkSize) * tileSizeX;
                const objY = correctY + (tileIndex % chunkSize) * tileSizeY;

                // Выбираем цвет: зелёный если param2 < 2000, иначе красный
                const color = tile.param2 < 2000 ? "rgba(0, 255, 0, 0.25)" : "rgba(255, 0, 0, 0.25)";

                ctx.fillStyle = color;
                ctx.fillRect(objX, objY, tileSizeX, tileSizeY);
            }
        }
    }

    // **Метод для рисования границ чанка**
    private drawChunkBorder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
        ctx.strokeStyle = "blue";
        ctx.setLineDash([5, 5]); // Штрихпунктирная линия
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.stroke();

        ctx.setLineDash([]); // Сбрасываем стиль линии
    }

    private drawAnimations() {
        const ctx = this.ctx;
        if (!ctx) return;

        this.levelData.levelAnimations.forEach((levelAnimation, index) => {
            const { animation, position } = levelAnimation;

            if (!animation) return;

            const objX = position.x - this.offset.x;
            const objY = position.y - this.offset.y;

            /* предотвращение отрисовок за пределами экрана */
            if (this.canvas.width < objX || this.canvas.height < objY) return;
            if ((objX + animation.frameWidth) < 0 || (objY + animation.frameHeight) < 0) return;

            animation.update();
            animation.draw(ctx, objX, objY);
        });
    }

    private drawDoors() {
        this.levelData.levelDoors.forEach((door) => {
            const { isOpened, levelStatic } = door;

            if (!isOpened) {
                this.drawStatic(levelStatic);
            }
        });
    }

    private drawStatic(levelStatic: LevelStatic) {
        if (!this.ctx) return;

        const { image, position } = levelStatic;

        if (!image) return;

        const objX = position.x - this.offset.x;
        const objY = position.y - this.offset.y;

        this.ctx.drawImage(image, objX, objY);
    }

    private drawPersons(persons: SEFData["persons"], color: string) {
        for (let key in persons) {
            const person = persons[key];

            const name = person.literaryName ? this.levelData.sdbData[person.literaryName] : key;
            const objX = person.position.x * this.tileWidth - this.offset.x;
            const objY = person.position.y * this.tileHeight - this.offset.y;

            this.drawPoint(objX, objY, 5, color, name);
        }
    }

    private drawEntrancePoints(points: SEFData["entrancePoints"], color: string) {
        for (let key in points) {
            const point = points[key];

            const objX = point.position.x * this.tileWidth - this.offset.x;
            const objY = point.position.y * this.tileHeight - this.offset.y;

            this.drawPoint(objX, objY, 4, color, key);
        }
    }

    private drawCellGroups(cellGroups: SEFData["cellGroups"], color: string) {
        if (!this.ctx) return;

        Object.entries(cellGroups).forEach(([groupName, positions]) => {
            if (positions.length === 0) return;

            this.ctx!.strokeStyle = color;
            this.ctx!.lineWidth = 2;
            this.ctx!.beginPath();

            positions.forEach((pos, index) => {
                const objX = pos.x * this.tileWidth - this.offset.x;
                const objY = pos.y * this.tileHeight - this.offset.y;

                if (index === 0) {
                    this.ctx!.moveTo(objX, objY);
                    this.drawPoint(objX, objY, 3, color, groupName);
                } else {
                    this.ctx!.lineTo(objX, objY);
                }
            });

            if (positions.length > 2) {
                const first = positions[0];
                this.ctx!.lineTo(first.x * this.tileWidth - this.offset.x, first.y * this.tileHeight - this.offset.y);
            }

            this.ctx!.stroke();
        });
    }

    private drawMasks(masks: LevelMask[]) {
        const ctx = this.ctx;
        if (!ctx) return;

        masks.forEach((mask, index) => {
            const { x, y, image, number } = mask;

            const objX = x - this.offset.x;
            const objY = y - this.offset.y;

            if (!image) return;

            ctx.drawImage(image, objX, objY);

            this.drawPoint(objX, objY, 0, 'red', `${number}`);
        });
    }

    private drawPoint(x: number, y: number, size: number, color: string, label?: string) {
        if (!this.ctx) return;

        this.ctx!.fillStyle = color;
        this.ctx!.beginPath();
        this.ctx!.arc(x, y, size, 0, Math.PI * 2);
        this.ctx!.fill();

        if (label) {
            this.ctx!.font = "12px Arial";
            this.ctx!.strokeStyle = "black";
            this.ctx!.textAlign = "center";
            this.ctx!.fillStyle = "white";
            this.ctx!.lineWidth = 3;
            this.ctx!.strokeText(label, x, y + 15);
            this.ctx!.fillText(label, x, y + 15);
        }
    }
}
