import {
    PROFESSION_SKILLS,
    type ProfessionSkillDefinition,
} from "./clientDll.ts";

export const getProfessionSkills = (
    parameters: Readonly<Record<string, number>>,
): readonly ProfessionSkillDefinition[] => PROFESSION_SKILLS.filter(
    ({ parameter, minimumExclusive }) => (parameters[parameter] ?? 0) > minimumExclusive,
);
