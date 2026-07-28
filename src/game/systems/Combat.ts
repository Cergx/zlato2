import parseEngineObject, { isParsedData } from "../parsers/engineObjectParser.ts";
import type { ParsedValue } from "../parsers/engineObjectParser.ts";
import {
    assertPercentage,
    validateDamageRange,
    type DamageKind,
    type DamageRange,
    type ItemClass,
    type ItemDefinition,
    type ItemEffect,
} from "./Items.ts";

export type FactionRelation = "friendly" | "neutral" | "hostile";
export type RandomSource = () => number;

export interface CharacterAttributes {
    readonly strength: number;
    readonly constitution: number;
    readonly dexterity: number;
    readonly perception: number;
    readonly intelligence: number;
    readonly wisdom: number;
    readonly luck: number;
}

export interface CombatStats extends CharacterAttributes {
    readonly accuracy: number;
    readonly evasion: number;
    readonly criticalChance: number;
    readonly criticalMultiplier: number;
    readonly physicalPower: number;
    readonly magicalPower: number;
    readonly resistances: Readonly<Record<DamageKind, number>>;
}

export type CombatStatsInput = Omit<Partial<CombatStats>, "resistances"> & {
    readonly resistances?: Partial<Record<DamageKind, number>>;
};

export interface Combatant {
    readonly id: string;
    readonly factionId: string;
    readonly maxHealth: number;
    readonly maxMana: number;
    readonly stats: CombatStats;
    health: number;
    mana: number;
    isDead: boolean;
}

export interface CombatantOptions {
    readonly id: string;
    readonly factionId: string;
    readonly maxHealth: number;
    readonly health?: number;
    readonly maxMana?: number;
    readonly mana?: number;
    readonly stats?: CombatStatsInput;
}

export interface PersonWeaponReference {
    readonly itemId: string;
    readonly minimumLevel: number;
    readonly maximumLevel: number;
}

export interface PersonSpellReference {
    readonly spellId: string;
    readonly argument0: number;
    readonly argument1: number;
}

export interface PersonTradeCapabilities {
    readonly change: number;
    readonly repair: number;
    readonly charging: number;
    readonly identification: number;
    readonly takeOffCurse: number;
}


export interface PersonCombatTemplate {
    readonly scriptId: string;
    readonly resourceId?: string;
    readonly level: number;
    readonly attributes: CharacterAttributes;
    readonly skills: Readonly<Record<string, number>>;
    readonly weaponLevelOffset: number;
    readonly weapons: readonly PersonWeaponReference[];
    readonly spells: readonly PersonSpellReference[];
    readonly battleMagicUse: number;
    readonly lifeEscape: number;
    readonly lifeHealing: number;
    readonly trade: PersonTradeCapabilities;
}

export type OriginalDamageKind = "crushing" | "hacking" | "pricking";
export type OriginalElementalDamageKind = "fire" | "cold" | "poison";
export type OriginalMagicKind = "shadows" | "nature" | "gods" | "elements" | "light" | "dark";


export interface OriginalWeaponProfile {
    readonly itemId: string;
    readonly itemClass?: ItemClass;
    /** Native item-header flags used by Client.dll 0x12057638 to select HUD attack modes. */
    readonly nativeFlags: number;
    readonly actionPointCost: number;
    readonly attackDistance: number;
    readonly baseHitChance: number;
    readonly damage: Readonly<Record<OriginalDamageKind, DamageRange>>;
}

export interface OriginalCombatProfileInput {
    readonly parameters: Readonly<Record<string, number>>;
    readonly weapon?: OriginalWeaponProfile;
    readonly baseHealth?: number;
    readonly baseEnergy?: number;
    readonly baseHitChance?: number;
    readonly baseActionPoints?: number;
    readonly baseArmorClass?: number;
    readonly modifiers?: Readonly<Record<string, number>>;
}

export interface OriginalCombatProfile {
    readonly maxHealth: number;
    readonly maxEnergy: number;
    readonly hitChance: number;
    readonly actionPoints: number;
    readonly armorClass: number;
    readonly initiative: number;
    readonly healthRegenerationTime: number;
    readonly energyRegenerationTime: number;
    readonly criticalChance: number;
    readonly criticalDamage: number;
    readonly criticalMissChance: number;
    readonly damageResistance: Readonly<Record<OriginalDamageKind, number>>;
    readonly elementalDamage: Readonly<Record<OriginalElementalDamageKind, DamageRange>>;
    readonly elementalResistance: Readonly<Record<OriginalElementalDamageKind, number>>;
    readonly magicResistance: Readonly<Record<OriginalMagicKind, number>>;
    readonly magicImmunity: Readonly<Record<OriginalMagicKind, number>>;
    readonly maxWeight: number;
    readonly weapon: OriginalWeaponProfile;
}

export interface OriginalAttackResult {
    readonly hit: boolean;
    readonly critical: boolean;
    readonly criticalMiss: boolean;
    readonly hitChance: number;
    readonly actionPointCost: number;
    readonly damageByKind: Readonly<Record<OriginalDamageKind, number>>;
    readonly elementalDamageByKind: Readonly<Record<OriginalElementalDamageKind, number>>;
    readonly appliedDamage: number;
    readonly healthBefore: number;
    readonly healthAfter: number;
    readonly killed: boolean;
}

export const UNARMED_WEAPON_PROFILE: OriginalWeaponProfile = {
    itemId: "unarmed",
    nativeFlags: 0x40,
    itemClass: "mace",
    actionPointCost: 10,
    attackDistance: 6,
    baseHitChance: 90,
    damage: {
        crushing: { min: 1, max: 4 },
        hacking: { min: 0, max: 0 },
        pricking: { min: 0, max: 0 },
    },
};

export interface PersonCombatantOptions extends Omit<CombatantOptions, "id" | "stats"> {
    readonly stats?: CombatStatsInput;
}

export interface DamageRequest {
    readonly amount: number;
    readonly damageKind: DamageKind;
}

export interface DamageResult {
    readonly damageKind: DamageKind;
    readonly requested: number;
    readonly resistance: number;
    readonly applied: number;
    readonly healthBefore: number;
    readonly healthAfter: number;
    readonly killed: boolean;
}

export interface RecoveryResult {
    readonly requested: number;
    readonly restored: number;
    readonly before: number;
    readonly after: number;
}

export interface AttackDefinition {
    readonly damage: DamageRange;
    readonly damageKind?: DamageKind;
    readonly accuracyBonus?: number;
    readonly criticalChance?: number;
    readonly criticalMultiplier?: number;
}

export interface AttackResult {
    readonly hit: boolean;
    readonly hitChance: number;
    readonly critical: boolean;
    readonly rolledDamage: number;
    readonly damage?: DamageResult;
}

export interface SpellDefinition {
    readonly id: string;
    readonly manaCost: number;
    /** The hit check, when supplied, is applied once before every effect. */
    readonly hitChance?: number;
    readonly effects: readonly ItemEffect[];
}

export interface SpellCastResult {
    readonly spellId: string;
    readonly hit: boolean;
    readonly manaBefore: number;
    readonly manaAfter: number;
    readonly effects: readonly (DamageResult | RecoveryResult)[];
}

const DEFAULT_STATS: CombatStats = {
    strength: 0,
    constitution: 0,
    dexterity: 0,
    perception: 0,
    intelligence: 0,
    wisdom: 0,
    luck: 0,
    accuracy: 100,
    evasion: 0,
    criticalChance: 0,
    criticalMultiplier: 2,
    physicalPower: 0,
    magicalPower: 0,
    resistances: { physical: 0, magical: 0 },
};

/** Stores the symmetric faction relation consumed by RS_GetTribesRelation-style lookups. */
export class FactionRelations {
    private readonly relations = new Map<string, FactionRelation>();

    get(leftFactionId: string, rightFactionId: string): FactionRelation {
        assertIdentifier(leftFactionId, "Left faction id");
        assertIdentifier(rightFactionId, "Right faction id");
        if (leftFactionId === rightFactionId) return "friendly";
        return this.relations.get(this.key(leftFactionId, rightFactionId)) ?? "friendly";
    }

    set(leftFactionId: string, rightFactionId: string, relation: FactionRelation): void {
        assertIdentifier(leftFactionId, "Left faction id");
        assertIdentifier(rightFactionId, "Right faction id");
        if (leftFactionId === rightFactionId) throw new Error("A faction's relation to itself is always friendly");
        this.relations.set(this.key(leftFactionId, rightFactionId), relation);
    }

    isHostile(leftFactionId: string, rightFactionId: string): boolean {
        return this.get(leftFactionId, rightFactionId) === "hostile";
    }

    private key(leftFactionId: string, rightFactionId: string): string {
        return leftFactionId < rightFactionId
            ? `${leftFactionId.length}:${leftFactionId}${rightFactionId.length}:${rightFactionId}`
            : `${rightFactionId.length}:${rightFactionId}${leftFactionId.length}:${leftFactionId}`;
    }
}

export function createCombatant(options: CombatantOptions): Combatant {
    assertIdentifier(options.id, "Combatant id");
    assertIdentifier(options.factionId, "Combatant faction id");
    assertPositiveInteger(options.maxHealth, "Combatant maximum health");
    const maxMana = options.maxMana ?? 0;
    assertNonNegativeInteger(maxMana, "Combatant maximum mana");
    const health = options.health ?? options.maxHealth;
    const mana = options.mana ?? maxMana;
    if (!Number.isSafeInteger(health) || health < 0 || health > options.maxHealth) {
        throw new Error(`Combatant health must be between 0 and ${options.maxHealth}`);
    }
    if (!Number.isSafeInteger(mana) || mana < 0 || mana > maxMana) {
        throw new Error(`Combatant mana must be between 0 and ${maxMana}`);
    }

    const stats = createCombatStats(options.stats);
    return {
        id: options.id,
        factionId: options.factionId,
        maxHealth: options.maxHealth,
        maxMana,
        stats,
        health,
        mana,
        isDead: health === 0,
    };
}

export function createCombatantFromPersonTemplate(
    template: PersonCombatTemplate,
    options: PersonCombatantOptions,
): Combatant {
    const attributes: CharacterAttributes = template.attributes;
    const inputStats: CombatStatsInput = { ...options.stats, ...attributes };
    return createCombatant({ ...options, id: template.scriptId, stats: inputStats });
}

/** AGE's shipped character formulas, recovered from Server.dll's stat accessors. */
export function createOriginalCombatProfile(input: OriginalCombatProfileInput): OriginalCombatProfile {
    const parameter = (name: string): number => input.parameters[name.toLowerCase()] ?? 0;
    const modifier = (name: string): number => input.modifiers?.[name] ?? 0;
    const dexterity = parameter("dexterity");
    const perception = parameter("perception");
    const constitution = parameter("constitution");
    const intelligence = parameter("intelligence");
    const wisdom = parameter("wisdom");
    const luck = parameter("luck");
    const athletics = parameter("skill_athletic");
    const tactic = parameter("skill_tactic");
    const criticalSkill = parameter("skill_critical_hit");
    const magicUse = parameter("skill_magicuse");
    const speech = parameter("skill_speech");
    const smith = parameter("skill_smith");
    const weapon = input.weapon ?? UNARMED_WEAPON_PROFILE;
    const weaponSkill = parameter(weaponSkillParameter(weapon.itemId));
    const magicResistance = (school: string, modifierName: string): number => nonNegativeStat(
        wisdom + parameter(`skill_${school}`) + magicUse + modifier(modifierName),
    );
    const magicImmunity = (school: string, modifierName: string): number => nonNegativeStat(
        perception + parameter(`skill_${school}`) + magicUse + modifier(modifierName),
    );
    const elementalDamage = (modifierName: string, skillName: string): DamageRange => {
        const maximum = nonNegativeStat(modifier(modifierName) + (parameter(skillName) > 4 ? 5 : 0));
        return { min: maximum > 0 ? 1 : 0, max: maximum };
    };
    const elementalResistanceBonus = (baseSkill: string): number => nonNegativeStat(
        parameter(baseSkill)
        + (magicUse > 4 ? 10 : 0)
        + (parameter("skill_elemmag") > 4 ? 10 : 0)
        + (parameter("skill_healing") > 4 ? 10 : 0),
    );
    const level = originalLevelForExperience(parameter("experience"));
    const maxWeightBase = 20 * parameter("strength") + 20 * constitution + level + modifier("maxWeight");

    const healthRegenerationTime = athletics === 0 ? 0 : Math.max(1, Math.min(20,
        (6 - 0.1 * (constitution + athletics)) * (athletics > 9 ? 0.5 : 1) + modifier("healthRegenerationTime"),
    ));
    const effectiveWisdom = wisdom + (speech > 4 ? 1 : 0);
    const energyRegenerationTime = smith === 0 ? 0 : Math.max(1, Math.min(20,
        (6 - 0.1 * (effectiveWisdom + smith)) * (smith > 9 ? 0.5 : 1) + modifier("energyRegenerationTime"),
    ));
    return {
        maxHealth: positiveStat((input.baseHealth ?? 50 + 14 * constitution) + modifier("maxHealth")),
        maxEnergy: nonNegativeStat((input.baseEnergy ?? 10 + 2 * wisdom + 2 * intelligence) + modifier("maxEnergy")),
        hitChance: boundedStat((input.baseHitChance ?? weapon.baseHitChance + 1.5 * perception + 5 * weaponSkill) + modifier("hitChance"), 0, 999),
        actionPoints: positiveStat((input.baseActionPoints ?? 20 + 1.5 * dexterity + 1.9375 * athletics) + modifier("actionPoints")),
        armorClass: nonNegativeStat((input.baseArmorClass ?? 0.6 * dexterity + 1.775 * athletics) + modifier("armorClass")),
        initiative: nonNegativeStat(5 + 0.9 * dexterity + 0.15 * perception + 1.14 * tactic + modifier("initiative")),
        healthRegenerationTime,
        energyRegenerationTime,
        criticalChance: boundedStat(3 * luck + 3 * criticalSkill + modifier("criticalChance"), 0, 100),
        criticalDamage: nonNegativeStat(15 + 0.334 * parameter("strength") + 1.5 * criticalSkill + modifier("criticalDamage")),
        criticalMissChance: boundedStat((10 - 0.167 * dexterity - 0.334 * weaponSkill) * 0.5 + modifier("criticalMissChance"), 0, 10),
        damageResistance: {
            crushing: modifier("crushingResistance"),
            hacking: modifier("hackingResistance"),
            pricking: modifier("prickingResistance"),
        },
        elementalDamage: {
            fire: elementalDamage("fireDamage", "skill_godsmag"),
            cold: elementalDamage("coldDamage", "skill_shadmag"),
            poison: elementalDamage("poisonDamage", "skill_natrmag"),
        },
        elementalResistance: {
            fire: elementalResistanceBonus("skill_smith") + modifier("fireResistance"),
            cold: elementalResistanceBonus("skill_alchemy") + modifier("coldResistance"),
            poison: elementalResistanceBonus("skill_healing") + modifier("poisonResistance"),
        },
        magicResistance: {
            shadows: magicResistance("shadmag", "shadowsMagicResistance"),
            nature: magicResistance("natrmag", "natureMagicResistance"),
            gods: magicResistance("godsmag", "godsMagicResistance"),
            elements: magicResistance("elemmag", "elementsMagicResistance"),
            light: magicResistance("lghtmag", "lightMagicResistance"),
            dark: magicResistance("darkmag", "darkMagicResistance"),
        },
        magicImmunity: {
            shadows: magicImmunity("shadmag", "shadowsMagicImmunity"),
            nature: magicImmunity("natrmag", "natureMagicImmunity"),
            gods: magicImmunity("godsmag", "godsMagicImmunity"),
            elements: magicImmunity("elemmag", "elementsMagicImmunity"),
            light: magicImmunity("lghtmag", "lightMagicImmunity"),
            dark: magicImmunity("darkmag", "darkMagicImmunity"),
        },
        maxWeight: nonNegativeStat(maxWeightBase * (athletics > 4 ? 1.5 : 1)),
        weapon,
    };
}

export function originalLevelForExperience(experience: number): number {
    if (!Number.isFinite(experience) || experience < 100) return 1;
    let level = 1;
    let factor = 50;
    do {
        factor += 50;
        level += 1;
    } while ((level + 1) * factor <= experience && level < 99);
    return level;
}

export function originalExperienceThreshold(level: number): number {
    const boundedLevel = Math.max(1, Math.min(99, Math.trunc(level)));
    return boundedLevel * (boundedLevel + 1) * 50;
}

/** Server.dll 0x1401DC32..0x1401DD6F: level-range filter followed by cyclic 50% selection. */
export function selectOriginalPersonWeapon(
    references: readonly PersonWeaponReference[],
    levelOffset: number,
    currentLevel: number,
    random: RandomSource,
): PersonWeaponReference | undefined {
    const candidates = references
        .filter(({ minimumLevel, maximumLevel }) =>
            minimumLevel + levelOffset <= currentLevel && currentLevel <= maximumLevel + levelOffset)
        .slice(0, 32);
    if (candidates.length === 0) return undefined;

    let index = 0;
    while (true) {
        if (nextRandom(random, "person weapon selection") < 0.5) return candidates[index];
        index = (index + 1) % candidates.length;
    }
}
/** Server.dll 0x14017ddd..0x14017e3e: max axis plus 3/8 of the minor axis, truncated. */
export const originalCombatDistance = (
    left: Readonly<{ x: number; y: number }>,
    right: Readonly<{ x: number; y: number }>,
): number => {
    const dx = Math.abs(left.x - right.x);
    const dy = Math.abs(left.y - right.y);
    return Math.trunc(Math.max(dx, dy) + Math.min(dx, dy) * 0.375);
};


/** Resolves one physical hit while preserving AGE's separate C/P/H damage channels. */
export function resolveOriginalAttack(
    attacker: OriginalCombatProfile,
    target: OriginalCombatProfile,
    targetHealth: number,
    random: RandomSource,
): OriginalAttackResult {
    if (!Number.isSafeInteger(targetHealth) || targetHealth <= 0 || targetHealth > target.maxHealth) {
        throw new Error(`Target health must be between 1 and ${target.maxHealth}`);
    }
    const hitChance = boundedStat(attacker.hitChance - target.armorClass, 0, 100);
    const criticalMiss = succeeds(attacker.criticalMissChance, random, "critical miss roll");
    const hit = !criticalMiss && succeeds(hitChance, random, "original attack hit roll");
    const emptyDamage: Record<OriginalDamageKind, number> = { crushing: 0, hacking: 0, pricking: 0 };
    const emptyElementalDamage: Record<OriginalElementalDamageKind, number> = { fire: 0, cold: 0, poison: 0 };
    if (!hit) {
        return {
            hit: false,
            critical: false,
            criticalMiss,
            hitChance,
            actionPointCost: attacker.weapon.actionPointCost,
            damageByKind: emptyDamage,
            elementalDamageByKind: emptyElementalDamage,
            appliedDamage: 0,
            healthBefore: targetHealth,
            healthAfter: targetHealth,
            killed: false,
        };
    }

    const critical = succeeds(attacker.criticalChance, random, "original critical hit roll");
    const multiplier = critical ? (100 + attacker.criticalDamage) / 100 : 1;
    const damageByKind: Record<OriginalDamageKind, number> = { crushing: 0, hacking: 0, pricking: 0 };
    for (const kind of ORIGINAL_DAMAGE_KINDS) {
        const rolled = rollDamage(attacker.weapon.damage[kind], random);
        damageByKind[kind] = Math.max(0, Math.round(rolled * multiplier) - target.damageResistance[kind]);
    }
    const elementalDamageByKind: Record<OriginalElementalDamageKind, number> = { fire: 0, cold: 0, poison: 0 };
    for (const kind of ORIGINAL_ELEMENTAL_DAMAGE_KINDS) {
        const rolled = rollDamage(attacker.elementalDamage[kind], random);
        elementalDamageByKind[kind] = Math.max(0, rolled - target.elementalResistance[kind]);
    }
    const appliedDamage = [...Object.values(damageByKind), ...Object.values(elementalDamageByKind)]
        .reduce((sum, value) => sum + value, 0);
    const healthAfter = Math.max(0, targetHealth - appliedDamage);
    return {
        hit: true,
        critical,
        criticalMiss: false,
        hitChance,
        actionPointCost: attacker.weapon.actionPointCost,
        damageByKind,
        elementalDamageByKind,
        appliedDamage,
        healthBefore: targetHealth,
        healthAfter,
        killed: healthAfter === 0,
    };
}

/** Parses the stat, weapon, magic, skill, and AI blocks in shipped person `.scr` files. */
export function parsePersonCombatScript(scriptId: string, source: string): PersonCombatTemplate {
    assertIdentifier(scriptId, "Person script id");
    const raw = parseEngineObject(source);
    const attributes: CharacterAttributes = {
        strength: readNonNegativeNumber(raw, "strength", scriptId),
        constitution: readNonNegativeNumber(raw, "constitution", scriptId),
        dexterity: readNonNegativeNumber(raw, "dexterity", scriptId),
        perception: readNonNegativeNumber(raw, "perception", scriptId),
        intelligence: readNonNegativeNumber(raw, "intelligence", scriptId),
        wisdom: readNonNegativeNumber(raw, "wisdom", scriptId),
        luck: readNonNegativeNumber(raw, "luck", scriptId),
    };
    const level = readNonNegativeNumber(raw, "level", scriptId);
    const resourceId = typeof raw.res_name === "string" ? raw.res_name : undefined;
    if (resourceId !== undefined) assertIdentifier(resourceId, `Person script ${scriptId} resource id`);

    const skills = readNumericBlock(raw.skills, `Person script ${scriptId} skills`);
    const weaponBlock = readWeaponReferences(source);
    const spells = readSpellReferences(source);
    const ai = readNumericScriptBlock(source, "ai");
    const tradePanel = readNumericScriptBlock(source, "trade_panel");
    const battleMagicUse = ai.battle_magic_use ?? 0;
    const lifeEscape = ai.life_escape ?? 0;
    const lifeHealing = ai.life_healing ?? 0;

    return {
        scriptId,
        resourceId,
        level,
        attributes,
        skills,
        weaponLevelOffset: weaponBlock.levelOffset,
        weapons: weaponBlock.references,
        spells,
        battleMagicUse,
        lifeEscape,
        lifeHealing,
        trade: {
            change: tradePanel.change ?? 0,
            repair: tradePanel.repair ?? 0,
            charging: tradePanel.charging ?? 0,
            identification: tradePanel.identification ?? 0,
            takeOffCurse: tradePanel.take_off_curse ?? 0,
        },
    };
}

export function rollDamage(range: DamageRange, random: RandomSource): number {
    validateDamageRange(range);
    if (range.min === range.max) return range.min;
    const roll = nextRandom(random, "damage roll");
    return range.min + Math.floor(roll * (range.max - range.min + 1));
}

export function applyDamage(target: Combatant, request: DamageRequest): DamageResult {
    assertDamageRequest(request);
    const healthBefore = target.health;
    const resistance = target.stats.resistances[request.damageKind];
    if (target.isDead) {
        return {
            damageKind: request.damageKind,
            requested: request.amount,
            resistance,
            applied: 0,
            healthBefore,
            healthAfter: healthBefore,
            killed: false,
        };
    }

    const applied = Math.floor(request.amount * (100 - resistance) / 100);
    target.health = Math.max(0, target.health - applied);
    target.isDead = target.health === 0;
    return {
        damageKind: request.damageKind,
        requested: request.amount,
        resistance,
        applied,
        healthBefore,
        healthAfter: target.health,
        killed: target.isDead,
    };
}

export function heal(target: Combatant, amount: number): RecoveryResult {
    assertNonNegativeInteger(amount, "Healing amount");
    const before = target.health;
    if (!target.isDead) target.health = Math.min(target.maxHealth, target.health + amount);
    return { requested: amount, restored: target.health - before, before, after: target.health };
}

export function restoreMana(target: Combatant, amount: number): RecoveryResult {
    assertNonNegativeInteger(amount, "Mana restoration amount");
    const before = target.mana;
    if (!target.isDead) target.mana = Math.min(target.maxMana, target.mana + amount);
    return { requested: amount, restored: target.mana - before, before, after: target.mana };
}

export function resolveAttack(
    attacker: Combatant,
    target: Combatant,
    definition: AttackDefinition,
    random: RandomSource,
): AttackResult {
    assertAlive(attacker, "Attacker");
    assertAlive(target, "Target");
    validateAttackDefinition(definition);
    const damageKind = definition.damageKind ?? "physical";
    const hitChance = clampPercentage(attacker.stats.accuracy + (definition.accuracyBonus ?? 0) - target.stats.evasion);
    const hit = succeeds(hitChance, random, "attack hit roll");
    if (!hit) return { hit: false, hitChance, critical: false, rolledDamage: 0 };

    const criticalChance = clampPercentage(attacker.stats.criticalChance + (definition.criticalChance ?? 0));
    const critical = succeeds(criticalChance, random, "critical hit roll");
    const baseDamage = rollDamage(definition.damage, random);
    const power = damageKind === "physical" ? attacker.stats.physicalPower : attacker.stats.magicalPower;
    const multiplier = critical ? definition.criticalMultiplier ?? attacker.stats.criticalMultiplier : 1;
    const rolledDamage = Math.floor(Math.max(0, baseDamage + power) * multiplier);
    const damage = applyDamage(target, { amount: rolledDamage, damageKind });
    return { hit: true, hitChance, critical, rolledDamage, damage };
}

export function attackWithItem(
    attacker: Combatant,
    target: Combatant,
    item: ItemDefinition,
    random: RandomSource,
): AttackResult {
    if (!item.weapon) throw new Error(`Item ${item.id} has no weapon combat definition`);
    return resolveAttack(attacker, target, item.weapon, random);
}

export function castSpell(
    caster: Combatant,
    target: Combatant,
    spell: SpellDefinition,
    random: RandomSource,
): SpellCastResult {
    assertAlive(caster, "Caster");
    validateSpell(spell);
    if (caster.mana < spell.manaCost) throw new Error(`Caster ${caster.id} has ${caster.mana} mana but ${spell.id} costs ${spell.manaCost}`);

    const manaBefore = caster.mana;
    caster.mana -= spell.manaCost;
    const hit = spell.hitChance === undefined || succeeds(spell.hitChance, random, `spell ${spell.id} hit roll`);
    if (!hit) return { spellId: spell.id, hit: false, manaBefore, manaAfter: caster.mana, effects: [] };

    const effects: (DamageResult | RecoveryResult)[] = [];
    for (const effect of spell.effects) effects.push(resolveEffect(caster, target, effect, random));
    return { spellId: spell.id, hit: true, manaBefore, manaAfter: caster.mana, effects };
}

function createCombatStats(input: CombatStatsInput | undefined): CombatStats {
    const stats: CombatStats = {
        ...DEFAULT_STATS,
        ...input,
        resistances: {
            physical: input?.resistances?.physical ?? DEFAULT_STATS.resistances.physical,
            magical: input?.resistances?.magical ?? DEFAULT_STATS.resistances.magical,
        },
    };
    for (const [name, value] of Object.entries(stats)) {
        if (name === "resistances") continue;
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Combat stat ${name} must be finite`);
    }
    assertPercentage(stats.criticalChance, "Combat critical chance");
    if (stats.criticalMultiplier < 1) throw new Error("Combat critical multiplier must be at least 1");
    for (const [damageKind, resistance] of Object.entries(stats.resistances)) {
        if (resistance < -100 || resistance > 100 || !Number.isFinite(resistance)) {
            throw new Error(`Combat ${damageKind} resistance must be between -100 and 100`);
        }
    }
    return stats;
}

const ORIGINAL_DAMAGE_KINDS: readonly OriginalDamageKind[] = ["crushing", "hacking", "pricking"];
const ORIGINAL_ELEMENTAL_DAMAGE_KINDS: readonly OriginalElementalDamageKind[] = ["fire", "cold", "poison"];

const weaponSkillParameter = (itemId: string): string => {
    const normalized = itemId.toLowerCase();
    if (normalized.includes("sword") || normalized.includes("swr")) return "skill_wpn_sword";
    if (normalized.includes("axe")) return "skill_wpn_axe";
    if (normalized.includes("spear") || normalized.includes("spr")) return "skill_wpn_spear";
    if (normalized.includes("bow") || normalized.includes("crossbow") || normalized.includes("firearm")) return "skill_wpn_dist";
    if (normalized.includes("staff")) return "skill_wpn_staff";
    return "skill_wpn_hand";
};

const boundedStat = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, Math.round(value)));
const positiveStat = (value: number): number => Math.max(1, Math.round(value));
const nonNegativeStat = (value: number): number => Math.max(0, Math.round(value));

function readNonNegativeNumber(raw: Record<string, unknown>, key: string, scriptId: string): number {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Person script ${scriptId} has invalid ${key}`);
    }
    return value;
}

function readNumericBlock(raw: ParsedValue | undefined, label: string): Record<string, number> {
    if (raw === undefined) return {};
    if (!isParsedData(raw)) throw new Error(`${label} must be a block`);
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
            throw new Error(`${label} has invalid value for ${key}`);
        }
        values[key] = value;
    }
    return values;
}

function readWeaponReferences(
    source: string,
): { readonly levelOffset: number; readonly references: readonly PersonWeaponReference[] } {
    const block = readScriptBlockSource(source, "weapon");
    const levelOffset = Number(block.match(/\blevel_offset\s+(-?\d+)/i)?.[1] ?? 0);
    const references: PersonWeaponReference[] = [];
    for (const entry of block.matchAll(/(\S+)\s+(-?\d+)\s+(-?\d+)/g)) {
        if (entry[1].toLowerCase() === "level_offset") continue;
        references.push({
            itemId: entry[1],
            minimumLevel: Number(entry[2]),
            maximumLevel: Number(entry[3]),
        });
    }
    return { levelOffset, references };
}

/** Server.dll 0x1401E101..0x1401E1E3 parses both integers, then selects magic only by technical name. */
function readSpellReferences(source: string): PersonSpellReference[] {
    const spells: PersonSpellReference[] = [];
    for (const entry of readScriptBlockSource(source, "magic").matchAll(/(\S+)\s+(-?\d+)\s+(-?\d+)/g)) {
        spells.push({
            spellId: entry[1],
            argument0: Number(entry[2]),
            argument1: Number(entry[3]),
        });
    }
    return spells;
}

function readNumericScriptBlock(source: string, name: string): Record<string, number> {
    const values: Record<string, number> = {};
    for (const entry of readScriptBlockSource(source, name).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+)/g)) {
        values[entry[1].toLowerCase()] = Number(entry[2]);
    }
    return values;
}

function readScriptBlockSource(source: string, name: string): string {
    const uncommented = source.replace(/\/\/.*$/gm, "");
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return uncommented.match(new RegExp(`\\b${escapedName}\\s*:\\s*\\{([^}]*)\\}`, "i"))?.[1] ?? "";
}


function assertDamageRequest(request: DamageRequest): void {
    assertNonNegativeInteger(request.amount, "Damage amount");
}

function validateAttackDefinition(definition: AttackDefinition): void {
    validateDamageRange(definition.damage, "Attack damage");
    if (definition.accuracyBonus !== undefined && !Number.isFinite(definition.accuracyBonus)) {
        throw new Error("Attack accuracy bonus must be finite");
    }
    if (definition.criticalChance !== undefined) assertPercentage(definition.criticalChance, "Attack critical chance");
    if (definition.criticalMultiplier !== undefined && definition.criticalMultiplier < 1) {
        throw new Error("Attack critical multiplier must be at least 1");
    }
}

function validateSpell(spell: SpellDefinition): void {
    assertIdentifier(spell.id, "Spell id");
    assertNonNegativeInteger(spell.manaCost, `Spell ${spell.id} mana cost`);
    if (spell.hitChance !== undefined) assertPercentage(spell.hitChance, `Spell ${spell.id} hit chance`);
    if (spell.effects.length === 0) throw new Error(`Spell ${spell.id} must have at least one effect`);
    for (const effect of spell.effects) {
        if (effect.kind === "damage") validateDamageRange(effect.damage, `Spell ${spell.id} damage effect`);
        else validateDamageRange(effect.amount, `Spell ${spell.id} ${effect.kind} effect`);
    }
}

function resolveEffect(caster: Combatant, target: Combatant, effect: ItemEffect, random: RandomSource): DamageResult | RecoveryResult {
    switch (effect.kind) {
        case "damage": {
            const amount = Math.max(0, rollDamage(effect.damage, random) + caster.stats.magicalPower);
            return applyDamage(target, { amount, damageKind: effect.damageKind });
        }
        case "heal":
            return heal(target, rollDamage(effect.amount, random));
        case "restoreMana":
            return restoreMana(target, rollDamage(effect.amount, random));
    }
}

function succeeds(chance: number, random: RandomSource, label: string): boolean {
    if (chance === 0) return false;
    if (chance === 100) return true;
    return nextRandom(random, label) * 100 < chance;
}

function nextRandom(random: RandomSource, label: string): number {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error(`${label} must produce a finite value in [0, 1)`);
    }
    return value;
}

function clampPercentage(value: number): number {
    if (!Number.isFinite(value)) throw new Error("Combat chance must be finite");
    return Math.max(0, Math.min(100, value));
}

function assertAlive(combatant: Combatant, label: string): void {
    if (combatant.isDead) throw new Error(`${label} ${combatant.id} is dead`);
}

function assertIdentifier(value: string, label: string): void {
    if (value.trim() === "") throw new Error(`${label} must not be empty`);
}

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}

function assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}
