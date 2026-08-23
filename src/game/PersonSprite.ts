import { Paths } from "../constants/paths.ts";
import { loadCSX, loadOptionalCSX } from "./Assets.ts";
import { PADAnimation, PADParser } from "./parsers/PersonAnimationParser.ts";
import type { SEFPerson } from "./parsers/SEFParser.ts";
import { loadCompositedHeroSprites } from "./HeroWear.ts";
import { cellToWorld, type WorldPosition } from "./WorldCoordinates.ts";

interface PersonAnimationProfile {
    idleFile: string;
    idleAction: number;
    walkFile: string;
    walkAction: number;
}

export interface PersonSpriteSet {
    idleImage: HTMLCanvasElement;
    idle: PADAnimation;
    walkImage: HTMLCanvasElement;
    walk: PADAnimation;
    runImage?: HTMLCanvasElement;
    run?: PADAnimation;
    turnIdleImage?: HTMLCanvasElement;
    turnIdle?: PADAnimation;
    turnWalkImage?: HTMLCanvasElement;
    turnWalk?: PADAnimation;
    attackImage?: HTMLCanvasElement;
    attack?: PADAnimation;
    castImage?: HTMLCanvasElement;
    cast?: PADAnimation;
    ssAttackImage?: HTMLCanvasElement;
    ssAttack?: PADAnimation;
    sufferImage?: HTMLCanvasElement;
    suffer?: PADAnimation;
    dieImage?: HTMLCanvasElement;
    die?: PADAnimation;
    funImage?: HTMLCanvasElement;
    fun?: PADAnimation;
    turnFunImage?: HTMLCanvasElement;
    turnFun?: PADAnimation;
}

export interface LevelPerson extends SEFPerson {
    combatantId: string;
    worldPosition: WorldPosition;
    sprites: PersonSpriteSet;
}

const realTimeProfile: PersonAnimationProfile = {
    idleFile: "rt_stay.csx",
    idleAction: 0x1,
    walkFile: "rt_go.csx",
    walkAction: 0x20,
};

const turnBasedProfile: PersonAnimationProfile = {
    idleFile: "tb_stay.csx",
    idleAction: 0x4,
    walkFile: "tb_go.csx",
    walkAction: 0x10,
};

const resourceCache = new Map<string, Promise<string>>();
const spriteCache = new Map<string, Promise<PersonSpriteSet>>();

const loadPersonResource = (technicalName: string): Promise<string> => {
    const cacheKey = technicalName.toLowerCase();
    const cached = resourceCache.get(cacheKey);
    if (cached) return cached;

    const promise = fetch(Paths.PERSON_SCRIPT(cacheKey)).then(async (response) => {
        if (!response.ok) throw new Error(`Person script request failed for ${technicalName}: ${response.status}`);
        const text = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
        const match = /\bres_name\s*:\s*"([^"]+)"/i.exec(text);
        if (!match) throw new Error(`Person script ${technicalName} has no res_name`);
        return match[1].toLowerCase();
    });

    resourceCache.set(cacheKey, promise);
    return promise;
};

const selectAnimationProfile = (pad: PADParser, resource: string): PersonAnimationProfile => {
    if (pad.hasAnimation(realTimeProfile.idleAction) && pad.hasAnimation(realTimeProfile.walkAction)) {
        return realTimeProfile;
    }
    if (pad.hasAnimation(turnBasedProfile.idleAction) && pad.hasAnimation(turnBasedProfile.walkAction)) {
        return turnBasedProfile;
    }
    throw new Error(`Person resource ${resource} has no complete idle/walk animation pair`);
};

const loadOptionalAnimation = async (
    pad: PADParser,
    resource: string,
    files: readonly string[],
    actions: readonly number[],
): Promise<{ readonly image: HTMLCanvasElement; readonly animation: PADAnimation } | undefined> => {
    for (const file of files) {
        const image = await loadOptionalCSX(Paths.PERSON_ANIMATION(resource, file));
        if (!image) continue;
        for (const action of actions) {
            if (!pad.hasAnimation(action)) continue;
            const animation = pad.getAnimation(action);
            if (image.width === animation.frameCount * animation.frameWidth && image.height % animation.frameHeight === 0) {
                return { image, animation };
            }
        }
    }
    return undefined;
};

const loadSpriteSet = (resource: string): Promise<PersonSpriteSet> => {
    const cached = spriteCache.get(resource);
    if (cached) return cached;

    const promise = fetch(Paths.PERSON_PAD(resource)).then(async (response) => {
        if (!response.ok) throw new Error(`PAD request failed for ${resource}: ${response.status}`);
        const pad = new PADParser(await response.arrayBuffer());
        const profile = selectAnimationProfile(pad, resource);
        const hasTurnProfile = pad.hasAnimation(turnBasedProfile.idleAction) && pad.hasAnimation(turnBasedProfile.walkAction);
        const [idleImage, walkImage, turnIdleImage, turnWalkImage, attack, cast, ssAttack, suffer, die, fun, turnFun] = await Promise.all([
            loadCSX(Paths.PERSON_ANIMATION(resource, profile.idleFile)),
            loadCSX(Paths.PERSON_ANIMATION(resource, profile.walkFile)),
            profile === turnBasedProfile || !hasTurnProfile ? undefined : loadCSX(Paths.PERSON_ANIMATION(resource, turnBasedProfile.idleFile)),
            profile === turnBasedProfile || !hasTurnProfile ? undefined : loadCSX(Paths.PERSON_ANIMATION(resource, turnBasedProfile.walkFile)),
            loadOptionalAnimation(pad, resource, ["hits0.csx", "hits1.csx", "hits2.csx", "hits3.csx"], [0x10000, 0x20000, 0x40000, 0x80000]),
            loadOptionalAnimation(pad, resource, ["cast.csx"], [0x40]),
            loadOptionalAnimation(pad, resource, ["ss_attack.csx"], [0x400]),
            loadOptionalAnimation(pad, resource, ["suffer.csx"], [0x80]),
            loadOptionalAnimation(pad, resource, ["die.csx"], [0x100]),
            loadOptionalAnimation(pad, resource, ["rt_fun.csx"], [0x2]),
            loadOptionalAnimation(pad, resource, ["tb_fun.csx"], [0x8]),
        ]);
        if (!idleImage || !walkImage) throw new Error(`Failed to load person sprite ${resource}`);
        return {
            idleImage,
            idle: pad.getAnimation(profile.idleAction),
            walkImage,
            walk: pad.getAnimation(profile.walkAction),
            turnIdleImage: profile === turnBasedProfile ? idleImage : turnIdleImage,
            turnIdle: hasTurnProfile ? pad.getAnimation(turnBasedProfile.idleAction) : undefined,
            turnWalkImage: profile === turnBasedProfile ? walkImage : turnWalkImage,
            turnWalk: hasTurnProfile ? pad.getAnimation(turnBasedProfile.walkAction) : undefined,
            attackImage: attack?.image,
            attack: attack?.animation,
            castImage: cast?.image,
            cast: cast?.animation,
            ssAttackImage: ssAttack?.image,
            ssAttack: ssAttack?.animation,
            sufferImage: suffer?.image,
            suffer: suffer?.animation,
            dieImage: die?.image,
            die: die?.animation,
            funImage: fun?.image,
            fun: fun?.animation,
            turnFunImage: turnFun?.image,
            turnFun: turnFun?.animation,
        };
    });

    spriteCache.set(resource, promise);
    return promise;
};

export const loadPersonSprites = async (technicalName: string): Promise<PersonSpriteSet> => {
    const resource = await loadPersonResource(technicalName);
    return loadSpriteSet(resource);
};

export const loadHeroSprites = (equippedTechnicalNames: readonly string[] = []): Promise<PersonSpriteSet> =>
    loadCompositedHeroSprites(equippedTechnicalNames);

export const loadLevelPerson = async (person: SEFPerson): Promise<LevelPerson> => ({
    ...person,
    combatantId: person.name,
    worldPosition: cellToWorld(person.position),
    sprites: await loadPersonSprites(person.name),
});

export const loadLevelPersons = async (persons: SEFPerson[]): Promise<LevelPerson[]> => {
    const occurrences = new Map<string, number>();
    return Promise.all(persons.map(async (person) => {
        const normalized = person.name.toLowerCase();
        const occurrence = (occurrences.get(normalized) ?? 0) + 1;
        occurrences.set(normalized, occurrence);
        return {
            ...await loadLevelPerson(person),
            combatantId: occurrence === 1 ? person.name : `${person.name}#${occurrence}`,
        };
    }));
};
