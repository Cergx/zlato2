#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { singleLevels, multiplayerLevels } from "../src/constants/levels.ts";
import { Paths } from "../src/constants/paths.ts";
import { LVLParser } from "../src/game/parsers/LVLParser.ts";
import { PADParser } from "../src/game/parsers/PADParser.ts";
import { SEFParser } from "../src/game/parsers/SEFParser.ts";

const publicRoot = resolve("public");
const fileCache = new Map();
const personCache = new Map();

const localPath = (url) => resolve(publicRoot, `.${decodeURIComponent(url)}`);
const readAsset = async (url) => {
    if (!fileCache.has(url)) {
        fileCache.set(url, readFile(localPath(url)).catch((error) => {
            if (error?.code === "ENOENT") return undefined;
            throw error;
        }));
    }
    return fileCache.get(url);
};
const readGraphic = async (url) => {
    const bytes = await readAsset(url);
    if (bytes) return { bytes, url };
    if (!url.toLowerCase().endsWith(".csx")) return undefined;
    const bmpUrl = `${url.slice(0, -4)}.bmp`;
    const bmp = await readAsset(bmpUrl);
    return bmp ? { bytes: bmp, url: bmpUrl } : undefined;
};

const csxDimensions = (bytes, url) => {
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
        if (bytes.length < 54) throw new Error(`${url}: truncated BMP fallback`);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    }
    if (bytes.length < 16) throw new Error(`${url}: truncated CSX header`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const paletteSize = view.getInt32(0, true);
    if (paletteSize < 0 || paletteSize > 256) throw new Error(`${url}: invalid CSX palette ${paletteSize}`);
    const offset = 8 + paletteSize * 4;
    if (offset + 8 > bytes.length) throw new Error(`${url}: truncated CSX dimensions`);
    return { width: view.getInt32(offset, true), height: view.getInt32(offset + 4, true) };
};

const requireAsset = async (url, errors, label) => {
    if (!await readAsset(url)) errors.push(`${label}: missing ${url}`);
};
const requireGraphic = async (url, errors, label) => {
    if (!await readGraphic(url)) errors.push(`${label}: missing ${url} and BMP fallback`);
};

const animationProfiles = [
    { idleFile: "rt_stay.csx", idleAction: 0x1, walkFile: "rt_go.csx", walkAction: 0x20 },
    { idleFile: "tb_stay.csx", idleAction: 0x4, walkFile: "tb_go.csx", walkAction: 0x10 },
];
const optionalAnimations = [
    { label: "attack", files: ["hits0.csx", "hits1.csx", "hits2.csx", "hits3.csx"], actions: [0x10000, 0x20000, 0x40000, 0x80000] },
    { label: "suffer", files: ["suffer.csx"], actions: [0x80] },
    { label: "die", files: ["die.csx"], actions: [0x100] },
];

const verifyPerson = async (technicalName) => {
    const key = technicalName.toLowerCase();
    if (personCache.has(key)) return personCache.get(key);
    const promise = (async () => {
        const errors = [];
        const scriptUrl = Paths.PERSON_SCRIPT(key);
        const scriptBytes = await readAsset(scriptUrl);
        if (!scriptBytes) return [`person ${technicalName}: missing ${scriptUrl}`];
        const script = new TextDecoder("windows-1251").decode(scriptBytes);
        const match = /\bres_name\s*:\s*"([^"]+)"/i.exec(script);
        if (!match) return [`person ${technicalName}: ${scriptUrl} has no res_name`];
        const resource = match[1].toLowerCase();
        const padUrl = Paths.PERSON_PAD(resource);
        const padBytes = await readAsset(padUrl);
        if (!padBytes) return [`person ${technicalName}: missing ${padUrl}`];
        let pad;
        try {
            pad = new PADParser(padBytes.buffer.slice(padBytes.byteOffset, padBytes.byteOffset + padBytes.byteLength));
        } catch (error) {
            return [`person ${technicalName}: invalid ${padUrl}: ${error}`];
        }
        const profile = animationProfiles.find(({ idleAction, walkAction }) => pad.hasAnimation(idleAction) && pad.hasAnimation(walkAction));
        if (!profile) return [`person ${technicalName}: ${resource} has no complete idle/walk animation pair`];
        await requireGraphic(Paths.PERSON_ANIMATION(resource, profile.idleFile), errors, `person ${technicalName} idle`);
        await requireGraphic(Paths.PERSON_ANIMATION(resource, profile.walkFile), errors, `person ${technicalName} walk`);
        const turnProfile = animationProfiles[1];
        if (profile !== turnProfile && pad.hasAnimation(turnProfile.idleAction) && pad.hasAnimation(turnProfile.walkAction)) {
            await requireGraphic(Paths.PERSON_ANIMATION(resource, turnProfile.idleFile), errors, `person ${technicalName} turn idle`);
            await requireGraphic(Paths.PERSON_ANIMATION(resource, turnProfile.walkFile), errors, `person ${technicalName} turn walk`);
        }
        for (const optional of optionalAnimations) {
            const availableActions = optional.actions.filter((action) => pad.hasAnimation(action));
            if (availableActions.length === 0) continue;
            let matched = false;
            for (const file of optional.files) {
                const graphic = await readGraphic(Paths.PERSON_ANIMATION(resource, file));
                if (!graphic) continue;
                const dimensions = csxDimensions(graphic.bytes, graphic.url);
                if (availableActions.some((action) => {
                    const animation = pad.getAnimation(action);
                    return dimensions.width === animation.frameCount * animation.frameWidth
                        && dimensions.height % animation.frameHeight === 0;
                })) {
                    matched = true;
                    break;
                }
            }
            if (!matched) errors.push(`person ${technicalName}: ${resource} has PAD ${optional.label} action but no matching sprite`);
        }
        return errors;
    })();
    personCache.set(key, promise);
    return promise;
};

globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    const bytes = await readAsset(new URL(url, "http://local").pathname);
    return bytes
        ? new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } })
        : new Response(null, { status: 404 });
};

const verifyLevel = async (gameMode, level) => {
    const errors = [];
    const sefUrl = Paths.LEVEL_SEF(level, gameMode);
    const sdbUrl = Paths.LEVEL_SDB(level, gameMode);
    const sefBytes = await readAsset(sefUrl);
    await requireAsset(sdbUrl, errors, `${gameMode}/${level}`);
    if (!sefBytes) return [...errors, `${gameMode}/${level}: missing ${sefUrl}`];
    let sefData;
    try {
        sefData = new SEFParser(new TextDecoder("windows-1251").decode(sefBytes)).getData();
    } catch (error) {
        return [...errors, `${gameMode}/${level}: invalid SEF: ${error}`];
    }
    const lvlUrl = Paths.LEVEL(sefData.pack);
    if (!await readAsset(lvlUrl)) return [...errors, `${gameMode}/${level}: missing ${lvlUrl}`];
    let lvlData;
    try {
        const parser = new LVLParser(lvlUrl);
        await parser.parse();
        lvlData = parser.getData();
    } catch (error) {
        return [...errors, `${gameMode}/${level}: invalid LVL ${lvlUrl}: ${error}`];
    }
    await requireAsset(Paths.LEVEL_IMAGE(sefData.pack), errors, `${gameMode}/${level} map`);
    await requireGraphic(Paths.LEVEL_MININAP(sefData.pack), errors, `${gameMode}/${level} minimap`);
    if (lvlData.animationDescriptions.length > 0) {
        await requireAsset(Paths.LEVEL_LAO(sefData.pack), errors, `${gameMode}/${level} animation data`);
    }
    for (const description of lvlData.staticDescriptions) {
        await requireGraphic(Paths.LEVEL_STATIC(sefData.pack, description.number), errors, `${gameMode}/${level} static ${description.name}`);
    }
    for (const description of lvlData.maskDescriptions) {
        if (description.number < 0) continue;
        await requireGraphic(Paths.LEVEL_MASK(sefData.pack, description.number), errors, `${gameMode}/${level} mask ${description.name}`);
        if ((description.type & 1) !== 0) {
            await requireGraphic(Paths.LEVEL_ALT_MASK(sefData.pack, description.number), errors, `${gameMode}/${level} alternate mask ${description.name}`);
        }
    }
    for (const number of new Set(lvlData.triggerDescription.map(({ number }) => number))) {
        await requireGraphic(Paths.LEVEL_TRIGGER(sefData.pack, number), errors, `${gameMode}/${level} trigger ${number}`);
    }
    for (const description of lvlData.animationDescriptions) {
        await requireGraphic(Paths.LEVEL_ANIMATION(sefData.pack, description.number), errors, `${gameMode}/${level} animation ${description.name}`);
    }
    for (const person of sefData.persons) errors.push(...await verifyPerson(person.name));
    return errors;
};

const selected = process.argv.slice(2);
const locations = [
    ...singleLevels.map((level) => ({ gameMode: "single", level })),
    ...multiplayerLevels.map((level) => ({ gameMode: "multiplayer", level })),
].filter(({ level }) => selected.length === 0 || selected.includes(level));
let failed = 0;
for (const { gameMode, level } of locations) {
    const errors = await verifyLevel(gameMode, level);
    if (errors.length === 0) {
        console.log(`OK ${gameMode}/${level}`);
        continue;
    }
    failed++;
    console.error(`ERROR ${gameMode}/${level}`);
    for (const error of errors) console.error(`  ${error}`);
}
console.log(`Verified ${locations.length - failed}/${locations.length} locations; ${failed} locations have asset errors.`);
if (failed > 0) process.exitCode = 1;
