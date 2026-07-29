import type { Door, LVLData, TriggerDescription } from "./parsers/LVLParser.ts";
import type { Direction, RouteType, SEFData, SEFDoor, SEFPerson, SEFTrigger, TilePosition } from "./parsers/SEFParser.ts";
import { cellToWorld, worldToCell, type WorldPosition } from "./WorldCoordinates.ts";

export type ScenarioTriggerPhase = "enter" | "leave" | "click";

export interface ScenarioTriggerState {
    name: string;
    active: boolean;
    visible: boolean;
    transition: boolean;
    cells: readonly TilePosition[];
    literaryName?: number;
    cursorName?: string;
    scriptName?: string;
    inventoryName?: string;
}

export interface ScenarioTriggerEvent {
    phase: ScenarioTriggerPhase;
    trigger: ScenarioTriggerState;
    cell: TilePosition;
}

export interface ScenarioScriptRequest extends ScenarioTriggerEvent {
    scriptName: string;
}

export interface ScenarioTransitionRequest {
    trigger: ScenarioTriggerState;
    cell: TilePosition;
    scriptName?: string;
}

export interface ScenarioDoorState {
    name: string;
    opened: boolean;
    cells: readonly TilePosition[];
    activationCells: readonly TilePosition[];
}

export interface ScenarioDoorChange {
    door: ScenarioDoorState;
    previousOpened: boolean;
}

export interface ScenarioTriggerChange {
    readonly trigger: ScenarioTriggerState;
}

export interface NpcRouteState {
    index: number;
    name: string;
    mode: RouteType;
    position: TilePosition;
    worldPosition: WorldPosition;
    direction: Direction;
    route: readonly TilePosition[];
    nextUpdateAt: number;
}

export interface ScenarioRuntimeOptions {
    /** A caller-owned, seeded source that must return values in [0, 1). */
    random: () => number;
    onScript?: (request: ScenarioScriptRequest) => void;
    onTransition?: (request: ScenarioTransitionRequest) => void;
    onDoorChange?: (change: ScenarioDoorChange) => void;
    onTriggerChange?: (change: ScenarioTriggerChange) => void;
}

interface TriggerRecord {
    readonly definition: SEFTrigger;
    readonly cells: readonly TilePosition[];
    active: boolean;
    visible: boolean;
}

interface DoorRecord {
    readonly name: string;
    readonly sefDoor: SEFDoor;
    readonly lvlDoor: Door;
    readonly cells: readonly TilePosition[];
    readonly activationCells: readonly TilePosition[];
    opened: boolean;
}

interface NpcRecord {
    readonly index: number;
    readonly person: SEFPerson;
    readonly mode: RouteType;
    readonly anchor: TilePosition;
    readonly route: readonly TilePosition[];
    position: TilePosition;
    direction: Direction;
    targetIndex: number;
    routeStep: 1 | -1;
    nextUpdateAt: number;
}

const directions: readonly Direction[] = [
    "UP",
    "UP_RIGHT",
    "RIGHT",
    "DOWN_RIGHT",
    "DOWN",
    "DOWN_LEFT",
    "LEFT",
    "UP_LEFT",
];

const cellKey = ({ x, y }: TilePosition) => `${x},${y}`;

const cloneCell = ({ x, y }: TilePosition): TilePosition => ({ x, y });

export const expandDoorBarrierCells = (cells: readonly TilePosition[]): readonly TilePosition[] => {
    if (cells.length !== 2) return cells.map(cloneCell);

    const [start, end] = cells;
    const result: TilePosition[] = [];
    let x = start.x;
    let y = start.y;
    const deltaX = Math.abs(end.x - start.x);
    const deltaY = -Math.abs(end.y - start.y);
    const stepX = start.x < end.x ? 1 : -1;
    const stepY = start.y < end.y ? 1 : -1;
    let error = deltaX + deltaY;

    while (true) {
        result.push({ x, y });
        if (x === end.x && y === end.y) return result;
        const doubledError = error * 2;
        if (doubledError >= deltaY) {
            error += deltaY;
            x += stepX;
        }
        if (doubledError <= deltaX) {
            error += deltaX;
            y += stepY;
        }
    }
};

/**
 * Keeps scenario-only state separate from rendering. All input positions and
 * hit tests use map cells; world coordinates are accepted only as a convenience.
 */
export class ScenarioRuntime {
    private readonly triggers = new Map<string, TriggerRecord>();
    private readonly triggersByCell = new Map<string, readonly TriggerRecord[]>();
    private readonly doors = new Map<string, DoorRecord>();
    private readonly doorActions = new Map<string, { door: DoorRecord; opened: boolean }>();
    private readonly persons: NpcRecord[];
    private playerCell: TilePosition | undefined;
    private activeTriggerNames = new Set<string>();
    private lastRouteUpdateAt = 0;

    public constructor(
        private readonly sefData: SEFData,
        private readonly lvlData: LVLData,
        private readonly triggerCells: Readonly<Record<string, readonly TilePosition[]>>,
        private readonly options: ScenarioRuntimeOptions,
    ) {
        if (typeof options.random !== "function") throw new Error("ScenarioRuntime requires a seeded random function");
        this.validateMapSize();
        this.createTriggers();
        this.createDoors();
        this.persons = sefData.persons.map((person, index) => this.createPerson(person, index));
    }

    public getPlayerCell(): TilePosition | undefined {
        return this.playerCell && cloneCell(this.playerCell);
    }

    public setPlayerWorldPosition(position: WorldPosition): ScenarioTriggerEvent[] {
        return this.setPlayerCell(worldToCell(position));
    }

    /** Updates trigger membership and emits enter/leave events only at region boundaries. */
    public setPlayerCell(cell: TilePosition): ScenarioTriggerEvent[] {
        const nextCell = this.requireCell(cell, "Player cell");
        const nextTriggers = this.activeTriggersAt(nextCell);
        const nextNames = new Set(nextTriggers.map((trigger) => trigger.definition.name));
        const previousCell = this.playerCell;
        const events: ScenarioTriggerEvent[] = [];

        if (previousCell) {
            for (const name of this.activeTriggerNames) {
                if (nextNames.has(name)) continue;
                const trigger = this.triggers.get(name);
                if (!trigger) continue;
                const event = this.createTriggerEvent("leave", trigger, nextCell);
                events.push(event);
                this.emitScript(event, trigger.definition.scriptName);
            }
        }

        this.playerCell = nextCell;
        this.activeTriggerNames = nextNames;

        for (const trigger of nextTriggers) {
            if (previousCell && this.activeTriggerNames.has(trigger.definition.name) && this.wasInsideTrigger(trigger.definition.name, previousCell)) continue;
            const event = this.createTriggerEvent("enter", trigger, nextCell);
            events.push(event);
            this.applyDoorAction(trigger.definition.name);
            this.emitScript(event, trigger.definition.scriptName);
            if (trigger.definition.isTransition) this.emitTransition(trigger, nextCell);
        }

        return events;
    }

    public getTriggerStates(): readonly ScenarioTriggerState[] {
        return [...this.triggers.values()].map((trigger) => this.createTriggerState(trigger));
    }

    public getTrigger(name: string): ScenarioTriggerState {
        return this.createTriggerState(this.requireTrigger(name));
    }

    public getTriggersAt(cell: TilePosition): readonly ScenarioTriggerState[] {
        return this.activeTriggersAt(this.requireCell(cell, "Trigger cell")).map((trigger) => this.createTriggerState(trigger));
    }

    public interactTrigger(name: string): ScenarioTriggerState {
        const trigger = this.requireTrigger(name);
        if (!trigger.active) return this.createTriggerState(trigger);
        if (trigger.definition.scriptName) {
            const cell = this.playerCell ?? trigger.cells[0];
            this.options.onScript?.({
                phase: "click",
                trigger: this.createTriggerState(trigger),
                cell: cloneCell(cell),
                scriptName: trigger.definition.scriptName,
            });
        }
        return this.createTriggerState(trigger);
    }

    public setTriggerActive(name: string, active: boolean): ScenarioTriggerState {
        const trigger = this.requireTrigger(name);
        trigger.active = active;
        this.refreshActiveTriggers();
        const state = this.createTriggerState(trigger);
        this.options.onTriggerChange?.({ trigger: state });
        return state;
    }

    public setTriggerVisible(name: string, visible: boolean): ScenarioTriggerState {
        const trigger = this.requireTrigger(name);
        trigger.visible = visible;
        const state = this.createTriggerState(trigger);
        this.options.onTriggerChange?.({ trigger: state });
        return state;
    }

    public getDoorStates(): readonly ScenarioDoorState[] {
        return [...this.doors.values()].map((door) => this.createDoorState(door));
    }

    public getDoor(name: string): ScenarioDoorState {
        return this.createDoorState(this.requireDoor(name));
    }

    public isDoorOpened(name: string): boolean {
        return this.requireDoor(name).opened;
    }

    public setDoorOpened(name: string, opened: boolean): ScenarioDoorState {
        const door = this.requireDoor(name);
        if (door.opened === opened) return this.createDoorState(door);
        const previousOpened = door.opened;
        door.opened = opened;
        this.options.onDoorChange?.({ door: this.createDoorState(door), previousOpened });
        return this.createDoorState(door);
    }

    public toggleDoor(name: string): ScenarioDoorState {
        const door = this.requireDoor(name);
        return this.setDoorOpened(name, !door.opened);
    }

    public getNpcRouteState(index: number): NpcRouteState {
        return this.createNpcRouteState(this.requirePerson(index));
    }

    public getNpcRouteStates(): readonly NpcRouteState[] {
        return this.persons.map((person) => this.createNpcRouteState(person));
    }

    /** Advances each NPC at most once when its delay has elapsed. */
    public advanceRoutes(nowMs: number): readonly NpcRouteState[] {
        if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error(`Route time must be a non-negative finite number; received ${nowMs}`);
        if (nowMs < this.lastRouteUpdateAt) throw new Error(`Route time must be monotonic; received ${nowMs} after ${this.lastRouteUpdateAt}`);
        this.lastRouteUpdateAt = nowMs;

        for (const person of this.persons) {
            if (nowMs < person.nextUpdateAt) continue;
            this.advancePerson(person);
            person.nextUpdateAt = nowMs + this.sampleDelay(person.person);
        }

        return this.getNpcRouteStates();
    }

    private createTriggers() {
        for (const definition of this.sefData.triggers) {
            if (this.triggers.has(definition.name)) continue;
            const cells = this.resolveTriggerCells(definition);
            const trigger: TriggerRecord = {
                definition,
                cells,
                active: definition.isActive ?? false,
                visible: definition.isVisible ?? false,
            };
            this.triggers.set(definition.name, trigger);
            for (const cell of cells) {
                const key = cellKey(cell);
                const existing = this.triggersByCell.get(key) ?? [];
                this.triggersByCell.set(key, [...existing, trigger]);
            }
        }
    }

    private createDoors() {
        for (const lvlDoor of this.lvlData.doors) {
            if (this.doors.has(lvlDoor.sefName)) throw new Error(`Duplicate joined door ${lvlDoor.sefName}`);
            const sefDoor = this.sefData.doors[lvlDoor.sefName];
            if (!sefDoor) continue;
            const cells = sefDoor.cellsName
                ? expandDoorBarrierCells(this.resolveCells(this.sefData.cellGroups, sefDoor.cellsName, `SEF door ${lvlDoor.sefName}`))
                : [];
            const activationCells = this.resolveCells(this.lvlData.cellGroups, lvlDoor.cellGroup, `LVL door ${lvlDoor.sefName}`);
            const door: DoorRecord = {
                name: lvlDoor.sefName,
                sefDoor,
                lvlDoor,
                cells,
                activationCells,
                opened: sefDoor.isOpened ?? false,
            };
            this.doors.set(door.name, door);
            this.registerDoorAction(lvlDoor.openAction, door, true);
            this.registerDoorAction(lvlDoor.closeAction, door, false);
        }
    }

    private createPerson(person: SEFPerson, index: number): NpcRecord {
        const anchor = this.requireCell(person.position, `NPC ${index} position`);
        const mode = person.routeType ?? "STAY";
        const routeName = person.route ?? (this.sefData.cellGroups.track ? "track" : undefined);
        const route = mode === "MOVED" || mode === "MOVED_FLIP"
            ? this.resolveCells(this.sefData.cellGroups, routeName, `NPC ${index} route`)
            : [];
        const targetIndex = route.length === 0 ? 0 : this.initialTargetIndex(anchor, route);
        return {
            index,
            person,
            mode,
            anchor,
            route,
            position: cloneCell(anchor),
            direction: person.direction,
            targetIndex,
            routeStep: 1,
            nextUpdateAt: 0,
        };
    }

    private resolveTriggerCells(trigger: SEFTrigger): readonly TilePosition[] {
        if (trigger.cellsName) return this.resolveCells(this.sefData.cellGroups, trigger.cellsName, `Trigger ${trigger.name}`);
        if (this.lvlData.cellGroups[trigger.name]) return this.resolveCells(this.lvlData.cellGroups, trigger.name, `Trigger ${trigger.name}`);

        const groupName = this.inferTriggerCellGroupName(trigger.name);
        if (groupName && this.lvlData.cellGroups[groupName]) {
            return this.resolveCells(this.lvlData.cellGroups, groupName, `Trigger ${trigger.name}`);
        }

        const maskCells = this.triggerCells[trigger.name];
        if (maskCells?.length) return maskCells.map((cell) => this.requireCell(cell, `Trigger ${trigger.name} mask cell`));

        const description = this.findTriggerDescription(trigger.name);
        if (description) return [this.requireCell(worldToCell(description.position), `Trigger ${trigger.name} position`)];
        throw new Error(`Trigger ${trigger.name} has neither a SEF cell group nor an LVL trigger description`);
    }

    private resolveCells(groups: Record<string, TilePosition[]>, name: string | undefined, owner: string): readonly TilePosition[] {
        if (!name) throw new Error(`${owner} is missing its cell group name`);
        const cells = groups[name];
        if (!cells) throw new Error(`${owner} references missing cell group ${name}`);
        if (cells.length === 0) throw new Error(`${owner} references empty cell group ${name}`);
        return cells.map((cell) => this.requireCell(cell, `${owner} cell`));
    }

    private findTriggerDescription(name: string): TriggerDescription | undefined {
        return this.lvlData.triggerDescription.find((description) => description.name === name);
    }

    private inferTriggerCellGroupName(name: string): string | undefined {
        const match = /^.+_T\d+_(.+)$/.exec(name);
        return match ? `cellgrp_${match[1]}` : undefined;
    }

    private registerDoorAction(action: string, door: DoorRecord, opened: boolean) {
        if (!action) return;
        const existing = this.doorActions.get(action);
        if (existing && (existing.door !== door || existing.opened !== opened)) {
            throw new Error(`Door action ${action} has conflicting door states`);
        }
        this.doorActions.set(action, { door, opened });
    }

    private activeTriggersAt(cell: TilePosition): readonly TriggerRecord[] {
        return (this.triggersByCell.get(cellKey(cell)) ?? []).filter((trigger) => trigger.active);
    }

    private wasInsideTrigger(name: string, cell: TilePosition): boolean {
        return (this.triggersByCell.get(cellKey(cell)) ?? []).some((trigger) => trigger.definition.name === name && trigger.active);
    }

    private refreshActiveTriggers() {
        if (!this.playerCell) return;
        this.activeTriggerNames = new Set(this.activeTriggersAt(this.playerCell).map((trigger) => trigger.definition.name));
    }

    private createTriggerEvent(phase: ScenarioTriggerPhase, trigger: TriggerRecord, cell: TilePosition): ScenarioTriggerEvent {
        return { phase, trigger: this.createTriggerState(trigger), cell: cloneCell(cell) };
    }

    private emitScript(event: ScenarioTriggerEvent, scriptName: string | undefined) {
        if (scriptName) this.options.onScript?.({ ...event, scriptName });
    }

    private emitTransition(trigger: TriggerRecord, cell: TilePosition) {
        this.options.onTransition?.({
            trigger: this.createTriggerState(trigger),
            cell: cloneCell(cell),
            scriptName: trigger.definition.scriptName,
        });
    }

    private applyDoorAction(triggerName: string) {
        const action = this.doorActions.get(triggerName);
        if (action) this.setDoorOpened(action.door.name, action.opened);
    }

    private advancePerson(person: NpcRecord) {
        switch (person.mode) {
            case "STAY":
                return;
            case "STAY_ROTATE":
                person.direction = directions[(directions.indexOf(person.direction) + 1) % directions.length];
                return;
            case "MOVED":
                this.moveAlongRoute(person, false);
                return;
            case "MOVED_FLIP":
                this.moveAlongRoute(person, true);
                return;
            case "RANDOM":
                this.moveRandomly(person);
                return;
            case "RANDOM_RADIUS":
                this.moveWithinRadius(person);
                return;
        }
    }

    private moveAlongRoute(person: NpcRecord, flip: boolean) {
        const target = person.route[person.targetIndex];
        if (!target) throw new Error(`NPC ${person.index} has an invalid route target`);
        const deltaX = target.x - person.position.x;
        const deltaY = target.y - person.position.y;
        person.position = cloneCell(target);
        person.direction = this.directionForDelta(deltaX, deltaY, person.direction);
        if (person.route.length < 2) return;

        if (!flip) {
            person.targetIndex = (person.targetIndex + 1) % person.route.length;
            return;
        }
        if (person.targetIndex === person.route.length - 1) person.routeStep = -1;
        else if (person.targetIndex === 0) person.routeStep = 1;
        person.targetIndex += person.routeStep;
    }

    private moveRandomly(person: NpcRecord) {
        const direction = directions[Math.floor(this.random() * directions.length)];
        const vector = this.directionVector(direction);
        person.position = this.clampToMap({ x: person.position.x + vector.x, y: person.position.y + vector.y });
        person.direction = direction;
    }

    private moveWithinRadius(person: NpcRecord) {
        const radius = this.radiusFor(person);
        if (radius === 0) return;
        const direction = directions[Math.floor(this.random() * directions.length)];
        const distance = Math.floor(this.random() * (radius + 1));
        const vector = this.directionVector(direction);
        const target = {
            x: person.anchor.x + vector.x * distance,
            y: person.anchor.y + vector.y * distance,
        };
        person.position = this.clampToMap(target);
        if (distance > 0) person.direction = direction;
    }

    private initialTargetIndex(position: TilePosition, route: readonly TilePosition[]): number {
        let closestIndex = 0;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < route.length; index++) {
            const candidate = route[index];
            const distance = Math.hypot(position.x - candidate.x, position.y - candidate.y);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        }
        return closestDistance === 0 && route.length > 1 ? (closestIndex + 1) % route.length : closestIndex;
    }

    private sampleDelay(person: SEFPerson): number {
        const minimum = this.delayFor(person.delayMin, "minimum");
        const maximum = this.delayFor(person.delayMax ?? minimum, "maximum");
        if (maximum < minimum) throw new Error(`NPC delay maximum ${maximum} is less than minimum ${minimum}`);
        if (maximum === minimum) return minimum;
        return minimum + Math.floor(this.random() * (maximum - minimum + 1));
    }

    private delayFor(value: number | undefined, label: string): number {
        const delay = value ?? 0;
        if (!Number.isFinite(delay) || delay < 0) throw new Error(`NPC ${label} delay must be a non-negative finite number; received ${delay}`);
        return delay;
    }

    private radiusFor(person: NpcRecord): number {
        const radius = person.person.radius ?? 0;
        if (!Number.isFinite(radius) || radius < 0) throw new Error(`NPC ${person.index} radius must be a non-negative finite number; received ${radius}`);
        return Math.floor(radius);
    }

    private random(): number {
        const value = this.options.random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error(`Seeded random source must return a finite value in [0, 1); received ${value}`);
        return value;
    }

    private directionForDelta(deltaX: number, deltaY: number, fallback: Direction): Direction {
        if (deltaX === 0 && deltaY === 0) return fallback;
        const horizontal = deltaX === 0 ? "" : deltaX > 0 ? "RIGHT" : "LEFT";
        const vertical = deltaY === 0 ? "" : deltaY > 0 ? "DOWN" : "UP";
        return horizontal && vertical ? `${vertical}_${horizontal}` as Direction : (horizontal || vertical) as Direction;
    }

    private directionVector(direction: Direction): TilePosition {
        switch (direction) {
            case "UP": return { x: 0, y: -1 };
            case "UP_RIGHT": return { x: 1, y: -1 };
            case "RIGHT": return { x: 1, y: 0 };
            case "DOWN_RIGHT": return { x: 1, y: 1 };
            case "DOWN": return { x: 0, y: 1 };
            case "DOWN_LEFT": return { x: -1, y: 1 };
            case "LEFT": return { x: -1, y: 0 };
            case "UP_LEFT": return { x: -1, y: -1 };
        }
    }

    private clampToMap(cell: TilePosition): TilePosition {
        const maxX = Math.max(0, Math.floor((this.lvlData.mapSize.width - 1) / 12));
        const maxY = Math.max(0, Math.floor((this.lvlData.mapSize.height - 1) / 9));
        return { x: Math.min(Math.max(cell.x, 0), maxX), y: Math.min(Math.max(cell.y, 0), maxY) };
    }

    private createTriggerState(trigger: TriggerRecord): ScenarioTriggerState {
        return {
            name: trigger.definition.name,
            active: trigger.active,
            visible: trigger.visible,
            transition: trigger.definition.isTransition ?? false,
            cells: trigger.cells.map(cloneCell),
            literaryName: trigger.definition.literaryName,
            cursorName: trigger.definition.cursorName,
            scriptName: trigger.definition.scriptName,
            inventoryName: trigger.definition.inventoryName,
        };
    }

    private createDoorState(door: DoorRecord): ScenarioDoorState {
        return {
            name: door.name,
            opened: door.opened,
            cells: door.cells.map(cloneCell),
            activationCells: door.activationCells.map(cloneCell),
        };
    }

    private createNpcRouteState(person: NpcRecord): NpcRouteState {
        return {
            index: person.index,
            name: person.person.name,
            mode: person.mode,
            position: cloneCell(person.position),
            worldPosition: cellToWorld(person.position),
            direction: person.direction,
            route: person.route.map(cloneCell),
            nextUpdateAt: person.nextUpdateAt,
        };
    }

    private requireCell(cell: TilePosition, owner: string): TilePosition {
        if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
            throw new Error(`${owner} must have safe integer x and y coordinates`);
        }
        return cloneCell(cell);
    }

    private requireTrigger(name: string): TriggerRecord {
        const trigger = this.triggers.get(name);
        if (!trigger) throw new Error(`Unknown scenario trigger ${name}`);
        return trigger;
    }

    private requireDoor(name: string): DoorRecord {
        const door = this.doors.get(name);
        if (!door) throw new Error(`Unknown joined door ${name}`);
        return door;
    }

    private requirePerson(index: number): NpcRecord {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.persons.length) throw new Error(`Unknown NPC route index ${index}`);
        return this.persons[index];
    }

    private validateMapSize() {
        const { width, height } = this.lvlData.mapSize;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
            throw new Error(`LVL map size must have positive finite dimensions; received ${width}x${height}`);
        }
    }
}
