import { MapScroller } from "./MapScroller";
import type { LevelAnimation, LevelData, LevelDoor, LevelStatic, LevelTriggerMask } from "./Level.ts";
import { loadHeroSprites, type LevelPerson } from "./PersonSprite.ts";
import type { Direction, TilePosition } from "./parsers/SEFParser.ts";
import type { PADAnimation } from "./parsers/PersonAnimationParser.ts";
import { WorldGrid } from "./WorldGrid.ts";
import {
    cellToWorld,
    worldToCell,
    WORLD_CHUNK_HEIGHT,
    WORLD_CHUNK_WIDTH,
    type WorldPosition,
} from "./WorldCoordinates.ts";
import { expandDoorBarrierCells, type ScenarioTriggerState } from "./ScenarioRuntime.ts";
import { CursorType } from "../enums/CursorTypes.ts";
import type { CombatAnimationKind, CombatMovementResult } from "./GameStateRuntime.ts";
import { MagicEffectAnimation } from "./MagicEffectAnimation.ts";
import { originalCombatDistance } from "./systems/Combat.ts";
import {
    buildNativeAlternateMaskTiles,
    findNativeOccluders,
    type NativeOccluderSelection,
} from "./MaskCompositorRuntime.ts";
import { gameAnimationSpeed, gameScrollSpeed } from "./GameSettingsRuntime.ts";
import { drawNativeNightShading } from "./NativeDayNight.ts";

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
    maskCells: readonly TilePosition[];
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

const personAnimationFrameDuration = (metadata: PADAnimation, playbackRate = 1): number =>
    Math.max(1, metadata.frameDuration / playbackRate);

const personAnimationClipDuration = (metadata: PADAnimation, playbackRate = 1): number =>
    personAnimationFrameDuration(metadata, playbackRate) * metadata.frameCount;

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
    readonly targetName?: string;
    readonly position?: Readonly<WorldPosition>;
    readonly startedAt: number;
}

type HoverTargetKind = "person" | "door" | "trigger" | "reference" | "ground";

// [INFERENCE] Native duplicate-object arbitration is not present in the available Client listing.
// Cycle exact-name overlaps on a stable cadence so both persistent instances remain selectable.
const DUPLICATE_TRIGGER_SELECTION_MS = 300;


type RenderKind = "static" | "animation" | "person";

type RenderItem =
    | { kind: "static"; levelStatic: LevelStatic }
    | { kind: "animation"; levelAnimation: LevelAnimation }
    | { kind: "person"; runtime: PersonRuntime };

const renderPriority: Record<RenderKind, number> = {
    static: 0,
    animation: 1,
    person: 2,
};
const STATIC_SCENERY_VISIBLE = 0x2;

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
    private backgroundStatics: readonly LevelStatic[];
    private lastFrameTime = performance.now();
    private simulationAccumulatorMs = 0;
    private simulationTick = 0;
    private readonly occluderCache = new Map<string, readonly NativeOccluderSelection[]>();
    private alternateMaskTiles: ReadonlySet<string> = new Set();
    private readonly onSimulationStep?: (tick: number, simulationTimeMs: number, playerPosition: Readonly<WorldPosition>, clockTimeMs: number) => void;
    private readonly onPersonClick?: (person: LevelPerson) => void;
    private readonly onPersonAttack?: (person: LevelPerson) => void;
    private readonly onCombatMovementStep?: () => boolean;
    private readonly getCombatVisualState?: (technicalName: string) => Readonly<{ relation: "friendly" | "neutral" | "hostile"; current: boolean; active: boolean }>;
    private readonly hiddenPersons = new Set<string>();
    private readonly deadPersons = new Set<string>();
    private pendingPersonInteraction: PendingInteraction | undefined;
    private readonly doors = new Map<string, DoorRuntime>();
    private readonly doorsByStatic = new Map<LevelStatic, DoorRuntime>();
    private readonly triggers = new Map<string, TriggerRuntime>();
    private triggerMasksByName = new Map<string, LevelTriggerMask>();
    private interactiveTriggerMasks: readonly LevelTriggerMask[] = [];
    private hoveredTargetKey = "";
    private hoveredTargetKind: HoverTargetKind | undefined;
    private hoveredTargetName: string | undefined;
    private pointerWorldPosition: WorldPosition | undefined;
    private duplicateTriggerSelectionCycle = -1;
    private hoveredPerson: PersonRuntime | undefined;
    private currentCursor = CursorType.NORMAL;
    private flashInteractiveObjects = false;
    private readonly highlightCanvas = document.createElement("canvas");
    private readonly highlightContext = this.highlightCanvas.getContext("2d");
    private combatMode = false;
    private magicTargeting = false;
    private aiTurn = false;
    private currentCombatant: string | undefined;
    private dialogueSpeakerCombatantId: string | undefined;
    private playerCombatChargedTargetIndex = -1;
    private readonly magicEffects: ActiveMagicAnimation[] = [];
    private paused = false;

    private readonly simulationStepMs = 1000 / 60;
    private animationSpeed = 1;
    private alwaysRun = false;
    private showHints = true;
    private transparentOccluders = true;
    private dayNightEnabled = true;
    private readonly interactionRangeCells = 6;
    private readonly randomMovementRadius = 8;

    private readonly handleClick = (event: MouseEvent) => {
        if (this.paused || this.aiTurn) return;
        if (event.button !== 0) return;
        if (this.deadPersons.has("hero")) return;
        const clickPosition = this.eventWorldPosition(event);
        const clickedPerson = this.findPersonAt(clickPosition);
        const deadPerson = clickedPerson ? this.deadPersons.has(clickedPerson.person.combatantId.toLowerCase()) : false;
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
            if (clickedTrigger.transition) this.movePlayerIntoTransition(clickedTrigger, event.detail > 1);
            else this.beginTriggerInteraction(clickedTrigger, event.detail > 1);
            return;
        }

        this.pendingPersonInteraction = undefined;
        this.movePlayerTo(clickPosition, event.detail > 1);
    };

    private readonly handleMouseMove = (event: MouseEvent) => {
        if (this.paused) return;
        if (this.aiTurn) {
            this.setHoveredTarget();
            this.changeCursor(CursorType.NPC_TURN);
            return;
        }
        const local = this.eventCanvasPosition(event);
        const edgeCursor = this.edgeCursor(local);

        if (edgeCursor) {
            this.setHoveredTarget();
            this.changeCursor(edgeCursor);
            return;
        }
        const world = { x: local.x + this.offset.x, y: local.y + this.offset.y };
        this.pointerWorldPosition = world;
        const person = this.findPersonAt(world);
        if (person) {
            this.setHoveredTarget("person", person.person.combatantId, person);
            this.changeCursor(this.deadPersons.has(person.person.combatantId.toLowerCase()) ? CursorType.TAKE : this.magicTargeting ? CursorType.CAST : event.shiftKey || this.combatMode ? CursorType.ATTACK : person.person.scriptDialog ? CursorType.TALK : CursorType.NPC_TURN);
            return;
        }
        const door = this.findDoorAt(world);
        if (door) {
            this.setHoveredTarget("door", door.name);
            this.changeCursor(CursorType.OPEN);
            return;
        }
        const trigger = this.findTriggerAt(world, true);
        const reference = trigger ? this.isReferenceTrigger(trigger) : false;
        if (trigger) this.setHoveredTarget(reference ? "reference" : "trigger", trigger.name, undefined, trigger.instanceKey);
        else {
            const groundStatus = this.combatMode && !this.magicTargeting ? this.combatGroundHoverStatus(world) : undefined;
            this.setHoveredTarget(groundStatus ? "ground" : undefined, groundStatus);
        }
        this.changeCursor(trigger ? this.cursorForTrigger(trigger) : CursorType.NORMAL);
    };

    private readonly handleMouseLeave = () => {
        this.pointerWorldPosition = undefined;
        this.setHoveredTarget();
        this.changeCursor(CursorType.NORMAL);
    };

    private readonly handleKeyDown = (event: KeyboardEvent) => {
        if (this.paused || event.key !== "Alt") return;
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
        onSimulationStep?: (tick: number, simulationTimeMs: number, playerPosition: Readonly<WorldPosition>, clockTimeMs: number) => void,
        onPersonClick?: (person: LevelPerson) => void,
        onPersonAttack?: (person: LevelPerson) => void,
        private readonly onDoorClick?: (name: string) => void,
        private readonly onTriggerClick?: (name: string) => void,
        private readonly onCursorChange?: (cursor: CursorType) => void,
        private readonly onHoverTarget?: (kind?: HoverTargetKind, name?: string, doorOpened?: boolean) => void,
        private readonly getHeroAttackDistance?: () => number,
        private readonly onPersonPositionChange?: (technicalName: string, position: Readonly<WorldPosition>) => void,
        onCombatMovementStep?: () => boolean,
        getCombatVisualState?: (technicalName: string) => Readonly<{ relation: "friendly" | "neutral" | "hostile"; current: boolean; active: boolean }>,
        private readonly getHeroCombatActionPoints?: () => number,
        private readonly onHeroCombatActionComplete?: () => boolean,
        private readonly getElapsedMinutes?: () => number,
    ) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.levelData = levelData;
        this.onSimulationStep = onSimulationStep;
        this.onPersonClick = onPersonClick;
        this.onPersonAttack = onPersonAttack;
        this.onCombatMovementStep = onCombatMovementStep;
        this.getCombatVisualState = getCombatVisualState;
        this.persons = this.createPersonRuntimes(levelData);
        this.player = this.createPlayerRuntime(levelData.player);
        this.backgroundStatics = this.createBackgroundStatics(levelData);
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
        this.backgroundStatics = this.createBackgroundStatics(levelData);
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
        this.setHoveredTarget();
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
        this.animationSpeed = gameAnimationSpeed(settings);
        this.scroller.setScrollSpeed(gameScrollSpeed(settings));
        this.alwaysRun = settings[12] === true;
        this.showHints = settings[13] !== false;
        this.transparentOccluders = settings[14] === true;
        if (!this.showHints) this.setHoveredTarget();
        this.dayNightEnabled = settings[4] === true;
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
                .map(({ person, position }) => ({
                    ...position,
                    relation: this.getCombatVisualState?.(person.combatantId).relation ?? "friendly",
                })),
            transitions: [...this.triggers.values()]
                .filter((trigger) => trigger.active && trigger.transition)
                .flatMap((trigger) => {
                    const mask = this.triggerMasksByName.get(trigger.name.toLowerCase());
                    if (mask) {
                        return [{
                            x: mask.position.x + mask.image.width / 2,
                            y: mask.position.y + mask.image.height / 2,
                        }];
                    }
                    if (trigger.cells.length === 0) return [];
                    const total = trigger.cells.reduce(
                        (sum, cell) => {
                            const position = cellToWorld(cell);
                            return { x: sum.x + position.x, y: sum.y + position.y };
                        },
                        { x: 0, y: 0 },
                    );
                    return [{
                        x: total.x / trigger.cells.length,
                        y: total.y / trigger.cells.length,
                    }];
                }),
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

    public playPersonCombatAnimation(technicalName: string, kind: CombatAnimationKind): number | undefined {
        const normalized = technicalName.toLowerCase();
        const runtime = normalized === "hero"
            ? this.player
            : this.persons.find((candidate) => candidate.person.combatantId.toLowerCase() === normalized);
        if (!runtime) return undefined;
        if (kind === "die") this.deadPersons.add(normalized);
        runtime.combatAnimation = { kind, startedAt: this.simulationTick * this.simulationStepMs };
        runtime.route = [];
        runtime.targetIndex = 0;
        runtime.moving = false;
        runtime.running = false;
        const metadata = kind === "attack" ? runtime.person.sprites.attack
            : kind === "cast" ? runtime.person.sprites.cast
                : kind === "suffer" ? runtime.person.sprites.suffer : runtime.person.sprites.die;
        return metadata ? personAnimationClipDuration(metadata) : undefined;
    }

    public faceCombatant(technicalName: string, targetPosition: Readonly<WorldPosition>): void {
        const normalized = technicalName.toLowerCase();
        const runtime = normalized === "hero"
            ? this.player
            : this.persons.find((candidate) => candidate.person.combatantId.toLowerCase() === normalized);
        if (!runtime) return;
        runtime.direction = this.directionFromVector(targetPosition.x - runtime.position.x, targetPosition.y - runtime.position.y);
    }
    public setDialogueSpeaker(combatantId?: string): void {
        this.dialogueSpeakerCombatantId = combatantId?.toLowerCase();
        if (!this.dialogueSpeakerCombatantId) return;
        const runtime = this.persons.find(
            (candidate) => candidate.person.combatantId.toLowerCase() === this.dialogueSpeakerCombatantId,
        );
        if (runtime) runtime.moving = false;
    }


    public canCombatantSee(technicalName: string, targetPosition: Readonly<WorldPosition>): boolean {
        const normalized = technicalName.toLowerCase();
        const runtime = normalized === "hero"
            ? this.player
            : this.persons.find((candidate) => candidate.person.combatantId.toLowerCase() === normalized);
        return runtime !== undefined
            && this.worldGrid.hasLineOfSight(worldToCell(runtime.position), worldToCell(targetPosition));
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

    public playMagicEffectAt(technicalName: string, position: Readonly<WorldPosition>): void {
        void MagicEffectAnimation.load(technicalName).then((animation) => {
            this.magicEffects.push({
                animation,
                position: { ...position },
                startedAt: this.simulationTick * this.simulationStepMs,
            });
        }).catch((error) => console.warn(`Не удалось загрузить анимацию магии ${technicalName}`, error));
    }

    public setDoorState(name: string, opened: boolean, cells?: readonly TilePosition[], activationCells?: readonly TilePosition[]): void {
        const door = this.doors.get(name);
        if (!door) return;
        door.opened = opened;
        if (cells) {
            door.maskCells = cells.map((cell) => ({ ...cell }));
            door.cells = expandDoorBarrierCells(cells);
        }
        if (activationCells) door.activationCells = activationCells.map((cell) => ({ ...cell }));
        door.depth = doorRenderDepth(door.cells, door.levelDoor.levelStatic.position.y + (door.levelDoor.levelStatic.image?.height ?? 0));
        this.refreshAlternateMaskTiles();
        if (this.showHints && this.hoveredTargetKey.toLowerCase() === `door:${name}`.toLowerCase()) {
            this.onHoverTarget?.("door", name, opened);
        }
    }

    public setTriggerState(trigger: ScenarioTriggerState): void {
        const existing = this.triggers.get(trigger.instanceKey);
        if (existing) Object.assign(existing, trigger, { cells: trigger.cells.map((cell) => ({ ...cell })) });
        else this.triggers.set(trigger.instanceKey, { ...trigger, cells: trigger.cells.map((cell) => ({ ...cell })) });
        this.refreshInteractiveVisuals();
    }

    public setCombatMode(active: boolean): void {
        this.combatMode = active;
        if (!active && this.currentCursor === CursorType.ATTACK) this.changeCursor(CursorType.NORMAL);
    }

    public setMagicTargeting(active: boolean): void {
        this.magicTargeting = active;
        if (!active && this.currentCursor === CursorType.CAST) this.changeCursor(this.combatMode ? CursorType.ATTACK : CursorType.NORMAL);
    }

    public setPaused(paused: boolean): void {
        if (this.paused === paused) return;
        this.paused = paused;
        this.flashInteractiveObjects = false;
        this.setHoveredTarget();
        this.changeCursor(CursorType.NORMAL);
        if (!paused) {
            this.lastFrameTime = performance.now();
            this.simulationAccumulatorMs = 0;
        }
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
        if (this.paused) return;
        const ctx = this.ctx;
        if (!ctx) return;

        const frameTime = performance.now();
        const elapsedMs = Math.min(Math.max(frameTime - this.lastFrameTime, 0), 100);
        this.lastFrameTime = frameTime;
        this.simulationAccumulatorMs += elapsedMs;
        while (this.simulationAccumulatorMs >= this.simulationStepMs) {
            this.advanceSimulation(frameTime);
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
        for (const levelStatic of this.backgroundStatics) this.drawBackgroundStatic(levelStatic);

        this.renderQueue.sort((left, right) => {
            const depthDelta = this.renderDepth(left) - this.renderDepth(right);
            return depthDelta || renderPriority[left.kind] - renderPriority[right.kind];
        });
        const highlightTime = this.simulationTick * this.simulationStepMs;
        for (const item of this.renderQueue) this.drawRenderItem(item, highlightTime);
        this.drawMagicEffects(highlightTime);
        this.drawTriggerMaskHighlights(highlightTime);
        this.drawDoorMaskHighlights(highlightTime);
        if (this.dayNightEnabled) {
            drawNativeNightShading(
                ctx,
                this.canvas.width,
                this.canvas.height,
                this.getElapsedMinutes?.() ?? 0,
                this.levelData.sefData.internalLocation === true,
            );
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
            const position = effect.position ?? (effect.targetName ? this.personWorldPosition(effect.targetName) : undefined);
            if (!position) continue;
            effect.animation.draw(context, position.x - this.offset.x, position.y - this.offset.y, elapsedMs);
        }
    }

    private personWorldPosition(technicalName: string): Readonly<WorldPosition> | undefined {
        const normalized = technicalName.toLowerCase();
        if (normalized === "hero") return this.player.position;
        return this.persons.find((candidate) => candidate.person.combatantId.toLowerCase() === normalized)?.position;
    }


    private drawTriggerMaskHighlights(now: number): void {
        const context = this.highlightContext;
        if (!context) return;
        for (const trigger of this.interactiveTriggerMasks) {
            const hovered = this.hoveredTargetKind === "trigger" && this.hoveredTargetName?.toLowerCase() === trigger.name.toLowerCase();
            if (!this.flashInteractiveObjects && !hovered) continue;
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
            context.globalCompositeOperation = "destination-in";
            context.drawImage(trigger.image, 0, 0);
            context.restore();
            this.drawPreparedHighlight(
                drawX,
                drawY,
                now,
                hovered || (this.flashInteractiveObjects && !hovered),
                this.triggers.get(trigger.name)?.transition ? 1 : undefined,
            );
        }
    }
    private drawDoorMaskHighlights(now: number): void {
        const context = this.highlightContext;
        if (!context) return;
        for (const door of this.doors.values()) {
            const hovered = this.hoveredTargetKey.toLowerCase() === `door:${door.name}`.toLowerCase();
            if (!this.flashInteractiveObjects && !hovered) continue;
            const mask = this.doorInteractionMask(door);
            if (!mask) continue;
            const drawX = mask.position.x - this.offset.x;
            const drawY = mask.position.y - this.offset.y;
            if (drawX > this.canvas.width || drawY > this.canvas.height
                || drawX + mask.image.width < 0 || drawY + mask.image.height < 0) continue;

            if (this.highlightCanvas.width !== mask.image.width) this.highlightCanvas.width = mask.image.width;
            if (this.highlightCanvas.height !== mask.image.height) this.highlightCanvas.height = mask.image.height;
            context.clearRect(0, 0, mask.image.width, mask.image.height);
            context.drawImage(
                this.levelData.image,
                mask.position.x, mask.position.y, mask.image.width, mask.image.height,
                0, 0, mask.image.width, mask.image.height,
            );
            if (!door.opened) {
                const levelStatic = door.levelDoor.levelStatic;
                if (levelStatic.image) {
                    context.drawImage(
                        levelStatic.image,
                        levelStatic.position.x - mask.position.x,
                        levelStatic.position.y - mask.position.y,
                    );
                }
            }
            context.save();
            context.globalCompositeOperation = "destination-in";
            context.drawImage(mask.image, 0, 0);
            context.restore();
            this.drawPreparedHighlight(drawX, drawY, now, true);
        }
    }


    private advanceSimulation(clockTimeMs: number) {
        this.simulationTick++;
        const simulationTime = this.simulationTick * this.simulationStepMs;
        this.updatePersons(simulationTime, this.simulationStepMs / 1000);
        this.updatePlayer(this.simulationStepMs / 1000);
        const edgeDirection = this.scroller.update();
        if (!edgeDirection && this.isEdgeCursor(this.currentCursor)) this.changeCursor(CursorType.NORMAL);

        const selectionCycle = Math.floor(simulationTime / DUPLICATE_TRIGGER_SELECTION_MS);
        if (selectionCycle !== this.duplicateTriggerSelectionCycle) {
            this.duplicateTriggerSelectionCycle = selectionCycle;
            this.refreshDuplicateTriggerHover();
        }

        for (const levelAnimation of this.levelData.levelAnimations) {
            levelAnimation.animation?.update(this.simulationStepMs * this.animationSpeed);
        }
        this.onSimulationStep?.(this.simulationTick, simulationTime, this.getPlayerWorldPosition(), clockTimeMs);
    }

    private createBackgroundStatics(levelData: LevelData): readonly LevelStatic[] {
        const doorStatics = new Set(levelData.levelDoors.map((door) => door.levelStatic));
        return levelData.levelStatics.filter((levelStatic) =>
            !doorStatics.has(levelStatic)
            && (levelStatic.param1 & STATIC_SCENERY_VISIBLE) !== 0
            && levelStatic.image !== undefined);
    }

    private createRenderQueue(levelData: LevelData): RenderItem[] {
        const queue: RenderItem[] = [];
        const doorStatics = new Set(levelData.levelDoors.map((door) => door.levelStatic));
        for (const levelStatic of doorStatics) {
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
        this.triggerMasksByName = new Map(
            levelData.triggerMasks.map((mask) => [mask.name.toLowerCase(), mask]),
        );
        for (const levelDoor of levelData.levelDoors) {
            const maskCells = (levelData.sefData.cellGroups[levelDoor.cellsName] ?? []).map((cell) => ({ ...cell }));
            const cells = expandDoorBarrierCells(maskCells);
            const runtime: DoorRuntime = {
                name: levelDoor.sefName,
                levelDoor,
                cells,
                maskCells,
                activationCells: (levelData.lvlData.cellGroups[levelDoor.cellGroup] ?? []).map((cell) => ({ ...cell })),
                opened: levelDoor.isOpened ?? false,
                depth: doorRenderDepth(cells, levelDoor.levelStatic.position.y + (levelDoor.levelStatic.image?.height ?? 0)),
            };
            this.doors.set(levelDoor.sefName, runtime);
            this.doorsByStatic.set(levelDoor.levelStatic, runtime);
        }
        this.refreshAlternateMaskTiles();
        this.triggers.clear();
        const occurrences = new Map<string, number>();
        for (const trigger of levelData.sefData.triggers) {
            const occurrence = occurrences.get(trigger.name) ?? 0;
            occurrences.set(trigger.name, occurrence + 1);
            const instanceKey = occurrence === 0 ? trigger.name : `${trigger.name}#${occurrence}`;
            const exactMask = this.triggerMasksByName.get(trigger.name.toLowerCase());
            const cells = trigger.cellsName
                ? levelData.sefData.cellGroups[trigger.cellsName] ?? []
                : exactMask ? levelData.triggerCells[exactMask.name] ?? [] : [];
            this.triggers.set(instanceKey, {
                instanceKey,
                name: trigger.name,
                active: trigger.isActive ?? true,
                visible: trigger.isVisible ?? true,
                transition: trigger.isTransition ?? false,
                cells: cells.map((cell) => ({ ...cell })),
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
                if (this.isStaticVisible(item.levelStatic)) this.drawStatic(item.levelStatic);
                break;
            case "animation":
                this.drawAnimation(item.levelAnimation);
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

    private planRoute(runtime: PersonRuntime, destination: Readonly<WorldPosition>, exactGoal = false): boolean {
        const path = this.worldGrid.findPath(worldToCell(runtime.position), worldToCell(destination), this.blockedCells(runtime), exactGoal);
        if (path.length === 0) return false;
        runtime.route = path.slice(1).map(cellToWorld);
        runtime.targetIndex = 0;
        runtime.moving = runtime.route.length > 0;
        return true;
    }

    private movePlayerTo(destination: Readonly<WorldPosition>, running: boolean, exactGoal = true): boolean {
        if (!this.planRoute(this.player, destination, exactGoal)) return false;
        this.playerCombatChargedTargetIndex = -1;
        this.player.waitUntil = 0;
        this.player.running = (running || this.alwaysRun) && this.player.moving;
        return true;
    }

    private movePlayerIntoTransition(trigger: TriggerRuntime, running: boolean): void {
        this.pendingPersonInteraction = undefined;
        const playerCell = worldToCell(this.player.position);
        const cells = [...trigger.cells].sort((left, right) =>
            Math.hypot(left.x - playerCell.x, left.y - playerCell.y)
            - Math.hypot(right.x - playerCell.x, right.y - playerCell.y));
        for (const cell of cells) {
            if (this.movePlayerTo(cellToWorld(cell), running, true)) return;
        }
    }

    private beginPersonInteraction(runtime: PersonRuntime, attack: boolean, running: boolean): void {
        this.pendingPersonInteraction = { kind: "person", runtime, attack };
        if (this.completePendingInteraction()) return;
        this.movePlayerTo(runtime.position, running, false);
        if (!this.player.moving) this.pendingPersonInteraction = undefined;
    }

    private beginDoorInteraction(door: DoorRuntime, running: boolean): void {
        this.pendingPersonInteraction = { kind: "door", door };
        if (this.completePendingInteraction()) return;
        this.movePlayerTo(this.nearestInteractionPosition(door.activationCells.length > 0 ? door.activationCells : door.cells), running, false);
        if (!this.player.moving) this.pendingPersonInteraction = undefined;
    }

    private beginTriggerInteraction(trigger: TriggerRuntime, running: boolean): void {
        this.pendingPersonInteraction = { kind: "trigger", trigger };
        if (this.completePendingInteraction()) return;
        this.movePlayerTo(this.nearestInteractionPosition(trigger.cells), running, false);
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
        if (interaction.kind === "trigger" && !this.isTriggerInteractive(interaction.trigger)) return false;
        const target = this.interactionPosition(interaction);
        const playerCell = worldToCell(this.player.position);
        const targetCell = worldToCell(target);
        const distance = interaction.kind === "person" && interaction.attack
            ? originalCombatDistance(playerCell, targetCell)
            : Math.hypot(targetCell.x - playerCell.x, targetCell.y - playerCell.y);
        const maximumDistance = interaction.kind === "person" && interaction.attack
            ? this.getHeroAttackDistance?.() ?? 6
            : this.interactionRangeCells;
        if (distance > maximumDistance) return false;

        this.pendingPersonInteraction = undefined;
        this.player.route = [];
        this.player.targetIndex = 0;
        this.player.moving = false;
        this.player.running = false;
        this.player.direction = this.directionFromVector(target.x - this.player.position.x, target.y - this.player.position.y);
        if (interaction.kind === "person") {
            interaction.runtime.direction = this.directionFromVector(
                this.player.position.x - interaction.runtime.position.x,
                this.player.position.y - interaction.runtime.position.y,
            );
            if (interaction.attack) this.onPersonAttack?.(interaction.runtime.person);
            else this.onPersonClick?.(interaction.runtime.person);
        } else if (interaction.kind === "door") {
            this.onDoorClick?.(interaction.door.name);
        } else {
            this.onTriggerClick?.(interaction.trigger.instanceKey);
        }
        return true;
    }

    public setCombatState(active: boolean, currentCombatant?: string): void {
        const enteringCombat = active && !this.combatMode;
        const previousCombatant = this.currentCombatant;
        this.combatMode = active;
        this.currentCombatant = currentCombatant;
        this.aiTurn = active && currentCombatant !== undefined && currentCombatant !== "hero";
        if (previousCombatant && previousCombatant !== currentCombatant && previousCombatant !== "hero") {
            const previousRuntime = this.persons.find((candidate) => candidate.person.combatantId === previousCombatant);
            if (previousRuntime?.route.length === 0) previousRuntime.moving = false;
        }
        if (enteringCombat) {
            for (const runtime of this.persons) {
                runtime.route = [];
                runtime.targetIndex = 0;
                runtime.moving = false;
            }
        }
        if (this.aiTurn) {
            this.player.route = [];
            this.player.targetIndex = 0;
            this.pendingPersonInteraction = undefined;
            this.changeCursor(CursorType.NPC_TURN);
        } else if (this.currentCursor === CursorType.NPC_TURN) {
            this.changeCursor(CursorType.NORMAL);
        }
    }

    public stepCombatant(technicalName: string, targetPosition: Readonly<WorldPosition>, away: boolean): CombatMovementResult | undefined {
        const runtime = this.persons.find((candidate) => candidate.person.combatantId.toLowerCase() === technicalName.toLowerCase());
        if (!runtime) return undefined;
        const current = worldToCell(runtime.position);
        const target = worldToCell(targetPosition);
        const blocked = this.blockedCells(runtime);
        let next: TilePosition | undefined;
        if (away) {
            const candidates: TilePosition[] = [];
            for (let y = -1; y <= 1; y += 1) {
                for (let x = -1; x <= 1; x += 1) {
                    if (x !== 0 || y !== 0) candidates.push({ x: current.x + x, y: current.y + y });
                }
            }
            next = candidates
                .filter((candidate) => this.worldGrid.findPath(current, candidate, blocked).length === 2)
                .sort((left, right) => originalCombatDistance(right, target) - originalCombatDistance(left, target))[0];
        } else {
            const routes: TilePosition[][] = [];
            for (let y = -1; y <= 1; y += 1) {
                for (let x = -1; x <= 1; x += 1) {
                    if (x === 0 && y === 0) continue;
                    const destination = { x: target.x + x, y: target.y + y };
                    const route = this.worldGrid.findPath(current, destination, blocked);
                    if (route.length > 1) routes.push(route);
                }
            }
            routes.sort((left, right) => left.length - right.length);
            next = routes[0]?.[1];
        }
        if (!next) return undefined;
        const destination = cellToWorld(next);
        const durationMs = this.movementDurationMs(runtime, destination);
        runtime.route = [destination];
        runtime.targetIndex = 0;
        runtime.moving = true;
        runtime.direction = this.directionFromVector(destination.x - runtime.position.x, destination.y - runtime.position.y);
        return { position: destination, durationMs };
    }

    private updatePlayer(deltaSeconds: number) {
        this.player.moving = false;
        if (this.player.combatAnimation) return;
        if (this.completePendingInteraction()) return;

        let remainingMs = deltaSeconds * 1000;
        while (remainingMs > 0.001) {
            const target = this.player.route[this.player.targetIndex];
            if (!target) {
                this.player.running = false;
                this.pendingPersonInteraction = undefined;
                return;
            }

            if (this.combatMode && this.playerCombatChargedTargetIndex !== this.player.targetIndex) {
                if (this.onCombatMovementStep && !this.onCombatMovementStep()) {
                    this.player.route = [];
                    this.player.targetIndex = 0;
                    this.player.running = false;
                    this.pendingPersonInteraction = undefined;
                    return;
                }
                this.playerCombatChargedTargetIndex = this.player.targetIndex;
            }

            remainingMs = this.moveRuntimeTowards(this.player, target, remainingMs);
            if (Math.hypot(target.x - this.player.position.x, target.y - this.player.position.y) >= 0.001) return;
            this.player.targetIndex++;
            if (this.combatMode && this.onHeroCombatActionComplete?.()) return;
            if (this.completePendingInteraction()) return;
        }
        this.player.moving = this.player.targetIndex < this.player.route.length;
        if (!this.player.moving) {
            this.player.running = false;
            this.pendingPersonInteraction = undefined;
        }
    }

    private updatePersons(now: number, deltaSeconds: number) {
        for (const runtime of this.persons) {
            runtime.moving = false;
            if (this.hiddenPersons.has(runtime.person.name)) continue;
            if (runtime.person.combatantId.toLowerCase() === this.dialogueSpeakerCombatantId) continue;
            if (this.pendingPersonInteraction?.kind === "person"
                && !this.pendingPersonInteraction.attack
                && this.pendingPersonInteraction.runtime === runtime) continue;
            if (runtime.combatAnimation) continue;

            let remainingMs = deltaSeconds * 1000;
            if (this.combatMode) {
                const combatTarget = runtime.route[runtime.targetIndex];
                if (!combatTarget) continue;
                this.moveRuntimeTowards(runtime, combatTarget, remainingMs);
                if (Math.hypot(combatTarget.x - runtime.position.x, combatTarget.y - runtime.position.y) < 0.001) {
                    runtime.route = [];
                    runtime.targetIndex = 0;
                }
                continue;
            }
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

            while (remainingMs > 0.001) {
                const target = runtime.route[runtime.targetIndex];
                if (!target) break;
                const targetCell = worldToCell(target);
                if (this.blockedCells(runtime).has(this.worldGrid.index(targetCell))) {
                    runtime.route = [];
                    runtime.targetIndex = 0;
                    runtime.waitUntil = now + 250;
                    break;
                }
                remainingMs = this.moveRuntimeTowards(runtime, target, remainingMs);
                if (Math.hypot(target.x - runtime.position.x, target.y - runtime.position.y) >= 0.001) break;
                runtime.targetIndex++;
                if (runtime.targetIndex >= runtime.route.length) {
                    this.finishNpcRoute(runtime, now);
                    break;
                }
            }
        }
    }

    private moveRuntimeTowards(runtime: PersonRuntime, target: Readonly<WorldPosition>, elapsedMs: number): number {
        const dx = target.x - runtime.position.x;
        const dy = target.y - runtime.position.y;
        const durationMs = this.movementDurationMs(runtime, target);
        runtime.direction = this.directionFromVector(dx, dy);
        runtime.moving = true;
        if (durationMs <= elapsedMs || durationMs < 0.001) {
            runtime.position.x = target.x;
            runtime.position.y = target.y;
            if (runtime !== this.player) this.onPersonPositionChange?.(runtime.person.combatantId, runtime.position);
            return Math.max(0, elapsedMs - durationMs);
        }
        const ratio = elapsedMs / durationMs;
        runtime.position.x += dx * ratio;
        runtime.position.y += dy * ratio;
        if (runtime !== this.player) this.onPersonPositionChange?.(runtime.person.combatantId, runtime.position);
        return 0;
    }

    private movementDurationMs(runtime: PersonRuntime, target: Readonly<WorldPosition>): number {
        const metadata = this.combatMode
            ? runtime.person.sprites.turnWalk ?? runtime.person.sprites.walk
            : runtime.running
                ? runtime.person.sprites.run ?? runtime.person.sprites.walk
                : runtime.person.sprites.walk;
        const dx = Math.abs(target.x - runtime.position.x);
        const dy = Math.abs(target.y - runtime.position.y);
        const xDuration = dx > 0.001 && metadata.movementX > 0 ? dx * metadata.frameDuration / metadata.movementX : 0;
        const yDuration = dy > 0.001 && metadata.movementY > 0 ? dy * metadata.frameDuration / metadata.movementY : 0;
        return Math.max(xDuration, yDuration);
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
        if (!destination || !this.planRoute(runtime, destination) || !runtime.moving) {
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

    private doorInteractionMask(door: DoorRuntime): LevelTriggerMask | undefined {
        const action = door.opened ? door.levelDoor.closeAction : door.levelDoor.openAction;
        return this.triggerMasksByName.get(action.toLowerCase());
    }

    private findDoorAt(position: Readonly<WorldPosition>): DoorRuntime | undefined {
        for (const door of this.doors.values()) {
            const mask = this.doorInteractionMask(door);
            if (!mask) continue;
            const x = Math.floor(position.x - mask.position.x);
            const y = Math.floor(position.y - mask.position.y);
            if (x < 0 || y < 0 || x >= mask.image.width || y >= mask.image.height) continue;
            const context = mask.image.getContext("2d", { willReadFrequently: true });
            if ((context?.getImageData(x, y, 1, 1).data[3] ?? 0) > 16) return door;
        }
        return undefined;
    }

    private isTriggerInteractive(trigger: TriggerRuntime): boolean {
        // Server trigger flags are independent: transitions commonly omit
        // is_visible, while Client.dll 0x12039ecc still selects active
        // transition flags 0x100 | 0x400 for minimap/interaction feedback.
        return trigger.active && (trigger.visible || trigger.transition);
    }

    private isReferenceTrigger(trigger: TriggerRuntime): boolean {
        const mask = this.triggerMasksByName.get(trigger.name.toLowerCase());
        return trigger.active
            && mask?.param1 === 5
            && trigger.literaryName !== undefined
            && !trigger.transition
            && !trigger.inventoryName
            && !trigger.scriptName
            && (!trigger.cursorName || trigger.cursorName.toUpperCase() === "CURSOR_NORMAL");
    }


    private findTriggerAt(position: Readonly<WorldPosition>, includeReferences = false): TriggerRuntime | undefined {
        const hits: TriggerRuntime[] = [];
        for (const trigger of this.triggers.values()) {
            if (!this.isTriggerInteractive(trigger) && !(includeReferences && this.isReferenceTrigger(trigger))) continue;
            const mask = this.triggerMasksByName.get(trigger.name.toLowerCase());
            if (mask) {
                const x = Math.floor(position.x - mask.position.x);
                const y = Math.floor(position.y - mask.position.y);
                if (x < 0 || y < 0 || x >= mask.image.width || y >= mask.image.height) continue;
                const context = mask.image.getContext("2d", { willReadFrequently: true });
                if ((context?.getImageData(x, y, 1, 1).data[3] ?? 0) > 16) hits.push(trigger);
                continue;
            }
            const cell = worldToCell(position);
            if (trigger.cells.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)) hits.push(trigger);
        }
        const first = hits[0];
        if (!first) return undefined;
        const duplicates = hits.filter((candidate) => candidate.name.toLowerCase() === first.name.toLowerCase());
        if (duplicates.length < 2) return first;
        const cycle = Math.floor(this.simulationTick * this.simulationStepMs / DUPLICATE_TRIGGER_SELECTION_MS);
        return duplicates[cycle % duplicates.length];
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

    private refreshDuplicateTriggerHover(): void {
        if (!this.pointerWorldPosition || this.hoveredTargetKind !== "trigger" && this.hoveredTargetKind !== "reference") return;
        const trigger = this.findTriggerAt(this.pointerWorldPosition, true);
        if (!trigger) return;
        const reference = this.isReferenceTrigger(trigger);
        this.setHoveredTarget(reference ? "reference" : "trigger", trigger.name, undefined, trigger.instanceKey);
        this.changeCursor(this.cursorForTrigger(trigger));
    }

    private setHoveredTarget(kind?: HoverTargetKind, name?: string, person?: PersonRuntime, identity?: string): void {
        const key = kind && name ? `${kind}:${identity ?? name}` : "";
        const nextPerson = kind === "person" ? person : undefined;
        const personChanged = nextPerson !== this.hoveredPerson;
        this.hoveredPerson = nextPerson;
        this.hoveredTargetKind = kind;
        this.hoveredTargetName = name;
        if (key === this.hoveredTargetKey && !personChanged) return;
        this.hoveredTargetKey = key;
        const doorOpened = kind === "door" && name ? this.doors.get(name)?.opened : undefined;
        if (this.showHints) this.onHoverTarget?.(kind, name, doorOpened);
        else this.onHoverTarget?.();
    }

    private combatGroundHoverStatus(world: Readonly<WorldPosition>): string | undefined {
        const remaining = this.getHeroCombatActionPoints?.();
        if (remaining === undefined) return undefined;
        const route = this.worldGrid.findPath(worldToCell(this.player.position), worldToCell(world), this.blockedCells(this.player), true);
        if (route.length === 0) return undefined;
        const required = route.length - 1;
        if (required === 0) return undefined;
        return required > remaining ? "unreachable" : String(required);
    }

    private cursorForTrigger(trigger: TriggerRuntime): CursorType {
        switch (trigger.cursorName?.toUpperCase()) {
            case "CURSOR_TAKE": return CursorType.TAKE;
            case "CURSOR_CANT_TAKE": return CursorType.CANT_TAKE;
            case "CURSOR_ANOTHER_LOCATION": return CursorType.ANOTHER_LOCATION;
            case "CURSOR_OPEN": return CursorType.OPEN;
            case "CURSOR_TALK": return CursorType.TALK;
            default: return trigger.transition ? CursorType.ANOTHER_LOCATION : trigger.inventoryName ? CursorType.TAKE : CursorType.NORMAL;
        }
    }

    private changeCursor(cursor: CursorType): void {
        if (cursor === this.currentCursor) return;
        this.currentCursor = cursor;
        this.onCursorChange?.(cursor);
    }

    private finishCombatAnimation(runtime: PersonRuntime): void {
        runtime.combatAnimation = undefined;
        if (runtime === this.player) this.onHeroCombatActionComplete?.();
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
                : combat.kind === "cast"
                    ? { metadata: sprites.cast, image: sprites.castImage }
                    : combat.kind === "suffer"
                        ? { metadata: sprites.suffer, image: sprites.sufferImage }
                        : { metadata: sprites.die, image: sprites.dieImage };
            if (clip.metadata && clip.image) {
                const elapsed = Math.max(0, now - combat.startedAt);
                const frameDuration = personAnimationFrameDuration(clip.metadata);
                const clipDuration = personAnimationClipDuration(clip.metadata);
                if (combat.kind === "die" || elapsed < clipDuration) {
                    metadata = clip.metadata;
                    image = clip.image;
                    frame = combat.kind === "die" && elapsed >= clipDuration
                        ? clip.metadata.frameCount - 1
                        : Math.min(clip.metadata.frameCount - 1, Math.floor(elapsed / frameDuration));
                } else this.finishCombatAnimation(runtime);
            } else if (combat.kind !== "die") this.finishCombatAnimation(runtime);
        }

        if (!metadata || !image || frame === undefined) {
            const useTurnWalk = this.combatMode && runtime.moving && sprites.turnWalk && sprites.turnWalkImage;
            const useTurnIdle = this.combatMode && !runtime.moving && sprites.turnIdle && sprites.turnIdleImage;
            const hasRunAnimation = !this.combatMode && runtime.running && sprites.run !== undefined && sprites.runImage !== undefined;
            metadata = useTurnWalk ? sprites.turnWalk! : useTurnIdle ? sprites.turnIdle! : hasRunAnimation ? sprites.run! : runtime.moving ? sprites.walk : sprites.idle;
            image = useTurnWalk ? sprites.turnWalkImage! : useTurnIdle ? sprites.turnIdleImage! : hasRunAnimation ? sprites.runImage! : runtime.moving ? sprites.walkImage : sprites.idleImage;
            const fallbackPlaybackRate = runtime.running && !hasRunAnimation ? 2 : 1;
            const frameDuration = personAnimationFrameDuration(metadata, fallbackPlaybackRate);
            frame = Math.floor(now / frameDuration) % metadata.frameCount;
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

    private drawPersonHighlight(runtime: PersonRuntime, frame: PersonRenderFrame, drawX: number, drawY: number): void {
        const state = this.getCombatVisualState?.(runtime.person.combatantId);
        const context = this.highlightContext;
        const target = this.ctx;
        if (!state || !context || !target) return;
        if (this.highlightCanvas.width !== frame.width) this.highlightCanvas.width = frame.width;
        if (this.highlightCanvas.height !== frame.height) this.highlightCanvas.height = frame.height;
        context.clearRect(0, 0, frame.width, frame.height);
        this.drawPersonFrame(frame, context, 0, 0);
        context.globalCompositeOperation = "source-in";
        context.fillStyle = state.relation === "hostile" ? "#ff2418"
            : state.relation === "friendly" ? "#42ff38" : "#ffe43b";
        context.fillRect(0, 0, frame.width, frame.height);
        context.globalCompositeOperation = "source-over";

        target.save();
        target.globalAlpha = 0.48;
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
        if (runtime !== this.player && this.hoveredPerson === runtime) {
            this.drawPersonHighlight(runtime, frame, drawX, drawY);
        }
        this.drawOccluders({
            x: frame.worldX,
            y: frame.worldY,
            width: frame.width,
            height: frame.height,
        }, frame.anchorX, frame.anchorY);
    }


    private drawAnimation(levelAnimation: LevelAnimation) {
        const animation = levelAnimation.animation;
        if (!this.ctx || !animation) return;

        const x = levelAnimation.position.x - this.offset.x;
        const y = levelAnimation.position.y - this.offset.y;
        if (x > this.canvas.width || y > this.canvas.height) return;
        if (x + animation.frameWidth < 0 || y + animation.frameHeight < 0) return;

        animation.draw(this.ctx, x, y);
        this.drawOccluders({
            x: levelAnimation.position.x,
            y: levelAnimation.position.y,
            width: animation.frameWidth,
            height: animation.frameHeight,
        }, levelAnimation.position.x + animation.frameWidth / 2, levelAnimation.position.y + animation.frameHeight);
    }

    private refreshInteractiveVisuals(): void {
        const triggerMasks: LevelTriggerMask[] = [];
        const added = new Set<string>();
        for (const trigger of this.triggers.values()) {
            if (!trigger.inventoryName && !trigger.transition || !this.isTriggerInteractive(trigger)) continue;
            const normalizedName = trigger.name.toLowerCase();
            if (added.has(normalizedName)) continue;
            const exactMask = this.triggerMasksByName.get(normalizedName);
            if (!exactMask) continue;
            triggerMasks.push(exactMask);
            added.add(normalizedName);
        }
        this.interactiveTriggerMasks = triggerMasks;
    }

    private drawPreparedHighlight(drawX: number, drawY: number, now: number, steady: boolean, opacity?: number): void {
        const target = this.ctx;
        if (!target) return;
        target.save();
        target.globalAlpha = opacity ?? (steady ? 0.48 : 0.2 + (Math.sin(now / 120) + 1) * 0.2);
        target.globalCompositeOperation = "screen";
        target.drawImage(this.highlightCanvas, drawX, drawY);
        target.restore();
    }


    private isStaticVisible(levelStatic: LevelStatic): boolean {
        for (const door of this.doors.values()) {
            if (door.levelDoor.levelStatic === levelStatic) return !door.opened;
        }
        return true;
    }

    private drawBackgroundStatic(levelStatic: LevelStatic): void {
        const image = levelStatic.image;
        if (!this.ctx || !image) return;

        const x = levelStatic.position.x - this.offset.x;
        const y = levelStatic.position.y - this.offset.y;
        if (x > this.canvas.width || y > this.canvas.height) return;
        if (x + image.width < 0 || y + image.height < 0) return;
        this.ctx.drawImage(image, x, y);
    }

    private drawStatic(levelStatic: LevelStatic) {
        const image = levelStatic.image;
        if (!this.ctx || !image) return;

        const x = levelStatic.position.x - this.offset.x;
        const y = levelStatic.position.y - this.offset.y;
        if (x > this.canvas.width || y > this.canvas.height) return;
        if (x + image.width < 0 || y + image.height < 0) return;
        this.ctx.drawImage(image, x, y);
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
        for (const { maskIndex, alternate } of occluders) {
            const mask = this.levelData.levelMasks[maskIndex];
            const foreground = alternate ? mask?.alternateForeground : mask?.foreground;
            if (!foreground || !mask) continue;
            ctx.drawImage(foreground, mask.x - this.offset.x, mask.y - this.offset.y);
        }
        ctx.restore();
    }

    private findOccluders(bounds: RenderBounds, anchorX: number, anchorY: number): readonly NativeOccluderSelection[] {
        const header = this.levelData.lvlData.maskHDR;
        const left = Math.max(0, Math.floor(bounds.x / WORLD_CHUNK_WIDTH));
        const right = Math.min(header.width - 1, Math.floor((bounds.x + Math.max(1, bounds.width) - 1) / WORLD_CHUNK_WIDTH));
        const anchorCellX = Math.floor(anchorX / WORLD_CHUNK_WIDTH);
        const anchorCellY = Math.floor(anchorY / WORLD_CHUNK_HEIGHT);
        const key = `${left}:${right}:${anchorCellX}:${anchorCellY}`;
        const cached = this.occluderCache.get(key);
        if (cached) return cached;
        const result = findNativeOccluders(
            header,
            this.levelData.levelMasks,
            bounds,
            anchorX,
            anchorY,
            this.alternateMaskTiles,
        );
        this.occluderCache.set(key, result);
        return result;
    }

    private refreshAlternateMaskTiles(): void {
        this.alternateMaskTiles = buildNativeAlternateMaskTiles(
            this.levelData.lvlData.maskHDR,
            this.levelData.levelMasks,
            [...this.doors.values()].map(({ opened, maskCells }) => ({ opened, cells: maskCells })),
        );
        this.occluderCache.clear();
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
