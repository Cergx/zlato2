import { loadCSX } from "./Assets.ts";
import {
    AnimationDescription,
    Door,
    LVLData,
    LVLParser,
    MaskDescription,
    StaticDescription,
    TriggerDescription
} from "./parsers/LVLParser.ts";
import { Paths } from "../constants/paths.ts";
import { SDBData, SDBParser } from "./parsers/SDBParser.ts";
import { SEFData, SEFDoor, SEFParser, type TilePosition } from "./parsers/SEFParser.ts";
import { MapRenderer } from "./MapRenderer.ts";
import { LAOData, LAOParser } from "./parsers/LAOParser.ts";
import { GameMode } from "../constants/levels.ts";
import { Animation } from "./Animation.ts";
import { LevelPerson, loadHeroSprites, loadLevelPerson, loadLevelPersons } from "./PersonSprite.ts";
import { cellToWorld, WORLD_CELL_HEIGHT, WORLD_CELL_WIDTH, worldToCell } from "./WorldCoordinates.ts";
import { AudioWeatherRuntime, type WeatherSnapshot } from "./AudioWeatherRuntime.ts";
import { GameStateRuntime, type AreaTransitionRequest, type DynamicPersonDefinition, type GameRuntimeSnapshot } from "./GameStateRuntime.ts";
import type { CursorType } from "../enums/CursorTypes.ts";
import { chooseSoundWave, type SoundShaderDefinition } from "./SoundShaderRuntime.ts";

import type { GameSettings } from "./GameSettingsRuntime.ts";

const loadOptionalScript = async (path: string): Promise<string | undefined> => {
    const response = await fetch(path);
    if (!response.ok || response.headers.get("content-type")?.includes("text/html")) return undefined;
    return new TextDecoder("windows-1251").decode(await response.arrayBuffer());
};

const buildTriggerCells = (
    description: TriggerDescription,
    image: HTMLCanvasElement,
    mapSize: LVLData["mapSize"],
): TilePosition[] => {
    const context = image.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error(`Не удалось прочитать маску триггера ${description.name}`);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const maximumCellX = Math.max(0, Math.floor((mapSize.width - 1) / WORLD_CELL_WIDTH));
    const maximumCellY = Math.max(0, Math.floor((mapSize.height - 1) / WORLD_CELL_HEIGHT));
    const firstCellX = Math.max(0, Math.ceil(description.position.x / WORLD_CELL_WIDTH));
    const lastCellX = Math.min(maximumCellX, Math.floor((description.position.x + image.width - 1) / WORLD_CELL_WIDTH));
    const firstCellY = Math.max(0, Math.ceil(description.position.y / WORLD_CELL_HEIGHT));
    const lastCellY = Math.min(maximumCellY, Math.floor((description.position.y + image.height - 1) / WORLD_CELL_HEIGHT));
    const cells: TilePosition[] = [];

    for (let y = firstCellY; y <= lastCellY; y += 1) {
        const pixelY = y * WORLD_CELL_HEIGHT - description.position.y;
        for (let x = firstCellX; x <= lastCellX; x += 1) {
            const pixelX = x * WORLD_CELL_WIDTH - description.position.x;
            if (pixels[(pixelY * image.width + pixelX) * 4 + 3] !== 0) cells.push({ x, y });
        }
    }
    if (cells.length > 0) return cells;

    const fallback = worldToCell(description.position);
    return [{
        x: Math.min(Math.max(fallback.x, 0), maximumCellX),
        y: Math.min(Math.max(fallback.y, 0), maximumCellY),
    }];
};

export interface LevelStatic extends StaticDescription {
    image?: HTMLCanvasElement;
}

export interface LevelAnimation extends AnimationDescription {
    animation?: Animation;
}

export interface LevelMask extends MaskDescription {
    image?: HTMLCanvasElement;
    foreground?: HTMLCanvasElement;
}

export interface LevelTriggerMask extends TriggerDescription {
    image: HTMLCanvasElement;
}

export interface LevelDoor extends Door, SEFDoor {
    levelStatic: LevelStatic;
    nameOpened?: string;
    nameClosed?: string;
}

export interface LevelData {
    gameMode: GameMode;
    levelName: string;
    initScript?: string;
    coreScript?: string;
    image: HTMLImageElement;
    sdbData: SDBData;
    sefData: SEFData;
    lvlData: LVLData;
    laoData: LAOData[];
    levelAnimations: LevelAnimation[];
    levelStatics: LevelStatic[];
    levelDoors: LevelDoor[];
    levelMasks: LevelMask[];
    triggerCells: Record<string, TilePosition[]>;
    triggerMasks: LevelTriggerMask[];
    levelPersons: LevelPerson[];
    player: LevelPerson;
}

export interface LevelOptions {
    onLoadArea: (request: AreaTransitionRequest) => void;
    onGlobalMap?: () => void;
    onDialog?: (arguments_: readonly (number | string | boolean)[]) => void;
    onFinished?: (ending: number) => void;
    onHeroDeath?: () => void;
    onCursorChange?: (cursor: CursorType) => void;
    onTrade?: () => void;
    onContainerOpen?: (owner: string, triggerName: string) => void;
    onStatusText?: (text?: string) => void;
}

export class Level {
    private readonly audioWeather = new AudioWeatherRuntime({
        onPlaybackError: (error, source) => console.warn(`Не удалось воспроизвести ${source}`, error),
    });
    private soundVolume = 0.5;
    private readonly runtime: GameStateRuntime;
    private canvas: HTMLCanvasElement;
    private mapRenderer: MapRenderer | null = null;
    private destroyed = false;
    private levelData: LevelData | null = null;
    private readonly oneShotAudio = new Set<HTMLAudioElement>();

    constructor(canvas: HTMLCanvasElement, private readonly options: LevelOptions) {
        this.canvas = canvas;
        this.runtime = new GameStateRuntime({
            ...options,
            onPersonPresence: (technicalName, present) => this.mapRenderer?.setPersonPresent(technicalName, present),
            onDynamicPerson: (person) => void this.addDynamicPerson(person).catch((error) => console.error(`Не удалось добавить персонажа ${person.name}`, error)),
            onDoorChange: ({ door }) => this.mapRenderer?.setDoorState(door.name, door.opened, door.cells, door.activationCells),
            onTriggerChange: (trigger) => this.mapRenderer?.setTriggerState(trigger),
            onContainerOpen: (owner, targetName) => {
                const trigger = this.levelData?.sefData.triggers.find((candidate) => candidate.name === targetName);
                const person = this.levelData?.levelPersons.find((candidate) => candidate.name.toLowerCase() === targetName.toLowerCase());
                const literaryName = trigger?.literaryName ?? person?.literaryName;
                const title = literaryName === undefined
                    ? person?.literaryLabel ?? targetName
                    : this.levelData?.sdbData[literaryName] ?? person?.literaryLabel ?? targetName;
                this.options.onContainerOpen?.(owner, title);
            },
            onPersonSound: (shader) => this.playPersonSound(shader),
            onCombatAnimation: (technicalName, kind) => this.mapRenderer?.playPersonCombatAnimation(technicalName, kind),
            onMagicEffect: (technicalName, targetName) => this.mapRenderer?.playMagicEffect(technicalName, targetName),
            onWeather: (type) => this.audioWeather.setWeather(type),
        });
    }
    public initializeHeroProfile(parameters: Readonly<Record<string, number>>, experience: number): void {
        this.runtime.initializeHeroProfile(parameters, experience);
    }

    public async loadLevel(gameMode: GameMode, level: string, entranceName?: string) {
        if (this.destroyed) throw new Error("Нельзя загрузить уничтоженный уровень");
        console.log(`Загрузка уровня ${level} в режиме ${gameMode}`);

        const sdbBinaryData = await fetch(Paths.LEVEL_SDB(level, gameMode)).then(res => res.arrayBuffer());
        const sdbData = new SDBParser(sdbBinaryData).getData();

        const sefText = await fetch(Paths.LEVEL_SEF(level, gameMode)).then(res => res.text());
        const sefData = new SEFParser(sefText).getData();
        const levelPersonsPromise = loadLevelPersons(sefData.persons);
        const playerSpritesPromise = loadHeroSprites(Object.values(this.runtime.getEquippedItems()));
        const initScriptPromise = loadOptionalScript(Paths.LEVEL_SCRIPT_INITIALIZATION(level, gameMode));
        const coreScriptPromise = loadOptionalScript(Paths.LEVEL_SCRIPT_CORE(level, gameMode));

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

            const image = description.number >= 0
                ? await loadCSX(Paths.LEVEL_MASK(sefData.pack, description.number), { magentaTransparent: false })
                : undefined;

            levelMasks.push({ image, ...description });
        }

        const triggerImages = new Map(await Promise.all(
            [...new Set(lvlData.triggerDescription.map((description) => description.number))]
                .map(async (number) => [number, await loadCSX(Paths.LEVEL_TRIGGER(sefData.pack, number))] as const),
        ));
        const triggerMasks: LevelTriggerMask[] = lvlData.triggerDescription.map((description) => {
            const image = triggerImages.get(description.number);
            if (!image) throw new Error(`Не найдена маска триггера ${description.name}`);
            return { ...description, image };
        });
        const triggerCells = Object.fromEntries(triggerMasks.map((trigger) => [
            trigger.name,
            buildTriggerCells(trigger, trigger.image, lvlData.mapSize),
        ]));

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
        const mapImagePromise = new Promise<void>((resolve, reject) => {
            mapImage.onload = () => resolve();
            mapImage.onerror = () => reject(new Error(`Не удалось загрузить карту ${sefData.pack}`));
            mapImage.src = Paths.LEVEL_IMAGE(sefData.pack);
        });
        const [levelPersons, playerSprites, , initScript, coreScript] = await Promise.all([
            levelPersonsPromise,
            playerSpritesPromise,
            mapImagePromise,
            initScriptPromise,
            coreScriptPromise,
        ]);
        if (this.destroyed) return;

        for (const mask of levelMasks) {
            if (!mask.image) continue;
            const foreground = document.createElement("canvas");
            foreground.width = mask.image.width;
            foreground.height = mask.image.height;
            const foregroundContext = foreground.getContext("2d");
            if (!foregroundContext) continue;

            foregroundContext.drawImage(mapImage, -mask.x, -mask.y);
            foregroundContext.globalCompositeOperation = "destination-out";
            foregroundContext.drawImage(mask.image, 0, 0);
            foregroundContext.globalCompositeOperation = "source-over";
            mask.foreground = foreground;
            mask.image.width = 0;
            mask.image.height = 0;
            mask.image = undefined;
        }

        const playerEntrance = entranceName
            ? sefData.entrancePoints.find((entrance) => entrance.name.toLowerCase() === entranceName.toLowerCase())
            : sefData.entrancePoints.reduce((closest, entrance) => {
                if (!closest) return entrance;
                const position = cellToWorld(entrance.position);
                const closestPosition = cellToWorld(closest.position);
                const centerX = this.canvas.width / 2;
                const centerY = this.canvas.height / 2;
                return Math.hypot(position.x - centerX, position.y - centerY)
                    < Math.hypot(closestPosition.x - centerX, closestPosition.y - centerY)
                    ? entrance
                    : closest;
            }, undefined as SEFData["entrancePoints"][number] | undefined);
        if (entranceName && !playerEntrance) {
            throw new Error(`Уровень ${level} не содержит точку входа ${entranceName}`);
        }
        const playerPosition = playerEntrance?.position ?? { x: 0, y: 0 };
        const player: LevelPerson = {
            name: "hero",
            position: playerPosition,
            worldPosition: cellToWorld(playerPosition),
            direction: playerEntrance?.direction ?? "DOWN",
            sprites: playerSprites,
        };

        this.levelData = {
            gameMode, levelName: level, initScript, coreScript,
            image: mapImage, sdbData, sefData, laoData, lvlData, levelStatics, levelAnimations, levelDoors, levelMasks, triggerCells, triggerMasks, levelPersons, player
        };

        this.mapRenderer?.destroy();
        this.mapRenderer = null;
        await this.runtime.loadLevel(this.levelData);
        this.levelData.levelPersons.push(...await loadLevelPersons([...this.runtime.getDynamicPersons()]));
        this.mapRenderer = new MapRenderer(
            this.canvas,
            this.levelData,
            (tick, simulationTimeMs, playerPosition) => this.runtime.update(tick, simulationTimeMs, playerPosition),
            (person) => {
                void this.runtime.interactDeadPerson(person.name).then((opened) => {
                    if (opened || !person.scriptDialog) return;
                    const literaryName = person.literaryName === undefined ? undefined : this.levelData?.sdbData[person.literaryName];
                    this.options.onDialog?.([person.name, person.scriptDialog, literaryName ?? person.literaryLabel ?? person.name]);
                }).catch((error) => console.error(`Не удалось открыть инвентарь ${person.name}`, error));
            },

            (person) => {
                this.runtime.attackPerson(person.name);
                this.mapRenderer?.setMagicTargeting(this.runtime.isHeroMagicTargeting());
            },
            (name) => this.runtime.toggleDoor(name),
            (name) => void this.runtime.interactTrigger(name).catch((error) => console.error(`Не удалось взаимодействовать с ${name}`, error)),
            (cursor) => this.options.onCursorChange?.(cursor),
            (kind, name) => {
                if (!name) {
                    this.options.onStatusText?.();
                    return;
                }
                if (kind === "person") {
                    const person = this.levelData?.levelPersons.find((candidate) => candidate.name === name);
                    const text = person?.literaryName === undefined ? person?.literaryLabel : this.levelData?.sdbData[person.literaryName];
                    this.options.onStatusText?.(text ?? name);
                    return;
                }
                if (kind === "door") {
                    const door = this.levelData?.levelDoors.find((candidate) => candidate.sefName === name);
                    this.options.onStatusText?.((door?.isOpened ? door.nameOpened : door?.nameClosed) ?? name);
                    return;
                }
                const trigger = this.levelData?.sefData.triggers.find((candidate) => candidate.name === name);
                const text = trigger?.literaryName === undefined ? undefined : this.levelData?.sdbData[trigger.literaryName];
                this.options.onStatusText?.(text ?? name);
            },
        );
        for (const [technicalName, present] of Object.entries(this.runtime.snapshot().persons)) {
            this.mapRenderer.setPersonPresent(technicalName, present);
        }
        const scenario = this.runtime.getScenarioRuntime();
        for (const door of scenario?.getDoorStates() ?? []) this.mapRenderer.setDoorState(door.name, door.opened, door.cells, door.activationCells);
        for (const trigger of scenario?.getTriggerStates() ?? []) this.mapRenderer.setTriggerState(trigger);
        this.audioWeather.loadLevel(lvlData);
    }

    public async changeLevel(gameMode: GameMode, level: string, entranceName?: string) {
        console.log(`Переключение на уровень ${level}`);
        await this.loadLevel(gameMode, level, entranceName);
    }

    public destroy() {
        this.destroyed = true;
        this.mapRenderer?.destroy();
        this.mapRenderer = null;
        this.levelData = null;
        this.audioWeather.destroy();
        for (const audio of this.oneShotAudio) audio.pause();
        this.oneShotAudio.clear();
    }

    private async addDynamicPerson(person: DynamicPersonDefinition): Promise<void> {
        const renderer = this.mapRenderer;
        const levelData = this.levelData;
        if (!renderer || !levelData) return;
        const loaded = await loadLevelPerson(person);
        if (this.destroyed || this.mapRenderer !== renderer || this.levelData !== levelData) return;
        renderer.addPerson(loaded);
        renderer.setPersonPresent(person.name, this.runtime.snapshot().persons[person.name] !== false);
    }

    private playPersonSound(shader: SoundShaderDefinition): void {
        const audio = new Audio(chooseSoundWave(shader));
        audio.volume = Math.min(1, Math.max(0, shader.volume * this.soundVolume));
        const cleanup = (): void => { this.oneShotAudio.delete(audio); };
        audio.addEventListener("ended", cleanup, { once: true });
        audio.addEventListener("error", cleanup, { once: true });
        this.oneShotAudio.add(audio);
        void audio.play().catch(cleanup);
    }

    public draw() {
        this.mapRenderer?.draw();
        this.audioWeather.update(this.mapRenderer?.getCameraCenterWorldPosition());
    }

    public getRuntimeSnapshot(): GameRuntimeSnapshot {
        return this.runtime.snapshot();
    }

    public getRuntime(): GameStateRuntime {
        return this.runtime;
    }

    public getData(): LevelData | null {
        return this.levelData;
    }

    public getPlayerState() {
        if (!this.mapRenderer) return null;
        return {
            position: this.mapRenderer.getPlayerWorldPosition(),
            direction: this.mapRenderer.getPlayerDirection(),
        };
    }

    public getMinimapState() {
        return this.mapRenderer?.getMinimapState() ?? null;
    }

    public centerCameraAt(position: Readonly<{ x: number; y: number }>): void {
        this.mapRenderer?.centerCameraAt(position);
    }

    public applySettings(settings: Readonly<GameSettings>): void {
        this.soundVolume = Math.max(0, Math.min(1, Number(settings[5]) / 100));
        this.audioWeather.setVolumes({
            master: 1,
            music: Math.max(0, Math.min(1, Number(settings[6]) / 100)),
            ambient: this.soundVolume,
        });
        this.mapRenderer?.applySettings(settings);
    }


    public setPlayerState(position: Readonly<{ x: number; y: number }>, direction: LevelPerson["direction"]): void {
        if (!this.mapRenderer) throw new Error("Нельзя восстановить игрока до загрузки уровня");
        this.mapRenderer.setPlayerState(position, direction);
    }

    public setHeroEquipment(equippedTechnicalNames: readonly string[]): Promise<void> {
        if (!this.mapRenderer) throw new Error("Нельзя сменить экипировку до загрузки уровня");
        return this.mapRenderer.setHeroEquipment(equippedTechnicalNames);
    }

    public setCombatMode(active: boolean): void {
        this.runtime.setCombatMode(active);
        this.mapRenderer?.setCombatMode(active);
        this.mapRenderer?.setMagicTargeting(false);
    }

    public activateHeroMagicSlot(slot: number): boolean {
        const changed = this.runtime.activateHeroMagicSlot(slot);
        this.mapRenderer?.setMagicTargeting(this.runtime.isHeroMagicTargeting());
        return changed;
    }

    public cancelHeroMagicTargeting(): void {
        this.runtime.cancelHeroMagicTargeting();
        this.mapRenderer?.setMagicTargeting(false);
    }
    public endCombatTurn(): boolean {
        return this.runtime.endCombatTurn();
    }

    public getWeather(): WeatherSnapshot {
        return this.audioWeather.getWeatherSnapshot();
    }
}
