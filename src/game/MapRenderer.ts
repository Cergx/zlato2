import { SEFData } from './parsers/SEFParser.ts';
import { MapScroller, scrollerDefaultPosition, ScrollerPosition } from './MapScroller';
import { LevelData, LevelMask, LevelStatic } from './Level.ts';

export class MapRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private levelData: LevelData;
    private scroller: MapScroller | null = null;
    private offset: ScrollerPosition = scrollerDefaultPosition;

    private helperCanvas: HTMLCanvasElement | null = null;
    private helperCtx: CanvasRenderingContext2D | null = null;
    private chunkDirty = true; // флаг «перерисовать кэш маски»
    private showChunkBorders = true; // опционально: рисовать рамки чанков поверх маски

    private readonly tileWidth: number = 12;
    private readonly tileHeight: number = 9;

    constructor(canvas: HTMLCanvasElement, levelData: LevelData) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.levelData = levelData;
        console.log('Загруженные данные уровня:\n', levelData);
        console.log(levelData.lvlData.mapHDR.chunks);

        this.scroller = new MapScroller(this.canvas, levelData.lvlData.mapSize);
        this.buildHelperCanvas(); // создаём кэш под маску
    }

    public updateLevelData(levelData: LevelData) {
        console.log('Обновление данных уровня в рендерере');
        this.levelData = levelData;
        this.buildHelperCanvas(); // перестроим кэш (вдруг размеры карты изменились)
        this.chunkDirty = true; // и пометим на перерисовку
    }

    // Можно вызывать извне, если что-то в маске логически меняется (например, двери):
    public invalidateMask() {
        this.chunkDirty = true;
    }

    private buildHelperCanvas() {
        const { image, lvlData } = this.levelData;
        const chunkSize = 2;
        const mapPixelWidth = (image?.width ?? lvlData.mapHDR.width * chunkSize * this.tileWidth) | 0;
        const mapPixelHeight = (image?.height ?? lvlData.mapHDR.height * chunkSize * this.tileHeight) | 0;

        if (!this.helperCanvas) {
            this.helperCanvas = document.createElement('canvas');
            this.helperCtx = this.helperCanvas.getContext('2d');
        }

        if (!this.helperCanvas || !this.helperCtx) return;

        // если размер поменялся — переинициализируем
        if (this.helperCanvas.width !== mapPixelWidth || this.helperCanvas.height !== mapPixelHeight) {
            this.helperCanvas.width = mapPixelWidth;
            this.helperCanvas.height = mapPixelHeight;
        }

        this.chunkDirty = true; // нужно перерисовать содержимое
    }

    public draw() {
        if (!this.ctx || !this.levelData || !this.scroller) return;

        const { sefData, levelAnimations, image } = this.levelData;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.offset = this.scroller.getOffset();

        // Отрисовка фона
        this.ctx.drawImage(
            image,
            this.offset.x,
            this.offset.y,
            this.canvas.width,
            this.canvas.height,
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );

        // Отрисовка анимаций
        this.drawAnimations();

        // Отрисовка входных точек
        // this.drawEntrancePoints(sefData.entrancePoints, "blue");

        // Отрисовка дверей
        this.drawDoors();

        // Отрисовка всех масок
        this.drawMasks(this.levelData.levelMasks);

        // Отрисовка групп клеток
        // this.drawCellGroups(sefData.cellGroups, "green");

        // Отрисовка тайлов
        this.drawMapHDRCache(this.ctx);

        // Отрисовка NPC
        this.drawPersons(sefData.persons, 'red');
    }

    private drawMapHDRCache(ctx: CanvasRenderingContext2D) {
        if (this.chunkDirty) this.redrawMapHDRCache(); // перерисуем только при изменениях

        if (this.helperCanvas) {
            ctx.drawImage(
                this.helperCanvas,
                this.offset.x,
                this.offset.y,
                this.canvas.width,
                this.canvas.height,
                0,
                0,
                this.canvas.width,
                this.canvas.height
            );
        }
    }

    private redrawMapHDRCache() {
        if (!this.helperCtx || !this.helperCanvas) return;

        const ctx = this.helperCtx;
        const { mapHDR } = this.levelData.lvlData;
        if (!mapHDR || mapHDR.chunks.length === 0) return;

        const chunkSize = 2;
        const tileSizeX = this.tileWidth;
        const tileSizeY = this.tileHeight;

        const chunkPixelW = chunkSize * tileSizeX;
        const chunkPixelH = chunkSize * tileSizeY;

        ctx.clearRect(0, 0, this.helperCanvas.width, this.helperCanvas.height);

        // (по желанию) отключим сглаживание для пиксельной чёткости
        ctx.imageSmoothingEnabled = false;

        for (let chunkIndex = 0; chunkIndex < mapHDR.chunks.length; chunkIndex++) {
            const chunk = mapHDR.chunks[chunkIndex];

            const baseX = Math.floor(chunkIndex / mapHDR.height) * chunkPixelW;
            const baseY = (chunkIndex % mapHDR.height) * chunkPixelH;

            for (let tileIndex = 0; tileIndex < chunk.length; tileIndex++) {
                const tile = chunk[tileIndex];

                // (column-major внутри чанка):
                // const objX = baseX + Math.floor(tileIndex / chunkSize) * tileSizeX;
                // const objY = baseY + (tileIndex % chunkSize) * tileSizeY;

                // (row-major внутри чанка):
                const objX = baseX + (tileIndex % chunkSize) * tileSizeX;
                const objY = baseY + Math.floor(tileIndex / chunkSize) * tileSizeY;

                const valueToWatch =
                    tile.maskNumber !== 0 &&
                    tile.maskNumber !== 255 &&
                    tile.maskNumber2 !== 0 &&
                    tile.maskNumber2 !== 255
                        ? 255
                        : 0;

                // твоя текущая раскраска (оставляю как есть)
                // const color = `rgba(${tile.param1a === 2 && tileIndex === 0 ? 255 : 0}, ${/*tile.param1_1 === 5 ? 255 : */ 0}, ${/*tile.param1_1 === 4 ? 255 : */ 0}, 0.25)`;
                const color = `rgba(${tile.maskNumber2 === 0 ? 255 : 0}, ${/*tile.param1_1 === 5 ? 255 : */ 0}, ${/*tile.param1_1 === 4 ? 255 : */ 0}, 0.25)`;
                ctx.fillStyle = color;
                ctx.fillRect(objX, objY, tileSizeX, tileSizeY);

                // if (tile.param1 > 10 && tile.param1 < 128) {
                //     console.log(`chunkIndex=${chunkIndex}`);
                //     console.log(tile);
                // }
            }

            if (this.showChunkBorders) {
                this.drawChunkBorder(ctx, baseX, baseY, chunkPixelW, chunkPixelH);
            }
        }

        this.chunkDirty = false;
    }

    // **Метод для рисования границ чанка**
    // Рисует только верхний и левый угол чанка
    private drawChunkBorder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1;

        ctx.beginPath();
        // верхняя граница
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y);

        // левая граница
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height);

        ctx.stroke();
        ctx.restore();
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
            if (objX + animation.frameWidth < 0 || objY + animation.frameHeight < 0) return;

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

    private drawPersons(persons: SEFData['persons'], color: string) {
        for (let key in persons) {
            const person = persons[key];

            const name = person.literaryName ? this.levelData.sdbData[person.literaryName] : key;
            const objX = person.position.x * this.tileWidth - this.offset.x;
            const objY = person.position.y * this.tileHeight - this.offset.y;

            this.drawPoint(objX, objY, 5, color, name);
        }
    }

    private drawEntrancePoints(points: SEFData['entrancePoints'], color: string) {
        for (let key in points) {
            const point = points[key];

            const objX = point.position.x * this.tileWidth - this.offset.x;
            const objY = point.position.y * this.tileHeight - this.offset.y;

            this.drawPoint(objX, objY, 4, color, key);
        }
    }

    private drawCellGroups(cellGroups: SEFData['cellGroups'], color: string) {
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
            this.ctx!.font = '12px Arial';
            this.ctx!.strokeStyle = 'black';
            this.ctx!.textAlign = 'center';
            this.ctx!.fillStyle = 'white';
            this.ctx!.lineWidth = 3;
            this.ctx!.strokeText(label, x, y + 15);
            this.ctx!.fillText(label, x, y + 15);
        }
    }
}
