import parseEngineObject, { isParsedData, isParsedDataArray } from "./engineObjectParser.ts";
import type { ParsedData, ParsedValue } from "./engineObjectParser.ts";

export interface TilePosition {
    x: number;
    y: number;
}

export type Direction = "LEFT" | "RIGHT" | "UP" | "DOWN" | "UP_LEFT" | "UP_RIGHT" | "DOWN_LEFT" | "DOWN_RIGHT";
export type RouteType = "STAY" | "RANDOM_RADIUS" | "STAY_ROTATE" | "MOVED_FLIP" | "MOVED" | "RANDOM";

export interface SEFPerson {
    name: string;
    position: TilePosition;
    literaryName?: number;
    literaryLabel?: string;
    direction: Direction;
    routeType?: RouteType;
    route?: string;
    radius?: number;
    delayMin?: number;
    delayMax?: number;
    tribe?: string;
    scriptDialog?: string;
    scriptInventory?: string;
}

export interface SEFEntrancePoint {
    name: string;
    direction: Direction;
    position: TilePosition;
}

export interface SEFDoor {
    cellsName: string;
    literaryNameClosed: number;
    literaryNameOpened: number;
    isOpened?: boolean;
}

export type SEFCellGroups = Record<string, TilePosition[]>;

export interface SEFTrigger {
    name: string;
    literaryName?: number;
    cursorName?: string;
    scriptName?: string;
    inventoryName?: string;
    cellsName?: string;
    isActive?: boolean;
    isVisible?: boolean;
    isTransition?: boolean;
}

export interface SEFData {
    version?: number;
    pack: string;
    internalLocation?: boolean;
    exitToGlobalMap?: boolean;
    weather?: number;
    persons: SEFPerson[];
    doors: Record<string, SEFDoor>;
    entrancePoints: SEFEntrancePoint[];
    cellGroups: SEFCellGroups;
    triggers: SEFTrigger[];
}

export class SEFParser {
    private data: SEFData;

    constructor(sefText: string) {
        this.data = this.mapToSEFData(parseEngineObject(sefText));
    }

    private mapToSEFData(raw: ParsedData): SEFData {
        const result: SEFData = {
            version: typeof raw.version === "number" ? raw.version : undefined,
            pack: typeof raw.pack === "string" ? raw.pack.toLowerCase() : "",
            internalLocation: raw.internal_location === 1,
            exitToGlobalMap: raw.exit_to_globalmap === 1,
            weather: typeof raw.weather === "number" ? raw.weather : undefined,
            persons: [],
            doors: {},
            entrancePoints: [],
            cellGroups: {},
            triggers: [],
        };

        if (isParsedData(raw.persons)) {
            for (const [name, person] of this.expandNamedEntries(raw.persons)) {
                result.persons.push(this.mapPersonData(name, person));
            }
        }
        if (isParsedData(raw.points_entrance)) {
            for (const [name, point] of this.expandNamedEntries(raw.points_entrance)) {
                result.entrancePoints.push(this.mapEntrancePoint(name, point));
            }
        }
        if (isParsedData(raw.cell_groups)) result.cellGroups = this.mapCellGroups(raw.cell_groups);
        if (isParsedData(raw.triggers)) {
            for (const [name, trigger] of this.expandNamedEntries(raw.triggers)) {
                result.triggers.push(this.mapTriggerData(name, trigger));
            }
        }
        if (isParsedData(raw.doors)) {
            for (const [name, door] of this.expandNamedEntries(raw.doors)) {
                if (result.doors[name]) throw new Error(`Duplicate door ${name}`);
                result.doors[name] = this.mapDoorData(door);
            }
        }

        return result;
    }

    private mapPersonData(name: string, rawPerson: ParsedData): SEFPerson {
        const person: SEFPerson = { name, position: this.readPosition(rawPerson.position), direction: "DOWN" };
        if (typeof rawPerson.literary_name === "number") person.literaryName = rawPerson.literary_name;
        if (typeof rawPerson.direction === "string") person.direction = this.normalizeDirection(rawPerson.direction);
        if (typeof rawPerson.route_type === "string") person.routeType = this.normalizeRouteType(rawPerson.route_type);
        if (typeof rawPerson.route === "string") person.route = rawPerson.route;
        if (typeof rawPerson.radius === "number") person.radius = rawPerson.radius;
        if (typeof rawPerson.delay_min === "number") person.delayMin = rawPerson.delay_min;
        if (typeof rawPerson.delay_max === "number") person.delayMax = rawPerson.delay_max;
        if (typeof rawPerson.tribe === "string") person.tribe = rawPerson.tribe;
        if (typeof rawPerson.scr_dialog === "string") person.scriptDialog = rawPerson.scr_dialog;
        if (typeof rawPerson.scr_inv === "string") person.scriptInventory = rawPerson.scr_inv;
        return person;
    }

    private mapEntrancePoint(name: string, rawPoint: ParsedData): SEFEntrancePoint {
        return {
            name,
            position: this.readPosition(rawPoint.position),
            direction: typeof rawPoint.direction === "string" ? this.normalizeDirection(rawPoint.direction) : "DOWN",
        };
    }

    private mapCellGroups(rawGroups: ParsedData): SEFCellGroups {
        const groups: SEFCellGroups = {};
        for (const [name, group] of this.expandNamedEntries(rawGroups)) {
            groups[name] = Object.values(group).map((value) => this.readPosition(value));
        }
        return groups;
    }

    private mapTriggerData(name: string, rawTrigger: ParsedData): SEFTrigger {
        const trigger: SEFTrigger = { name };
        if (typeof rawTrigger.literary_name === "number") trigger.literaryName = rawTrigger.literary_name;
        if (typeof rawTrigger.cursor_name === "string") trigger.cursorName = rawTrigger.cursor_name;
        if (typeof rawTrigger.script_name === "string") trigger.scriptName = rawTrigger.script_name;
        if (typeof rawTrigger.inv_name === "string") trigger.inventoryName = rawTrigger.inv_name;
        if (typeof rawTrigger.cells_name === "string") trigger.cellsName = rawTrigger.cells_name;
        if (rawTrigger.is_active !== undefined) trigger.isActive = Boolean(rawTrigger.is_active);
        if (rawTrigger.is_visible !== undefined) trigger.isVisible = Boolean(rawTrigger.is_visible);
        if (rawTrigger.is_transition !== undefined) trigger.isTransition = Boolean(rawTrigger.is_transition);
        return trigger;
    }

    private mapDoorData(rawDoor: ParsedData): SEFDoor {
        return {
            cellsName: typeof rawDoor.cells_name === "string" ? rawDoor.cells_name : "",
            literaryNameClosed: typeof rawDoor.literary_name_close === "number" ? rawDoor.literary_name_close : -1,
            literaryNameOpened: typeof rawDoor.literary_name_open === "number" ? rawDoor.literary_name_open : -1,
            isOpened: rawDoor.is_opened === undefined ? undefined : Boolean(rawDoor.is_opened),
        };
    }

    private expandNamedEntries(entries: ParsedData): Array<[string, ParsedData]> {
        const result: Array<[string, ParsedData]> = [];
        for (const [name, value] of Object.entries(entries)) {
            if (isParsedData(value)) {
                result.push([name, value]);
            } else if (isParsedDataArray(value)) {
                for (const entry of value) result.push([name, entry]);
            }
        }
        return result;
    }

    private readPosition(value: ParsedValue | undefined): TilePosition {
        if (Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number")) {
            return { x: value[0], y: value[1] };
        }
        return { x: 0, y: 0 };
    }

    private normalizeDirection(value: string): Direction {
        switch (value) {
            case "LEFT": return "LEFT";
            case "RIGHT": return "RIGHT";
            case "UP": return "UP";
            case "DOWN": return "DOWN";
            case "UP_LEFT": return "UP_LEFT";
            case "UP_RIGHT": return "UP_RIGHT";
            case "DOWN_LEFT": return "DOWN_LEFT";
            case "DOWN_RIGHT": return "DOWN_RIGHT";
            default: return "DOWN";
        }
    }

    private normalizeRouteType(value: string): RouteType | undefined {
        switch (value) {
            case "STAY": return "STAY";
            case "RANDOM_RADIUS": return "RANDOM_RADIUS";
            case "STAY_ROTATE": return "STAY_ROTATE";
            case "MOVED_FLIP": return "MOVED_FLIP";
            case "MOVED": return "MOVED";
            case "RANDOM": return "RANDOM";
            default: return undefined;
        }
    }

    public getData(): SEFData {
        return this.data;
    }
}
