export interface MapSize {
    width: number;
    height: number;
}

export interface PixelPosition {
    x: number;
    y: number;
}

export interface LevelDescription {
    name: string;
    param1: number;
    param2: number;
    number: number;
    position: PixelPosition;
}

export interface StaticDescription extends LevelDescription {}

export interface AnimationDescription extends LevelDescription {}

export interface TriggerDescription extends LevelDescription {}

export interface MaskDescription {
    number: number;
    x: number;
    y: number;
}

export interface Weather {
    type: number;
    intensity: number;
}

export interface CellGroup {
    x: number;
    y: number;
}

export type CellGroups = Record<string, CellGroup[]>;

export interface Door {
    sefName: string;
    openAction: string;
    closeAction: string;
    cellGroup: string;
    param1: string;
    staticName: string;
}

interface ExtraSound {
    path: string;
    param1: number;
    param2: number;
    param3: number;
    param4: number;
    param5: number;
    param6: number;
    param7: number;
    param8: number;
    param9: number;
    param10: number;
    param11: number;
    param12: number;
}

interface EnvironmentSoundHeader {
    param1: number;
    param2: number;
    param3: number;
    param4: number;
}

interface EnvironmentSounds {
    header: EnvironmentSoundHeader;
    levelTheme: string;
    dayAmbience: string;
    nightAmbience: string;
    otherSounds: ExtraSound[];
}

interface MapHDRTile {
    maskNumber: number;
    maskNumber2: number;
    param1: number;
    param2: number;
    surfaceType: number;
}

type MapHDRChunk = MapHDRTile[];

interface MapHDR {
    width: number;
    height: number;
    chunks: MapHDRChunk[];
}

export interface LVLData {
    version: string;
    mapSize: MapSize;
    weather: Weather;
    levelFloors: number;
    staticDescriptions: StaticDescription[];
    animationDescriptions: AnimationDescription[];
    maskDescriptions: MaskDescription[];
    triggerDescription: TriggerDescription[];
    cellGroups: CellGroups;
    doors: Door[];
    environmentSounds: EnvironmentSounds;
    mapHDR: MapHDR;
}

const defaultEnvironmentSounds: EnvironmentSounds = {
    header: { param1: 0, param2: 0, param3: 0, param4: 0 },
    levelTheme: '',
    dayAmbience: '',
    nightAmbience: '',
    otherSounds: []
};

const defaultMapHDR: MapHDR = {
    width: 1,
    height: 1,
    chunks: []
};

const defaultLvlData: LVLData = {
    version: '-1',
    mapSize: { width: 1, height: 1 },
    weather: { type: 0, intensity: 0 },
    levelFloors: 0,
    staticDescriptions: [],
    animationDescriptions: [],
    maskDescriptions: [],
    triggerDescription: [],
    cellGroups: {},
    doors: [],
    environmentSounds: { ...defaultEnvironmentSounds },
    mapHDR: { ...defaultMapHDR }
};

type DataBlocks = Record<string, Uint8Array>;

export class LVLParser {
    private blocks: DataBlocks = {};
    private data: LVLData;

    constructor(private filePath: string) {}

    private async loadFile() {
        const response = await fetch(this.filePath);
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
        return response.arrayBuffer();
    }

    async parse() {
        const buffer = await this.loadFile();
        this.extractBlocks(new Uint8Array(buffer));
        this.data = this.interpretData();
    }

    private extractBlocks(data: Uint8Array) {
        let index = 0;
        while (index < data.length) {
            if (index + 12 > data.length) break;

            const blockId = this.readString(data, index, 8);
            const blockSize = this.readUint32(data, index + 8);
            index += 12;

            if (index + blockSize > data.length) break;

            this.blocks[blockId] = data.slice(index, index + blockSize);
            index += blockSize;
        }
        console.log(this.blocks);
    }

    private interpretData(): LVLData {
        const data: LVLData = { ...defaultLvlData };

        // Перебираем все блоки, которые были извлечены
        for (let blockName in this.blocks) {
            const block = this.blocks[blockName];

            switch (blockName) {
                case 'BLK_LVER':
                    data.version = this.parseVersion(block); // готово
                    break;

                case 'BLK_MPSZ':
                    data.mapSize = this.parseMapSize(block); // готово
                    break;

                case 'BLK_WTHR':
                    data.weather = this.parseWeather(block); // готово
                    break;

                case 'BLK_LFLS':
                    data.levelFloors = this.parseLevelFloors(block); // готово
                    break;

                case 'BLK_CGRP':
                    data.cellGroups = this.parseCellGroups(block); // готово
                    break;

                case 'BLK_DOOR':
                    data.doors = this.parseDoors(block); // готово
                    break;

                case 'BLK_SENV':
                    data.environmentSounds = this.parseEnvironmentSounds(block); // не доделано?
                    break;

                case 'BLK_SDSC':
                    data.staticDescriptions = this.parseStructuredBlock(block); // не доделано?
                    break;

                case 'BLK_ADSC':
                    data.animationDescriptions = this.parseStructuredBlock(block); // не доделано?
                    break;

                case 'BLK_TDSC':
                    data.triggerDescription = this.parseStructuredBlock(block); // не доделано?
                    break;

                case 'BLK_MDSC':
                    data.maskDescriptions = this.parseMaskDescriptions(block); // не доделано?
                    break;

                case 'BLK_MHDR':
                    data.mapHDR = this.parseMapHDR(block); // не доделано
                    break;

                default:
                    // Все остальные блоки обрабатываются как строки
                    (data as any)[blockName] = this.parseBlockAsString(block);
                    break;
            }
        }

        return data;
    }

    private parseBlockAsString(block: Uint8Array) {
        return new TextDecoder('ascii').decode(block);
    }

    private parseEnvironmentSounds(block: Uint8Array) {
        const result: EnvironmentSounds = defaultEnvironmentSounds;

        if (!block || block.length < 16) return result;

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        let offset = 0;

        // 1. Первые 16 байт записываются в header
        result.header.param1 = view.getInt32(offset, true);
        result.header.param2 = view.getFloat32((offset += 4), true);
        result.header.param3 = view.getFloat32((offset += 4), true);
        result.header.param4 = view.getFloat32((offset += 4), true);
        offset += 4;

        if (offset + 4 > block.byteLength) return result;
        const otherSoundsLength = view.getUint32(offset, true);
        offset += 4;

        result.levelTheme = this.readStringWithLength(block, offset);
        offset += 4 + result.levelTheme.length;

        result.dayAmbience = this.readStringWithLength(block, offset);
        offset += 4 + result.dayAmbience.length;

        result.nightAmbience = this.readStringWithLength(block, offset);
        offset += 4 + result.nightAmbience.length;

        result.otherSounds = [];

        for (let i = 0; i < otherSoundsLength; i++) {
            const path = this.readStringWithLength(block, offset);
            offset += 4 + path.length;

            result.otherSounds.push({
                path,
                param1: view.getFloat32(offset, true),
                param2: view.getFloat32((offset += 4), true),
                param3: view.getFloat32((offset += 4), true),
                param4: view.getFloat32((offset += 4), true),
                param5: view.getFloat32((offset += 4), true),
                param6: view.getFloat32((offset += 4), true),
                param7: view.getFloat32((offset += 4), true),
                param8: view.getFloat32((offset += 4), true),
                param9: view.getUint32((offset += 4), true),
                param10: view.getUint32((offset += 4), true),
                param11: view.getUint32((offset += 4), true),
                param12: view.getUint32((offset += 4), true)
            });

            offset += 4;
        }

        return result;
    }

    private parseVersion(block: Uint8Array) {
        if (block.length < 4) return '-1';

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        const minor = view.getUint16(0, true);
        const major = view.getUint16(2, true);
        return `${major}.${minor}`;
    }

    private parseMapSize(block: Uint8Array): MapSize {
        if (block.length < 8) return { width: 1, height: 1 };

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        return { width: view.getUint32(0, true), height: view.getUint32(4, true) };
    }

    private parseWeather(block: Uint8Array): Weather {
        if (block.length < 4) return { type: 0, intensity: 0 };

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        return { type: view.getUint16(0, true), intensity: view.getUint16(2, true) };
    }

    private parseLevelFloors(block: Uint8Array) {
        if (block.length < 4) return 0;

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        return view.getUint32(0, true);
    }

    private parseMaskDescriptions(block: Uint8Array) {
        if (block.length < 4) return [];

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        let offset = 0;

        // Читаем количество элементов
        const count = view.getUint32(offset, true);
        offset += 4;

        const masks: MaskDescription[] = [];

        for (let i = 0; i < count; i++) {
            if (offset + 16 > block.byteLength) break; // Каждая запись занимает 16 байт

            offset += 4;
            const number = view.getUint32(offset, true);
            const x = view.getUint32(offset + 4, true);
            const y = view.getUint32(offset + 8, true);
            offset += 12;

            masks.push({ number, x, y });
        }

        return masks;
    }

    private parseMapHDR(block: Uint8Array): MapHDR {
        const mapHDR = { ...defaultMapHDR };

        if (block.length < 8) return mapHDR;

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        mapHDR.width = view.getUint32(0, true);
        mapHDR.height = view.getUint32(4, true);

        // Читаем данные
        const rawData = block.slice(8);
        const tileSize = 6; // 6 байт на один тайл
        const chunkSize = 4; // 4 тайла в чанке
        const numChunks = Math.floor(rawData.length / (chunkSize * tileSize));

        const flatChunks: MapHDRChunk[] = new Array(numChunks);

        // **Записываем чанки в одну полоску**
        for (let i = 0; i < numChunks; i++) {
            const tiles: MapHDRChunk = [];
            const baseOffset = i * chunkSize * tileSize;

            for (let j = 0; j < chunkSize; j++) {
                const offset = baseOffset + j * tileSize;
                if (offset + tileSize > rawData.length) break;

                const param1Byte = view.getUint8(offset + 2);
                const param2Byte = view.getUint8(offset + 3);

                tiles.push({
                    /* в самом первом тайле вместо maskNumber всегда ширина в чанках, а в surfaceType - высота */
                    /* остальное - нули */

                    maskNumber: view.getUint8(offset),
                    maskNumber1: view.getUint8(offset).toString(2).padStart(8, '0'),
                    // maskNumber
                    // каждое отдельное значение относится к соответствующей маске
                    maskNumber2: view.getUint8(offset + 1),
                    // maskNumber2 всегда принимает значения либо 255, либо 0
                    // как-то связаны с масками, поскольку пересекаются
                    // есть предположение, что эти значения отвечают за перекрытие объектами, выделенных масками
                    surfaceType: view.getUint16(offset + 4, true),
                    // surfaceType - тип поверхности
                    // 0 земля (ground)
                    // 1 трава (grass)
                    // 2 песок (sand)
                    // 3 доски (wood)
                    // 4 камень (stone)
                    // 5 влага (water)
                    // 6 снег (snow)
                    // \sounds\persons\footsteps

                    param1a: param1Byte & 0b11,
                    // соответствует каким-то маскам (бывает либо 1, либо 2)
                    passability: (param1Byte & 0b1100) >> 2,
                    // проходимость?
                    // 0 - проходимый
                    // 1 - непроходимый
                    obstacles: (param1Byte & 0xf0) >> 4,
                    // перпятствия?
                    // 0 - нет препятствий
                    // 8 - препятствие/стена

                    param2_1: param2Byte & 0x0f,
                    // param2_1 - тоже проходимость или z-index
                    // 0 - проходимое
                    // 15 - непроходимое
                    // 1-14 - какие-то крючки?
                    param2_2: (param2Byte & 0xf0) >> 4
                    // param2_2 - проходимость ландшафта или z-index?
                    // 0 - проходимое
                    // 15 - непроходимое
                    // 1-14 - какие-то крючки на границе?
                    // param2_1 и param2_2 явно связаны с картой проходимости
                    // возможно, там не 2 значения по полбайта, а как-то иначе
                });
            }

            flatChunks[i] = tiles;
        }

        mapHDR.chunks = flatChunks;
        return mapHDR;
    }

    private parseCellGroups(block: Uint8Array) {
        if (block.length < 4) return {};

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        let offset = 0;

        // Читаем количество групп
        const numGroups = view.getUint32(offset, true);
        offset += 4;

        const groups: CellGroups = {};

        for (let i = 0; i < numGroups; i++) {
            if (offset + 4 > block.byteLength) break;

            // Читаем имя группы
            const name = this.readStringWithLength(block, offset);
            offset += 4 + name.length;

            if (offset + 4 > block.byteLength) break;

            // Читаем размер группы (количество элементов)
            const groupSize = view.getUint32(offset, true);
            offset += 4;

            const entries: CellGroup[] = [];
            for (let j = 0; j < groupSize; j++) {
                if (offset + 4 > block.byteLength) break;

                const x = view.getUint16(offset, true);
                const y = view.getUint16(offset + 2, true);
                offset += 4;

                entries.push({ x, y });
            }

            groups[name] = entries;
        }

        return groups;
    }

    private parseStructuredBlock(block: Uint8Array) {
        if (block.length < 4) return [];

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        let offset = 0;

        const arrayLength = view.getUint32(offset, true);
        offset += 4;

        const descriptions: LevelDescription[] = [];

        for (let i = 0; i < arrayLength; i++) {
            if (offset + 16 > block.byteLength) break;

            const param1 = view.getUint16(offset, true);
            const param2 = view.getUint16(offset + 2, true);
            const number = view.getUint32(offset + 4, true);

            const position: PixelPosition = {
                x: view.getUint32(offset + 8, true),
                y: view.getUint32(offset + 12, true)
            };

            offset += 16;

            const name = this.readStringWithLength(block, offset);
            offset += 4 + name.length;

            descriptions.push({ param1, param2, number, position, name });
        }

        return descriptions;
    }

    private parseDoors(block: Uint8Array) {
        if (!block || block.length < 4) return [];

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        let offset = 0;

        // Читаем количество дверей
        const numDoors = view.getUint32(offset, true);
        offset += 4;

        const doors: Door[] = [];

        for (let i = 0; i < numDoors; i++) {
            const sefName = this.readStringWithLength(block, offset);
            offset += 4 + sefName.length;

            const openAction = this.readStringWithLength(block, offset);
            offset += 4 + openAction.length;

            const closeAction = this.readStringWithLength(block, offset);
            offset += 4 + closeAction.length;

            const cellGroup = this.readStringWithLength(block, offset);
            offset += 4 + cellGroup.length;

            const param1 = this.readStringWithLength(block, offset);
            offset += 4 + param1.length;

            const staticName = this.readStringWithLength(block, offset);
            offset += 4 + staticName.length;

            doors.push({ sefName, openAction, closeAction, cellGroup, param1, staticName });
        }

        return doors;
    }

    private readUint32(data: Uint8Array, offset: number) {
        return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
    }

    private readStringWithLength(block: Uint8Array, offset: number) {
        if (offset + 4 > block.byteLength) return '';

        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        const length = view.getUint32(offset, true);
        offset += 4;

        if (offset + length > block.byteLength) return '';

        return this.readString(block, offset, length);
    }

    private readString(data: Uint8Array, offset: number, length: number) {
        return new TextDecoder('windows-1251').decode(data.slice(offset, offset + length));
    }

    getData() {
        return this.data;
    }
}
