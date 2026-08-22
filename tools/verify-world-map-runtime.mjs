#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
    const {
        WorldMapRuntime,
        nativeGlobalMapPassable,
        nativeEvilEncounterChance,
        nativeGoodEncounterChance,
        nativeSelectEncounterPersons,
        nativeScoutNoticeChance,
        nativeWorldMapAudioState,
    } = await vite.ssrLoadModule("/src/game/WorldMapRuntime.ts");
    const { parseNativeGlobalMapAudioDefinition, joinLocationLabels, SPECIAL_MAP_LABELS } = await vite.ssrLoadModule("/src/game/NativeGlobalMapData.ts");
    const shippedAudio = parseNativeGlobalMapAudioDefinition(new TextDecoder("windows-1251").decode(
        readFileSync("public/assets/scripts/globalmap/soundmap/gmsound.dsc"),
    ));
    assert.deepEqual(shippedAudio.music.map((entry) => entry.source), ["music/gl01.ogg", "music/gl02.ogg", "music/gl03.ogg"]);
    assert.deepEqual(shippedAudio.environments.map((entry) => entry.source), [
        "sounds/globalmap/effects/sealoop.wav",
        "sounds/globalmap/effects/dayloop2.wav",
        "sounds/globalmap/effects/water.wav",
    ]);
    assert.equal(shippedAudio.sources.length, 0);
    const { SDBParser } = await vite.ssrLoadModule("/src/game/parsers/SDBParser.ts");
    const arrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const technicalNames = new SDBParser(arrayBuffer(readFileSync("public/assets/sdb/globalmap/gm_loc_tech.sdb"))).getData();
    const visibleNames = new SDBParser(arrayBuffer(readFileSync("public/assets/sdb/globalmap/gm_reg_vis.sdb"))).getData();
    const visibleLabels = joinLocationLabels(technicalNames, visibleNames);
    for (const [id, label] of Object.entries(SPECIAL_MAP_LABELS)) visibleLabels.set(id, label);
    const colorsSource = new TextDecoder("windows-1251").decode(readFileSync("public/assets/scripts/globalmap/gm_colors.ini"));
    const locationIds = [];
    for (const rawLine of colorsSource.replace(/\r/g, "").split("\n")) {
        const line = rawLine.split("//", 2)[0].trim();
        const location = /^loc\s+\d+\s+\d+\s+\d+\s+"([^"]+)"/i.exec(line);
        if (location) locationIds.push(location[1].toUpperCase());
    }
    assert.equal(locationIds.length, 54, "gm_colors.ini must define 54 authored locations");
    for (const id of locationIds) {
        const label = visibleLabels.get(id.toLowerCase());
        assert.ok(label, `${id} must resolve a literary name`);
        assert.notEqual(label, id, `${id} must not fall back to its technical id`);
    }
    assert.equal(visibleLabels.get("l27"), "Амулет Вечерней Звезды");
    assert.equal(visibleLabels.get("l25_1"), "Хрустальный рудник");
    assert.equal(visibleLabels.get("l53"), "Кузнец-отшельник");
    assert.equal(visibleLabels.get("l21_1"), "В Марвию");
    assert.equal(visibleLabels.get("l77"), "Нападение пиратов", "The special pirate-attack point must keep its authored comment name");
    const { WorldMapAudioRuntime } = await vite.ssrLoadModule("/src/game/WorldMapAudioRuntime.ts");
    const createdAudio = [];
    const cancelledFrames = [];
    const mapAudio = new WorldMapAudioRuntime({
        createAudio: (src) => {
            const audio = { src, loop: false, volume: 1, muted: false, currentTime: 0, played: 0, pausedCount: 0,
                play() { this.played += 1; }, pause() { this.pausedCount += 1; } };
            createdAudio.push(audio);
            return audio;
        },
        resolveAudioUrl: (source) => `/assets/${source}`,
        frameScheduler: { requestFrame: () => 7, cancelFrame: (handle) => cancelledFrames.push(handle) },
    });
    mapAudio.setVolumes(0.35, 1);
    mapAudio.setState({
        music: "music/gl01.ogg",
        environment: "sounds/globalmap/effects/dayloop2.wav",
        environmentVolume: 128 / 255,
        sources: [],
    });
    assert.deepEqual(createdAudio.map((audio) => audio.src), [
        "/assets/music/gl01.ogg",
        "/assets/sounds/globalmap/effects/dayloop2.wav",
    ]);
    assert.equal(createdAudio[0].volume, 0, "Native music starts silent before its one-second fade");
    assert.equal(createdAudio[1].volume, 0.5, "Environment volume is quantized to native integer percent");
    mapAudio.destroy();
    assert.equal(createdAudio.every((audio) => audio.pausedCount === 1), true);
    assert.deepEqual(cancelledFrames, [7]);

    assert.equal(nativeScoutNoticeChance(4), 0);
    assert.equal(nativeScoutNoticeChance(5), 0.25);
    assert.equal(nativeScoutNoticeChance(10), 0.5);
    assert.equal(nativeScoutNoticeChance(15), 0.9);
    assert.ok(nativeEvilEncounterChance(0.5, 0.5, 16, 30, 15, 0, false)
        < nativeEvilEncounterChance(0.5, 0.5, 16, 1, 0, 0, false), "Luck and scout must reduce hostile encounter probability");
    assert.ok(nativeGoodEncounterChance(0.5, 0.5, 30, 15)
        > nativeGoodEncounterChance(0.5, 0.5, 1, 0), "Luck and scout must increase peaceful encounter probability");
    const encounterSide = {
        disposition: "evil",
        priority: 2,
        groupCount: 2,
        persons: [
            { technicalName: "Always", group: 0, dayWeight: 100, nightWeight: 100 },
            { technicalName: "Day", group: 1, dayWeight: 70, nightWeight: 0 },
            { technicalName: "Night", group: 1, dayWeight: 30, nightWeight: 100 },
        ],
    };
    assert.deepEqual(nativeSelectEncounterPersons(encounterSide, 12 * 60, () => 0), ["Always", "Day"]);
    assert.deepEqual(nativeSelectEncounterPersons(encounterSide, 22 * 60, () => 0), ["Always", "Night"]);

    const width = 16;
    const height = 12;
    const colors = new Uint32Array(width * height);
    const probability = new Uint8Array(width * height);
    const audio = {
        music: [{ color: 0x0ac80a, source: "music/gl01.ogg" }],
        environments: [{ color: 0x3eb802, source: "sounds/globalmap/effects/dayloop2.wav" }],
        sources: [{ x: 33, y: 8, source: "sounds/globalmap/effects/water.wav" }],
        musicColors: new Uint32Array(width * height).fill(0x0ac80a),
        environmentColors: new Uint32Array(width * height).fill(0x3eb802),
        environmentVolume: new Uint8Array(width * height).fill(128),
    };
    const initialAudio = nativeWorldMapAudioState({ maskWidth: width, maskHeight: height, audio }, { x: 8, y: 8 });
    assert.equal(initialAudio.music, "music/gl01.ogg");
    assert.equal(initialAudio.environment, "sounds/globalmap/effects/dayloop2.wav");
    assert.equal(initialAudio.environmentVolume, 128 / 255);
    assert.deepEqual(initialAudio.sources, [{ source: "sounds/globalmap/effects/water.wav", volume: 0.5 }]);
    const locations = [
        { id: "A", level: "a", entrance: "GM", x: 8, y: 8, label: "A", color: 1, subLevels: [] },
        { id: "B", level: "b", entrance: "GM", x: 20, y: 8, label: "B", color: 2, subLevels: ["b_inner"], entries: [{ level: "b", label: "Вход" }, { level: "b_inner", label: "Центр" }] },
        { id: "C", level: "c", entrance: "GM", x: 30, y: 8, label: "C", color: 3, subLevels: ["c_inner"], entries: [{ level: "c", label: "Вход" }] },
    ];
    const transitions = [];
    let minutes = 100;
    const audioStates = [];
    const host = {
        getVariable: (name) => name === "worldmap:B" || name === "worldmap:C" ? 2 : 0,
        setVariable() {},
        getHeroParameter: () => 0,
        getElapsedMinutes: () => minutes,
        advanceClock: (value) => { minutes += value; },
        requestTransition: (level, entrance) => transitions.push([level, entrance]),
        requestEncounter: () => { throw new Error("No crime zones are present in the movement fixture"); },
        random: () => 0.999999,
        setAudioState: (state) => audioStates.push(state),
    };
    const runtimeData = {
        locations,
        regions: [],
        crimeZones: [],
        mapWidth: 1600,
        mapHeight: 1200,
        maskWidth: width,
        maskHeight: height,
        noWayColor: 0xff00ff,
        zoneColors: colors,
        probability,
        audio,
    };
    const runtime = new WorldMapRuntime({
        data: runtimeData,
        currentLocation: "A",
        canTravel: true,
        host,
    });
    const encounterFallback = new WorldMapRuntime({
        data: runtimeData,
        currentLocation: "rl_4",
        currentPosition: { x: 8, y: 8 },
        canTravel: true,
        host,
    });
    assert.equal(encounterFallback.getState().position.x, 8, "An RL encounter name must resolve from the saved map position without throwing");
    assert.equal(runtime.travelTo(20, 8, "B"), true, "An unobstructed discovered location must accept travel");
    const fixedRoute = runtime.getState().routePath.map(({ x, y }) => [x, y]);
    runtime.update(40);
    assert.deepEqual(runtime.getState().routePath.map(({ x, y }) => [x, y]), fixedRoute, "Displayed route geometry must stay anchored while the hero moves");
    for (let index = 1; index < 12; index += 1) runtime.update(40);
    assert.deepEqual(transitions, [], "Multi-district arrival must wait for the authored location choice");
    assert.deepEqual(runtime.getState().arrivalPrompt?.options.map(({ level, label }) => [level, label]), [["b", "Вход"], ["b_inner", "Центр"]]);
    runtime.continueArrival();
    assert.equal(runtime.getState().arrivalPrompt, undefined, "Продолжить must dismiss the tooltip and resume map travel");
    assert.deepEqual(transitions, [], "Продолжить must not confirm a district");
    assert.equal(runtime.travelTo(20, 8, "B"), true, "Clicking the city again must reopen its native arrival tooltip");
    runtime.selectArrival("b_inner");
    assert.deepEqual(transitions, [["b_inner", "GM"]], "A district button must enter the selected authored district through GM");
    assert.equal(minutes, 460, "Twelve map pixels must advance the game clock by twelve native 30-minute steps");
    assert.equal(runtime.getState().elapsedMinutes, 460);
    assert.equal(runtime.travelTo(20, 8, "B"), true, "Clicking the current multi-district city must reopen its native arrival tooltip");
    assert.deepEqual(runtime.getState().arrivalPrompt?.options.map(({ level }) => level), ["b", "b_inner"]);
    runtime.continueArrival();
    assert.equal(runtime.getState().arrivalPrompt, undefined);
    assert.ok(audioStates.length >= 2, "Map movement must refresh music, environment, and spatial source state");
    const locked = new WorldMapRuntime({
        data: { locations: [...locations, { id: "D", level: "d", entrance: "GM", x: 40, y: 8, label: "D", color: 4, subLevels: [] }], regions: [], crimeZones: [], mapWidth: 1600, mapHeight: 1200, maskWidth: width, maskHeight: height, noWayColor: 0xff00ff, zoneColors: colors, probability, audio },
        currentLocation: "A",
        canTravel: true,
        host,
    });
    assert.equal(locked.getState().locations.find(({ id }) => id === "D")?.available, false, "A location without RS_SetLocationAccess must remain locked");
    assert.equal(locked.travelTo(40, 8, "D"), false, "A locked authored location must reject map travel");

    // A city whose entry list was filtered down to one district must not prompt;
    // it should transition straight into that sole reachable district.
    const single = new WorldMapRuntime({
        data: { locations, regions: [], crimeZones: [], mapWidth: 1600, mapHeight: 1200, maskWidth: width, maskHeight: height, noWayColor: 0xff00ff, zoneColors: colors, probability, audio },
        currentLocation: "A",
        canTravel: true,
        host,
    });
    assert.equal(single.travelTo(30, 8, "C"), true, "A single-entry city must accept travel");
    for (let index = 0; index < 40 && single.getState().moving; index += 1) single.update(40);
    assert.equal(single.getState().arrivalPrompt, undefined, "A single filtered district must not show a district chooser");
    assert.deepEqual(transitions[transitions.length - 1], ["c", "GM"], "A single filtered district must transition straight to its level");
    const minutesBeforeBlocked = minutes;

    const blockedColors = colors.slice();
    for (let y = 0; y < height; y += 1) blockedColors[y * width + 3] = 0xff00ff;
    assert.equal(nativeGlobalMapPassable({
        maskWidth: width,
        maskHeight: height,
        zoneColors: blockedColors,
        noWayColor: 0xff00ff,
    }, 3, 0), false, "The authored magenta no-way raster must block the complete mask cell");
    assert.equal(nativeGlobalMapPassable({
        maskWidth: width,
        maskHeight: height,
        zoneColors: blockedColors,
        noWayColor: 0xff00ff,
    }, 2, 0), true, "Non-magenta global-map cells must remain passable");
    const blocked = new WorldMapRuntime({
        data: { locations, regions: [], crimeZones: [], mapWidth: 1600, mapHeight: 1200, maskWidth: width, maskHeight: height, noWayColor: 0xff00ff, zoneColors: blockedColors, probability, audio },
        currentLocation: "A",
        canTravel: true,
        host,
    });
    assert.equal(blocked.travelTo(20, 8, "B"), false, "The native no-way mask must reject routes cut off by impassable cells");
    const partialColors = colors.slice();
    partialColors[2 * width + 3] = 0xff00ff;
    const detour = new WorldMapRuntime({
        data: { locations, regions: [], crimeZones: [], mapWidth: 1600, mapHeight: 1200, maskWidth: width, maskHeight: height, noWayColor: 0xff00ff, zoneColors: partialColors, probability, audio },
        currentLocation: "A",
        canTravel: true,
        host,
    });
    assert.equal(detour.travelTo(20, 8, "B"), true, "A partial no-way obstacle must remain routeable around");
    const detourPath = detour.getState().routePath;
    assert.ok(detourPath.length > 2, "A partial no-way obstacle must force a bent route");
    assert.equal(detourPath.some(({ x, y }) => Math.trunc(x / 4) === 3 && Math.trunc(y / 4) === 2), false, "The bent route must not include the blocked cell");
    // Diagonal corner movement: native validates the destination footprint only,
    // so a diagonal between two walkable cells must be traversable even when both
    // orthogonal neighbors are blocked (Server.dll 0x1400FF28 has no corner rule).
    const cornerColors = colors.slice();
    cornerColors[0 * width + 1] = 0xff00ff;
    cornerColors[1 * width + 0] = 0xff00ff;
    const cornerLocations = [
        { id: "A", level: "a", entrance: "GM", x: 0, y: 0, label: "A", color: 1, subLevels: [] },
        { id: "B", level: "b", entrance: "GM", x: 4, y: 4, label: "B", color: 2, subLevels: [] },
    ];
    const corner = new WorldMapRuntime({
        data: { locations: cornerLocations, regions: [], crimeZones: [], mapWidth: 1600, mapHeight: 1200, maskWidth: width, maskHeight: height, noWayColor: 0xff00ff, zoneColors: cornerColors, probability, audio },
        currentLocation: "A",
        canTravel: true,
        host,
    });
    assert.equal(corner.travelTo(4, 4, "B"), true, "A diagonal between walkable cells must be traversable across blocked orthogonal neighbors");

    const frozen = new WorldMapRuntime({
        data: { locations, regions: [], crimeZones: [], mapWidth: 1600, mapHeight: 1200, maskWidth: width, maskHeight: height, noWayColor: 0xff00ff, zoneColors: colors, probability, audio },
        currentLocation: "A",
        canTravel: false,
        host,
    });
    const minutesBeforeFrozen = minutes;
    assert.equal(frozen.travelTo(20, 8, "B"), false, "Travel must be refused without permission even toward a discovered location");
    assert.equal(frozen.update(40), false, "Map clock must not advance when travel is disallowed");
    assert.equal(minutes, minutesBeforeFrozen, "Disallowed travel must not advance the game clock");

    console.log("World-map runtime verification passed: native scout bounds, encounter modifiers, masks, movement timing, GM arrival, and global-map audio selection.");
} finally {
    await vite.close();
}
