#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
    const { nativeDayPhase, nativeWorldLightCoefficient, nativeWorldLightModulation, drawNativeNightShading } =
        await vite.ssrLoadModule("/src/game/NativeDayNight.ts");
    const { AudioWeatherRuntime } = await vite.ssrLoadModule("/src/game/AudioWeatherRuntime.ts");

    assert.equal(nativeDayPhase(5 * 60 + 59), "night", "05:59 must remain native night");
    assert.equal(nativeDayPhase(6 * 60), "day", "Server.dll starts day at 06:00");
    assert.equal(nativeDayPhase(19 * 60 + 59), "day", "19:59 must remain native day");
    assert.equal(nativeDayPhase(20 * 60), "night", "Server.dll starts night at 20:00");

    assert.equal(nativeWorldLightCoefficient(6 * 60), 0, "Client sunrise has not started at 06:00");
    assert.equal(nativeWorldLightCoefficient(7 * 60 + 30), 0.5, "Client sunrise reaches half strength at 07:30");
    assert.equal(nativeWorldLightCoefficient(8 * 60), 1, "Client sunrise finishes at 08:00");
    assert.equal(nativeWorldLightCoefficient(20 * 60), 1, "Client remains unmodified through 20:59");
    assert.equal(nativeWorldLightCoefficient(21 * 60 + 30), 0.5, "Client dusk reaches half strength at 21:30");
    assert.equal(nativeWorldLightCoefficient(22 * 60), 0, "Client dusk finishes at 22:00");
    assert.deepEqual(nativeWorldLightModulation(22 * 60), { red: 161, green: 124, blue: 255 });
    assert.deepEqual(nativeWorldLightModulation(21 * 60 + 30), { red: 208, green: 190, blue: 255 });

    const shadingCalls = [];
    const shadingContext = {
        fillStyle: "",
        globalCompositeOperation: "source-over",
        save: () => shadingCalls.push("save"),
        fillRect: (x, y, width, height) => shadingCalls.push([x, y, width, height]),
        restore: () => shadingCalls.push("restore"),
    };
    drawNativeNightShading(shadingContext, 1024, 768, 22 * 60, false);
    assert.deepEqual(shadingCalls, ["save", [0, 0, 1024, 768], "restore"]);
    assert.equal(shadingContext.fillStyle, "rgb(161 124 255)");
    assert.equal(shadingContext.globalCompositeOperation, "multiply", "Native HAL night uses ZERO/INVSRCCOLOR modulation");

    shadingCalls.length = 0;
    drawNativeNightShading(shadingContext, 1024, 768, 22 * 60, true);
    assert.deepEqual(shadingCalls, [], "SEF internal_location must bypass native day/night modulation");
    drawNativeNightShading(shadingContext, 1024, 768, 20 * 60, false);
    assert.deepEqual(shadingCalls, [], "Full-light coefficient must not touch the framebuffer");
    let elapsedMinutes = 5 * 60 + 59;
    const createdAudio = [];
    const audio = new AudioWeatherRuntime({
        gameTime: () => elapsedMinutes,
        random: () => 0,
        crossfadeDurationMs: 0,
        resolveAudioUrl: (source) => source,
        createAudio: (source) => {
            const element = {
                src: source,
                loop: false,
                volume: 0,
                muted: false,
                currentTime: 0,
                play() {},
                pause() {},
                removeAttribute() {},
                load() {},
            };
            createdAudio.push(element);
            return element;
        },
    });
    audio.loadLevel({
        weather: { type: 0, intensity: 0 },
        environmentSounds: {
            header: { param1: 0, param2: 0, param3: 0, param4: 0 },
            levelTheme: "",
            dayAmbience: "/day.wav",
            nightAmbience: "/night.wav",
            otherSounds: [],
        },
    });
    assert.equal(audio.getSnapshot().phase, "night");
    assert.equal(createdAudio.at(-1).src, "/night.wav");

    elapsedMinutes = 6 * 60;
    audio.update();
    assert.equal(audio.getSnapshot().phase, "day");
    assert.equal(createdAudio.at(-1).src, "/day.wav");

    elapsedMinutes = 20 * 60;
    audio.update();
    assert.equal(audio.getSnapshot().phase, "night");
    assert.equal(createdAudio.at(-1).src, "/night.wav");
    audio.destroy();

    console.log("Day/night runtime verification passed: server ambience phases, Client HAL modulation, twilight curve, and SEF interior gate.");
} finally {
    await vite.close();
}
