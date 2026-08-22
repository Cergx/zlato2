import type { NativeGlobalMapCrimeZone, NativeGlobalMapData, NativeGlobalMapLocation } from "./NativeGlobalMapData.ts";
import type { EncounterDisposition, GlobalEncounterPerson, GlobalEncounterSide } from "./parsers/GlobalEncounterParser.ts";

export interface WorldMapLocationState extends NativeGlobalMapLocation {
    readonly discovered: boolean;
    readonly available: boolean;
    readonly current: boolean;
}

export interface WorldMapPoint {
    readonly x: number;
    readonly y: number;
}

export interface WorldMapEncounterRequest {
    readonly level: string;
    readonly entrance: "GM";
    readonly disposition: EncounterDisposition | "special";
    readonly persons: readonly string[];
    readonly specialVariable?: string;
}

export interface WorldMapEncounterPrompt {
    readonly text: string;
    readonly request: WorldMapEncounterRequest;
}
export interface WorldMapArrivalPrompt {
    readonly locationId: string;
    readonly locationLabel: string;
    readonly options: readonly Readonly<{ level: string; label: string }>[];
}



export interface WorldMapAudioSourceState {
    readonly source: string;
    readonly volume: number;
}

export interface WorldMapAudioState {
    readonly music?: string;
    readonly environment?: string;
    readonly environmentVolume: number;
    readonly sources: readonly WorldMapAudioSourceState[];
}
export interface WorldMapState {
    readonly locations: readonly WorldMapLocationState[];
    readonly regions: NativeGlobalMapData["regions"];
    readonly position: WorldMapPoint;
    readonly zoneId?: string;
    readonly destination?: WorldMapPoint;
    readonly route: readonly WorldMapPoint[];
    readonly routeStart?: WorldMapPoint;
    readonly routePath: readonly WorldMapPoint[];
    readonly moving: boolean;
    readonly canTravel: boolean;
    readonly prompt?: WorldMapEncounterPrompt;
    readonly arrivalPrompt?: WorldMapArrivalPrompt;
    readonly elapsedMinutes: number;
}

export interface WorldMapRuntimeHost {
    getVariable(name: string): unknown;
    setVariable(name: string, value: unknown): void;
    getHeroParameter(name: string): number;
    getElapsedMinutes(): number;
    advanceClock(minutes: number): void;
    requestTransition(level: string, entrance: string): void;
    requestEncounter(request: WorldMapEncounterRequest): void;
    setAudioState?(state: WorldMapAudioState): void;
    random(): number;
}

export interface WorldMapRuntimeOptions {
    readonly data: NativeGlobalMapData;
    readonly currentLocation: string;
    readonly currentPosition?: WorldMapPoint;
    readonly canTravel: boolean;
    readonly host: WorldMapRuntimeHost;
    readonly addonMode?: boolean;
}

const MAP_STEP_DELAY_MS = 40;
const MAP_MINUTES_PER_PIXEL = 30;
const MAP_CELL_SIZE = 4;
const PROBABILITY_MAXIMUM = 121;
const SQRT_TWO = Math.SQRT2;
const SPECIAL_ENCOUNTERS = Object.freeze([
    { variable: "coolsmith_meet", zone: "cz_1", level: "l100" },
    { variable: "alana_meet", zone: "cz_20", level: "l101" },
    { variable: "dedmoroz_meet", zone: "cz_22", level: "l102" },
    { variable: "ivor_meet", zone: "cz_6", level: "l103" },
    { variable: "gipsies_meet", zone: "cz_4", level: "l105" },
    { variable: "blood_meet", zone: "cz_3", level: "l106" },
] as const);

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

/** Client.dll global-map no-way raster: one mask cell covers 4×4 map pixels. */
export const nativeGlobalMapPassable = (
    data: Pick<NativeGlobalMapData, "maskWidth" | "maskHeight" | "zoneColors" | "noWayColor">,
    cellX: number,
    cellY: number,
): boolean => {
    if (cellX < 0 || cellY < 0 || cellX >= data.maskWidth || cellY >= data.maskHeight) return false;
    return data.zoneColors[cellY * data.maskWidth + cellX] !== data.noWayColor;
};
const point = (x: number, y: number): WorldMapPoint => Object.freeze({ x, y });
const distance = (left: WorldMapPoint, right: WorldMapPoint): number => Math.hypot(right.x - left.x, right.y - left.y);

/** Client.dll 0x120B3638..0x120B3696 and 0x120B369C..0x120B3737. */
export const nativeScoutNoticeChance = (skill: number): number => {
    const value = Math.trunc(skill);
    if (value < 5) return 0;
    if (value >= 15) return 0.9;
    return value * 0.05;
};

/** Client.dll 0x120B3464..0x120B356F. */
export const nativeEvilEncounterChance = (
    baseChance: number,
    terrainProbability: number,
    steps: number,
    luck: number,
    scout: number,
    specialPerks: number,
    addonMode: boolean,
): number => {
    const counter = Math.min(Math.max(0, steps) / 16, 1) * 0.3;
    const luckTerm = (1 - clamp(luck, 1, 30) / 30) * 0.65;
    const scoutTerm = (1 - clamp(scout, 0, 15) / 15) * 0.7;
    const sum = terrainProbability * 0.8 + counter + baseChance + luckTerm + scoutTerm;
    const addonPerkFactor = addonMode && (Math.trunc(specialPerks) & 0x800) !== 0 ? 0.85 : 1;
    return clamp((sum * 0.2) ** 2 * addonPerkFactor * 0.1, 0, 1);
};

/** Client.dll 0x120B3574..0x120B3632. */
export const nativeGoodEncounterChance = (
    baseChance: number,
    terrainProbability: number,
    luck: number,
    scout: number,
): number => {
    const luckTerm = clamp(luck, 1, 30) / 30 * 0.4 + 0.1;
    const scoutTerm = clamp(scout, 0, 15) / 15 * 0.45 + 0.1;
    const sum = terrainProbability * 0.5 + luckTerm + (1 - baseChance) * 0.5 + scoutTerm;
    return clamp((sum * 0.25) ** 2 * 0.1, 0, 1);
};

export const nativeSelectEncounterPersons = (
    side: GlobalEncounterSide,
    elapsedMinutes: number,
    random: () => number,
): readonly string[] => {
    const selected: string[] = [];
    const grouped = new Map<number, GlobalEncounterPerson[]>();
    for (const person of side.persons) {
        const list = grouped.get(person.group) ?? [];
        list.push(person);
        grouped.set(person.group, list);
    }
    const minuteOfDay = ((Math.floor(elapsedMinutes) % 1440) + 1440) % 1440;
    const day = minuteOfDay >= 6 * 60 && minuteOfDay < 20 * 60;
    for (const group of [...grouped.keys()].sort((left, right) => left - right)) {
        const choices = grouped.get(group)!;
        const total = choices.reduce((sum, person) => sum + Math.max(0, day ? person.dayWeight : person.nightWeight), 0);
        if (total <= 0) continue;
        let roll = random() * total;
        const chosen = choices.find((person) => (roll -= Math.max(0, day ? person.dayWeight : person.nightWeight)) < 0)
            ?? choices[choices.length - 1];
        if (chosen) selected.push(chosen.technicalName);
    }
    return Object.freeze(selected);
};

/** Client.dll 0x120B52FC..0x120B5417 and 0x120B58A0..0x120B5AC0. */
export const nativeWorldMapAudioState = (
    data: NativeGlobalMapData,
    position: WorldMapPoint,
): WorldMapAudioState => {
    const cellX = clamp(Math.trunc(position.x / MAP_CELL_SIZE), 0, data.maskWidth - 1);
    const cellY = clamp(Math.trunc(position.y / MAP_CELL_SIZE), 0, data.maskHeight - 1);
    const index = cellY * data.maskWidth + cellX;
    const musicColor = data.audio.musicColors[index];
    const environmentColor = data.audio.environmentColors[index];
    return Object.freeze({
        music: data.audio.music.find((entry) => entry.color === musicColor)?.source,
        environment: data.audio.environments.find((entry) => entry.color === environmentColor)?.source,
        environmentVolume: data.audio.environmentVolume[index] / 255,
        sources: Object.freeze(data.audio.sources.flatMap((source) => {
            const gainPercent = Math.trunc((1 - distance(position, source) / 50) * 100);
            return gainPercent > 0 ? [Object.freeze({ source: source.source, volume: gainPercent / 100 })] : [];
        })),
    });
};

interface HeapEntry {
    index: number;
    score: number;
}

class MinimumHeap {
    private readonly values: HeapEntry[] = [];

    public push(value: HeapEntry): void {
        this.values.push(value);
        let index = this.values.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.values[parent].score <= value.score) break;
            this.values[index] = this.values[parent];
            index = parent;
        }
        this.values[index] = value;
    }

    public pop(): HeapEntry | undefined {
        const first = this.values[0];
        const last = this.values.pop();
        if (!first || !last || this.values.length === 0) return first;
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            if (left >= this.values.length) break;
            const right = left + 1;
            const child = right < this.values.length && this.values[right].score < this.values[left].score ? right : left;
            if (this.values[child].score >= last.score) break;
            this.values[index] = this.values[child];
            index = child;
        }
        this.values[index] = last;
        return first;
    }

    public get empty(): boolean {
        return this.values.length === 0;
    }
}

export class WorldMapRuntime {
    private readonly locationsById = new Map<string, NativeGlobalMapLocation>();
    private readonly crimeByColor = new Map<number, NativeGlobalMapCrimeZone>();
    private position: WorldMapPoint;
    private route: WorldMapPoint[] = [];
    private destination?: WorldMapPoint;
    private routeStart?: WorldMapPoint;
    private routePath: WorldMapPoint[] = [];
    private destinationLocation?: NativeGlobalMapLocation;
    private pendingPrompt?: WorldMapEncounterPrompt;
    private pendingArrival?: WorldMapArrivalPrompt;
    private stepAccumulator = 0;
    private encounterSteps = 0;
    private currentLocation: string;
    private lastZoneId?: string;
    private audioState?: WorldMapAudioState;

    private get canTravel(): boolean {
        return this.options.canTravel;
    }

    public constructor(private readonly options: WorldMapRuntimeOptions) {
        for (const location of options.data.locations) this.locationsById.set(location.id, location);
        for (const zone of options.data.crimeZones) this.crimeByColor.set(zone.color, zone);
        const requested = this.locationsById.get(options.currentLocation.toUpperCase());
        const current = requested
            ?? (options.currentPosition
                ? [...this.locationsById.values()].sort((left, right) =>
                    distance(options.currentPosition!, left) - distance(options.currentPosition!, right))[0]
                : undefined)
            ?? this.options.data.locations[0];
        if (!current) throw new Error("Global-map data contains no authored locations");
        this.currentLocation = current.id;
        this.position = options.currentPosition ? point(options.currentPosition.x, options.currentPosition.y) : point(current.x, current.y);
        this.lastZoneId = this.zoneAt(this.position);
        this.updateAudio();
    }

    public getState(): WorldMapState {
        return Object.freeze({
            locations: Object.freeze(this.options.data.locations.map((location) => Object.freeze({
                ...location,
                subLevels: Object.freeze([...location.subLevels]),
                discovered: this.access(location) > 0 || location.id === this.currentLocation,
                available: this.access(location) > 0 || location.id === this.currentLocation,
                current: location.id === this.currentLocation,
            }))),
            regions: this.options.data.regions,
            position: point(this.position.x, this.position.y),
            zoneId: this.zoneAt(this.position),
            destination: this.destination ? point(this.destination.x, this.destination.y) : undefined,
            route: Object.freeze(this.route.map((entry) => point(entry.x, entry.y))),
            routeStart: this.routeStart ? point(this.routeStart.x, this.routeStart.y) : undefined,
            routePath: Object.freeze(this.routePath.map((entry) => point(entry.x, entry.y))),
            moving: this.route.length > 0 && !this.pendingPrompt,
            canTravel: this.options.canTravel,
            prompt: this.pendingPrompt,
            arrivalPrompt: this.pendingArrival,
            elapsedMinutes: this.options.host.getElapsedMinutes(),
        });
    }

    public getPosition(): WorldMapPoint {
        return point(this.position.x, this.position.y);
    }

    /** Last authored crime zone visited on the current map journey. */
    public getZoneId(): string | undefined {
        return this.zoneAt(this.position) ?? this.lastZoneId;
    }

    public travelTo(x: number, y: number, locationId?: string): boolean {
        if (this.pendingPrompt || this.pendingArrival || !this.canTravel) return false;
        const targetLocation = locationId ? this.requireLocation(locationId) : undefined;
        if (targetLocation && this.access(targetLocation) < 1 && targetLocation.id !== this.currentLocation) return false;
        if (targetLocation && targetLocation.id === this.currentLocation && distance(this.position, targetLocation) <= 16) {
            if (!this.openArrivalPrompt(targetLocation.id)) return false;
            this.destination = undefined;
            this.destinationLocation = undefined;
            this.route = [];
            this.routeStart = undefined;
            this.routePath = [];
            return true;
        }
        const target = targetLocation ? point(targetLocation.x, targetLocation.y) : point(
            clamp(Math.trunc(x), 0, this.options.data.mapWidth - 1),
            clamp(Math.trunc(y), 0, this.options.data.mapHeight - 1),
        );
        const route = this.findPath(this.position, target);
        if (!route) return false;
        this.destination = target;
        this.destinationLocation = targetLocation;
        this.routeStart = point(this.position.x, this.position.y);
        this.routePath = route.map((entry) => point(entry.x, entry.y));
        this.route = route.slice(1);
        this.encounterSteps = 0;
        return true;
    }

    public openArrivalPrompt(locationId: string): boolean {
        const location = this.requireLocation(locationId);
        const options = location.entries ?? [Object.freeze({ level: location.level, label: location.label })];
        if (options.length <= 1) return false;
        this.currentLocation = location.id;
        this.pendingArrival = Object.freeze({
            locationId: location.id,
            locationLabel: location.label,
            options: Object.freeze(options.map((option) => Object.freeze({ ...option }))),
        });
        return true;
    }

    public update(elapsedMs: number): boolean {
        if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || this.pendingPrompt || this.pendingArrival || this.route.length === 0 || !this.canTravel) return false;
        this.stepAccumulator += elapsedMs;
        let changed = false;
        while (this.stepAccumulator >= MAP_STEP_DELAY_MS && this.route.length > 0 && !this.pendingPrompt) {
            this.stepAccumulator -= MAP_STEP_DELAY_MS;
            this.advanceOnePixel();
            changed = true;
        }
        return changed;
    }

    public answerEncounter(accept: boolean): void {
        const prompt = this.pendingPrompt;
        if (!prompt) return;
        this.pendingPrompt = undefined;
        if (accept) this.startEncounter(prompt.request);
    }

    /** Native "Продолжить..." action: dismiss the city chooser and resume map travel. */
    public continueArrival(): void {
        this.pendingArrival = undefined;
    }

    /** Select an authored district button and transition directly through GM. */
    public selectArrival(level: string): void {
        const prompt = this.pendingArrival;
        if (!prompt) return;
        const selected = prompt.options.find((option) => option.level.toLowerCase() === level.toLowerCase());
        if (!selected) throw new Error(`Unknown arrival sublocation ${level}`);
        this.pendingArrival = undefined;
        this.options.host.requestTransition(selected.level, "GM");
    }

    private advanceOnePixel(): void {
        const next = this.route[0];
        const remaining = distance(this.position, next);
        if (remaining <= 1) {
            this.position = next;
            this.route.shift();
        } else {
            this.position = point(
                this.position.x + (next.x - this.position.x) / remaining,
                this.position.y + (next.y - this.position.y) / remaining,
            );
        }
        const zoneId = this.zoneAt(this.position);
        if (zoneId) this.lastZoneId = zoneId;
        this.updateAudio();
        this.options.host.advanceClock(MAP_MINUTES_PER_PIXEL);
        this.encounterSteps += 1;
        if (this.rollEncounter()) return;
        if (this.route.length === 0 && this.destination) this.arrive();
    }

    private updateAudio(): void {
        const next = nativeWorldMapAudioState(this.options.data, this.position);
        const previous = this.audioState;
        const unchanged = previous !== undefined
            && previous.music === next.music
            && previous.environment === next.environment
            && previous.environmentVolume === next.environmentVolume
            && previous.sources.length === next.sources.length
            && previous.sources.every((source, index) => source.source === next.sources[index]?.source && source.volume === next.sources[index]?.volume);
        if (unchanged) return;
        this.audioState = next;
        this.options.host.setAudioState?.(next);
    }

    private arrive(): void {
        const location = this.destinationLocation;
        this.destination = undefined;
        this.destinationLocation = undefined;
        this.routeStart = undefined;
        this.routePath = [];
        if (!location) return;
        this.currentLocation = location.id;
        if (this.openArrivalPrompt(location.id)) return;
        const only = (location.entries ?? [Object.freeze({ level: location.level, label: location.label })])[0];
        this.options.host.requestTransition(only.level, location.entrance);
    }

    private rollEncounter(): boolean {
        const cellX = clamp(Math.trunc(this.position.x / MAP_CELL_SIZE), 0, this.options.data.maskWidth - 1);
        const cellY = clamp(Math.trunc(this.position.y / MAP_CELL_SIZE), 0, this.options.data.maskHeight - 1);
        const index = cellY * this.options.data.maskWidth + cellX;
        const zone = this.crimeByColor.get(this.options.data.zoneColors[index]);
        if (!zone) return false;
        const baseChance = zone.encounter.chance / 100;
        const terrainProbability = clamp(this.options.data.probability[index] / PROBABILITY_MAXIMUM, 0, 1);
        const luck = this.options.host.getHeroParameter("luck");
        const scout = this.options.host.getHeroParameter("skill_scout");
        const specialPerks = this.options.host.getHeroParameter("special_perks");
        const evil = nativeEvilEncounterChance(baseChance, terrainProbability, this.encounterSteps, luck, scout, specialPerks, this.options.addonMode === true);
        if (this.options.host.random() < evil) return this.prepareEncounter(zone, "evil", scout);
        const good = nativeGoodEncounterChance(baseChance, terrainProbability, luck, scout);
        if (this.options.host.random() < good) return this.prepareEncounter(zone, "good", scout);
        if (scout > 0) {
            const special = SPECIAL_ENCOUNTERS.find((entry) => entry.zone === zone.id && !this.options.host.getVariable(entry.variable));
            const perkFactor = this.options.addonMode && (Math.trunc(specialPerks) & 0x8) !== 0 ? 1.15 : 1;
            if (special && this.options.host.random() < 0.001 * perkFactor) {
                const request: WorldMapEncounterRequest = Object.freeze({
                    level: special.level,
                    entrance: "GM",
                    disposition: "special",
                    persons: Object.freeze([]),
                    specialVariable: special.variable,
                });
                this.startEncounter(request);
                return true;
            }
        }
        return false;
    }

    /** Zone id at the given map position (undefined when off-mask or outside a crime zone). */
    private zoneAt(position: WorldMapPoint): string | undefined {
        const cellX = clamp(Math.trunc(position.x / MAP_CELL_SIZE), 0, this.options.data.maskWidth - 1);
        const cellY = clamp(Math.trunc(position.y / MAP_CELL_SIZE), 0, this.options.data.maskHeight - 1);
        const index = cellY * this.options.data.maskWidth + cellX;
        return this.crimeByColor.get(this.options.data.zoneColors[index])?.id;
    }

    private prepareEncounter(zone: NativeGlobalMapCrimeZone, disposition: EncounterDisposition, scout: number): boolean {
        const side = zone.encounter.sides.find((candidate) => candidate.disposition === disposition);
        if (!side || zone.levels.length === 0) return false;
        const request: WorldMapEncounterRequest = Object.freeze({
            level: zone.levels[Math.floor(this.options.host.random() * zone.levels.length)],
            entrance: "GM",
            disposition,
            persons: Object.freeze(this.selectPersons(side)),
        });
        if (this.options.host.random() < nativeScoutNoticeChance(scout)) {
            this.pendingPrompt = Object.freeze({
                text: disposition === "evil"
                    ? "Вы первым заметили монстров. Хотите сражаться?"
                    : "Вы заметили мирных путников. Хотите с ними встретиться?",
                request,
            });
        } else this.startEncounter(request);
        return true;
    }

    private startEncounter(request: WorldMapEncounterRequest): void {
        this.route = [];
        this.destination = undefined;
        this.destinationLocation = undefined;
        this.routeStart = undefined;
        this.routePath = [];
        this.encounterSteps = 0;
        if (request.specialVariable) this.options.host.setVariable(request.specialVariable, 1);
        this.options.host.requestEncounter(request);
    }

    private selectPersons(side: GlobalEncounterSide): string[] {
        return [...nativeSelectEncounterPersons(side, this.options.host.getElapsedMinutes(), this.options.host.random)];
    }

    private access(location: NativeGlobalMapLocation): number {
        const value = Number(this.options.host.getVariable(`worldmap:${location.id}`));
        return Number.isFinite(value) ? Math.trunc(value) : 0;
    }

    private requireLocation(id: string): NativeGlobalMapLocation {
        const location = this.locationsById.get(id.toUpperCase());
        if (!location) throw new Error(`Unknown world-map location ${id}`);
        return location;
    }

    private passable(cellX: number, cellY: number): boolean {
        return nativeGlobalMapPassable(this.options.data, cellX, cellY);
    }

    private linePassable(from: WorldMapPoint, to: WorldMapPoint): boolean {
        const startX = from.x / MAP_CELL_SIZE;
        const startY = from.y / MAP_CELL_SIZE;
        const endX = to.x / MAP_CELL_SIZE;
        const endY = to.y / MAP_CELL_SIZE;
        let cellX = Math.trunc(startX);
        let cellY = Math.trunc(startY);
        const targetX = Math.trunc(endX);
        const targetY = Math.trunc(endY);
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const stepX = Math.sign(deltaX);
        const stepY = Math.sign(deltaY);
        const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / deltaX);
        const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / deltaY);
        let tMaxX = stepX > 0 ? (cellX + 1 - startX) * tDeltaX : (startX - cellX) * tDeltaX;
        let tMaxY = stepY > 0 ? (cellY + 1 - startY) * tDeltaY : (startY - cellY) * tDeltaY;
        while (true) {
            if (!this.passable(cellX, cellY)) return false;
            if (cellX === targetX && cellY === targetY) return true;
            if (tMaxX < tMaxY) {
                cellX += stepX;
                tMaxX += tDeltaX;
            } else if (tMaxY < tMaxX) {
                cellY += stepY;
                tMaxY += tDeltaY;
            } else {
                // Diagonal corner step: native validates the destination footprint
                // only and adds no two-cardinal corner rule (Server.dll 0x1400FF28).
                cellX += stepX;
                cellY += stepY;
                tMaxX += tDeltaX;
                tMaxY += tDeltaY;
            }
        }
    }

    private findPath(from: WorldMapPoint, to: WorldMapPoint): WorldMapPoint[] | undefined {
        if (this.linePassable(from, to)) return [point(from.x, from.y), to];
        const width = this.options.data.maskWidth;
        const height = this.options.data.maskHeight;
        const startX = clamp(Math.trunc(from.x / MAP_CELL_SIZE), 0, width - 1);
        const startY = clamp(Math.trunc(from.y / MAP_CELL_SIZE), 0, height - 1);
        const targetX = clamp(Math.trunc(to.x / MAP_CELL_SIZE), 0, width - 1);
        const targetY = clamp(Math.trunc(to.y / MAP_CELL_SIZE), 0, height - 1);
        if (!this.passable(startX, startY) || !this.passable(targetX, targetY)) return undefined;
        const count = width * height;
        const costs = new Float64Array(count);
        costs.fill(Number.POSITIVE_INFINITY);
        const parents = new Int32Array(count);
        parents.fill(-1);
        const closed = new Uint8Array(count);
        const heap = new MinimumHeap();
        const start = startY * width + startX;
        const target = targetY * width + targetX;
        costs[start] = 0;
        heap.push({ index: start, score: distance(point(startX, startY), point(targetX, targetY)) });
        const directions = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
        while (!heap.empty) {
            const entry = heap.pop()!;
            if (closed[entry.index]) continue;
            if (entry.index === target) break;
            closed[entry.index] = 1;
            const x = entry.index % width;
            const y = Math.trunc(entry.index / width);
            for (const [dx, dy] of directions) {
                const nx = x + dx;
                const ny = y + dy;
                if (!this.passable(nx, ny)) continue;
                const next = ny * width + nx;
                if (closed[next]) continue;
                const nextCost = costs[entry.index] + (dx === 0 || dy === 0 ? 1 : SQRT_TWO);
                if (nextCost >= costs[next]) continue;
                costs[next] = nextCost;
                parents[next] = entry.index;
                heap.push({ index: next, score: nextCost + Math.hypot(targetX - nx, targetY - ny) });
            }
        }
        if (parents[target] < 0) return undefined;
        const cells: WorldMapPoint[] = [];
        for (let current = target; current >= 0; current = parents[current]) {
            cells.push(point((current % width) * MAP_CELL_SIZE, Math.trunc(current / width) * MAP_CELL_SIZE));
            if (current === start) break;
        }
        cells.reverse();
        cells[0] = point(from.x, from.y);
        cells[cells.length - 1] = to;
        const smoothed: WorldMapPoint[] = [cells[0]];
        let anchor = 0;
        while (anchor < cells.length - 1) {
            let next = cells.length - 1;
            while (next > anchor + 1 && !this.linePassable(cells[anchor], cells[next])) next -= 1;
            smoothed.push(cells[next]);
            anchor = next;
        }
        return smoothed;
    }
}
