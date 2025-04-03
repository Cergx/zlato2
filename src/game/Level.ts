import { loadCSX } from "./Assets.ts";
import {
    AnimationDescription,
    Door,
    LVLData,
    LVLParser,
    MaskDescription,
    StaticDescription
} from "./parsers/LVLParser.ts";
import { Paths } from "../constants/paths.ts";
import { SDBData, SDBParser } from "./parsers/SDBParser.ts";
import { SEFData, SEFDoor, SEFParser } from "./parsers/SEFParser.ts";
import { MapRenderer } from "./MapRenderer.ts";
import { LAOData, LAOParser } from "./parsers/LAOParser.ts";
import { GameMode } from "../constants/levels.ts";
import { Animation } from "./Animation.ts";

export interface LevelStatic extends StaticDescription {
    image?: HTMLCanvasElement;
}

export interface LevelAnimation extends AnimationDescription {
    animation?: Animation;
}

export interface LevelMask extends MaskDescription {
    image?: HTMLCanvasElement;
}

export interface LevelDoor extends Door, SEFDoor {
    levelStatic: LevelStatic;
    nameOpened?: string;
    nameClosed?: string;
}

export interface LevelData {
    image: HTMLImageElement;
    sdbData: SDBData;
    sefData: SEFData;
    lvlData: LVLData;
    laoData: LAOData[];
    levelAnimations: LevelAnimation[];
    levelStatics: LevelStatic[];
    levelDoors: LevelDoor[];
    levelMasks: LevelMask[];
}

export class Level {
    private canvas: HTMLCanvasElement;
    private mapRenderer: MapRenderer | null = null;
    private levelData: LevelData | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async loadLevel(gameMode: GameMode, level: string) {
        console.log(`Загрузка уровня ${level} в режиме ${gameMode}`);

        const sdbBinaryData = await fetch(Paths.LEVEL_SDB(level, gameMode)).then(res => res.arrayBuffer());
        const sdbData = new SDBParser(sdbBinaryData).getData();

        const sefText = await fetch(Paths.LEVEL_SEF(level, gameMode)).then(res => res.text());
        const sefData = new SEFParser(sefText).getData();

        const lvlParser = new LVLParser(Paths.LEVEL(sefData.pack));
        await lvlParser.parse();
        const lvlData = lvlParser.getData();

        const levelStatics: LevelStatic[] = [];
        for (let i = 0; i < lvlData.staticDescriptions.length; i++) {
            const description = lvlData.staticDescriptions[i];
            const image = await loadCSX(Paths.LEVEL_STATIC(sefData.pack, description.number));
            levelStatics.push({ image, ...description });
        }

        const levelMasks: LevelMask[] = [];
        for (let i = 0; i < lvlData.maskDescriptions.length; i++) {
            const description = lvlData.maskDescriptions[i];

            const image = await loadCSX(Paths.LEVEL_MASK(sefData.pack, description.number));

            levelMasks.push({ image, ...description });
        }

        const levelDoors: LevelDoor[] = [];
        for (let i = 0; i < lvlData.doors.length; i++) {
            const door= lvlData.doors[i];

            const sefDoor = sefData.doors[door.sefName];
            if (!sefDoor) {
                continue;
            }

            const levelStatic = levelStatics.find((s) => s.name === door.staticName);
            if (!levelStatic) {
                continue;
            }

            levelDoors.push({
                levelStatic,
                nameClosed: sefDoor && sefDoor.literaryNameClosed in sdbData ? sdbData[sefDoor.literaryNameClosed] : undefined,
                nameOpened: sefDoor && sefDoor.literaryNameOpened in sdbData ? sdbData[sefDoor.literaryNameOpened] : undefined,
                ...door,
                ...sefDoor
            });
        }

        const laoParser = new LAOParser(Paths.LEVEL_LAO(sefData.pack));
        await laoParser.parse();
        const laoData = laoParser.getData();

        const levelAnimations: LevelAnimation[] = [];
        for (let i = 0; i < lvlData.animationDescriptions.length; i++) {
            const description = lvlData.animationDescriptions[i];
            const animationInfo = laoData[description.number];
            if (!description || !animationInfo) continue;
            const animation = new Animation(Paths.LEVEL_ANIMATION(sefData.pack, description.number), animationInfo.height, animationInfo.duration);
            levelAnimations.push({ animation, ...description });
        }

        const mapImage = new Image();
        mapImage.src = Paths.LEVEL_IMAGE(sefData.pack);
        await new Promise((resolve) => (mapImage.onload = resolve));

        this.levelData = {
            image: mapImage, sdbData, sefData, laoData, lvlData, levelStatics, levelAnimations, levelDoors, levelMasks
        };

        this.mapRenderer = new MapRenderer(this.canvas, this.levelData);
    }

    public async changeLevel(gameMode: GameMode, level: string) {
        console.log(`Переключение на уровень ${level}`);
        // await this.loadLevel(gameMode, level);

        if (this.mapRenderer && this.levelData) {
            // this.mapRenderer.updateLevelData(this.levelData);
        }
    }

    public draw() {
        this.mapRenderer?.draw();
    }
}
