import { singleLevels } from "../constants/levels.ts";
import type { TilePosition, SEFData } from "./parsers/SEFParser.ts";

export type WorldMapVariableOperator = "truthy" | "equals" | "notEquals" | "atLeast" | "lessThan";

/** A condition evaluated against the game-variable lookup supplied by the runtime host. */
export interface WorldMapVariableCondition {
    variable: string;
    operator?: WorldMapVariableOperator;
    value?: unknown;
}

export interface WorldMapLocation {
    /** Identifier used by the shipped global-map picture script. */
    id: string;
    level: string;
    entrance: string;
    position: Readonly<TilePosition>;
    discoveryWhen?: readonly WorldMapVariableCondition[];
    availableWhen?: readonly WorldMapVariableCondition[];
}

/** A directed route between two global-map location identifiers. */
export interface WorldMapTravelLink {
    from: string;
    to: string;
    cost: number;
    duration: number;
    availableWhen?: readonly WorldMapVariableCondition[];
}

export interface WorldMapTransitionRequest {
    level: string;
    entrance: string;
}

export interface WorldMapRuntimeHost {
    getVariable(variable: string): unknown;
    /** Must either charge the complete amount or leave the balance unchanged. */
    chargeTravelCost(cost: number): boolean;
    advanceClock(duration: number): void;
    requestTransition(request: Readonly<WorldMapTransitionRequest>): void;
}

export interface WorldMapRuntimeOptions {
    locations: readonly WorldMapLocation[];
    links: readonly WorldMapTravelLink[];
    currentLocation: string;
    discoveredLocations?: readonly string[];
    host: WorldMapRuntimeHost;
}

export interface WorldMapLocationState extends WorldMapLocation {
    discovered: boolean;
    available: boolean;
    current: boolean;

}


export interface WorldMapRoute {
    locations: readonly string[];
    links: readonly WorldMapTravelLink[];
    cost: number;
    duration: number;
}

export interface WorldMapTravelResult {
    route: WorldMapRoute;
    transition: WorldMapTransitionRequest;
}

interface RouteCandidate {
    location: string;
    links: readonly WorldMapTravelLink[];
    cost: number;
    duration: number;
    key: string;
}

const compareCandidates = (left: RouteCandidate, right: RouteCandidate): number => (
    left.duration - right.duration
    || left.cost - right.cost
    || left.key.localeCompare(right.key)
);

const clonePosition = (position: Readonly<TilePosition>): TilePosition => ({ x: position.x, y: position.y });

const cloneLocation = (location: WorldMapLocation): WorldMapLocation => ({
    ...location,
    position: clonePosition(location.position),
    discoveryWhen: location.discoveryWhen ? [...location.discoveryWhen] : undefined,
    availableWhen: location.availableWhen ? [...location.availableWhen] : undefined,
});

const cloneLink = (link: WorldMapTravelLink): WorldMapTravelLink => ({
    ...link,
    availableWhen: link.availableWhen ? [...link.availableWhen] : undefined,
});

const freezeLocation = (location: WorldMapLocation): WorldMapLocation => Object.freeze({
    ...location,
    position: Object.freeze(clonePosition(location.position)),
    discoveryWhen: location.discoveryWhen ? Object.freeze([...location.discoveryWhen]) : undefined,
    availableWhen: location.availableWhen ? Object.freeze([...location.availableWhen]) : undefined,
});

const requireNonEmptyString = (value: string, description: string): void => {
    if (!value.trim()) throw new Error(`World-map ${description} must not be empty`);
};

const shippedWorldMapLocations: readonly WorldMapLocation[] = [
    { id: "L73_A", level: "l73_a", entrance: "GM", position: { x: 1080, y: 326 } },
    { id: "L75", level: "l75", entrance: "GM", position: { x: 1151, y: 772 } },
    { id: "L33_1", level: "l33_1", entrance: "GM", position: { x: 1170, y: 413 } },
    { id: "L18_1", level: "l18_1", entrance: "GM", position: { x: 121, y: 485 } },
    { id: "L41", level: "l41", entrance: "GM", position: { x: 124, y: 808 } },
    { id: "L31_2", level: "l31_2", entrance: "GM", position: { x: 1298, y: 670 } },
    { id: "L32", level: "l32", entrance: "GM", position: { x: 1303, y: 82 } },
    { id: "L35", level: "l35", entrance: "GM", position: { x: 1333, y: 933 } },
    { id: "L91", level: "l91", entrance: "GM", position: { x: 1391, y: 454 } },
    { id: "L97", level: "l97", entrance: "GM", position: { x: 159, y: 730 } },
    { id: "L15", level: "l15", entrance: "GM", position: { x: 213, y: 286 } },
    { id: "L27", level: "l27", entrance: "GM", position: { x: 240, y: 532 } },
    { id: "L26", level: "l26", entrance: "GM", position: { x: 266, y: 396 } },
    { id: "L56", level: "l56", entrance: "GM", position: { x: 300, y: 26 } },
    { id: "L40_2", level: "l40_2", entrance: "GM", position: { x: 366, y: 778 } },
    { id: "L48", level: "l48", entrance: "GM", position: { x: 381, y: 141 } },
    { id: "L24", level: "l24", entrance: "GM", position: { x: 418, y: 412 } },
    { id: "L22", level: "l22", entrance: "GM", position: { x: 418, y: 606 } },
    { id: "L49", level: "l49", entrance: "GM", position: { x: 435, y: 487 } },
    { id: "L94", level: "l94", entrance: "GM", position: { x: 439, y: 336 } },
    { id: "L54", level: "l54", entrance: "GM", position: { x: 536, y: 498 } },
    { id: "L64", level: "l64", entrance: "GM", position: { x: 580, y: 113 } },
    { id: "L23", level: "l23", entrance: "GM", position: { x: 585, y: 225 } },
    { id: "L99_1", level: "l99_1", entrance: "GM", position: { x: 587, y: 716 } },
    { id: "L52_1", level: "l52_1", entrance: "GM", position: { x: 628, y: 50 } },
    { id: "L83", level: "l83", entrance: "GM", position: { x: 638, y: 997 } },
    { id: "L96", level: "l96", entrance: "GM", position: { x: 743, y: 117 } },
    { id: "L66", level: "l66", entrance: "GM", position: { x: 772, y: 566 } },
    { id: "L25_1", level: "l25_1", entrance: "GM", position: { x: 796, y: 297 } },
    { id: "L43_1", level: "l43_1", entrance: "GM", position: { x: 797, y: 730 } },
    { id: "L53", level: "l53", entrance: "GM", position: { x: 96, y: 321 } },
    { id: "L78", level: "l78", entrance: "GM", position: { x: 990, y: 669 } },
    { id: "L21_1", level: "l21_1", entrance: "GM", position: { x: 832, y: 525 } },
    { id: "L29_1", level: "l29_1", entrance: "GM", position: { x: 913, y: 531 } },
].map(freezeLocation);

const singleLevelSet = new Set(singleLevels);
for (const location of shippedWorldMapLocations) {
    if (!singleLevelSet.has(location.level)) {
        throw new Error(`Global-map location ${location.id} references unknown level ${location.level}`);
    }
}

/** Playable locations and positions declared by scripts/globalmap/pictures.scr. */
export const GOLDEN_LAND_WORLD_MAP_LOCATIONS = Object.freeze(shippedWorldMapLocations);

export class WorldMapRuntime {
    private readonly locations = new Map<string, WorldMapLocation>();
    private readonly linksByOrigin = new Map<string, readonly WorldMapTravelLink[]>();
    private readonly discovered = new Set<string>();
    private currentLocation: string;

    public constructor(private readonly options: WorldMapRuntimeOptions) {
        if (!options.locations.length) throw new Error("World map requires at least one location");

        for (const sourceLocation of options.locations) {
            const location = freezeLocation(sourceLocation);
            requireNonEmptyString(location.id, "location identifier");
            requireNonEmptyString(location.level, `level for ${location.id}`);
            requireNonEmptyString(location.entrance, `entrance for ${location.id}`);
            if (!Number.isFinite(location.position.x) || !Number.isFinite(location.position.y)) {
                throw new Error(`World-map location ${location.id} has an invalid position`);
            }
            if (this.locations.has(location.id)) throw new Error(`Duplicate world-map location ${location.id}`);
            this.validateConditions(location.discoveryWhen, `discovery condition for ${location.id}`);
            this.validateConditions(location.availableWhen, `availability condition for ${location.id}`);
            this.locations.set(location.id, location);
        }

        this.currentLocation = this.requireLocation(options.currentLocation).id;
        for (const locationId of options.discoveredLocations ?? []) this.discoverStored(locationId);
        this.discovered.add(this.currentLocation);

        const linksByOrigin = new Map<string, WorldMapTravelLink[]>();
        for (const sourceLink of options.links) {
            const link = Object.freeze(cloneLink(sourceLink));
            this.requireLocation(link.from);
            this.requireLocation(link.to);
            if (link.from === link.to) throw new Error(`World-map link ${link.from} cannot target itself`);
            if (!Number.isFinite(link.cost) || link.cost < 0) throw new Error(`World-map link ${link.from} -> ${link.to} has an invalid cost`);
            if (!Number.isFinite(link.duration) || link.duration < 0) throw new Error(`World-map link ${link.from} -> ${link.to} has an invalid duration`);
            this.validateConditions(link.availableWhen, `availability condition for ${link.from} -> ${link.to}`);
            const outgoing = linksByOrigin.get(link.from) ?? [];
            if (outgoing.some((existing) => existing.to === link.to)) {
                throw new Error(`Duplicate world-map link ${link.from} -> ${link.to}`);
            }
            outgoing.push(link);
            linksByOrigin.set(link.from, outgoing);
        }
        for (const [origin, links] of linksByOrigin) {
            this.linksByOrigin.set(origin, Object.freeze(links.sort((left, right) => left.to.localeCompare(right.to))));
        }
    }

    public getCurrentLocation(): string {
        return this.currentLocation;
    }

    public getLocations(): readonly WorldMapLocationState[] {
        return [...this.locations.values()]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((location) => ({
                ...cloneLocation(location),
                discovered: this.discovered.has(location.id),
                available: this.isLocationAvailable(location),
                current: location.id === this.currentLocation,
            }));
    }

    /** Marks a configured location as discovered after its discovery conditions pass. */
    public discover(locationId: string): WorldMapLocationState {
        const location = this.requireLocation(locationId);
        if (!this.matchesAll(location.discoveryWhen)) {
            throw new Error(`World-map location ${locationId} cannot be discovered yet`);
        }
        this.discovered.add(location.id);
        return this.getLocationState(location);
    }

    /**
     * Discovers the location represented by a loaded level and verifies that its
     * configured global-map entrance exists in that level's parsed SEF data.
     */
    public discoverLevel(level: string, sefData: SEFData): WorldMapLocationState {
        const normalizedLevel = level.toLowerCase();
        const location = [...this.locations.values()].find((candidate) => candidate.level === normalizedLevel);
        if (!location) throw new Error(`Level ${level} is not a configured world-map destination`);
        if (!sefData.entrancePoints.some((point) => point.name === location.entrance)) {
            throw new Error(`Level ${level} does not define world-map entrance ${location.entrance}`);
        }
        return this.discover(location.id);
    }

    /** Returns the shortest available route by duration, then cost, then identifier order. */
    public findRoute(destinationId: string): WorldMapRoute | undefined {
        const destination = this.requireLocation(destinationId);
        if (!this.isLocationAvailable(destination)) return undefined;
        const origin = this.requireLocation(this.currentLocation);
        if (!this.isLocationAvailable(origin)) return undefined;
        if (origin.id === destination.id) return { locations: [origin.id], links: [], cost: 0, duration: 0 };

        const candidates: RouteCandidate[] = [{ location: origin.id, links: [], cost: 0, duration: 0, key: origin.id }];
        const best = new Map<string, RouteCandidate>();
        best.set(origin.id, candidates[0]);

        while (candidates.length) {
            candidates.sort(compareCandidates);
            const candidate = candidates.shift()!;
            if (best.get(candidate.location) !== candidate) continue;
            if (candidate.location === destination.id) return this.routeFromCandidate(candidate);

            for (const link of this.linksByOrigin.get(candidate.location) ?? []) {
                const nextLocation = this.requireLocation(link.to);
                if (!this.isLocationAvailable(nextLocation) || !this.matchesAll(link.availableWhen)) continue;
                const next: RouteCandidate = {
                    location: link.to,
                    links: [...candidate.links, link],
                    cost: candidate.cost + link.cost,
                    duration: candidate.duration + link.duration,
                    key: `${candidate.key}\u0000${link.to}`,
                };
                const previous = best.get(next.location);
                if (!previous || compareCandidates(next, previous) < 0) {
                    best.set(next.location, next);
                    candidates.push(next);
                }
            }
        }
        return undefined;
    }

    /**
     * Performs one atomic cost charge after every route precondition has been
     * checked, advances the supplied clock, and requests the destination entry.
     */
    public travel(destinationId: string): WorldMapTravelResult {
        const destination = this.requireLocation(destinationId);
        if (!this.isLocationAvailable(destination)) {
            throw new Error(`World-map destination ${destinationId} is unavailable`);
        }
        const route = this.findRoute(destinationId);
        if (!route) throw new Error(`World-map destination ${destinationId} is unreachable from ${this.currentLocation}`);
        if (!this.options.host.chargeTravelCost(route.cost)) {
            throw new Error(`Insufficient funds to travel to ${destinationId}: requires ${route.cost}`);
        }

        const transition: WorldMapTransitionRequest = { level: destination.level, entrance: destination.entrance };
        this.options.host.advanceClock(route.duration);
        this.options.host.requestTransition(Object.freeze({ ...transition }));
        this.currentLocation = destination.id;
        return {
            route: {
                locations: [...route.locations],
                links: route.links.map(cloneLink),
                cost: route.cost,
                duration: route.duration,
            },
            transition,
        };
    }

    private discoverStored(locationId: string): void {
        this.discovered.add(this.requireLocation(locationId).id);
    }

    private getLocationState(location: WorldMapLocation): WorldMapLocationState {
        return {
            ...cloneLocation(location),
            discovered: this.discovered.has(location.id),
            available: this.isLocationAvailable(location),
            current: location.id === this.currentLocation,
        };
    }

    private isLocationAvailable(location: WorldMapLocation): boolean {
        return this.discovered.has(location.id) && this.matchesAll(location.availableWhen);
    }

    private matchesAll(conditions: readonly WorldMapVariableCondition[] | undefined): boolean {
        return !conditions || conditions.every((condition) => this.matchesCondition(condition));
    }

    private matchesCondition(condition: WorldMapVariableCondition): boolean {
        const currentValue = this.options.host.getVariable(condition.variable);
        switch (condition.operator ?? "truthy") {
            case "truthy": return Boolean(currentValue);
            case "equals": return currentValue === condition.value;
            case "notEquals": return currentValue !== condition.value;
            case "atLeast": return typeof currentValue === "number" && typeof condition.value === "number" && currentValue >= condition.value;
            case "lessThan": return typeof currentValue === "number" && typeof condition.value === "number" && currentValue < condition.value;
        }
    }

    private validateConditions(conditions: readonly WorldMapVariableCondition[] | undefined, description: string): void {
        for (const condition of conditions ?? []) {
            requireNonEmptyString(condition.variable, description);
            if ((condition.operator === "equals" || condition.operator === "notEquals" || condition.operator === "atLeast" || condition.operator === "lessThan") && !("value" in condition)) {
                throw new Error(`World-map ${description} requires a comparison value`);
            }
            if ((condition.operator === "atLeast" || condition.operator === "lessThan") && typeof condition.value !== "number") {
                throw new Error(`World-map ${description} requires a numeric comparison value`);
            }
        }
    }

    private requireLocation(locationId: string): WorldMapLocation {
        const location = this.locations.get(locationId);
        if (!location) throw new Error(`Unknown world-map location ${locationId}`);
        return location;
    }

    private routeFromCandidate(candidate: RouteCandidate): WorldMapRoute {
        return {
            locations: [this.currentLocation, ...candidate.links.map((link) => link.to)],
            links: candidate.links.map(cloneLink),
            cost: candidate.cost,
            duration: candidate.duration,
        };
    }
}
