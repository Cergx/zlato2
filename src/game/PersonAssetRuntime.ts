import { Paths } from "../constants/paths";
import { parsePersonCombatScript, type PersonCombatTemplate } from "./systems/Combat";
import { parsePersonSoundDefinition, type PersonSoundDefinition } from "./SoundShaderRuntime";
import { parsePersonResourceDefinition, personSoundShaderUrl, type PersonResourceDefinition } from "./parsers/PRSParser";
import { loadShippedItemCatalog, type ShippedItem } from "./ItemCatalogRuntime.ts";

export interface MonsterCombatDefinition {
    readonly level?: number;
    readonly health?: number;
    readonly energy?: number;
    readonly hitChance?: number;
    readonly actionPoints?: number;
    readonly armorClass?: number;
    readonly bestAttack?: string;
    readonly additiveDamage?: string;
    readonly bestResistance?: string;
    readonly worstResistance?: string;
    readonly bestImmunity?: string;
    readonly worstImmunity?: string;
}

export interface PersonCombatAssets {
    readonly template?: PersonCombatTemplate;
    readonly monster?: MonsterCombatDefinition;
    readonly sounds?: PersonSoundDefinition;
    readonly resource?: PersonResourceDefinition;
    readonly weapons: readonly ShippedItem[];
}

const assetsCache = new Map<string, Promise<PersonCombatAssets>>();

const optionalText = async (url: string): Promise<string | undefined> => {
    const response = await fetch(url);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Person asset ${url} failed: HTTP ${response.status}`);
    return new TextDecoder("windows-1251").decode(await response.arrayBuffer());
};

export const parseMonsterCombatDefinition = (source: string): MonsterCombatDefinition => {
    const fields: Record<string, string> = {};
    for (const rawLine of source.replace(/\r/g, "").split("\n")) {
        const line = rawLine.replace(/\/\/.*$/, "").trim();
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        fields[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
    }
    const numeric = (name: string): number | undefined => {
        if (fields[name] === undefined) return undefined;
        const value = Number(fields[name]);
        return Number.isFinite(value) ? value : undefined;
    };
    return {
        level: numeric("level"),
        health: numeric("hp"),
        energy: numeric("ep"),
        hitChance: numeric("chth"),
        actionPoints: numeric("ap"),
        armorClass: numeric("ac"),
        bestAttack: fields.best_attack,
        additiveDamage: fields.additive_dmg,
        bestResistance: fields.best_resist,
        worstResistance: fields.worst_resist,
        bestImmunity: fields.best_immun,
        worstImmunity: fields.worst_immun,
    };
};

export const loadPersonCombatAssets = (technicalName: string): Promise<PersonCombatAssets> => {
    const normalized = technicalName.toLowerCase();
    let cached = assetsCache.get(normalized);
    if (!cached) {
        cached = Promise.all([
            optionalText(Paths.PERSON_SCRIPT(technicalName)),
            normalized.includes(".m") ? optionalText(`${Paths.SCRIPTS}/monsters/${normalized}.inf`) : undefined,
        ]).then(async ([personSource, monsterSource]) => {
            let template: PersonCombatTemplate | undefined;
            if (personSource) {
                try {
                    template = parsePersonCombatScript(technicalName, personSource);
                } catch (error) {
                    console.warn(`Person combat script ${technicalName} is unsupported`, error);
                }
            }
            const resource = (template?.resourceId ?? technicalName).toLowerCase();
            const [soundSource, resourceSource] = await Promise.all([
                optionalText(`${Paths.SCRIPTS}/shaders/persons/${resource}.pssh`),
                optionalText(`${Paths.SCRIPTS}/persons_res/${resource}.prs`),
            ]);
            const personResource = resourceSource ? parsePersonResourceDefinition(resourceSource) : undefined;
            const bundledSounds = soundSource ? parsePersonSoundDefinition(soundSource) : undefined;
            const referencedSounds = personResource
                ? await Promise.all(Object.entries(personResource.soundShaders)
                    .filter(([name]) => name === "attack_0" || name === "suffer" || name === "die")
                    .map(async ([name, reference]) => {
                        const source = await optionalText(personSoundShaderUrl(reference));
                        const shader = source ? Object.values(parsePersonSoundDefinition(source).shaders)[0] : undefined;
                        return shader ? [name, { ...shader, name }] as const : undefined;
                    }))
                : [];
            const referencedShaders = Object.fromEntries(referencedSounds.filter((entry) => entry !== undefined));
            const shaders = { ...referencedShaders, ...bundledSounds?.shaders };
            const sounds = Object.keys(shaders).length > 0
                ? { shaders, stepFrames: bundledSounds?.stepFrames ?? [] }
                : undefined;
            const catalog = template?.weapons.length ? await loadShippedItemCatalog() : undefined;
            const weapons = catalog
                ? await Promise.all(template!.weapons
                    .filter(({ itemId }) => catalog.has(itemId))
                    .map(({ itemId }) => catalog.get(itemId)))
                : [];
            return {
                template,
                monster: monsterSource ? parseMonsterCombatDefinition(monsterSource) : undefined,
                resource: personResource,
                sounds,
                weapons,
            };
        });
        assetsCache.set(normalized, cached);
    }
    return cached;
};
