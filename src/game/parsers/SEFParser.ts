import parseEngineObject from "./engineObjectParser.ts";

/** Общий тип для координат в тайлах */
export interface TilePosition {
    x: number;
    y: number;
}

export type Direction = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'UP_LEFT' | 'UP_RIGHT' | 'DOWN_LEFT' | 'DOWN_RIGHT';

export type RouteType = 'STAY' | 'RANDOM_RADIUS' | 'STAY_ROTATE' | 'MOVED_FLIP' | 'MOVED' | 'RANDOM';

/** NPC (персонажи) */
export interface SEFPerson {
    position: TilePosition;
    literaryName?: number;
    literaryNameString?: string;
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

/** Входные точки */
export interface SEFEntrancePoint {
    direction: Direction;
    position: TilePosition;
}

/** Входные точки */
export interface SEFDoor {
    cellsName: string;
    literaryNameClosed: number;
    literaryNameOpened: number;
    isOpened?: boolean;
}

/** Группы клеток (ключ - название группы, значение - массив позиций) */
export interface SEFCellGroups {
    [groupName: string]: TilePosition[];
}

/** Триггеры */
export interface SEFTrigger {
    literaryName?: number;
    literaryNameString?: string;
    cursorName?: string;
    scriptName?: string;
    inventoryName?: string;
    cellsName?: string;
    isActive?: boolean;
    isVisible?: boolean;
    isTransition?: boolean;
}

/** Основная структура данных SEF */
export interface SEFData {
    version?: number;
    pack: string;
    internalLocation?: boolean;
    exitToGlobalMap?: boolean;
    weather?: number;
    persons: Record<string, SEFPerson>;
    doors: Record<string, SEFDoor>;
    entrancePoints: Record<string, SEFEntrancePoint>;
    cellGroups: SEFCellGroups;
    triggers: Record<string, SEFTrigger>;
}

export class SEFParser {
    private data: SEFData;

    constructor(sefText: string) {
        this.data = this.mapToSEFData(parseEngineObject(sefText));
    }

    private mapToSEFData(raw: any): SEFData {
        // Создаём заготовку
        const result: SEFData = {
            version: raw.version ?? undefined,
            pack: (raw.pack ?? "").toLowerCase(),
            internalLocation: raw.internal_location === 1,
            exitToGlobalMap: raw.exit_to_globalmap === 1,
            weather: typeof raw.weather === "number" ? raw.weather : undefined,
            persons: {},
            doors: {},
            entrancePoints: {},
            cellGroups: {},
            triggers: {}
        };

        // --- Мапим person-ов
        if (raw.persons && typeof raw.persons === "object") {
            for (const [personName, personData] of Object.entries(raw.persons)) {
                result.persons[personName] = this.mapPersonData(personData);
            }
        }

        // --- Мапим входные точки (points_entrance)
        if (raw.points_entrance && typeof raw.points_entrance === "object") {
            for (const [pointName, pointData] of Object.entries(raw.points_entrance)) {
                result.entrancePoints[pointName] = this.mapEntrancePoint(pointData);
            }
        }

        // --- Мапим cell_groups
        if (raw.cell_groups && typeof raw.cell_groups === "object") {
            result.cellGroups = this.mapCellGroups(raw.cell_groups);
        }

        // --- Мапим триггеры
        if (raw.triggers && typeof raw.triggers === "object") {
            for (const [triggerName, triggerData] of Object.entries(raw.triggers)) {
                result.triggers[triggerName] = this.mapTriggerData(triggerData);
            }
        }

        // --- Мапим двери
        if (raw.doors && typeof raw.doors === "object") {
            for (const [doorName, doorData] of Object.entries(raw.doors)) {
                result.doors[doorName] = this.mapDoorData(doorData);
            }
        }

        return result;
    }

    private mapPersonData(rawPerson: any): SEFPerson {
        const person: SEFPerson = {
            position: { x: 0, y: 0 },
            direction: "DOWN"
        };

        // position может быть массивом [x, y]
        if (Array.isArray(rawPerson.position) && rawPerson.position.length === 2) {
            person.position = {
                x: Number(rawPerson.position[0]) || 0,
                y: Number(rawPerson.position[1]) || 0
            };
        }

        // direction
        if (rawPerson.direction) {
            person.direction = this.normalizeDirection(rawPerson.direction);
        }

        // literary_name => literaryName (число)
        if (typeof rawPerson.literary_name === "number") {
            person.literaryName = rawPerson.literary_name;
        }

        // route_type => routeType
        if (rawPerson.route_type) {
            person.routeType = this.normalizeRouteType(rawPerson.route_type);
        }

        // route
        if (typeof rawPerson.route === "string") {
            person.route = rawPerson.route;
        }

        // radius
        if (typeof rawPerson.radius === "number") {
            person.radius = rawPerson.radius;
        }

        // delay_min => delayMin
        if (typeof rawPerson.delay_min === "number") {
            person.delayMin = rawPerson.delay_min;
        }

        // delay_max => delayMax
        if (typeof rawPerson.delay_max === "number") {
            person.delayMax = rawPerson.delay_max;
        }

        // tribe
        if (typeof rawPerson.tribe === "string") {
            person.tribe = rawPerson.tribe;
        }

        // scr_dialog => scriptDialog
        if (typeof rawPerson.scr_dialog === "string") {
            person.scriptDialog = rawPerson.scr_dialog;
        }

        // scr_inv => scriptInventory
        if (typeof rawPerson.scr_inv === "string") {
            person.scriptInventory = rawPerson.scr_inv;
        }

        return person;
    }

    private mapEntrancePoint(rawPoint: any): SEFEntrancePoint {
        const entrancePoint: SEFEntrancePoint = {
            direction: "DOWN",
            position: { x: 0, y: 0 }
        };

        if (Array.isArray(rawPoint.position) && rawPoint.position.length === 2) {
            entrancePoint.position = {
                x: Number(rawPoint.position[0]) || 0,
                y: Number(rawPoint.position[1]) || 0
            };
        }

        if (rawPoint.direction) {
            entrancePoint.direction = this.normalizeDirection(rawPoint.direction);
        }

        return entrancePoint;
    }

    private mapCellGroups(rawGroups: any): SEFCellGroups {
        const result: SEFCellGroups = {};

        for (const [groupName, groupData] of Object.entries(rawGroups)) {
            const positions: TilePosition[] = [];
            if (groupData && typeof groupData === "object") {
                // Для каждого cell_XX
                for (const cellKey of Object.keys(groupData)) {
                    const maybePos = groupData[cellKey];
                    if (Array.isArray(maybePos) && maybePos.length === 2) {
                        const [x, y] = maybePos;
                        positions.push({ x, y });
                    }
                }
            }
            result[groupName] = positions;
        }

        return result;
    }

    private mapTriggerData(rawTrigger: any): SEFTrigger {
        const trigger: SEFTrigger = {};

        if (typeof rawTrigger.literary_name === "number") {
            trigger.literaryName = rawTrigger.literary_name;
        }
        if (typeof rawTrigger.cursor_name === "string") {
            trigger.cursorName = rawTrigger.cursor_name;
        }
        if (typeof rawTrigger.script_name === "string") {
            trigger.scriptName = rawTrigger.script_name;
        }
        if (typeof rawTrigger.inv_name === "string") {
            trigger.inventoryName = rawTrigger.inv_name;
        }
        if (typeof rawTrigger.cells_name === "string") {
            trigger.cellsName = rawTrigger.cells_name;
        }
        if (rawTrigger.is_active !== undefined) {
            trigger.isActive = !!rawTrigger.is_active;
        }
        if (rawTrigger.is_visible !== undefined) {
            trigger.isVisible = !!rawTrigger.is_visible;
        }
        if (rawTrigger.is_transition !== undefined) {
            trigger.isTransition = !!rawTrigger.is_transition;
        }

        return trigger;
    }

    private mapDoorData(rawDoor: any): SEFDoor {
        const trigger: SEFDoor = {
            cellsName: '',
            literaryNameClosed: -1,
            literaryNameOpened: -1
        };

        if (typeof rawDoor.literary_name_close === "number") {
            trigger.literaryNameClosed = rawDoor.literary_name_close;
        }
        if (typeof rawDoor.literary_name_open === "number") {
            trigger.literaryNameOpened = rawDoor.literary_name_open;
        }
        if (typeof rawDoor.cells_name === "string") {
            trigger.cellsName = rawDoor.cells_name;
        }
        if (rawDoor.is_opened !== undefined) {
            trigger.isOpened = !!rawDoor.is_opened;
        }

        return trigger;
    }

    private normalizeDirection(direction: string): Direction {
        return direction as Direction;
    }

    private normalizeRouteType(route: string): RouteType {
        return route as RouteType;
    }

    public getData(): SEFData {
        return this.data;
    }
}