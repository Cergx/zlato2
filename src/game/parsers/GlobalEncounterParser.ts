export type EncounterDisposition = "evil" | "good";

export interface GlobalEncounterPerson {
    readonly technicalName: string;
    readonly group: number;
    readonly dayWeight: number;
    readonly nightWeight: number;
}

export interface GlobalEncounterSide {
    readonly disposition: EncounterDisposition;
    readonly priority: number;
    readonly groupCount: number;
    readonly persons: readonly GlobalEncounterPerson[];
}

export interface GlobalEncounterDefinition {
    readonly chance: number;
    readonly sides: readonly GlobalEncounterSide[];
}

const PERSON_PATTERN = /^person\s*:\s*"([^"]+)"\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/i;

export const parseGlobalEncounterDefinition = (source: string): GlobalEncounterDefinition => {
    const lines = source.replace(/\r/g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "").trim()).filter(Boolean);
    const chanceLine = lines.find((line) => /^chance\s*:/i.test(line));
    const chance = Number(chanceLine?.split(":", 2)[1]);
    if (!Number.isFinite(chance) || chance < 0 || chance > 100) throw new Error("Global encounter chance must be between 0 and 100");
    const sides: GlobalEncounterSide[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const match = /^(evil|good)\s*:\s*(-?\d+)$/i.exec(lines[index]);
        if (!match) continue;
        const disposition = match[1].toLowerCase() as EncounterDisposition;
        const priority = Number(match[2]);
        while (index < lines.length && lines[index] !== "{") index += 1;
        index += 1;
        let groupCount = 0;
        const persons: GlobalEncounterPerson[] = [];
        for (; index < lines.length && lines[index] !== "}"; index += 1) {
            const groupMatch = /^groups\s*:\s*(\d+)$/i.exec(lines[index]);
            if (groupMatch) {
                groupCount = Number(groupMatch[1]);
                continue;
            }
            const personMatch = PERSON_PATTERN.exec(lines[index]);
            if (!personMatch) throw new Error(`Unsupported global encounter line: ${lines[index]}`);
            persons.push({
                technicalName: personMatch[1],
                group: Number(personMatch[2]),
                dayWeight: Number(personMatch[3]),
                nightWeight: Number(personMatch[4]),
            });
        }
        if (groupCount <= 0) throw new Error(`Global encounter ${disposition} has no groups`);
        if (persons.some((person) => person.group < 0 || person.group > groupCount)) {
            throw new Error(`Global encounter ${disposition} references an invalid group`);
        }
        sides.push({ disposition, priority, groupCount, persons });
    }
    if (sides.length === 0) throw new Error("Global encounter has no sides");
    return { chance, sides };
};

export const loadGlobalEncounterDefinition = async (name: string): Promise<GlobalEncounterDefinition> => {
    const normalized = name.replace(/\.dsc$/i, "").replace(/[^a-z0-9_]/gi, "");
    const response = await fetch(`/assets/scripts/globalmap/czdescriptions/${normalized}.dsc`);
    if (!response.ok) throw new Error(`Global encounter ${name} failed: HTTP ${response.status}`);
    const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
    return parseGlobalEncounterDefinition(source);
};
