import { SEFData } from './parsers/SEFParser.ts';
import { MapScroller, scrollerDefaultPosition, ScrollerPosition } from './MapScroller';
import { LevelData, LevelStatic } from './Level.ts';

const getContext2D = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context is not available');
    return context;
};

const getCanvas2D = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

interface MaskedCanvas {
    x: number;
    y: number;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
}

export class MapRenderer {
    private readonly mapCanvas: HTMLCanvasElement;
    private readonly mapContext: CanvasRenderingContext2D;
    private levelData: LevelData;
    private scroller: MapScroller;
    private offset: ScrollerPosition = scrollerDefaultPosition;

    private readonly helperCanvas: HTMLCanvasElement;
    private helperCtx: CanvasRenderingContext2D;
    private showChunkBorders = true;

    private maskedCanvases: MaskedCanvas[];

    private readonly maskedOpacity = 0.5;

    private readonly tileWidth: number = 12;
    private readonly tileHeight: number = 9;

    constructor(canvas: HTMLCanvasElement, levelData: LevelData) {
        this.mapCanvas = canvas;
        this.mapContext = getContext2D(canvas);

        this.levelData = levelData;
        console.log('Загруженные данные уровня:\n', levelData);
        console.log(levelData.lvlData.mapHDR.chunks);

        const { lvlData, image } = levelData;

        this.scroller = new MapScroller(this.mapCanvas, lvlData.mapSize);

        // создаём кэш под информацию о чанках/тайлах
        this.helperCanvas = getCanvas2D(image.width, image.height);
        this.helperCtx = getContext2D(this.helperCanvas);
        this.renderMapHDRCache();
        if (this.showChunkBorders) {
            this.renderChunkBordersCache();
        }

        // создаём кэш маскированных изображений
        this.maskedCanvases = [];
        this.renderMaskedCache();
    }

    // --- Кэши ---

    private renderMapHDRCache() {
        const { mapHDR } = this.levelData.lvlData;
        if (mapHDR.chunks.length === 0) return;

        const chunkSize = 2;
        const tileSizeX = this.tileWidth;
        const tileSizeY = this.tileHeight;

        const chunkPixelW = chunkSize * tileSizeX;
        const chunkPixelH = chunkSize * tileSizeY;

        this.helperCtx.clearRect(0, 0, this.helperCanvas.width, this.helperCanvas.height);

        // (по желанию) отключим сглаживание для пиксельной чёткости
        this.helperCtx.imageSmoothingEnabled = false;

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

                // твоя текущая раскраска (оставляю как есть)
                // const color = `rgba(${tile.param1a === 2 && tileIndex === 0 ? 255 : 0}, ${/*tile.param1_1 === 5 ? 255 : */ 0}, ${/*tile.param1_1 === 4 ? 255 : */ 0}, 0.25)`;
                this.helperCtx.fillStyle = `rgba(${tile.maskNumber2 === 0 ? 255 : 0}, ${/*tile.param1_1 === 5 ? 255 : */ 0}, ${/*tile.param1_1 === 4 ? 255 : */ 0}, 0.25)`;
                this.helperCtx.fillRect(objX, objY, tileSizeX, tileSizeY);
            }
        }
    }

    private renderChunkBordersCache() {
        const { mapHDR } = this.levelData.lvlData;

        const chunkSize = 2;
        const chunkPixelW = chunkSize * this.tileWidth;
        const chunkPixelH = chunkSize * this.tileHeight;

        const chunksX = mapHDR.width; // количество чанков по горизонтали
        const chunksY = mapHDR.height; // количество чанков по вертикали

        const totalW = chunksX * chunkPixelW;
        const totalH = chunksY * chunkPixelH;

        this.helperCtx.save();
        this.helperCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        this.helperCtx.setLineDash([5, 5]);
        this.helperCtx.lineWidth = 1;

        this.helperCtx.beginPath();

        // Вертикальные линии сетки (включая левую и правую границы)
        for (let cx = 0; cx <= chunksX; cx++) {
            const x = cx * chunkPixelW;
            this.helperCtx.moveTo(x, 0);
            this.helperCtx.lineTo(x, totalH);
        }

        // Горизонтальные линии сетки (включая верх и низ)
        for (let cy = 0; cy <= chunksY; cy++) {
            const y = cy * chunkPixelH;
            this.helperCtx.moveTo(0, y);
            this.helperCtx.lineTo(totalW, y);
        }

        this.helperCtx.stroke();
        this.helperCtx.restore();
    }

    private renderMaskedCache() {
        for (const mask of this.levelData.levelMasks) {
            if (!mask.image) continue;

            const width = mask.image.width;
            const height = mask.image.height;

            const maskedCanvas = getCanvas2D(width, height);
            const maskedContext = getContext2D(maskedCanvas);

            // 1) кладём подложку (кусок карты под маской)
            maskedContext.drawImage(
                this.levelData.image,
                mask.x,
                mask.y,
                width,
                height, // источник — абсолютные координаты на большой карте
                0,
                0,
                width,
                height // цель — локальные координаты временного канваса
            );

            // 2) вырезаем непрозрачные пиксели маски (оставляем только те места, где маска прозрачна)
            maskedContext.globalCompositeOperation = 'destination-out';
            maskedContext.drawImage(mask.image, 0, 0);

            // домножаем альфу, чтобы маскированные изображения были полупрозрачным
            const image = maskedContext.getImageData(0, 0, width, height);
            for (let i = 3; i < image.data.length; i += 4) {
                image.data[i] = (image.data[i] * this.maskedOpacity) | 0;
            }
            maskedContext.putImageData(image, 0, 0);

            // 3) обратно в обычный режим
            maskedContext.globalCompositeOperation = 'source-over';

            this.maskedCanvases.push({ x: mask.x, y: mask.y, width, height, canvas: maskedCanvas });
        }
    }

    // --- Вспомогательные функции рендера ---

    private drawStatic(levelStatic: LevelStatic) {
        const { image, position } = levelStatic;

        if (!image) return;

        const objX = position.x - this.offset.x;
        const objY = position.y - this.offset.y;

        this.mapContext.drawImage(image, objX, objY);
    }

    private drawPoint(x: number, y: number, size: number, color: string, label?: string) {
        this.mapContext.fillStyle = color;
        this.mapContext.beginPath();
        this.mapContext.arc(x, y, size, 0, Math.PI * 2);
        this.mapContext.fill();

        if (label) {
            this.mapContext.font = '12px Arial';
            this.mapContext.strokeStyle = 'black';
            this.mapContext.textAlign = 'center';
            this.mapContext.fillStyle = 'white';
            this.mapContext.lineWidth = 3;
            this.mapContext.strokeText(label, x, y + 15);
            this.mapContext.fillText(label, x, y + 15);
        }
    }

    private drawLayer(layer: CanvasImageSource) {
        this.mapContext.drawImage(
            layer,
            this.offset.x,
            this.offset.y,
            this.mapCanvas.width,
            this.mapCanvas.height,
            0,
            0,
            this.mapCanvas.width,
            this.mapCanvas.height
        );
    }

    // --- Основной рендер ---

    public draw() {
        const { sefData, image } = this.levelData;

        this.mapContext.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);

        this.offset = this.scroller.getOffset();

        // Отрисовка фона
        this.drawLayer(image);

        // Отрисовка анимаций
        this.drawAnimations();

        // Отрисовка тайлов
        this.drawLayer(this.helperCanvas);

        // Отрисовка всех маскированных фрагментов
        this.drawMaskedCache();

        // Отрисовка дверей
        this.drawDoors();

        // Отрисовка входных точек
        this.drawEntrancePoints(sefData.entrancePoints, 'blue');

        // Отрисовка групп клеток (маршруты?)
        this.drawCellGroups(sefData.cellGroups, 'green');

        // Отрисовка NPC
        this.drawPersons(sefData.persons, 'red');
    }

    private drawAnimations() {
        this.levelData.levelAnimations.forEach((levelAnimation) => {
            const { animation, position } = levelAnimation;

            if (!animation) return;

            const objX = position.x - this.offset.x;
            const objY = position.y - this.offset.y;

            /* предотвращение отрисовок за пределами экрана */
            if (this.mapCanvas.width < objX || this.mapCanvas.height < objY) return;
            if (objX + animation.frameWidth < 0 || objY + animation.frameHeight < 0) return;

            animation.update();
            animation.draw(this.mapContext, objX, objY);
        });
    }

    private drawEntrancePoints(points: SEFData['entrancePoints'], color: string) {
        for (let key in points) {
            const point = points[key];

            const objX = point.position.x * this.tileWidth - this.offset.x;
            const objY = point.position.y * this.tileHeight - this.offset.y;

            this.drawPoint(objX, objY, 4, color, key);
        }
    }

    private drawDoors() {
        this.levelData.levelDoors.forEach((door) => {
            const { isOpened, levelStatic } = door;

            if (!isOpened) {
                this.drawStatic(levelStatic);
            }
        });
    }

    private drawMaskedCache() {
        for (const item of this.maskedCanvases) {
            const dx = item.x - this.offset.x;
            const dy = item.y - this.offset.y;

            // отсечение за экраном (чтоб вообще не рисовать вне кадра)
            if (dx > this.mapCanvas.width || dy > this.mapCanvas.height) continue;
            if (dx + item.w < 0 || dy + item.h < 0) continue;

            this.mapContext.drawImage(item.canvas, dx, dy);
        }
    }

    private drawCellGroups(cellGroups: SEFData['cellGroups'], color: string) {
        Object.entries(cellGroups).forEach(([groupName, positions]) => {
            if (positions.length === 0) return;

            this.mapContext.strokeStyle = color;
            this.mapContext.lineWidth = 2;
            this.mapContext.beginPath();

            positions.forEach((pos, index) => {
                const objX = pos.x * this.tileWidth - this.offset.x;
                const objY = pos.y * this.tileHeight - this.offset.y;

                if (index === 0) {
                    this.mapContext.moveTo(objX, objY);
                    this.drawPoint(objX, objY, 3, color, groupName);
                } else {
                    this.mapContext.lineTo(objX, objY);
                }
            });

            if (positions.length > 2) {
                const first = positions[0];
                this.mapContext.lineTo(
                    first.x * this.tileWidth - this.offset.x,
                    first.y * this.tileHeight - this.offset.y
                );
            }

            this.mapContext.stroke();
        });
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
}
