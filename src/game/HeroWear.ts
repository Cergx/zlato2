import { loadCSX } from "./Assets.ts";
import { HADParser, type HADAnimation } from "./parsers/HADParser.ts";
import { IADParser, type IADAnimation } from "./parsers/IADParser.ts";
import type { PersonSpriteSet } from "./PersonSprite.ts";

interface WearMapping {
    readonly group: string;
    readonly profile?: string;
}

interface WearLayer {
    readonly category: string;
    readonly image: HTMLCanvasElement;
    readonly metadata: IADAnimation;
    readonly order: Uint8Array;
}

interface ActionProfile {
    readonly action: number;
    readonly file: string;
    readonly target: "idle" | "walk" | "run" | "turnIdle" | "turnWalk" | "attack" | "suffer" | "die";
}

const ACTIONS: readonly ActionProfile[] = [
    { action: 0x1, file: "rt_stay.csx", target: "idle" },
    { action: 0x20, file: "rt_go.csx", target: "walk" },
    { action: 0x200, file: "run.csx", target: "run" },
    { action: 0x4, file: "tb_stay.csx", target: "turnIdle" },
    { action: 0x10, file: "tb_go.csx", target: "turnWalk" },
    { action: 0x10000, file: "hits0.csx", target: "attack" },
    { action: 0x80, file: "suffer.csx", target: "suffer" },
    { action: 0x100, file: "die.csx", target: "die" },
];
const DEFAULT_PROFILE = "noweapon_thrw";

const getWearCategory = (group: string): string => {
    if (group.startsWith("dospeh_")) return "armor";
    if (group.startsWith("ponogi_")) return "elbarms";
    if (group.startsWith("diadem_") || group.startsWith("shlem_")) return "helmet";
    if (group.startsWith("shit_")) return "shield";
    return "weapon";
};

let wearMappingsPromise: Promise<ReadonlyMap<string, WearMapping>> | undefined;
const spriteCache = new Map<string, Promise<PersonSpriteSet>>();

const loadWearMappings = (): Promise<ReadonlyMap<string, WearMapping>> => {
    wearMappingsPromise ??= fetch("/assets/scripts/herowear.scr").then(async (response) => {
        if (!response.ok) throw new Error(`Hero wear mapping request failed: HTTP ${response.status}`);
        const source = new TextDecoder("windows-1251").decode(await response.arrayBuffer());
        const mappings = new Map<string, WearMapping>();
        let current: WearMapping | undefined;
        for (const originalLine of source.split(/\r?\n/)) {
            const line = originalLine.replace(/\/\/.*$/, "").trim();
            const group = /^group\s+"([^"]+)"(?:\s+"([^"]+)")?/i.exec(line);
            if (group) {
                current = { group: group[1].toLowerCase(), profile: group[2]?.toLowerCase() };
                continue;
            }
            const item = /^item\s+"([^"]+)"/i.exec(line);
            if (item && current) mappings.set(item[1].toLowerCase(), current);
        }
        return mappings;
    });
    return wearMappingsPromise;
};

const fetchBuffer = async (path: string): Promise<ArrayBuffer> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Hero wear asset request failed for ${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
};

const drawFrame = (
    context: CanvasRenderingContext2D,
    image: HTMLCanvasElement,
    frameWidth: number,
    frameHeight: number,
    row: number,
    frame: number,
    destinationX: number,
    destinationY: number,
): void => {
    context.drawImage(
        image,
        frame * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight,
        destinationX,
        destinationY,
        frameWidth,
        frameHeight,
    );
};

const composeAction = async (
    profile: string,
    action: ActionProfile,
    base: HADAnimation,
    baseImage: HTMLCanvasElement,
    equippedMappings: readonly WearMapping[],
): Promise<HTMLCanvasElement> => {
    const rows = baseImage.height / base.frameHeight;
    if (!Number.isInteger(rows) || baseImage.width !== base.frameCount * base.frameWidth) {
        throw new Error(`Invalid hero atlas geometry for ${profile}/${action.file}`);
    }

    const loadedLayers = await Promise.all(equippedMappings.map(async (mapping): Promise<WearLayer | undefined> => {
        const category = getWearCategory(mapping.group);
        const directory = `/assets/wear/${profile}/${category}/${mapping.group}`;
        const iadUrl = `${directory}/${mapping.group}.iad`;
        const image = await loadCSX(`${directory}/animation/${action.file}`);
        if (!image) return undefined;
        const [iadBuffer, sequenceBuffer] = await Promise.all([
            fetchBuffer(iadUrl),
            fetchBuffer(`/assets/wear/${profile}/seq/${action.file.replace(/\.csx$/i, "")}_${category}.seq`),
        ]);
        const metadata = new IADParser(iadBuffer).getAnimation(action.action);
        if (metadata.frameCount !== base.frameCount
            || image.width !== metadata.frameCount * metadata.frameWidth
            || image.height !== rows * metadata.frameHeight) {
            throw new Error(`Incompatible wear atlas ${mapping.group}/${action.file}`);
        }
        const sequence = new Uint8Array(sequenceBuffer);
        if (sequence[0] !== base.frameCount || sequence.byteLength !== 1 + rows * base.frameCount) {
            throw new Error(`Invalid wear sequence for ${mapping.group}/${action.file}`);
        }
        return { category, image, metadata, order: sequence.subarray(1) };
    }));
    const layers = loadedLayers.filter((layer): layer is WearLayer => layer !== undefined);

    if (layers.length === 0) return baseImage;
    const output = document.createElement("canvas");
    output.width = baseImage.width;
    output.height = baseImage.height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Failed to create hero composition canvas");

    for (let row = 0; row < rows; row += 1) {
        for (let frame = 0; frame < base.frameCount; frame += 1) {
            const index = row * base.frameCount + frame;
            const sorted = [...layers].sort((left, right) => left.order[index] - right.order[index]);
            for (const layer of sorted.filter((entry) => entry.order[index] < 1)) {
                drawFrame(context, layer.image, layer.metadata.frameWidth, layer.metadata.frameHeight, row, frame,
                    frame * base.frameWidth + layer.metadata.compositeWidth - base.compositeWidth,
                    row * base.frameHeight + layer.metadata.compositeHeight - base.compositeHeight);
            }
            drawFrame(context, baseImage, base.frameWidth, base.frameHeight, row, frame,
                frame * base.frameWidth, row * base.frameHeight);
            for (const layer of sorted.filter((entry) => entry.order[index] >= 1)) {
                drawFrame(context, layer.image, layer.metadata.frameWidth, layer.metadata.frameHeight, row, frame,
                    frame * base.frameWidth + layer.metadata.compositeWidth - base.compositeWidth,
                    row * base.frameHeight + layer.metadata.compositeHeight - base.compositeHeight);
            }
        }
    }
    return output;
};

export const loadCompositedHeroSprites = async (equippedTechnicalNames: readonly string[]): Promise<PersonSpriteSet> => {
    const mappings = await loadWearMappings();
    const equippedMappings = equippedTechnicalNames
        .map((name) => mappings.get(name.toLowerCase()))
        .filter((mapping): mapping is WearMapping => mapping !== undefined);
    const profile = equippedMappings.find((mapping) => mapping.profile)?.profile ?? DEFAULT_PROFILE;
    const cacheKey = `${profile}:${equippedMappings.map((mapping) => mapping.group).sort().join(",")}`;
    const actions = profile === "bows"
        ? ACTIONS.map((action) => action.target === "attack" ? { ...action, file: "hits3.csx" } : action)
        : ACTIONS;
    const cached = spriteCache.get(cacheKey);
    if (cached) return cached;

    const promise = (async (): Promise<PersonSpriteSet> => {
        const had = new HADParser(await fetchBuffer(`/assets/wear/${profile}/${profile}.had`));
        const baseImages = await Promise.all(actions.map((action) => loadCSX(`/assets/wear/${profile}/animation/${action.file}`)));
        if (baseImages.some((image) => !image)) throw new Error(`Failed to load hero profile ${profile}`);
        const composed = await Promise.all(actions.map((action, index) => {
            const base = had.getAnimation(action.action);
            return composeAction(profile, action, base, baseImages[index]!, equippedMappings);
        }));
        return {
            idleImage: composed[0],
            idle: had.getAnimation(ACTIONS[0].action),
            walkImage: composed[1],
            walk: had.getAnimation(ACTIONS[1].action),
            runImage: composed[2],
            run: had.getAnimation(ACTIONS[2].action),
            turnIdleImage: composed[3],
            turnIdle: had.getAnimation(ACTIONS[3].action),
            turnWalkImage: composed[4],
            turnWalk: had.getAnimation(ACTIONS[4].action),
            attackImage: composed[5],
            attack: had.getAnimation(ACTIONS[5].action),
            sufferImage: composed[6],
            suffer: had.getAnimation(ACTIONS[6].action),
            dieImage: composed[7],
            die: had.getAnimation(ACTIONS[7].action),
        };
    })();
    spriteCache.set(cacheKey, promise);
    return promise;
};
