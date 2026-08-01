export const NATIVE_TARGET_QUEUE_CAPACITY = 256;
export const NATIVE_TARGET_RETRY_LIMIT = 4;

export interface NativeCombatAiTarget<TId extends string = string> {
    readonly id: TId;
    readonly marker: number;
    readonly priority: number;
    readonly relationRank: number;
    readonly rosterOrder: number;
}

export interface RankedNativeCombatAiTarget<TId extends string = string> extends NativeCombatAiTarget<TId> {
    readonly score: number;
}

export interface NativeCombatAiTargetPreferences<TId extends string = string> {
    readonly primary?: TId;
    readonly secondary?: TId;
}

/** Server.dll 0x1401AB74 target score, sorted by 0x1401D83C. */
export function scoreNativeCombatAiTarget<TId extends string>(
    target: NativeCombatAiTarget<TId>,
    preferences: Readonly<NativeCombatAiTargetPreferences<TId>>,
): number {
    let score = target.id === preferences.primary ? 28 - target.priority : 0;
    if (target.id === preferences.secondary) score += 8;
    score -= target.relationRank;
    score += 2;
    score -= target.priority >> 1;
    if (target.marker === 0) score += 4;
    return score;
}

/** Keeps only native-eligible relation ranks and preserves roster order for equal scores. */
export function rankNativeCombatAiTargets<TId extends string>(
    targets: readonly NativeCombatAiTarget<TId>[],
    preferences: Readonly<NativeCombatAiTargetPreferences<TId>> = {},
    capacity = NATIVE_TARGET_QUEUE_CAPACITY,
): RankedNativeCombatAiTarget<TId>[] {
    return targets
        .filter((target) => target.relationRank < 2)
        .slice(0, Math.max(0, capacity))
        .map((target) => ({ ...target, score: scoreNativeCombatAiTarget(target, preferences) }))
        .sort((left, right) => right.score - left.score || left.rosterOrder - right.rosterOrder);
}

/** Server.dll 0x1401A15C low-health action probability. */
export function nativeSelfPreservationProbability(health: number, threshold: number): number {
    if (threshold <= 0 || health >= threshold) return 0;
    return 1 - 0.8 * health / threshold;
}

/** Server.dll 0x14019B84 movement contribution before attack AP is added. */
export function nativeAdvanceMovementCost(pathCost: number, attackRange: number): number {
    return Math.floor(pathCost - attackRange * 0.5);
}
