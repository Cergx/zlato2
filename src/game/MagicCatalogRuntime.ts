import { Paths } from "../constants/paths.ts";
import { SDBParser } from "./parsers/SDBParser.ts";

export type MagicSchool = "gods" | "light" | "nature" | "elements" | "shadows" | "dark";
export type MagicTarget = "ally" | "enemy";
export type MagicValueMode = "absolute" | "relative" | "replace";
export type MagicDamageChannel = MagicSchool | "fire" | "cold" | "poison" | "crushing" | "hacking" | "pricking";

export interface MagicSpecialDefinition {
    readonly id: string;
    readonly baseValue: number;
    readonly valueCoefficient: number;
    readonly baseDuration: number;
    readonly durationCoefficient: number;
    readonly valueMode: MagicValueMode;
    readonly immediate: boolean;
}

export interface MagicDefinition {
    readonly id: number;
    readonly technicalName: string;
    readonly literaryName: string;
    readonly school: MagicSchool;
    readonly target: MagicTarget;
    readonly healing: boolean;
    readonly aimed: boolean;
    readonly realtime: boolean;
    readonly radius: number;
    readonly actionPointBase: number;
    readonly actionPointCoefficient: number;
    readonly energyBase: number;
    readonly energyCoefficient: number;
    readonly specials: readonly MagicSpecialDefinition[];
    readonly executable: boolean;
}
export interface MagicCastResult {
    readonly spellId: number;
    readonly technicalName: string;
    readonly target: string;
    readonly resisted: boolean;
    readonly energyBefore: number;
    readonly energyAfter: number;
    readonly actionPointsBefore: number;
    readonly actionPointsAfter: number;
    readonly damage: number;
    readonly healing: number;
    readonly energyChange: number;
    readonly actionPointChange: number;
    readonly killed: boolean;
    readonly effectsApplied: number;
}

const SCHOOL_NAMES: Readonly<Record<string, MagicSchool>> = {
    GOD: "gods",
    LIGHT: "light",
    NATURE: "nature",
    ELEMENTALS: "elements",
    SHADOW: "shadows",
    DARK: "dark",
};

const IMMEDIATE_SPECIALS = new Set([
    "IDSPEC_HEALTH_CURRENT",
    "IDSPEC_ENERGY_CURRENT",
    "IDSPEC_DISPELL",
    "IDSPEC_MAP_WALKER",
    "IDSPEC_SUMMON_DEMISHADOW",
    "IDSPEC_SUMMON_ICE_BEAST",
    "IDSPEC_SUMMON_WINGED_DEMON",
    "IDSPEC_SUMMON_VIOLIA",
]);

const TIMED_SPECIALS = new Set([
    "IDSPEC_ACTION_POINTS", "IDSPEC_ARMOR_CLASS", "IDSPEC_CHT_CRITICAL_HIT", "IDSPEC_CHT_CRITICAL_MISS",
    "IDSPEC_CHT_HIT", "IDSPEC_CHT_HIT_THROWING", "IDSPEC_COLD_RES", "IDSPEC_CONSTITUTION",
    "IDSPEC_CRUSHING_RES", "IDSPEC_DARKNESS_MAGIC_IMMUN", "IDSPEC_DARKNESS_MAGIC_RES", "IDSPEC_DEXTERITY",
    "IDSPEC_DMG_THROWING", "IDSPEC_ELEMENTS_MAGIC_IMMUN", "IDSPEC_ELEMENTS_MAGIC_RES",
    "IDSPEC_ENERGY_REGENERATE_TIME", "IDSPEC_FIRE_RES", "IDSPEC_GODS_MAGIC_IMMUN", "IDSPEC_GODS_MAGIC_RES",
    "IDSPEC_HACKING_RES", "IDSPEC_HEALTH_REGENERATE_TIME", "IDSPEC_INITIATIVE", "IDSPEC_INTELLIGENCE",
    "IDSPEC_LIGHTNESS_MAGIC_IMMUN", "IDSPEC_LIGHTNESS_MAGIC_RES", "IDSPEC_LUCK", "IDSPEC_MAX_HEALTH",
    "IDSPEC_MOD_CRITICAL_HIT", "IDSPEC_NATURE_MAGIC_IMMUN", "IDSPEC_NATURE_MAGIC_RES", "IDSPEC_POISON_RES",
    "IDSPEC_PRICKING_RES", "IDSPEC_SHADOWS_MAGIC_IMMUN", "IDSPEC_SHADOWS_MAGIC_RES", "IDSPEC_SILENCE",
    "IDSPEC_STRENGTH", "IDSPEC_WISDOM",
]);

const DAMAGE_CHANNELS: Readonly<Record<string, MagicDamageChannel>> = {
    IDSPEC_CRUSHING_DMG: "crushing",
    IDSPEC_HACKING_DMG: "hacking",
    IDSPEC_PRICKING_DMG: "pricking",
    IDSPEC_FIRE_DMG: "fire",
    IDSPEC_COLD_DMG: "cold",
    IDSPEC_POISON_DMG: "poison",
    IDSPEC_GODS_MAGIC_DMG: "gods",
    IDSPEC_LIGHTNESS_MAGIC_DMG: "light",
    IDSPEC_NATURE_MAGIC_DMG: "nature",
    IDSPEC_ELEMENTS_MAGIC_DMG: "elements",
    IDSPEC_SHADOWS_MAGIC_DMG: "shadows",
    IDSPEC_DARKNESS_MAGIC_DMG: "dark",
};

let catalogPromise: Promise<readonly MagicDefinition[]> | undefined;

const integer = (value: string | undefined, fallback = 0): number => {
    if (value === undefined) return fallback;
    const parsed = Number(value.replace(/^"|"$/g, ""));
    if (!Number.isSafeInteger(parsed)) throw new Error(`Magic scalar must be an integer, received ${value}`);
    return parsed;
};

const scalarLines = (source: string): Readonly<Record<string, string>> => {
    const values: Record<string, string> = {};
    for (const originalLine of source.split(/\r?\n/)) {
        const line = originalLine.trim();
        if (!line || line === "{" || line === "}") continue;
        const match = /^(\w+)\s+(.+)$/.exec(line);
        if (match) values[match[1]] = match[2].trim();
    }
    return values;
};

const extractBlock = (source: string, openingBrace: number): { readonly body: string; readonly end: number } => {
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}") {
            depth -= 1;
            if (depth === 0) return { body: source.slice(openingBrace + 1, index), end: index + 1 };
        }
    }
    throw new Error(`Unclosed magic block at byte ${openingBrace}`);
};

const parseSpecials = (body: string): { readonly specials: readonly MagicSpecialDefinition[]; readonly scalarBody: string } => {
    const specials: MagicSpecialDefinition[] = [];
    let scalarBody = "";
    let cursor = 0;
    const pattern = /\bspecial\s*:\s*([A-Z0-9_]+)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
        scalarBody += body.slice(cursor, match.index);
        const block = extractBlock(body, match.index + match[0].lastIndexOf("{"));
        const values = scalarLines(block.body);
        const flags = values.flags ?? "";
        const valueMode: MagicValueMode = flags.includes("SPECF_VALUE_REPLACE")
            ? "replace"
            : flags.includes("SPECF_VALUE_CHANGE_RELATIVE") ? "relative" : "absolute";
        specials.push({
            id: match[1],
            baseValue: integer(values.base_value),
            valueCoefficient: integer(values.k_value),
            baseDuration: integer(values.base_duration),
            durationCoefficient: integer(values.k_duration),
            valueMode,
            immediate: flags.includes("SPECF_TIME_IMMEDIATE"),
        });
        cursor = block.end;
        pattern.lastIndex = block.end;
    }
    scalarBody += body.slice(cursor);
    return { specials, scalarBody };
};

interface ParsedMagicBlock {
    readonly technicalName: string;
    readonly values: Readonly<Record<string, string>>;
    readonly specials: readonly MagicSpecialDefinition[];
}

const parseMagicBlocks = (source: string): readonly ParsedMagicBlock[] => {
    const clean = source.replace(/\/\/.*$/gm, "");
    const definitions: ParsedMagicBlock[] = [];
    const pattern = /\bmagic\s*:\s*"([^"]+)"\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(clean)) !== null) {
        const block = extractBlock(clean, match.index + match[0].lastIndexOf("{"));
        const parsed = parseSpecials(block.body);
        definitions.push({ technicalName: match[1].toLowerCase(), values: scalarLines(parsed.scalarBody), specials: parsed.specials });
        pattern.lastIndex = block.end;
    }
    return definitions;
};

const loadArrayBuffer = async (path: string): Promise<ArrayBuffer> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Magic asset ${path} failed: HTTP ${response.status}`);
    if (response.headers.get("content-type")?.includes("text/html")) throw new Error(`Magic asset ${path} resolved to the application shell`);
    return response.arrayBuffer();
};

export const parseMagicCatalog = (
    source: string,
    technicalNames: Readonly<Record<number, string>>,
    literaryNames: Readonly<Record<number, string>>,
): readonly MagicDefinition[] => {
    const blocks = new Map(parseMagicBlocks(source).map((block) => [block.technicalName, block]));
    const ids = Object.keys(technicalNames).map(Number)
        .filter((id) => Number.isSafeInteger(id) && id >= 0 && id < 78)
        .sort((left, right) => left - right);
    const definitions = ids.map((id): MagicDefinition => {
        const technicalName = technicalNames[id]?.toLowerCase();
        const block = technicalName ? blocks.get(technicalName) : undefined;
        if (!technicalName || !block) throw new Error(`Magic id ${id} has no matching magic.scr definition`);
        const schoolName = block.values.school?.replace(/^"|"$/g, "");
        const school = schoolName ? SCHOOL_NAMES[schoolName] : undefined;
        if (!school) throw new Error(`Magic ${technicalName} has unsupported school ${schoolName ?? "<none>"}`);
        const typeFlags = block.values.type_flags ?? "";
        const target: MagicTarget | undefined = typeFlags.includes("FMT_TARGET_ENEMY")
            ? "enemy"
            : typeFlags.includes("FMT_TARGET_ALLY") ? "ally" : undefined;
        if (!target) throw new Error(`Magic ${technicalName} has no ally/enemy target flag`);
        return {
            id,
            technicalName,
            literaryName: literaryNames[id] ?? technicalName,
            school,
            target,
            healing: typeFlags.includes("FMT_HEALING"),
            aimed: integer(block.values.aimed_cast) !== 0,
            realtime: integer(block.values.rt_mode) !== 0,
            radius: integer(block.values.radius_damage),
            actionPointBase: integer(block.values.base_AP),
            actionPointCoefficient: integer(block.values.k_AP),
            energyBase: integer(block.values.base_EP),
            energyCoefficient: integer(block.values.k_EP),
            specials: block.specials,
            executable: block.specials.length > 0 && block.specials.every((special) => (
                DAMAGE_CHANNELS[special.id] !== undefined || IMMEDIATE_SPECIALS.has(special.id) || TIMED_SPECIALS.has(special.id)
            )),
        };
    });
    if (definitions.length !== 78) throw new Error(`Expected 78 player spells, parsed ${definitions.length}`);
    return definitions;
};

export const loadMagicCatalog = (): Promise<readonly MagicDefinition[]> => {
    catalogPromise ??= Promise.all([
        loadArrayBuffer(`${Paths.SCRIPTS}/magic.scr`),
        loadArrayBuffer(`${Paths.SDB}/magic/magictechnames.sdb`),
        loadArrayBuffer(`${Paths.SDB}/magic/magiclitnames.sdb`),
    ]).then(([sourceBuffer, technicalBuffer, literaryBuffer]) => parseMagicCatalog(
        new TextDecoder("windows-1251").decode(sourceBuffer),
        new SDBParser(technicalBuffer).getData(),
        new SDBParser(literaryBuffer).getData(),
    ));
    return catalogPromise;
};

export const magicValue = (special: MagicSpecialDefinition, power = 1): number =>
    Math.round(special.baseValue + special.valueCoefficient * power);

export const magicDuration = (special: MagicSpecialDefinition, power = 1): number =>
    Math.max(0, Math.round(special.baseDuration + special.durationCoefficient * power));

export const magicActionPointCost = (magic: MagicDefinition, power = 1): number =>
    Math.max(0, Math.round(magic.actionPointBase + magic.actionPointCoefficient * power));

export const magicEnergyCost = (magic: MagicDefinition, power = 1): number =>
    Math.max(0, Math.round(magic.energyBase + magic.energyCoefficient * power));

export const magicDamageChannel = (specialId: string): MagicDamageChannel | undefined => DAMAGE_CHANNELS[specialId];
