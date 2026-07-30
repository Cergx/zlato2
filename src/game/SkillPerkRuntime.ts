import { originalInitiative, originalScoutCaution, originalTalkativeness } from "./systems/Combat.ts";
import { HERO_GENERATOR_NATIVE_LAYOUT } from "../constants/clientDll.ts";
import type { SDBData } from "./parsers/SDBParser.ts";

export const NATIVE_SKILL_PERK_THRESHOLDS = Object.freeze([1, 5, 10, 15] as const);

const SKILL_PERK_BASE_IDS: Readonly<Record<string, number>> = Object.freeze({
    skill_godsmag: 0,
    skill_elemmag: 4,
    skill_lghtmag: 8,
    skill_darkmag: 12,
    skill_shadmag: 16,
    skill_natrmag: 20,
    skill_athletic: 24,
    skill_wpn_crush: 28,
    skill_wpn_staff: 32,
    skill_wpn_dist: 36,
    skill_wpn_spear: 40,
    skill_wpn_throw: 44,
    skill_wpn_sword: 48,
    skill_wpn_axe: 52,
    skill_wpn_hand: 56,
    skill_scout: 60,
    skill_trade: 64,
    skill_magicuse: 68,
    skill_hack: 72,
    skill_science: 76,
    skill_healing: 80,
    skill_speech: 84,
    skill_smith: 88,
    skill_identify: 92,
    skill_critical_hit: 96,
    skill_alchemy: 100,
    skill_tactic: 104,
});

export interface NativeSkillPerk {
    readonly id: number;
    readonly parameter: string;
    readonly requiredLevel: number;
}

export const NATIVE_SKILL_PERKS: readonly NativeSkillPerk[] = Object.freeze(
    HERO_GENERATOR_NATIVE_LAYOUT.skills.flatMap(({ parameter }) => {
        const baseId = SKILL_PERK_BASE_IDS[parameter];
        if (baseId === undefined) throw new Error(`Missing native perk group for ${parameter}`);
        return NATIVE_SKILL_PERK_THRESHOLDS.map((requiredLevel, index) => Object.freeze({
            id: baseId + index,
            parameter,
            requiredLevel,
        }));
    }),
);

export const unlockedSkillPerks = (parameter: string, level: number): readonly NativeSkillPerk[] =>
    NATIVE_SKILL_PERKS.filter((perk) => perk.parameter === parameter && level >= perk.requiredLevel);

export interface SkillDerivedValues {
    readonly initiative?: number;
    readonly effectiveIntelligence?: number;
}

const skillDerivedTooltip = (
    parameter: string,
    level: number,
    parameters: Readonly<Record<string, number>>,
    derived: SkillDerivedValues,
): string | undefined => {
    if (parameter === "skill_scout") return `Осторожность: ${originalScoutCaution(level)}%`;
    if (parameter === "skill_speech") {
        const intelligence = derived.effectiveIntelligence
            ?? Math.max(1, (parameters.intelligence ?? 0) + (level >= 10 ? 2 : 0));
        return `Разговорчивость: ${originalTalkativeness(level, intelligence)}%`;
    }
    if (parameter === "skill_tactic") {
        const attribute = (name: string): number => Math.max(1, parameters[name] ?? 0);
        const initiative = derived.initiative ?? originalInitiative({
            strength: attribute("strength"),
            constitution: attribute("constitution"),
            dexterity: attribute("dexterity"),
            perception: attribute("perception"),
            intelligence: attribute("intelligence") + ((parameters.skill_speech ?? 0) >= 10 ? 2 : 0),
            wisdom: attribute("wisdom") + ((parameters.skill_speech ?? 0) >= 5 ? 1 : 0),
            luck: attribute("luck"),
        }, parameters.skill_critical_hit ?? 0);
        return `Инициатива: ${initiative}`;
    }
    return undefined;
};

export const skillPerkTooltip = (
    baseText: string | undefined,
    parameter: string,
    level: number,
    names: SDBData,
    descriptions: SDBData,
    parameters: Readonly<Record<string, number>> = {},
    derived: SkillDerivedValues = {},
): string | undefined => {
    const perkText = unlockedSkillPerks(parameter, level).flatMap(({ id }) => {
        const name = names[id];
        if (!name) return [];
        const description = descriptions[id];
        return [description ? `${name}\n${description}` : name];
    });
    const parts = [baseText, ...perkText, skillDerivedTooltip(parameter, level, parameters, derived)]
        .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("\n\n") : undefined;
};
