import { loadCSX } from "./Assets.ts";
import { loadGlobalEncounterDefinition, type GlobalEncounterDefinition } from "./parsers/GlobalEncounterParser.ts";
import { SDBParser, type SDBData } from "./parsers/SDBParser.ts";

export interface NativeGlobalMapPicture {
    readonly locationId: string;
    readonly x: number;
    readonly y: number;
    readonly source: string;
}

export interface NativeGlobalMapEntry {
    readonly level: string;
    readonly label: string;
}

export interface NativeGlobalMapLocation {
    readonly id: string;
    readonly level: string;
    readonly entrance: "GM";
    readonly x: number;
    readonly y: number;
    readonly label: string;
    readonly color: number;
    readonly subLevels: readonly string[];
    readonly entries?: readonly NativeGlobalMapEntry[];
    readonly picture?: NativeGlobalMapPicture;
}

export interface NativeGlobalMapRegionLabel {
    readonly text: string;
    readonly x: number;
    readonly y: number;
}

export interface NativeGlobalMapCrimeZone {
    readonly id: string;
    readonly color: number;
    readonly levels: readonly string[];
    readonly encounter: GlobalEncounterDefinition;
}

export interface NativeGlobalMapAudioEntry {
    readonly color: number;
    readonly source: string;
}

export interface NativeGlobalMapAudioSource {
    readonly x: number;
    readonly y: number;
    readonly source: string;
}

export interface NativeGlobalMapAudioData {
    readonly music: readonly NativeGlobalMapAudioEntry[];
    readonly environments: readonly NativeGlobalMapAudioEntry[];
    readonly sources: readonly NativeGlobalMapAudioSource[];
    readonly musicColors: Uint32Array;
    readonly environmentColors: Uint32Array;
    readonly environmentVolume: Uint8Array;
}

export interface NativeGlobalMapData {
    readonly locations: readonly NativeGlobalMapLocation[];
    readonly regions: readonly NativeGlobalMapRegionLabel[];
    readonly crimeZones: readonly NativeGlobalMapCrimeZone[];
    readonly mapWidth: 1600;
    readonly mapHeight: 1200;
    readonly maskWidth: 400;
    readonly maskHeight: 300;
    readonly noWayColor: number;
    readonly zoneColors: Uint32Array;
    readonly probability: Uint8Array;
    readonly audio: NativeGlobalMapAudioData;
}

const textAsset = async (path: string): Promise<string> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Global-map asset ${path} failed: HTTP ${response.status}`);
    return new TextDecoder("windows-1251").decode(await response.arrayBuffer());
};

const rgb = (red: number, green: number, blue: number): number => (red << 16) | (green << 8) | blue;


interface MutableLocation {
    id: string;
    level: string;
    entrance: "GM";
    x: number;
    y: number;
    label: string;
    color: number;
    subLevels: string[];
    picture?: NativeGlobalMapPicture;
}

interface MutableCrimeZone {
    id: string;
    color: number;
    levels: string[];
}

const sdbAsset = async (path: string): Promise<SDBData> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Global-map SDB ${path} failed: HTTP ${response.status}`);
    return new SDBParser(await response.arrayBuffer()).getData();
};

const parsePictures = (source: string): Map<string, NativeGlobalMapPicture> => {
    const pictures = new Map<string, NativeGlobalMapPicture>();
    for (const rawLine of source.replace(/\r/g, "").split("\n")) {
        const line = rawLine.replace(/\/\/.*$/, "").trim();
        const match = /^locimage\s+"([^"]+)"\s+(-?\d+)\s+(-?\d+)\s+"([^"]+)"/i.exec(line);
        if (!match) continue;
        pictures.set(match[1].toUpperCase(), Object.freeze({
            locationId: match[1].toUpperCase(),
            x: Number(match[2]),
            y: Number(match[3]),
            source: `${match[4]}.bmp`,
        }));
    }
    return pictures;
};

const parseColors = (source: string, pictures: ReadonlyMap<string, NativeGlobalMapPicture>, visibleLabels: ReadonlyMap<string, string>): {
    locations: MutableLocation[];
    crimeZones: MutableCrimeZone[];
    noWayColor: number;
} => {
    const locations: MutableLocation[] = [];
    const crimeZones: MutableCrimeZone[] = [];
    let noWayColor = rgb(255, 0, 255);
    let currentLocation: MutableLocation | undefined;
    let currentCrimeZone: MutableCrimeZone | undefined;

    for (const rawLine of source.replace(/\r/g, "").split("\n")) {
        const [content] = rawLine.split("//", 2);
        const line = content.trim();
        if (!line) continue;
        const noWay = /^no_way_zone\s+(\d+)\s+(\d+)\s+(\d+)/i.exec(line);
        if (noWay) {
            noWayColor = rgb(Number(noWay[1]), Number(noWay[2]), Number(noWay[3]));
            currentLocation = undefined;
            currentCrimeZone = undefined;
            continue;
        }
        const location = /^loc\s+(\d+)\s+(\d+)\s+(\d+)\s+"([^"]+)"\s+(-?\d+)\s+(-?\d+)/i.exec(line);
        if (location) {
            const id = location[4].toUpperCase();
            currentLocation = {
                id,
                level: id.toLowerCase(),
                entrance: "GM",
                x: Number(location[5]),
                y: Number(location[6]),
                label: visibleLabels.get(id.toLowerCase()) ?? id,
                color: rgb(Number(location[1]), Number(location[2]), Number(location[3])),
                subLevels: [],
                picture: pictures.get(id),
            };
            locations.push(currentLocation);
            currentCrimeZone = undefined;
            continue;
        }
        const crime = /^crime_zone\s+(\d+)\s+(\d+)\s+(\d+)\s+"([^"]+)"/i.exec(line);
        if (crime) {
            currentCrimeZone = {
                id: crime[4].toLowerCase(),
                color: rgb(Number(crime[1]), Number(crime[2]), Number(crime[3])),
                levels: [],
            };
            crimeZones.push(currentCrimeZone);
            currentLocation = undefined;
            continue;
        }
        const subLocation = /^sub_loc\s+"([^"]+)"/i.exec(line);
        if (!subLocation) continue;
        const level = subLocation[1].toLowerCase();
        if (currentLocation) currentLocation.subLevels.push(level);
        else if (currentCrimeZone) currentCrimeZone.levels.push(level);
    }
    return { locations, crimeZones, noWayColor };
};

const parseRegions = (source: string): readonly NativeGlobalMapRegionLabel[] => {
    const regions: NativeGlobalMapRegionLabel[] = [];
    for (const rawLine of source.replace(/\r/g, "").split("\n")) {
        const match = /^region_name:\s*(-?\d+)\s+(-?\d+)\s+\d+\s*(?:\/\/\s*(.+))?$/i.exec(rawLine.trim());
        if (match) regions.push(Object.freeze({ x: Number(match[1]), y: Number(match[2]), text: match[3]?.trim() ?? "" }));
    }
    return Object.freeze(regions);
};

const audioSource = (source: string): string => {
    const normalized = source.trim().replace(/\\/g, "/");
    if (/^sounds\//i.test(normalized) && !/\.[a-z0-9]+$/i.test(normalized)) return `${normalized}.wav`;
    return normalized;
};

export const parseNativeGlobalMapAudioDefinition = (source: string): {
    music: NativeGlobalMapAudioEntry[];
    environments: NativeGlobalMapAudioEntry[];
    sources: NativeGlobalMapAudioSource[];
} => {
    const music: NativeGlobalMapAudioEntry[] = [];
    const environments: NativeGlobalMapAudioEntry[] = [];
    const sources: NativeGlobalMapAudioSource[] = [];
    for (const rawLine of source.replace(/\r/g, "").split("\n")) {
        const line = rawLine.replace(/\/\/.*$/, "").trim();
        const area = /^(music|environment)\s+(\d+)\s+(\d+)\s+(\d+)\s+"([^"]+)"/i.exec(line);
        if (area) {
            const entry = Object.freeze({
                color: rgb(Number(area[2]), Number(area[3]), Number(area[4])),
                source: audioSource(area[5]),
            });
            (area[1].toLowerCase() === "music" ? music : environments).push(entry);
            continue;
        }
        const point = /^source\s+(-?\d+)\s+(-?\d+)\s+"([^"]+)"/i.exec(line);
        if (point) sources.push(Object.freeze({ x: Number(point[1]), y: Number(point[2]), source: audioSource(point[3]) }));
    }
    return { music, environments, sources };
};


const canvasPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Global-map CSX canvas has no 2D context");
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
};
export const joinLocationLabels = (technicalNames: SDBData, literaryNames: SDBData): Map<string, string> => {
    const labels = new Map<string, string>();
    for (const [index, technicalName] of Object.entries(technicalNames)) {
        const literaryName = literaryNames[Number(index)];
        if (technicalName && literaryName && literaryName !== "Item inserting") {
            labels.set(technicalName.toLowerCase(), literaryName);
        }
    }
    return labels;
};

// gm_reg_vis.sdb omits L77 (the "нападение пиратов" special encounter) from both the
// technical and visible name tables; its only authored name is the gm_colors.ini /
// pictures.scr comment. Keep it as an explicit exception rather than a comment fallback.
export const SPECIAL_MAP_LABELS: Readonly<Record<string, string>> = {
    l77: "Нападение пиратов",
};


let dataPromise: Promise<NativeGlobalMapData> | undefined;

export const loadNativeGlobalMapData = (): Promise<NativeGlobalMapData> => dataPromise ??= (async () => {
    const [
        colorsSource, picturesSource, regionsSource, noWayCanvas, probabilityCanvas,
        audioSourceData, musicCanvas, environmentCanvas, environmentVolumeCanvas,
        locationTechnicalNames,
        locationLiteraryNames,
        locationVisibleNames,
    ] = await Promise.all([
        textAsset("/assets/scripts/globalmap/gm_colors.ini"),
        textAsset("/assets/scripts/globalmap/pictures.scr"),
        textAsset("/assets/scripts/globalmap/region_names.scr"),
        // map_noway.csx uses its magenta fill for blocked cells; keep the background opaque for passability sampling.
        loadCSX("/assets/engineres/globalmap/map_noway.csx", { magentaTransparent: false, backgroundTransparent: false }),
        loadCSX("/assets/engineres/globalmap/probability.csx", { magentaTransparent: false }),
        textAsset("/assets/scripts/globalmap/soundmap/gmsound.dsc"),
        loadCSX("/assets/engineres/globalmap/soundmap/map_snd_music.csx", { magentaTransparent: false }),
        loadCSX("/assets/engineres/globalmap/soundmap/map_snd_effects.csx", { magentaTransparent: false }),
        loadCSX("/assets/engineres/globalmap/soundmap/map_snd_effects_volume.csx", { magentaTransparent: false }),
        sdbAsset("/assets/sdb/globalmap/gm_loc_tech.sdb"),
        sdbAsset("/assets/sdb/globalmap/gm_loc_lit.sdb"),
        sdbAsset("/assets/sdb/globalmap/gm_reg_vis.sdb"),
    ]);
    if (!noWayCanvas || !probabilityCanvas || !musicCanvas || !environmentCanvas || !environmentVolumeCanvas) {
        throw new Error("Global-map masks failed to load");
    }
    const maskCanvases = [noWayCanvas, probabilityCanvas, musicCanvas, environmentCanvas, environmentVolumeCanvas];
    if (maskCanvases.some((canvas) => canvas.width !== 400 || canvas.height !== 300)) {
        throw new Error("Global-map masks must be 400x300");
    }

    const pictures = parsePictures(picturesSource);
    const locationVisibleLabels = joinLocationLabels(locationTechnicalNames, locationVisibleNames);
    for (const [id, label] of Object.entries(SPECIAL_MAP_LABELS)) locationVisibleLabels.set(id, label);
    const parsed = parseColors(colorsSource, pictures, locationVisibleLabels);
    const locationEntryLabels = joinLocationLabels(locationTechnicalNames, locationLiteraryNames);
    const encounters = await Promise.all(parsed.crimeZones.map((zone) => loadGlobalEncounterDefinition(zone.id)));
    const noWayPixels = canvasPixels(noWayCanvas);
    const probabilityPixels = canvasPixels(probabilityCanvas);
    const musicPixels = canvasPixels(musicCanvas);
    const environmentPixels = canvasPixels(environmentCanvas);
    const environmentVolumePixels = canvasPixels(environmentVolumeCanvas);
    const audio = parseNativeGlobalMapAudioDefinition(audioSourceData);
    const zoneColors = new Uint32Array(400 * 300);
    const probability = new Uint8Array(400 * 300);
    const musicColors = new Uint32Array(400 * 300);
    const environmentColors = new Uint32Array(400 * 300);
    const environmentVolume = new Uint8Array(400 * 300);
    for (let index = 0; index < zoneColors.length; index += 1) {
        const offset = index * 4;
        zoneColors[index] = rgb(noWayPixels[offset], noWayPixels[offset + 1], noWayPixels[offset + 2]);
        probability[index] = probabilityPixels[offset];
        musicColors[index] = rgb(musicPixels[offset], musicPixels[offset + 1], musicPixels[offset + 2]);
        environmentColors[index] = rgb(environmentPixels[offset], environmentPixels[offset + 1], environmentPixels[offset + 2]);
        environmentVolume[index] = environmentVolumePixels[offset];
    }

    return Object.freeze({
        locations: Object.freeze(parsed.locations.map((location) => Object.freeze({
            ...location,
            subLevels: Object.freeze([...location.subLevels]),
            entries: Object.freeze([location.level, ...location.subLevels]
                .map((level) => Object.freeze({
                    level,
                    label: locationEntryLabels.get(level) ?? level,
                }))),
        }))),
        regions: parseRegions(regionsSource),
        crimeZones: Object.freeze(parsed.crimeZones.map((zone, index) => Object.freeze({
            ...zone,
            levels: Object.freeze([...zone.levels]),
            encounter: encounters[index],
        }))),
        mapWidth: 1600,
        mapHeight: 1200,
        maskWidth: 400,
        maskHeight: 300,
        noWayColor: parsed.noWayColor,
        zoneColors,
        probability,
        audio: Object.freeze({
            music: Object.freeze(audio.music),
            environments: Object.freeze(audio.environments),
            sources: Object.freeze(audio.sources),
            musicColors,
            environmentColors,
            environmentVolume,
        }),
    });
})();
