import { Paths } from "../constants/paths.ts";
import type { FactionRelation } from "./systems/Combat.ts";

export interface NativeFactionRelation {
    readonly from: string;
    readonly to: string;
    readonly relation: FactionRelation;
}

export interface AllyPortraitMapping {
    readonly personResource: string;
    readonly portraitResource: string;
}

const optionalWindows1251Text = async (path: string): Promise<string | undefined> => {
    const response = await fetch(path);
    if (!response.ok) return undefined;
    return new TextDecoder("windows-1251").decode(await response.arrayBuffer());
};

const stripComments = (source: string): string => source.replace(/\/\/[^\r\n]*/g, "");

export const parseNativeFactionRelations = (source: string): NativeFactionRelation[] => {
    const relations: NativeFactionRelation[] = [];
    const clean = stripComments(source);
    const blockPattern = /\[([^\]]+)]\s*\{([^}]*)}/g;
    for (const block of clean.matchAll(blockPattern)) {
        const from = block[1].trim().toLowerCase();
        const entryPattern = /([\w.]+)\s+"(VERY_EVIL|EVIL|NEUTRAL|GOOD|VERY_GOOD)"/gi;
        for (const entry of block[2].matchAll(entryPattern)) {
            const to = entry[1].toLowerCase();
            if (to === from) continue;
            const value = entry[2].toUpperCase();
            const relation: FactionRelation = value === "NEUTRAL"
                ? "neutral"
                : value === "EVIL" || value === "VERY_EVIL"
                    ? "hostile"
                    : "friendly";
            relations.push({ from, to, relation });
        }
    }
    return relations;
};

export const loadNativeFactionRelations = async (): Promise<readonly NativeFactionRelation[]> => {
    const source = await optionalWindows1251Text(`${Paths.SCRIPTS}/tribes.scr`);
    return source ? parseNativeFactionRelations(source) : [];
};

export const parseAllyPortraitMappings = (source: string): AllyPortraitMapping[] => {
    const mappings: AllyPortraitMapping[] = [];
    const clean = stripComments(source);
    const entryPattern = /"([^"]+)"\s+"([^"]+)"/g;
    for (const entry of clean.matchAll(entryPattern)) {
        mappings.push({
            personResource: entry[1].toLowerCase(),
            portraitResource: entry[2].toLowerCase(),
        });
    }
    return mappings;
};

export const loadAllyPortraitMappings = async (): Promise<readonly AllyPortraitMapping[]> => {
    const source = await optionalWindows1251Text(`${Paths.SCRIPTS}/ally_sprite.scr`);
    return source ? parseAllyPortraitMappings(source) : [];
};

export const loadPersonResourceName = async (technicalName: string): Promise<string> => {
    const source = await optionalWindows1251Text(Paths.PERSON_SCRIPT(technicalName));
    return /\bres_name\s*:\s*"([^"]+)"/i.exec(source ?? "")?.[1].toLowerCase() ?? technicalName.toLowerCase();
};
