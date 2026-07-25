import { MapScroller } from "./MapScroller";
import type { LevelAnimation, LevelData, LevelDoor, LevelStatic, LevelTriggerMask } from "./Level.ts";
import { loadHeroSprites, type LevelPerson } from "./PersonSprite.ts";
import type { MHDRTile } from "./parsers/LVLParser.ts";
import type { Direction, TilePosition } from "./parsers/SEFParser.ts";
import type { PADAnimation } from "./parsers/PADParser.ts";
import { WorldGrid } from "./WorldGrid.ts";
import {
    cellToWorld,
    worldToCell,
    WORLD_CELL_HEIGHT,
    WORLD_CELL_WIDTH,
    WORLD_CHUNK_HEIGHT,
    WORLD_CHUNK_WIDTH,
    type WorldPosition,
} from "./WorldCoordinates.ts";
import { expandDoorBarrierCells, type ScenarioTriggerState } from "./ScenarioRuntime.ts";
import { CursorType } from "../enums/CursorTypes.ts";
import type { CombatAnimationKind } from "./GameStateRuntime.ts";
import { MagicEffectAnimation } from "./MagicEffectAnimation.ts";

interface PersonRuntime {
    person: LevelPerson;
    position: WorldPosition;
    readonly anchor: WorldPosition;
    direction: Direction;
    route: WorldPosition[];
    targetIndex: number;
    readonly patrol: readonly WorldPosition[];
    patrolIndex: number;
    routeStep: 1 | -1;
    waitUntil: number;
    moving: boolean;
    running: boolean;
    combatAnimation?: { readonly kind: CombatAnimationKind; readonly startedAt: number };
}

interface DoorRuntime {
    readonly name: string;
    readonly levelDoor: LevelDoor;
    cells: readonly TilePosition[];
    activationCells: readonly TilePosition[];
    opened: boolean;
    depth: number;
}

type TriggerRuntime = ScenarioTriggerState;

interface DirectionFrame {
    row: number;
    mirrored: boolean;
}

interface PersonRenderFrame {
    readonly image: HTMLCanvasElement;
    readonly sourceX: number;
    readonly sourceY: number;
    readonly width: number;
    readonly height: number;
    readonly worldX: number;
    readonly worldY: number;
    readonly anchorX: number;
    readonly anchorY: number;
    readonly mirrored: boolean;
}

type PendingInteraction =
    | { readonly kind: "person"; readonly runtime: PersonRuntime; readonly attack: boolean }
    | { readonly kind: "door"; readonly door: DoorRuntime }
    | { readonly kind: "trigger"; readonly trigger: TriggerRuntime };

interface RenderBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface ActiveMagicAnimation {
    readonly animation: MagicEffectAnimation;
    readonly targetName: string;
    readonly startedAt: number;
}

type HoverTargetKind = "person" | "door" | "trigger";

interface BackgroundSpriteHighlight extends RenderBounds {
    readonly centerX: number;
    readonly centerY: number;
}

type RenderKind = "static" | "animation" | "person";

type RenderItem =
    | { kind: "static"; levelStatic: LevelStatic }
    | { kind: "animation"; levelAnimation: LevelAnimation }
    | { kind: "person"; runtime: PersonRuntime };

const renderPriority: Record<RenderKind, number> = {
    person: 0,
    animation: 1,
    static: 2,
};

const doorRenderDepth = (cells: readonly TilePosition[], fallback: number): number => {
    let depth = Number.NEGATIVE_INFINITY;
    for (const cell of cells) depth = Math.max(depth, cellToWorld(cell).y);
    return Number.isFinite(depth) ? depth : fallback;
};
const directionOrder: readonly Direction[] = ["UP", "UP_RIGHT", "RIGHT", "DOWN_RIGHT", "DOWN", "DOWN_LEFT", "LEFT", "UP_LEFT"];

export class MapRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D | null;
    private levelData: LevelData;
    private readonly scroller: MapScroller;
    private offset: Readonly<WorldPosition> = { x: 0, y: 0 };
    private persons: PersonRuntime[];
    private player: PersonRuntime;
    private worldGrid: WorldGrid;
    private renderQueue: RenderItem[];
    private lastFrameTime = performance.now();
    private simulationAccumulatorMs = 0;
    private simulationTick = 0;
    private readonly occluderCache = new Map<string, readonly number[]>();
    private readonly onSimulationStep?: (tick: number, simulationTimeMs: number, playerPosition: Readonly<WorldPosition>) => void;
    private readonly onPersonClick?: (person: LevelPerson) => void;
    private readonly onPersonAttack?: (person: LevelPerson) => void;
    private readonly hiddenPersons = new Set<string>();
    private readonly deadPersons = new Set<string>();
    private pendingPersonInteraction: PendingInteraction | undefined;
    private readonly doors = new Map<string, DoorRuntime>();
    private readonly doorsByStatic = new Map<LevelStatic, DoorRuntime>();
    private readonly triggers = new Map<string, TriggerRuntime>();
    private interactiveStatics = new Set<LevelStatic>();
    private interactiveAnimations = new Set<LevelAnimation>();
    private interactiveBackgrounds: readonly BackgroundSpriteHighlight[] = [];
    private interactiveTriggerMasks: readonly LevelTriggerMask[] = [];
    private hoveredTargetKey = "";
    private currentCursor = CursorType.NORMAL;
    private flashInteractiveObjects = false;
    private readonly highlightCanvas = document.createElement("canvas");
    private readonly highlightContext = this.highlightCanvas.getContext("2d");
    private combatMode = false;
    private magicTargeting = false;
    private readonly magicEffects: ActiveMagicAnimation[] = [];

    private readonly simulationStepMs = 1000 / 60;
    private walkingSpeed = 48;
    private runningSpeed = 96;
    private animationSpeed = 1;
    private alwaysRun = false;
    private showHints = true;
    private transparentOccluders = true;
    private readonly interactionRangeCells = 3;
    private readonly randomMovementRadius = 8;

    private readonly handleClick = (event: MouseEvent) => {
        if (event.button !== 0) return;
        if (this.deadPersons.has("hero")) return;
        const clickPosition = this.eventWorldPosition(event);
        const clickedPerson = this.findPersonAt(clickPosition);
        const deadPerson = clickedPerson ? this.deadPersons.has(clickedPerson.person.name.toLowerCase()) : false;
        const attack = !deadPerson && (event.shiftKey || this.combatMode || this.magicTargeting);
        if (clickedPerson && (attack || clickedPerson.person.scriptDialog || deadPerson)) {
            this.beginPersonInteraction(clickedPerson, attack, event.detail > 1);
            return;
        }
        const clickedDoor = this.findDoorAt(clickPosition);
        if (clickedDoor) {
            this.beginDoorInteraction(clickedDoor, event.detail > 1);
            return;
        }
        const clickedTrigger = this.findTriggerAt(clickPosition);
        if (clickedTrigger) {
            this.beginTriggerInteraction(clickedTrigger, event.detail > 1);
            return;
        }

        this.pendingPersonInteraction = undefined;
        this.movePlayerTo(clickPosition, event.detail > 1);
    };

    private readonly handleMouseMove = (event: MouseEvent) => {
        const local = this.eventCanvasPosition(event);
        const edgeCursor = this.edgeCursor(local);

        if (edgeCursor) {
            this.setHoveredTarget();
            this.changeCursor(edgeCursor);
            return;
        }
        const world = { x: local.x + this.offset.x, y: local.y + this.offset.y };
        const person = this.findPersonAt(world);
        if (person) {
            this.setHoveredTarget("person", person.person.name);
            this.changeCursor(this.deadPersons.has(person.person.name.toLowerCase()) ? CursorType.TAKE : this.magicTargeting ? CursorType.CAST : event.shiftKey || this.combatMode ? CursorType.ATTACK : person.person.scriptDialog ? CursorType.TALK : CursorType.NPC_TURN);
            return;
        }
        const door = this.findDoorAt(world);
        if (door) {
            this.setHoveredTarget("door", door.name);
            this.changeCursor(CursorType.OPEN);
            return;
        }
        const trigger = this.findTriggerAt(world);
        this.setHoveredTarget(trigger ? "trigger" : undefined, trigger?.name);
        this.changeCursor(trigger ? this.cursorForTrigger(trigger) : CursorType.NORMAL);
    };

    private readonly handleMouseLeave = () => {
        this.setHoveredTarget();
        this.changeCursor(CursorType.NORMAL);
    };

    private readonly handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Alt") return;
        event.preventDefault();
        this.refreshInteractiveVisuals();
        this.flashInteractiveObjects = true;
    };

    private readonly handleKeyUp = (event: KeyboardEvent) => {
        if (event.key === "Alt") this.flashInteractiveObjects = false;
    };

    private readonly handleWindowBlur = () => {
        this.flashInteractiveObjects = false;
    };

    constructor(
        canvas: HTMLCanvasElement,
        levelData: LevelData,
        onSimulationStep?: (tick: number, simulationTimeMs: number, playerPosition: Readonly<WorldPosition>) => void,
        onPersonClick?: (person: LevelPerson) => void,
        onPersonAttack?: (person: LevelPerson) => void,
        private readonly onDoorClick?: (name: string) => void,
        private readonly onTriggerClick?: (name: string) => void,
        private readonly onCursorChange?: (cursor: CursorType) => void,
        private readonly onHoverTarget?: (kind?: HoverTargetKind, name?: string) => void,
    ) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.levelData = levelData;
        this.onSimulationStep = onSimulationStep;
        this.onPersonClick = onPersonClick;
        this.onPersonAttack = onPersonAttack;
        this.persons = this.createPersonRuntimes(levelData);
        this.player = this.createPlayerRuntime(levelData.player);
        this.worldGrid = new WorldGrid(levelData.lvlData.maskHDR);
        this.createInteractionRuntimes(levelData);
        this.refreshInteractiveVisuals();
        this.scroller = new MapScroller(this.canvas, levelData.lvlData.mapSize);
        this.scroller.centerOn(this.player.position);
        this.renderQueue = this.createRenderQueue(levelData);
        this.canvas.addEventListener("click", this.handleClick);
        this.canvas.addEventListener("mousemove", this.handleMouseMove);
        this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);
        window.addEventListener("blur", this.handleWindowBlur);
    }

    public updateLevelData(levelData: LevelData) {
        this.levelData = levelData;
        this.persons = this.createPersonRuntimes(levelData);
        this.player = this.createPlayerRuntime(levelData.player);
        this.worldGrid = new WorldGrid(levelData.lvlData.maskHDR);
        this.renderQueue = this.createRenderQueue(levelData);
        this.createInteractionRuntimes(levelData);
        this.refreshInteractiveVisuals();
        this.occluderCache.clear();
        this.scroller.setMapSize(levelData.lvlData.mapSize);
        this.scroller.centerOn(this.player.position);
        this.lastFrameTime = performance.now();
        this.simulationAccumulatorMs = 0;
        this.simulationTick = 0;
        this.pendingPersonInteraction = undefined;
        this.flashInteractiveObjects = false;
        this.magicEffects.length = 0;
    }

    public getPlayerWorldPosition(): WorldPosition {
        return { ...this.player.position };
    }

    public async setHeroEquipment(equippedTechnicalNames: readonly string[]): Promise<void> {
        this.player.person.sprites = await loadHeroSprites(equippedTechnicalNames);

    }
    public getCameraCenterWorldPosition(): WorldPosition {
        const offset = this.scroller.getOffset();
        return {
            x: offset.x + this.canvas.width / 2,
            y: offset.y + this.canvas.height / 2,
        };
    }

    public centerCameraAt(position: Readonly<WorldPosition>): void {
        this.scroller.centerOn(position);
        this.offset = this.scroller.getOffset();
    }

    public applySettings(settings: Readonly<Record<number, boolean | number | string>>): void {
        const animation = Number(settings[9]);
        this.animationSpeed = Number.isFinite(animation) ? Math.max(0.25, Math.min(2, 0.5 + animation / 100)) : 1;
        const speed = Number(settings[9]);
        const movementFactor = Number.isFinite(speed) ? Math.max(0.5, Math.min(1.5, 0.5 + speed / 100)) : 1;
        this.walkingSpeed = 48 * movementFactor;
        this.runningSpeed = 96 * movementFactor;
        this.scroller.setScrollSpeed(Number(settings[10]) || 0);
        this.alwaysRun = settings[12] === true;
        this.showHints = settings[13] !== false;
        this.transparentOccluders = settings[14] !== false;
        if (!this.showHints) this.setHoveredTarget();
    }

    public getMinimapState() {
        const cameraOffset = this.scroller.getOffset();
        return {
            camera: {
                left: cameraOffset.x,
                top: cameraOffset.y,
                width: this.canvas.width,
                height: this.canvas.height,
            },
            player: { ...this.player.position },
            persons: this.persons
                .filter(({ person }) => !this.hiddenPersons.has(person.name))
                .map(({ position }) => ({ ...position })),
        };
    }


    public getPlayerDirection(): Direction {
        return this.player.direction;
    }

    public setPlayerState(position: Readonly<WorldPosition>, direction: Direction): void {
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Player position must be finite");
        this.player.position = { ...position };
        this.player.direction = direction;
        this.player.route = [];
        this.player.targetIndex = 0;
        this.player.moving = false;
        this.player.running = false;
        this.pendingPersonInteraction = undefined;
        this.scroller.centerOn(this.player.position);
    }


    public setPersonPresent(technicalName: string, present: boolean): void {
        if (present) this.hiddenPersons.delete(technicalName);
        else this.hiddenPersons.add(technicalName);
    }

    public addPerson(person: LevelPerson): void {
        this.levelData.levelPersons.push(person);
        const runtime = this.createPersonRuntime(person, this.levelData);
        this.persons.push(runtime);
        this.renderQueue.push({ kind: "person", runtime });
        this.hiddenPersons.delete(person.name);
    }

    public playPersonCombatAnimation(technicalName: string, kind: CombatAnimationKind): void {
        const normalized = technicalName.toLowerCase();
        const runtime = normalized === "hero"
            ? this.player
            : this.persons.find((candidate) => candidate.person.name.toLowerCase() === normalized);
        if (!runtime) return;
        if (kind === "die") this.deadPersons.add(normalized);
        runtime.combatAnimation = { kind, startedAt: this.simulationTick * this.simulationStepMs };
        runtime.route = [];
        runtime.targetIndex = 0;
        runtime.moving = false;
        runtime.running = false;
    }

    public playMagicEffect(technicalName: string, targetName: string): void {
        void MagicEffectAnimation.load(technicalName).then((animation) => {
            this.magicEffects.push({
                animation,
                targetName: targetName.toLowerCase(),
                startedAt: this.simulationTick * this.simulationStepMs,
            });
        }).catch((error) => console.warn(`Не удалось загрузить анимацию магии ${technicalName}`, error));
    }

    public setDoorState(name: string, opened: boolean, cells?: readonly TilePosition[], activationCells?: readonly TilePosition[]): void {
        const door = this.doors.get(name);
        if (!door) return;
        door.opened = opened;
        if (cells) door.cells = expandDoorBarrierCells(cells);
        if (activationCells) door.activationCells = activationCells.map((cell) => ({ ...cell }));
        door.depth = doorRenderDepth(door.cells, door.levelDoor.levelStatic.position.y + (door.levelDoor.levelStatic.image?.height ?? 0));
    }

    public setTriggerState(trigger: ScenarioTriggerState): void {
        const existing = this.triggers.get(trigger.name);
        if (existing) Object.assign(existing, trigger, { cells: trigger.cells.map((cell) => ({ ...cell })) });
        else this.triggers.set(trigger.name, { ...trigger, cells: trigger.cells.map((cell) => ({ ...cell })) });
    }

    public setCombatMode(active: boolean): void {
        this.combatMode = active;
        if (!active && this.currentCursor === CursorType.ATTACK) this.changeCursor(CursorType.NORMAL);
    }

    public setMagicTargeting(active: boolean): void {
        this.magicTargeting = active;
        if (!active && this.currentCursor === CursorType.CAST) this.changeCursor(this.combatMode ? CursorType.ATTACK : CursorType.NORMAL);
    }

    public getSimulationTick(): number {
        return this.simulationTick;
    }

    public destroy() {
        this.scroller.destroy();
        this.canvas.removeEventListener("click", this.handleClick);
        this.canvas.removeEventListener("mousemove", this.handleMouseMove);
        this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
        this.changeCursor(CursorType.NORMAL);
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
        window.removeEventListener("blur", this.handleWindowBlur);
        this.setHoveredTarget();
        this.magicEffects.length = 0;
    }

    public draw() {
        const ctx = this.ctx;
        if (!ctx) return;

        const frameTime = performance.now();
        const elapsedMs = Math.min(Math.max(frameTime - this.lastFrameTime, 0), 100);
        this.lastFrameTime = frameTime;
        this.simulationAccumulatorMs += elapsedMs;
        while (this.simulationAccumulatorMs >= this.simulationStepMs) {
            this.advanceSimulation();
            this.simulationAccumulatorMs -= this.simulationStepMs;
        }

        this.offset = this.scroller.getOffset();
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(
            this.levelData.image,
            this.offset.x,
            this.offset.y,
            this.canvas.width,
            this.canvas.height,
            0,
            0,
            this.canvas.width,
            this.canvas.height,
        );

        this.renderQueue.sort((left, right) => {
            const depthDelta = this.renderDepth(left) - this.renderDepth(right);
            return depthDelta || renderPriority[left.kind] - renderPriority[right.kind];
        });
        const highlightTime = this.simulationTick * this.simulationStepMs;
        for (const item of this.renderQueue) this.drawRenderItem(item, highlightTime);
        this.drawMagicEffects(highlightTime);
        if (this.flashInteractiveObjects) {
            this.drawBackgroundSpriteHighlights(highlightTime);
            this.drawTriggerMaskHighlights(highlightTime);
            this.drawTriggerHighlights();
        }
    }

    private drawMagicEffects(now: number): void {
        const context = this.ctx;
        if (!context) return;
        for (let index = this.magicEffects.length - 1; index >= 0; index -= 1) {
            const effect = this.magicEffects[index];
            const elapsedMs = now - effect.startedAt;
            if (elapsedMs > effect.animation.durationMs) {
                this.magicEffects.splice(index, 1);
                continue;
            }
            const position = this.personWorldPosition(effect.targetName);
            if (!position) continue;
            effect.animation.draw(context, position.x - this.offset.x, position.y - this.offset.y, elapsedMs);
        }
    }

    private personWorldPosition(technicalName: string): Readonly<WorldPosition> | undefined {
        if (technicalName === "hero") return this.player.position;
        return this.persons.find((candidate) => candidate.person.name.toLowerCase() === technicalName)?.position;
    }

    private drawBackgroundSpriteHighlights(now: number): void {
        const context = this.highlightContext;
        if (!context) return;
        for (const highlight of this.interactiveBackgrounds) {
            const drawX = highlight.x - this.offset.x;
            const drawY = highlight.y - this.offset.y;
            if (drawX > this.canvas.width || drawY > this.canvas.height
                || drawX + highlight.width < 0 || drawY + highlight.height < 0) continue;
            if (this.highlightCanvas.width !== highlight.width) this.highlightCanvas.width = highlight.width;
            if (this.highlightCanvas.height !== highlight.height) this.highlightCanvas.height = highlight.height;
            context.clearRect(0, 0, highlight.width, highlight.height);
            context.drawImage(
                this.levelData.image,
                highlight.x, highlight.y, highlight.width, highlight.height,
                0, 0, highlight.width, highlight.height,
            );
            context.save();
            context.globalCompositeOperation = "destination-in";
            const radius = Math.max(highlight.width, highlight.height) * 0.62;
            const gradient = context.createRadialGradient(
                highlight.centerX, highlight.centerY, radius * 0.22,
                highlight.centerX, highlight.centerY, radius,
            );
            gradient.addColorStop(0, "rgb(255 255 255 / 100%)");
            gradient.addColorStop(0.68, "rgb(255 255 255 / 82%)");
            gradient.addColorStop(1, "rgb(255 255 255 / 0%)");
            context.fillStyle = gradient;
            context.fillRect(0, 0, highlight.width, highlight.height);
            context.restore();
            this.tintAndDrawHighlight(drawX, drawY, highlight.width, highlight.height, now, 0.45);
        }
    }

    private drawTriggerMaskHighlights(now: number): void {
        const context = this.highlightContext;
        if (!context) return;
        for (const trigger of this.interactiveTriggerMasks) {
            const drawX = trigger.position.x - this.offset.x;
            const drawY = trigger.position.y - this.offset.y;
            if (drawX > this.canvas.width || drawY > this.canvas.height
                || drawX + trigger.image.width < 0 || drawY + trigger.image.height < 0) continue;
            if (this.highlightCanvas.width !== trigger.image.width) this.highlightCanvas.width = trigger.image.width;
            if (this.highlightCanvas.height !== trigger.image.height) this.highlightCanvas.height = trigger.image.height;
            context.clearRect(0, 0, trigger.image.width, trigger.image.height);
            context.drawImage(
                this.levelData.image,
                trigger.position.x, trigger.position.y, trigger.image.width, trigger.image.height,
                0, 0, trigger.image.width, trigger.image.height,
            );
            context.save();
            context.drawImage(trigger.image, 0, 0);
            context.restore();
            this.tintAndDrawHighlight(drawX, drawY, trigger.image.width, trigger.image.height, now);
        }
    }

    private drawTriggerHighlights(): void {
        const context = this.ctx;
        if (!context) return;
        context.save();
        context.fillStyle = "rgb(255 220 96 / 24%)";
        context.strokeStyle = "rgb(255 230 125 / 88%)";
        context.lineWidth = 2;
        for (const trigger of this.triggers.values()) {
            if (!trigger.active || !trigger.visible || !trigger.scriptName || trigger.inventoryName) continue;
            for (const cell of trigger.cells) {
                const point = cellToWorld(cell);
                const x = point.x - this.offset.x;
                const y = point.y - this.offset.y;
                context.beginPath();
                context.moveTo(x, y - WORLD_CELL_HEIGHT / 2);
                context.lineTo(x + WORLD_CELL_WIDTH / 2, y);
                context.lineTo(x, y + WORLD_CELL_HEIGHT / 2);
                context.lineTo(x - WORLD_CELL_WIDTH / 2, y);
                context.closePath();
                context.fill();
                context.stroke();
            }
        }
        context.restore();
    }

    private advanceSimulation() {
        this.simulationTick++;
        const simulationTime = this.simulationTick * this.simulationStepMs;
        this.updatePersons(simulationTime, this.simulationStepMs / 1000);
        this.updatePlayer(this.simulationStepMs / 1000);
        const edgeDirection = this.scroller.update();
        if (!edgeDirection && this.isEdgeCursor(this.currentCursor)) this.changeCursor(CursorType.NORMAL);

        for (const levelAnimation of this.levelData.levelAnimations) {
            levelAnimation.animation?.update(this.simulationStepMs * this.animationSpeed);
        }
        this.onSimulationStep?.(this.simulationTick, simulationTime, this.getPlayerWorldPosition());
    }

    private createRenderQueue(levelData: LevelData): RenderItem[] {
        const queue: RenderItem[] = [];
        for (const levelStatic of levelData.levelStatics) {
            if (levelStatic.image) queue.push({ kind: "static", levelStatic });
        }
        for (const levelAnimation of levelData.levelAnimations) {
            if (levelAnimation.animation) queue.push({ kind: "animation", levelAnimation });
        }
        for (const runtime of this.persons) queue.push({ kind: "person", runtime });
        queue.push({ kind: "person", runtime: this.player });
        return queue;
    }

    private createInteractionRuntimes(levelData: LevelData): void {
        this.doors.clear();
        this.doorsByStatic.clear();
        for (const levelDoor of levelData.levelDoors) {
            const cells = expandDoorBarrierCells(levelData.sefData.cellGroups[levelDoor.cellsName] ?? []);
            const runtime: DoorRuntime = {
                name: levelDoor.sefName,
                levelDoor,
                cells,
                activationCells: (levelData.lvlData.cellGroups[levelDoor.cellGroup] ?? []).map((cell) => ({ ...cell })),
                opened: levelDoor.isOpened ?? false,
                depth: doorRenderDepth(cells, levelDoor.levelStatic.position.y + (levelDoor.levelStatic.image?.height ?? 0)),
            };
            this.doors.set(levelDoor.sefName, runtime);
            this.doorsByStatic.set(levelDoor.levelStatic, runtime);
        }
        this.triggers.clear();
        for (const trigger of levelData.sefData.triggers) {
            this.triggers.set(trigger.name, {
                name: trigger.name,
                active: trigger.isActive ?? true,
                visible: trigger.isVisible ?? true,
                transition: trigger.isTransition ?? false,
                cells: (trigger.cellsName ? levelData.sefData.cellGroups[trigger.cellsName] ?? [] : []).map((cell) => ({ ...cell })),
                literaryName: trigger.literaryName,
                cursorName: trigger.cursorName,
                scriptName: trigger.scriptName,
                inventoryName: trigger.inventoryName,
            });
        }
    }

    private renderDepth(item: RenderItem): number {
        switch (item.kind) {
            case "static":
                return this.doorsByStatic.get(item.levelStatic)?.depth
                    ?? item.levelStatic.position.y + (item.levelStatic.image?.height ?? 0);
            case "animation":
                return item.levelAnimation.position.y + (item.levelAnimation.animation?.frameHeight ?? 0);
            case "person":
                return item.runtime.position.y;
        }
    }

    private drawRenderItem(item: RenderItem, now: number) {
        switch (item.kind) {
            case "static":
                if (this.isStaticVisible(item.levelStatic)) this.drawStatic(item.levelStatic, now);
                break;
            case "animation":
                this.drawAnimation(item.levelAnimation, now);
                break;
            case "person":
                if (!this.hiddenPersons.has(item.runtime.person.name)) this.drawPerson(item.runtime, now);
                break;
        }
    }

    private createPersonRuntimes(levelData: LevelData): PersonRuntime[] {
        return levelData.levelPersons.map((person) => this.createPersonRuntime(person, levelData));
    }

    private createPersonRuntime(person: LevelPerson, levelData: LevelData): PersonRuntime {
        const patrol = (person.route ? levelData.sefData.cellGroups[person.route] ?? [] : []).map(cellToWorld);
        let patrolIndex = 0;
        if (patrol.length > 0) {
            patrolIndex = patrol.reduce((closest, point, index) =>
                Math.hypot(person.worldPosition.x - point.x, person.worldPosition.y - point.y)
                    < Math.hypot(person.worldPosition.x - patrol[closest].x, person.worldPosition.y - patrol[closest].y)
                    ? index : closest, 0);
            if (patrol.length > 1 && Math.hypot(person.worldPosition.x - patrol[patrolIndex].x, person.worldPosition.y - patrol[patrolIndex].y) < 1) {
                patrolIndex = (patrolIndex + 1) % patrol.length;
            }
        }
        return {
            person,
            position: { ...person.worldPosition },
            anchor: { ...person.worldPosition },
            direction: person.direction,
            route: [],
            targetIndex: 0,
            patrol,
            patrolIndex,
            routeStep: 1,
            waitUntil: 0,
            moving: false,
            running: false,
        };
    }

    private createPlayerRuntime(player: LevelPerson): PersonRuntime {
        return {
            person: player,
            position: { ...player.worldPosition },
            anchor: { ...player.worldPosition },
            direction: player.direction,
            route: [],
            targetIndex: 0,
            patrol: [],
            patrolIndex: 0,
            routeStep: 1,
            waitUntil: 0,
            moving: false,
            running: false,
        };
    }

    private blockedCells(excluded?: PersonRuntime): Set<number> {
        const blocked = new Set<number>();
        for (const runtime of this.persons) {
            if (runtime !== excluded && !this.hiddenPersons.has(runtime.person.name)) {
                blocked.add(this.worldGrid.index(worldToCell(runtime.position)));
            }
        }
        if (this.player !== excluded) blocked.add(this.worldGrid.index(worldToCell(this.player.position)));
        for (const door of this.doors.values()) {
            if (!door.opened) for (const cell of door.cells) blocked.add(this.worldGrid.index(cell));
        }
        if (excluded) blocked.delete(this.worldGrid.index(worldToCell(excluded.position)));
        return blocked;
    }

    private planRoute(runtime: PersonRuntime, destination: Readonly<WorldPosition>): boolean {
        const path = this.worldGrid.findPath(worldToCell(runtime.position), worldToCell(destination), this.blockedCells(runtime));
        runtime.route = path.slice(1).map(cellToWorld);
        runtime.targetIndex = 0;
        runtime.moving = runtime.route.length > 0;
        return runtime.moving;
    }

    private movePlayerTo(destination: Readonly<WorldPosition>, running: boolean): void {
        this.planRoute(this.player, destination);
        this.player.waitUntil = 0;
        this.player.running = (running || this.alwaysRun) && this.player.moving;
    }

    private beginPersonInteraction(runtime: PersonRuntime, attack: boolean, running: boolean): void {
        this.pendingPersonInteraction = { kind: "person", runtime, attack };
        if (this.completePendingInteraction()) return;
        this.movePlayerTo(runtime.position, running);
        if (!this.player.moving) this.pendingPersonInteraction = undefined;
    }

    private beginDoorInteraction(door: DoorRuntime, running: boolean): void {
        this.pendingPersonInteraction = { kind: "door", door };
        if (this.completePendingInteraction()) return;
        this.movePlayerTo(this.nearestInteractionPosition(door.activationCells.length > 0 ? door.activationCells : door.cells), running);
        if (!this.player.moving) this.pendingPersonInteraction = undefined;
    }

    private beginTriggerInteraction(trigger: TriggerRuntime, running: boolean): void {
        this.pendingPersonInteraction = { kind: "trigger", trigger };
        if (this.completePendingInteraction()) return;
        this.movePlayerTo(this.nearestInteractionPosition(trigger.cells), running);
        if (!this.player.moving) this.pendingPersonInteraction = undefined;
    }

    private nearestInteractionPosition(cells: readonly TilePosition[]): WorldPosition {
        if (cells.length === 0) return { ...this.player.position };
        const playerCell = worldToCell(this.player.position);
        return cellToWorld(cells.reduce((closest, cell) =>
            Math.hypot(cell.x - playerCell.x, cell.y - playerCell.y) < Math.hypot(closest.x - playerCell.x, closest.y - playerCell.y)
                ? cell : closest, cells[0]));
    }

    private interactionPosition(interaction: PendingInteraction): WorldPosition {
        if (interaction.kind === "person") return interaction.runtime.position;
        if (interaction.kind === "door") return this.nearestInteractionPosition(interaction.door.activationCells.length > 0 ? interaction.door.activationCells : interaction.door.cells);
        return this.nearestInteractionPosition(interaction.trigger.cells);
    }

    private completePendingInteraction(): boolean {
        const interaction = this.pendingPersonInteraction;
        if (!interaction) return false;
        if (interaction.kind === "person" && this.hiddenPersons.has(interaction.runtime.person.name)) return false;
        if (interaction.kind === "trigger" && (!interaction.trigger.active || !interaction.trigger.visible)) return false;
        const target = this.interactionPosition(interaction);
        const distance = Math.hypot(
            (target.x - this.player.position.x) / WORLD_CELL_WIDTH,
            (target.y - this.player.position.y) / WORLD_CELL_HEIGHT,
        );
        if (distance > this.interactionRangeCells) return false;

        this.pendingPersonInteraction = undefined;
        this.player.route = [];
        this.player.targetIndex = 0;
        this.player.moving = false;
        this.player.running = false;
        this.player.direction = this.directionFromVector(target.x - this.player.position.x, target.y - this.player.position.y);
        if (interaction.kind === "person") {
            if (interaction.attack) this.onPersonAttack?.(interaction.runtime.person);
            else this.onPersonClick?.(interaction.runtime.person);
        } else if (interaction.kind === "door") {
            this.onDoorClick?.(interaction.door.name);
        } else {
            this.onTriggerClick?.(interaction.trigger.name);
        }
        return true;
    }

    private updatePlayer(deltaSeconds: number) {
        this.player.moving = false;
        if (this.player.combatAnimation) return;
        if (this.completePendingInteraction()) return;
        const target = this.player.route[this.player.targetIndex];
        if (!target) {
            this.player.running = false;
            this.pendingPersonInteraction = undefined;
            return;
        }

        this.moveRuntimeTowards(this.player, target, (this.player.running ? this.runningSpeed : this.walkingSpeed) * deltaSeconds);
        if (Math.hypot(target.x - this.player.position.x, target.y - this.player.position.y) < 0.001) {
            this.player.targetIndex++;
            if (this.completePendingInteraction()) return;
            this.player.moving = this.player.targetIndex < this.player.route.length;
            if (!this.player.moving) {
                this.player.running = false;
                this.pendingPersonInteraction = undefined;
            }
        }
    }

    private updatePersons(now: number, deltaSeconds: number) {
        for (const runtime of this.persons) {
            runtime.moving = false;
            if (this.hiddenPersons.has(runtime.person.name)) continue;
            if (this.combatMode || runtime.combatAnimation) continue;
            if (runtime.person.routeType === "STAY") continue;
            if (runtime.person.routeType === "STAY_ROTATE") {
                if (now >= runtime.waitUntil) {
                    runtime.direction = directionOrder[(directionOrder.indexOf(runtime.direction) + 1) % directionOrder.length];
                    runtime.waitUntil = now + this.routeDelay(runtime);
                }
                continue;
            }
            if (now < runtime.waitUntil) continue;
            if (runtime.targetIndex >= runtime.route.length && !this.planNpcRoute(runtime, now)) continue;
            const target = runtime.route[runtime.targetIndex];
            if (!target) continue;
            const targetCell = worldToCell(target);
            if (this.blockedCells(runtime).has(this.worldGrid.index(targetCell))) {
                runtime.route = [];
                runtime.targetIndex = 0;
                runtime.waitUntil = now + 250;
                continue;
            }
            this.moveRuntimeTowards(runtime, target, this.walkingSpeed * deltaSeconds);
            if (Math.hypot(target.x - runtime.position.x, target.y - runtime.position.y) < 0.001) {
                runtime.targetIndex++;
                if (runtime.targetIndex >= runtime.route.length) this.finishNpcRoute(runtime, now);
            }
        }
    }

    private moveRuntimeTowards(runtime: PersonRuntime, target: Readonly<WorldPosition>, travel: number): void {
        const dx = target.x - runtime.position.x;
        const dy = target.y - runtime.position.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= travel || distance < 0.001) {
            runtime.position.x = target.x;
            runtime.position.y = target.y;
            runtime.moving = true;
            return;
        }
        const ratio = travel / distance;
        runtime.position.x += dx * ratio;
        runtime.position.y += dy * ratio;
        runtime.direction = this.directionFromVector(dx, dy);
        runtime.moving = true;
    }

    private planNpcRoute(runtime: PersonRuntime, now: number): boolean {
        let destination: WorldPosition | undefined;
        if ((runtime.person.routeType === "MOVED" || runtime.person.routeType === "MOVED_FLIP") && runtime.patrol.length > 0) {
            destination = runtime.patrol[runtime.patrolIndex];
        } else if (runtime.person.routeType === "RANDOM" || runtime.person.routeType === "RANDOM_RADIUS") {
            const radius = Math.max(1, runtime.person.routeType === "RANDOM_RADIUS" ? runtime.person.radius ?? this.randomMovementRadius : this.randomMovementRadius);
            const anchor = worldToCell(runtime.anchor);
            for (let attempt = 0; attempt < 8 && !destination; attempt++) {
                const candidate = {
                    x: anchor.x + Math.floor(Math.random() * (radius * 2 + 1)) - radius,
                    y: anchor.y + Math.floor(Math.random() * (radius * 2 + 1)) - radius,
                };
                const walkable = this.worldGrid.nearestWalkable(candidate, this.blockedCells(runtime), radius);
                if (walkable) destination = cellToWorld(walkable);
            }
        }
        if (!destination || !this.planRoute(runtime, destination)) {
            runtime.waitUntil = now + this.routeDelay(runtime);
            return false;
        }
        return true;
    }

    private finishNpcRoute(runtime: PersonRuntime, now: number): void {
        runtime.route = [];
        runtime.targetIndex = 0;
        if (runtime.patrol.length > 1) {
            if (runtime.person.routeType === "MOVED_FLIP") {
                if (runtime.patrolIndex === runtime.patrol.length - 1) runtime.routeStep = -1;
                if (runtime.patrolIndex === 0) runtime.routeStep = 1;
                runtime.patrolIndex += runtime.routeStep;
            } else runtime.patrolIndex = (runtime.patrolIndex + 1) % runtime.patrol.length;
        }
        runtime.waitUntil = now + this.routeDelay(runtime);
    }

    private routeDelay(runtime: PersonRuntime): number {
        const minimum = Math.max(0, runtime.person.delayMin ?? 0);
        const maximum = Math.max(minimum, runtime.person.delayMax ?? minimum);
        return minimum + Math.random() * (maximum - minimum);
    }

    private findPersonAt(position: Readonly<WorldPosition>): PersonRuntime | undefined {
        const now = this.simulationTick * this.simulationStepMs;
        const candidates = this.persons
            .filter((runtime) => !this.hiddenPersons.has(runtime.person.name))
            .sort((left, right) => right.position.y - left.position.y);
        for (const runtime of candidates) {
            const frame = this.personRenderFrame(runtime, now);
            const localX = Math.floor(position.x - frame.worldX);
            const localY = Math.floor(position.y - frame.worldY);
            if (localX < 0 || localY < 0 || localX >= frame.width || localY >= frame.height) continue;
            const sourcePixelX = frame.mirrored ? frame.width - localX - 1 : localX;
            const sourceContext = frame.image.getContext("2d", { willReadFrequently: true });
            if (!sourceContext) continue;
            const alpha = sourceContext.getImageData(
                frame.sourceX + sourcePixelX,
                frame.sourceY + localY,
                1,
                1,
            ).data[3];
            if (alpha > 16) return runtime;
        }
        return undefined;
    }

    private findDoorAt(position: Readonly<WorldPosition>): DoorRuntime | undefined {
        const cell = worldToCell(position);
        for (const door of this.doors.values()) {
            if (door.cells.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)
                || door.activationCells.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)) return door;
            const levelStatic = door.levelDoor.levelStatic;
            const image = levelStatic.image;
            if (!image) continue;
            const x = Math.floor(position.x - levelStatic.position.x);
            const y = Math.floor(position.y - levelStatic.position.y);
            if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
            const context = image.getContext("2d", { willReadFrequently: true });
            if ((context?.getImageData(x, y, 1, 1).data[3] ?? 0) > 16) return door;
        }
        return undefined;
    }

    private findTriggerAt(position: Readonly<WorldPosition>): TriggerRuntime | undefined {
        for (const trigger of this.triggers.values()) {
            if (!trigger.active || !trigger.visible) continue;
            const mask = this.levelData.triggerMasks.find((candidate) => candidate.name.toLowerCase() === trigger.name.toLowerCase());
            if (mask) {
                const x = Math.floor(position.x - mask.position.x);
                const y = Math.floor(position.y - mask.position.y);
                if (x < 0 || y < 0 || x >= mask.image.width || y >= mask.image.height) continue;
                const context = mask.image.getContext("2d", { willReadFrequently: true });
                if ((context?.getImageData(x, y, 1, 1).data[3] ?? 0) > 16) return trigger;
                continue;
            }
            const cell = worldToCell(position);
            if (trigger.cells.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)) return trigger;
        }
        return undefined;
    }

    private eventCanvasPosition(event: MouseEvent): WorldPosition {
        const bounds = this.canvas.getBoundingClientRect();
        return {
            x: (event.clientX - bounds.left) * this.canvas.width / Math.max(1, bounds.width),
            y: (event.clientY - bounds.top) * this.canvas.height / Math.max(1, bounds.height),
        };
    }

    private eventWorldPosition(event: MouseEvent): WorldPosition {
        const local = this.eventCanvasPosition(event);
        return { x: local.x + this.offset.x, y: local.y + this.offset.y };
    }

    private edgeCursor(position: Readonly<WorldPosition>): CursorType | undefined {
        switch (this.scroller.getEdgeDirection(position)) {
            case "left-up": return CursorType.LUP;
            case "right-up": return CursorType.RUP;
            case "left-down": return CursorType.LDOWN;
            case "right-down": return CursorType.RDOWN;
            case "left": return CursorType.LEFT;
            case "right": return CursorType.RIGHT;
            case "up": return CursorType.UP;
            case "down": return CursorType.DOWN;
            default: return undefined;
        }
    }

    private isEdgeCursor(cursor: CursorType): boolean {
        return cursor === CursorType.LEFT || cursor === CursorType.RIGHT || cursor === CursorType.UP || cursor === CursorType.DOWN
            || cursor === CursorType.LUP || cursor === CursorType.RUP || cursor === CursorType.LDOWN || cursor === CursorType.RDOWN;
    }

    private setHoveredTarget(kind?: HoverTargetKind, name?: string): void {
        const key = kind && name ? `${kind}:${name}` : "";
        if (key === this.hoveredTargetKey) return;
        this.hoveredTargetKey = key;
        if (this.showHints) this.onHoverTarget?.(kind, name);
        else this.onHoverTarget?.();
    }

    private cursorForTrigger(trigger: TriggerRuntime): CursorType {
        switch (trigger.cursorName?.toUpperCase()) {
            case "CURSOR_TAKE": return CursorType.TAKE;
            case "CURSOR_CANT_TAKE": return CursorType.CANT_TAKE;
            case "CURSOR_ANOTHER_LOCATION": return CursorType.ANOTHER_LOCATION;
            case "CURSOR_OPEN": return CursorType.OPEN;
            case "CURSOR_TALK": return CursorType.TALK;
            default: return trigger.inventoryName ? CursorType.TAKE : CursorType.NORMAL;
        }
    }

    private changeCursor(cursor: CursorType): void {
        if (cursor === this.currentCursor) return;
        this.currentCursor = cursor;
        this.onCursorChange?.(cursor);
    }

    private personRenderFrame(runtime: PersonRuntime, now: number): PersonRenderFrame {
        const { sprites } = runtime.person;
        const combat = runtime.combatAnimation;
        let metadata: PADAnimation | undefined;
        let image: HTMLCanvasElement | undefined;
        let frame: number | undefined;

        if (combat) {
            const clip = combat.kind === "attack"
                ? { metadata: sprites.attack, image: sprites.attackImage }
                : combat.kind === "suffer"
                    ? { metadata: sprites.suffer, image: sprites.sufferImage }
                    : { metadata: sprites.die, image: sprites.dieImage };
            if (clip.metadata && clip.image) {
                const elapsed = Math.max(0, now - combat.startedAt);
                if (combat.kind === "die" || elapsed < clip.metadata.duration) {
                    metadata = clip.metadata;
                    image = clip.image;
                    frame = combat.kind === "die" && elapsed >= clip.metadata.duration
                        ? clip.metadata.frameCount - 1
                        : Math.min(clip.metadata.frameCount - 1, Math.floor(elapsed * clip.metadata.frameCount / Math.max(1, clip.metadata.duration)));
                } else runtime.combatAnimation = undefined;
            } else if (combat.kind !== "die") runtime.combatAnimation = undefined;
        }

        if (!metadata || !image || frame === undefined) {
            const useTurnWalk = this.combatMode && runtime.moving && sprites.turnWalk && sprites.turnWalkImage;
            const useTurnIdle = this.combatMode && !runtime.moving && sprites.turnIdle && sprites.turnIdleImage;
            const hasRunAnimation = !this.combatMode && runtime.running && sprites.run !== undefined && sprites.runImage !== undefined;
            metadata = useTurnWalk ? sprites.turnWalk! : useTurnIdle ? sprites.turnIdle! : hasRunAnimation ? sprites.run! : runtime.moving ? sprites.walk : sprites.idle;
            image = useTurnWalk ? sprites.turnWalkImage! : useTurnIdle ? sprites.turnIdleImage! : hasRunAnimation ? sprites.runImage! : runtime.moving ? sprites.walkImage : sprites.idleImage;
            const fallbackPlaybackRate = runtime.running && !hasRunAnimation ? 2 : 1;
            const duration = Math.max(1, metadata.duration / fallbackPlaybackRate);
            frame = Math.floor((now % duration) * metadata.frameCount / duration);
        }

        const directionFrame = runtime.moving
            ? this.walkDirectionFrame(runtime.direction)
            : this.idleDirectionFrame(runtime.direction);
        const worldX = directionFrame.mirrored
            ? runtime.position.x - (metadata.frameWidth - metadata.anchorX)
            : runtime.position.x - metadata.anchorX;
        return {
            image,
            sourceX: frame * metadata.frameWidth,
            sourceY: directionFrame.row * metadata.frameHeight,
            width: metadata.frameWidth,
            height: metadata.frameHeight,
            worldX,
            worldY: runtime.position.y - metadata.anchorY,
            anchorX: runtime.position.x,
            anchorY: runtime.position.y,
            mirrored: directionFrame.mirrored,
        };
    }

    private drawPersonFrame(frame: PersonRenderFrame, context: CanvasRenderingContext2D, drawX: number, drawY: number): void {
        context.save();
        if (frame.mirrored) {
            context.translate(drawX + frame.width, drawY);
            context.scale(-1, 1);
            context.drawImage(frame.image, frame.sourceX, frame.sourceY, frame.width, frame.height, 0, 0, frame.width, frame.height);
        } else {
            context.drawImage(frame.image, frame.sourceX, frame.sourceY, frame.width, frame.height, drawX, drawY, frame.width, frame.height);
        }
        context.restore();
    }

    private drawPersonHighlight(frame: PersonRenderFrame, drawX: number, drawY: number, now: number): void {
        const context = this.highlightContext;
        const target = this.ctx;
        if (!context || !target) return;
        if (this.highlightCanvas.width !== frame.width) this.highlightCanvas.width = frame.width;
        if (this.highlightCanvas.height !== frame.height) this.highlightCanvas.height = frame.height;
        context.clearRect(0, 0, frame.width, frame.height);
        this.drawPersonFrame(frame, context, 0, 0);
        context.save();
        context.globalCompositeOperation = "source-in";
        context.fillStyle = "rgb(255 220 96)";
        context.fillRect(0, 0, frame.width, frame.height);
        context.restore();

        const pulse = 0.35 + (Math.sin(now / 120) + 1) * 0.12;
        target.save();
        target.globalAlpha = pulse;
        target.shadowColor = "rgb(255 220 96)";
        target.shadowBlur = 6;
        target.globalCompositeOperation = "screen";
        target.drawImage(this.highlightCanvas, drawX, drawY);
        target.restore();
    }

    private drawPerson(runtime: PersonRuntime, now: number) {
        const ctx = this.ctx;
        if (!ctx) return;
        const frame = this.personRenderFrame(runtime, now);
        const drawX = frame.worldX - this.offset.x;
        const drawY = frame.worldY - this.offset.y;

        if (drawX > this.canvas.width || drawY > this.canvas.height) return;
        if (drawX + frame.width < 0 || drawY + frame.height < 0) return;

        this.drawPersonFrame(frame, ctx, drawX, drawY);
        if (this.flashInteractiveObjects && runtime !== this.player) this.drawPersonHighlight(frame, drawX, drawY, now);
        this.drawOccluders({
            x: frame.worldX,
            y: frame.worldY,
            width: frame.width,
            height: frame.height,
        }, frame.anchorX, frame.anchorY);
    }


    private drawAnimation(levelAnimation: LevelAnimation, now: number) {
        const animation = levelAnimation.animation;
        if (!this.ctx || !animation) return;

        const x = levelAnimation.position.x - this.offset.x;
        const y = levelAnimation.position.y - this.offset.y;
        if (x > this.canvas.width || y > this.canvas.height) return;
        if (x + animation.frameWidth < 0 || y + animation.frameHeight < 0) return;

        animation.draw(this.ctx, x, y);
        if (this.flashInteractiveObjects && this.interactiveAnimations.has(levelAnimation)) {
            const context = this.highlightContext;
            if (context) {
                if (this.highlightCanvas.width !== animation.frameWidth) this.highlightCanvas.width = animation.frameWidth;
                if (this.highlightCanvas.height !== animation.frameHeight) this.highlightCanvas.height = animation.frameHeight;
                context.clearRect(0, 0, animation.frameWidth, animation.frameHeight);
                animation.draw(context, 0, 0);
                this.tintAndDrawHighlight(x, y, animation.frameWidth, animation.frameHeight, now);
            }
        }
        this.drawOccluders({
            x: levelAnimation.position.x,
            y: levelAnimation.position.y,
            width: animation.frameWidth,
            height: animation.frameHeight,
        }, levelAnimation.position.x + animation.frameWidth / 2, levelAnimation.position.y + animation.frameHeight);
    }

    private refreshInteractiveVisuals(): void {
        const statics = new Set<LevelStatic>();
        const animations = new Set<LevelAnimation>();
        const backgrounds: BackgroundSpriteHighlight[] = [];
        const triggerMasks: LevelTriggerMask[] = [];
        const distanceToBounds = (point: Readonly<WorldPosition>, x: number, y: number, width: number, height: number): number => {
            const dx = Math.max(x - point.x, 0, point.x - (x + width));
            const dy = Math.max(y - point.y, 0, point.y - (y + height));
            return Math.hypot(dx, dy);
        };

        for (const trigger of this.levelData.sefData.triggers) {
            if (!trigger.inventoryName) continue;
            const runtime = this.triggers.get(trigger.name);
            if (runtime && (!runtime.active || !runtime.visible)) continue;
            const exactMask = this.levelData.triggerMasks.find(
                (candidate) => candidate.name.toLowerCase() === trigger.name.toLowerCase(),
            );
            if (exactMask) {
                triggerMasks.push(exactMask);
                continue;
            }
            const points: WorldPosition[] = [];
            if (trigger.cellsName) {
                for (const cell of this.levelData.sefData.cellGroups[trigger.cellsName] ?? []) points.push(cellToWorld(cell));
            }
            if (points.length === 0) continue;

            let closestStatic: LevelStatic | undefined;
            let closestAnimation: LevelAnimation | undefined;
            let closestDistance = Number.POSITIVE_INFINITY;
            for (const levelStatic of this.levelData.levelStatics) {
                if (!levelStatic.image || this.doorsByStatic.has(levelStatic)) continue;
                const distance = Math.min(...points.map((point) => distanceToBounds(
                    point, levelStatic.position.x, levelStatic.position.y, levelStatic.image!.width, levelStatic.image!.height,
                )));
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestStatic = levelStatic;
                    closestAnimation = undefined;
                }
            }
            for (const levelAnimation of this.levelData.levelAnimations) {
                const animation = levelAnimation.animation;
                if (!animation || animation.frameWidth <= 0 || animation.frameHeight <= 0) continue;
                const distance = Math.min(...points.map((point) => distanceToBounds(
                    point, levelAnimation.position.x, levelAnimation.position.y, animation.frameWidth, animation.frameHeight,
                )));
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestStatic = undefined;
                    closestAnimation = levelAnimation;
                }
            }
            if (closestDistance <= WORLD_CELL_HEIGHT * 2) {
                if (closestStatic) statics.add(closestStatic);
                if (closestAnimation) animations.add(closestAnimation);
                continue;
            }

            const description = this.levelData.lvlData.triggerDescription.find(
                (candidate) => candidate.name.toLowerCase() === trigger.name.toLowerCase(),
            );
            if (!description) continue;
            const anchor = points[0];
            const width = Math.min(180, Math.max(48, Math.abs(anchor.x - description.position.x) + 32));
            const height = Math.min(180, Math.max(48, Math.abs(anchor.y - description.position.y)));
            backgrounds.push({
                x: description.position.x,
                y: description.position.y,
                width,
                height,
                centerX: width / 2,
                centerY: height * 0.55,
            });
        }
        this.interactiveStatics = statics;
        this.interactiveAnimations = animations;
        this.interactiveBackgrounds = backgrounds;
        this.interactiveTriggerMasks = triggerMasks;
    }

    private tintAndDrawHighlight(drawX: number, drawY: number, width: number, height: number, now: number, strength = 1): void {
        const context = this.highlightContext;
        const target = this.ctx;
        if (!context || !target) return;
        context.save();
        context.globalCompositeOperation = "source-in";
        context.fillStyle = "rgb(255 220 96)";
        context.fillRect(0, 0, width, height);
        context.restore();
        target.save();
        target.globalAlpha = (0.35 + (Math.sin(now / 120) + 1) * 0.12) * strength;
        target.shadowColor = "rgb(255 220 96)";
        target.shadowBlur = 6;
        target.globalCompositeOperation = "screen";
        target.drawImage(this.highlightCanvas, drawX, drawY);
        target.restore();
    }

    private drawStaticHighlight(image: HTMLCanvasElement, drawX: number, drawY: number, now: number): void {
        const context = this.highlightContext;
        if (!context) return;
        if (this.highlightCanvas.width !== image.width) this.highlightCanvas.width = image.width;
        if (this.highlightCanvas.height !== image.height) this.highlightCanvas.height = image.height;
        context.clearRect(0, 0, image.width, image.height);
        context.drawImage(image, 0, 0);
        this.tintAndDrawHighlight(drawX, drawY, image.width, image.height, now);
    }

    private isStaticVisible(levelStatic: LevelStatic): boolean {
        for (const door of this.doors.values()) {
            if (door.levelDoor.levelStatic === levelStatic) return !door.opened;
        }
        return true;
    }

    private drawStatic(levelStatic: LevelStatic, now: number) {
        const image = levelStatic.image;
        if (!this.ctx || !image) return;

        const x = levelStatic.position.x - this.offset.x;
        const y = levelStatic.position.y - this.offset.y;
        if (x > this.canvas.width || y > this.canvas.height) return;
        if (x + image.width < 0 || y + image.height < 0) return;
        this.ctx.drawImage(image, x, y);
        if (this.flashInteractiveObjects && this.interactiveStatics.has(levelStatic)) this.drawStaticHighlight(image, x, y, now);
        this.drawOccluders({
            x: levelStatic.position.x,
            y: levelStatic.position.y,
            width: image.width,
            height: image.height,
        }, levelStatic.position.x + image.width / 2, levelStatic.position.y + image.height);
    }

    private drawOccluders(bounds: RenderBounds, anchorX: number, anchorY: number) {
        const ctx = this.ctx;
        if (!ctx) return;

        const occluders = this.findOccluders(bounds, anchorX, anchorY);
        if (occluders.length === 0) return;

        ctx.save();
        ctx.globalAlpha = this.transparentOccluders ? 0.58 : 1;
        ctx.beginPath();
        ctx.rect(bounds.x - this.offset.x, bounds.y - this.offset.y, bounds.width, bounds.height);
        ctx.clip();
        for (const maskIndex of occluders) {
            const mask = this.levelData.levelMasks[maskIndex];
            if (!mask?.foreground) continue;
            ctx.drawImage(mask.foreground, mask.x - this.offset.x, mask.y - this.offset.y);
        }
        ctx.restore();
    }

    private findOccluders(bounds: RenderBounds, anchorX: number, anchorY: number): readonly number[] {
        const header = this.levelData.lvlData.maskHDR;
        if (header.chunks.length === 0 || header.width <= 0 || header.height <= 0) return [];

        const left = Math.max(0, Math.floor(bounds.x / WORLD_CHUNK_WIDTH));
        const right = Math.min(header.width - 1, Math.floor((bounds.x + Math.max(1, bounds.width) - 1) / WORLD_CHUNK_WIDTH));
        const anchorCellX = Math.floor(anchorX / WORLD_CHUNK_WIDTH);
        const anchorCellY = Math.floor(anchorY / WORLD_CHUNK_HEIGHT);
        if (left > right || anchorCellX < 0 || anchorCellY < 0 || anchorCellX >= header.width || anchorCellY >= header.height) return [];

        const key = `${left}:${right}:${anchorCellX}:${anchorCellY}`;
        const cached = this.occluderCache.get(key);
        if (cached) return cached;

        const indexes = new Set<number>();
        for (let x = left; x <= right; x++) {
            for (let slot = 0; slot < 4; slot++) {
                const tile = this.getMaskTile(x, anchorCellY, slot);
                if (!tile || (tile.terrain & 1) === 0 || tile.maskIndex < 0) continue;
                if (!this.maskExtendsPastAnchor(x, anchorCellY, slot, tile.maskIndex, anchorCellX)) continue;
                if (this.levelData.levelMasks[tile.maskIndex]?.foreground) indexes.add(tile.maskIndex);
            }
        }

        const result = [...indexes];
        this.occluderCache.set(key, result);
        return result;
    }

    private maskExtendsPastAnchor(startX: number, startY: number, slot: number, maskIndex: number, anchorCellX: number): boolean {
        const header = this.levelData.lvlData.maskHDR;
        let horizontalBoundary = false;
        for (let x = startX; x < header.width; x++) {
            const tile = this.getMaskTile(x, startY, slot);
            if (!this.isMatchingMask(tile, maskIndex)) break;
            if ((tile.terrain & 2) !== 0 && anchorCellX <= x) {
                horizontalBoundary = true;
                break;
            }
        }
        if (!horizontalBoundary) return false;

        for (let y = startY; y < header.height; y++) {
            const tile = this.getMaskTile(startX, y, slot);
            if (!this.isMatchingMask(tile, maskIndex)) break;
            if ((tile.terrain & 2) !== 0) return true;
        }
        return false;
    }

    private getMaskTile(x: number, y: number, slot: number): MHDRTile | undefined {
        const header = this.levelData.lvlData.maskHDR;
        return header.chunks[x * header.height + y]?.[slot];
    }

    private isMatchingMask(tile: MHDRTile | undefined, maskIndex: number): tile is MHDRTile {
        return tile !== undefined && (tile.terrain & 1) !== 0 && tile.maskIndex === maskIndex;
    }


    private directionFromVector(x: number, y: number): Direction {
        const octant = Math.round(Math.atan2(y, x) / (Math.PI / 4));
        const directions: Direction[] = ["RIGHT", "DOWN_RIGHT", "DOWN", "DOWN_LEFT", "LEFT", "UP_LEFT", "UP", "UP_RIGHT"];
        return directions[(octant + 8) % 8];
    }

    private walkDirectionFrame(direction: Direction): DirectionFrame {
        const frames: Record<Direction, DirectionFrame> = {
            UP: { row: 0, mirrored: false },
            UP_LEFT: { row: 2, mirrored: false },
            LEFT: { row: 4, mirrored: false },
            DOWN_LEFT: { row: 6, mirrored: false },
            DOWN: { row: 8, mirrored: false },
            DOWN_RIGHT: { row: 6, mirrored: true },
            RIGHT: { row: 4, mirrored: true },
            UP_RIGHT: { row: 2, mirrored: true },
        };
        return frames[direction];
    }

    private idleDirectionFrame(direction: Direction): DirectionFrame {
        const frames: Record<Direction, DirectionFrame> = {
            UP: { row: 0, mirrored: false },
            UP_LEFT: { row: 1, mirrored: false },
            LEFT: { row: 2, mirrored: false },
            DOWN_LEFT: { row: 3, mirrored: false },
            DOWN: { row: 4, mirrored: false },
            DOWN_RIGHT: { row: 3, mirrored: true },
            RIGHT: { row: 2, mirrored: true },
            UP_RIGHT: { row: 1, mirrored: true },
        };
        return frames[direction];
    }
}
