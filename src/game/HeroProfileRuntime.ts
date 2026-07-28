/** GoldenLand.ini `cl_username`, CP1251 file offset 0x4a in the original installation. */
export const DEFAULT_HERO_NAME = "Вертас";

export interface HeroProfile {
    readonly name: string;
    readonly parameters: Readonly<Record<string, number>>;
    readonly experience: number;
}

const PROFILE_PARAMETERS = new Set([
    "strength",
    "constitution",
    "dexterity",
    "perception",
    "intelligence",
    "wisdom",
    "luck",
    "reputation",
]);

const findClosingBrace = (source: string, openingBrace: number): number => {
    let depth = 1;
    for (let index = openingBrace + 1; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}" && --depth === 0) return index;
    }
    throw new Error(`Hero profile block at ${openingBrace} is missing its closing brace`);
};

const extractBlock = (source: string, name: string): string | undefined => {
    const match = new RegExp(`\\b${name}\\s*:\\s*\\{`, "i").exec(source);
    if (!match) return undefined;
    const openingBrace = source.indexOf("{", match.index);
    return source.slice(openingBrace + 1, findClosingBrace(source, openingBrace));
};

const parseNumericAssignments = (source: string): Readonly<Record<string, number>> => {
    const values: Record<string, number> = {};
    const assignment = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:?\s*(-?\d+)\s*$/gm;
    for (const match of source.matchAll(assignment)) values[match[1].toLowerCase()] = Number(match[2]);
    return values;
};

export const parseHeroProfiles = (source: string): readonly HeroProfile[] => {
    const normalized = source.replace(/\/\/.*$/gm, "");
    const profiles: HeroProfile[] = [];
    const header = /\bname\s*:\s*"([^"]+)"\s*\{/gi;
    for (const match of normalized.matchAll(header)) {
        const openingBrace = normalized.indexOf("{", match.index);
        const closingBrace = findClosingBrace(normalized, openingBrace);
        const body = normalized.slice(openingBrace + 1, closingBrace);
        const topLevel = parseNumericAssignments(body
            .replace(/\bskills\s*:\s*\{[\s\S]*?\}/i, "")
            .replace(/\bpoints_left\s*:\s*\{[\s\S]*?\}/i, ""));
        const skills = parseNumericAssignments(extractBlock(body, "skills") ?? "");
        const points = parseNumericAssignments(extractBlock(body, "points_left") ?? "");
        const parameters: Record<string, number> = {};
        for (const [name, value] of Object.entries(topLevel)) {
            if (PROFILE_PARAMETERS.has(name)) parameters[name] = value;
        }
        Object.assign(parameters, skills, points);
        profiles.push({
            name: match[1],
            parameters,
            experience: topLevel.experience ?? 0,
        });
    }
    if (profiles.length === 0) throw new Error("The shipped hero profile script contains no profiles");
    return profiles;
};

export const selectHeroProfile = (profiles: readonly HeroProfile[], name: string): HeroProfile => {
    const profile = profiles.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!profile) throw new Error(`Unknown shipped hero profile ${name}`);
    return profile;
};
