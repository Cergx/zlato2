import { Paths } from "../constants/paths.ts";
import { WORLD_CHUNK_HEIGHT, WORLD_CHUNK_WIDTH, type WorldPosition } from "./WorldCoordinates.ts";
import type { TilePosition } from "./parsers/SEFParser.ts";
import type { LVLData } from "./parsers/LVLParser.ts";

export type EnvironmentSoundData = LVLData["environmentSounds"];
export type AmbientEmitterData = EnvironmentSoundData["otherSounds"][number];

export type WeatherKind = "clear" | "rain" | "snow" | "snowstorm" | "sand" | "sandstorm" | "unknown";
export type DayPhase = "day" | "night";

export interface WeatherSnapshot {
    readonly type: number;
    readonly intensity: number;
    readonly strength: number;
    readonly kind: WeatherKind;
    readonly active: boolean;
    readonly phase: DayPhase;
    readonly seed: number;
    readonly updatedAt: number;
}

export interface AmbientEmitterSnapshot {
    readonly source: string;
    readonly position: TilePosition;
    readonly worldPosition: WorldPosition;
    readonly radius: number;
    readonly volume: number;
}

export interface AudioWeatherSnapshot {
    readonly destroyed: boolean;
    readonly muted: boolean;
    readonly volumes: Readonly<AudioVolumeSettings>;
    readonly phase: DayPhase;
    readonly weather: WeatherSnapshot;
    readonly emitters: readonly AmbientEmitterSnapshot[];
}

export interface AudioVolumeSettings {
    master: number;
    music: number;
    ambient: number;
}

export interface BrowserAudio {
    src: string;
    loop: boolean;
    volume: number;
    muted: boolean;
    currentTime: number;
    readonly paused?: boolean;
    preload?: string;
    play(): Promise<void> | void;
    pause(): void;
    removeAttribute?(qualifiedName: string): void;
    load?(): void;
}

export interface FrameScheduler {
    requestFrame(callback: () => void): number;
    cancelFrame(handle: number): void;
}

export interface AudioWeatherRuntimeOptions {
    /** Creates browser audio elements. It is injectable so runtime hosts control browser effects. */
    createAudio?: (url: string) => BrowserAudio;
    /** Resolves an LVL SENV resource such as `sounds\\locations\\water.wav`. */
    resolveAudioUrl?: (source: string) => string;
    clock?: () => Date;
    random?: () => number;
    frameScheduler?: FrameScheduler;
    crossfadeDurationMs?: number;
    volumes?: Partial<AudioVolumeSettings>;
    muted?: boolean;
    onPlaybackError?: (error: unknown, source: string) => void;
}

interface AudioTrack {
    readonly audio: BrowserAudio;
    readonly source: string;
    readonly group: "music" | "ambient";
    readonly baseVolume: number;
    readonly emitter?: PlannedEmitter;
}

interface Fade {
    readonly track: AudioTrack;
    readonly startedAt: number;
    readonly from: number;
    target: number;
    readonly disposeAtEnd: boolean;
}

interface LevelAudioPlan {
    readonly musicUrl?: string;
    readonly dayAmbienceUrl?: string;
    readonly nightAmbienceUrl?: string;
    readonly weatherUrl?: string;
    readonly emitters: readonly PlannedEmitter[];
    readonly weather: LVLData["weather"];
}

interface PlannedEmitter {
    readonly url: string;
    readonly source: string;
    readonly position: TilePosition;
    readonly worldPosition: WorldPosition;
    readonly radius: number;
    readonly volume: number;
    readonly minimumDistance: number;
    readonly maximumDistance: number;
    readonly delayMinimumMs: number;
    readonly delayMaximumMs: number;
    readonly flags: number;
}

const DEFAULT_VOLUMES: AudioVolumeSettings = {
    master: 1,
    music: 0.35,
    ambient: 1,
};

// Client.dll 0x120C1E98..0x120C1ED8 initializes the three native battle tracks;
// 0x120C14F0..0x120C152D selects one with a uniform random index in [0, 2].
const COMBAT_MUSIC_URLS = [
    `${Paths.MUSIC}/gl04.ogg`,
    `${Paths.MUSIC}/gl02.ogg`,
    `${Paths.MUSIC}/gl05.ogg`,
] as const;

const WEATHER_KINDS: Readonly<Record<number, WeatherKind>> = {
    0: "clear",
    1: "rain",
    2: "snow",
    3: "snowstorm",
    4: "sand",
    5: "sandstorm",
};

const WEATHER_AUDIO: Readonly<Partial<Record<WeatherKind, string>>> = {
    rain: `${Paths.SOUNDS}/weather/storm.wav`,
    snowstorm: `${Paths.SOUNDS}/weather/storm.wav`,
    sand: `${Paths.SOUNDS}/weather/sand.wav`,
    sandstorm: `${Paths.SOUNDS}/weather/sandstorm.wav`,
};

const defaultFrameScheduler: FrameScheduler = {
    requestFrame(callback) {
        if (typeof globalThis.requestAnimationFrame === "function") {
            return globalThis.requestAnimationFrame(() => callback());
        }

        return globalThis.setTimeout(callback, 16) as unknown as number;
    },
    cancelFrame(handle) {
        if (typeof globalThis.cancelAnimationFrame === "function") {
            globalThis.cancelAnimationFrame(handle);
            return;
        }

        globalThis.clearTimeout(handle);
    },
};

class GaplessBrowserAudio implements BrowserAudio {
    private static context: AudioContext | undefined;
    private static unlockInstalled = false;
    private static readonly waiting = new Set<GaplessBrowserAudio>();
    private readonly gain: GainNode;
    private sourceNode: AudioBufferSourceNode | undefined;
    private buffer: AudioBuffer | undefined;
    private bufferPromise: Promise<AudioBuffer> | undefined;
    private playing = false;
    private startedAt = 0;
    private offset = 0;
    private generation = 0;
    private sourceUrl: string;
    private looping = false;
    private trackVolume = 1;
    private trackMuted = false;
    public preload = "auto";

    public constructor(url: string) {
        this.sourceUrl = url;
        const context = GaplessBrowserAudio.getContext();
        this.gain = context.createGain();
        this.gain.connect(context.destination);
    }

    public get src(): string { return this.sourceUrl; }
    public set src(value: string) {
        if (value === this.sourceUrl) return;
        this.pause();
        this.sourceUrl = value;
        this.buffer = undefined;
        this.bufferPromise = undefined;
        this.offset = 0;
        this.generation++;
    }
    public get loop(): boolean { return this.looping; }
    public set loop(value: boolean) {
        this.looping = value;
        if (this.sourceNode) this.sourceNode.loop = value;
    }
    public get volume(): number { return this.trackVolume; }
    public set volume(value: number) {
        this.trackVolume = value;
        this.updateGain();
    }
    public get muted(): boolean { return this.trackMuted; }
    public set muted(value: boolean) {
        this.trackMuted = value;
        this.updateGain();
    }
    public get paused(): boolean { return !this.playing; }
    public get currentTime(): number {
        if (!this.playing || !this.buffer) return this.offset;
        const elapsed = GaplessBrowserAudio.getContext().currentTime - this.startedAt + this.offset;
        return this.looping ? elapsed % this.buffer.duration : Math.min(elapsed, this.buffer.duration);
    }
    public set currentTime(value: number) {
        this.offset = Math.max(0, value);
        if (this.playing) this.restartSource();
    }

    public async play(): Promise<void> {
        if (this.playing && (this.sourceNode || GaplessBrowserAudio.waiting.has(this))) return;
        this.playing = true;
        const generation = this.generation;
        const buffer = await this.loadBuffer();
        if (!this.playing || generation !== this.generation) return;
        this.buffer = buffer;
        const context = GaplessBrowserAudio.getContext();
        if (context.state === "running") this.startSource();
        else GaplessBrowserAudio.waiting.add(this);
    }

    public pause(): void {
        if (this.playing && this.sourceNode) this.offset = this.currentTime;
        this.playing = false;
        GaplessBrowserAudio.waiting.delete(this);
        this.stopSource();
    }

    public removeAttribute(qualifiedName: string): void {
        if (qualifiedName === "src") this.src = "";
    }

    public load(): void {}

    private async loadBuffer(): Promise<AudioBuffer> {
        if (this.buffer) return this.buffer;
        if (!this.bufferPromise) {
            this.bufferPromise = fetch(this.sourceUrl).then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status} loading ${this.sourceUrl}`);
                return GaplessBrowserAudio.getContext().decodeAudioData(await response.arrayBuffer());
            });
        }
        return this.bufferPromise;
    }

    private restartSource(): void {
        this.stopSource();
        if (!this.buffer) return;
        const context = GaplessBrowserAudio.getContext();
        if (context.state === "running") this.startSource();
        else GaplessBrowserAudio.waiting.add(this);
    }

    private resumeAfterUnlock(): void {
        if (this.playing && this.buffer && !this.sourceNode) this.startSource();
    }

    private startSource(): void {
        const context = GaplessBrowserAudio.getContext();
        const buffer = this.buffer;
        if (!buffer || buffer.duration <= 0) return;
        GaplessBrowserAudio.waiting.delete(this);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = this.looping;
        source.connect(this.gain);
        const offset = this.offset % buffer.duration;
        this.startedAt = context.currentTime;
        this.offset = offset;
        source.onended = () => {
            if (this.sourceNode !== source || source.loop) return;
            this.sourceNode = undefined;
            this.playing = false;
            this.offset = 0;
        };
        this.sourceNode = source;
        source.start(0, offset);
    }

    private stopSource(): void {
        const source = this.sourceNode;
        this.sourceNode = undefined;
        if (!source) return;
        source.onended = null;
        try { source.stop(); } catch { /* already stopped */ }
        source.disconnect();
    }

    private updateGain(): void {
        this.gain.gain.value = this.trackMuted ? 0 : this.trackVolume;
    }

    private static getContext(): AudioContext {
        this.context ??= new AudioContext();
        if (this.context.state === "suspended" && !this.unlockInstalled) {
            this.unlockInstalled = true;
            const unlock = () => {
                window.removeEventListener("pointerdown", unlock);
                window.removeEventListener("keydown", unlock);
                this.unlockInstalled = false;
                void this.context?.resume().then(() => {
                    for (const track of this.waiting) track.resumeAfterUnlock();
                    this.waiting.clear();
                });
            };
            window.addEventListener("pointerdown", unlock, { once: true });
            window.addEventListener("keydown", unlock, { once: true });
        }
        return this.context;
    }
}

export const createBrowserAudio = (url: string): BrowserAudio => new GaplessBrowserAudio(url);
const defaultAudioFactory = createBrowserAudio;

const defaultClock = (): Date => new Date();

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

const assertVolume: (name: string, value: unknown) => asserts value is number = (name, value) => {
    if (!isFiniteNumber(value) || value < 0 || value > 1) {
        throw new Error(`${name} volume must be a finite number between 0 and 1.`);
    }
};

const assertWeather = (weather: LVLData["weather"]): void => {
    if (!weather || !Number.isInteger(weather.type) || weather.type < 0 || !Number.isInteger(weather.intensity) || weather.intensity < 0) {
        throw new Error("LVL weather must contain non-negative integer type and intensity values.");
    }
};

const isDayAt = (date: Date): boolean => {
    const timestamp = date.getTime();
    if (!Number.isFinite(timestamp)) {
        throw new Error("The audio weather clock returned an invalid date.");
    }

    const hour = date.getHours();
    return hour >= 6 && hour < 18;
};

const validateBrowserUrl = (url: string): string => {
    if (typeof url !== "string" || url.trim().length === 0 || [...url].some((character) => character.charCodeAt(0) <= 0x1f)) {
        throw new Error("Audio URL must be a non-empty, control-character-free string.");
    }

    let parsed: URL;
    try {
        parsed = new URL(url, "https://runtime.invalid/");
    } catch {
        throw new Error(`Audio URL is invalid: ${url}`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "blob:") {
        throw new Error(`Audio URL uses unsupported protocol '${parsed.protocol}'.`);
    }

    return url;
};

/** Converts the Windows-style resource names stored in SENV into public browser asset URLs. */
export const resolveLevelAudioUrl = (source: string): string => {
    if (typeof source !== "string" || source.trim().length === 0) {
        throw new Error("LVL audio resource must be a non-empty string.");
    }

    const parts = source.trim().replace(/\\/g, "/").split("/");
    if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
        throw new Error(`LVL audio resource contains an unsafe path: ${source}`);
    }

    const root = parts.shift()?.toLowerCase();
    if (root !== "music" && root !== "sounds" || parts.length === 0) {
        throw new Error(`LVL audio resource must begin with music or sounds: ${source}`);
    }

    const filename = parts[parts.length - 1];
    const extensionIndex = filename.lastIndexOf(".");
    if (extensionIndex <= 0) {
        throw new Error(`LVL audio resource must include an audio extension: ${source}`);
    }

    const extension = filename.slice(extensionIndex + 1).toLowerCase();
    if (!["wav", "ogg", "mp3", "m4a"].includes(extension)) {
        throw new Error(`LVL audio resource has unsupported extension '.${extension}'.`);
    }

    const normalizedParts = parts.map((part) => part.toLowerCase());
    if (root === "music") {
        normalizedParts[normalizedParts.length - 1] = `${filename.slice(0, extensionIndex).toLowerCase()}.ogg`;
    }

    const base = root === "music" ? Paths.MUSIC : Paths.SOUNDS;
    return validateBrowserUrl(`${base}/${normalizedParts.map((part) => encodeURIComponent(part).replace(/%2C/gi, ",")).join("/")}`);
};

export class AudioWeatherRuntime {
    private readonly createAudio: (url: string) => BrowserAudio;
    private readonly resolveAudioUrl: (source: string) => string;
    private readonly clock: () => Date;
    private readonly random: () => number;
    private readonly frameScheduler: FrameScheduler;
    private readonly crossfadeDurationMs: number;
    private readonly onPlaybackError?: (error: unknown, source: string) => void;
    private readonly tracks = new Set<AudioTrack>();
    private readonly fades = new Map<AudioTrack, Fade>();
    private readonly pausedTracks = new Set<AudioTrack>();
    private readonly emitters: PlannedEmitter[] = [];
    private volumes: AudioVolumeSettings;
    private muted: boolean;
    private destroyed = false;
    private paused = false;
    private frameHandle: number | undefined;
    private music: AudioTrack | undefined;
    private ambience: AudioTrack | undefined;
    private weatherAudio: AudioTrack | undefined;
    private dayAmbienceUrl: string | undefined;
    private nightAmbienceUrl: string | undefined;
    private levelMusicUrl: string | undefined;
    private combatActive = false;
    private phase: DayPhase = "day";
    private listenerWorldPosition: WorldPosition | undefined;
    private weatherSnapshot: WeatherSnapshot;

    public constructor(options: AudioWeatherRuntimeOptions = {}) {
        this.createAudio = options.createAudio ?? defaultAudioFactory;
        this.resolveAudioUrl = options.resolveAudioUrl ?? resolveLevelAudioUrl;
        this.clock = options.clock ?? defaultClock;
        this.random = options.random ?? Math.random;
        this.frameScheduler = options.frameScheduler ?? defaultFrameScheduler;
        this.crossfadeDurationMs = options.crossfadeDurationMs ?? 600;
        this.onPlaybackError = options.onPlaybackError;
        this.muted = options.muted ?? false;
        this.volumes = { ...DEFAULT_VOLUMES };

        if (!isFiniteNumber(this.crossfadeDurationMs) || this.crossfadeDurationMs < 0) {
            throw new Error("Crossfade duration must be a non-negative finite number of milliseconds.");
        }
        if (typeof this.muted !== "boolean") {
            throw new Error("Muted must be a boolean.");
        }

        this.setVolumes(options.volumes ?? {});
        const initialDate = this.clock();
        const timestamp = initialDate.getTime();
        this.phase = isDayAt(initialDate) ? "day" : "night";
        this.weatherSnapshot = {
            type: 0,
            intensity: 0,
            strength: 0,
            kind: "clear",
            active: false,
            phase: this.phase,
            seed: 0,
            updatedAt: timestamp,
        };
    }

    /** Loads the parsed LVL environment atomically; malformed audio references create no Audio elements. */
    public loadLevel(level: Pick<LVLData, "weather" | "environmentSounds">): void {
        this.assertAlive();
        const plan = this.createPlan(level);
        const date = this.clock();
        const phase: DayPhase = isDayAt(date) ? "day" : "night";
        const ambienceUrl = phase === "day" ? plan.dayAmbienceUrl : plan.nightAmbienceUrl;
        const weatherSnapshot = this.makeWeatherSnapshot(plan.weather, date);
        const created: AudioTrack[] = [];

        try {
            const music = plan.musicUrl ? this.createTrack(plan.musicUrl, "music", 1) : undefined;
            if (music) created.push(music);
            const ambience = ambienceUrl ? this.createTrack(ambienceUrl, "ambient", 1) : undefined;
            if (ambience) created.push(ambience);
            const weatherAudio = plan.weatherUrl ? this.createTrack(plan.weatherUrl, "ambient", 1) : undefined;
            if (weatherAudio) created.push(weatherAudio);
            const emitters = plan.emitters.map((emitter) => {
                const track = this.createTrack(emitter.url, "ambient", emitter.volume, emitter);
                created.push(track);
                return track;
            });

            for (const track of created) {
                this.startTrack(track);
            }

            this.stopEmitters();
            this.transitionTrack(this.music, music);
            this.transitionTrack(this.ambience, ambience);
            this.transitionTrack(this.weatherAudio, weatherAudio);
            this.music = music;
            this.ambience = ambience;
            this.weatherAudio = weatherAudio;
            this.dayAmbienceUrl = plan.dayAmbienceUrl;
            this.nightAmbienceUrl = plan.nightAmbienceUrl;
            this.levelMusicUrl = plan.musicUrl;
            this.combatActive = false;
            this.phase = phase;
            this.emitters.splice(0, this.emitters.length, ...plan.emitters);

            for (const track of emitters) {
                this.tracks.add(track);
                this.fadeTrack(track, this.targetVolume(track), false);
            }

            this.weatherSnapshot = weatherSnapshot;
        } catch (error) {
            for (const track of created) {
                this.disposeTrack(track);
            }
            throw error;
        }
    }
    public setCombatMode(active: boolean): void {
        this.assertAlive();
        if (this.combatActive === active) return;
        this.combatActive = active;
        let source = this.levelMusicUrl;
        if (active) {
            const random = this.random();
            if (!isFiniteNumber(random) || random < 0 || random >= 1) {
                throw new Error("The audio weather random source must return a number in [0, 1).");
            }
            source = COMBAT_MUSIC_URLS[Math.floor(random * COMBAT_MUSIC_URLS.length)];
        }
        if (this.music?.source === source) return;
        const next = source ? this.createTrack(source, "music", 1) : undefined;
        if (next) this.startTrack(next);
        this.transitionTrack(this.music, next);
        this.music = next;
    }
    public setPaused(paused: boolean): void {
        this.assertAlive();
        if (this.paused === paused) return;
        this.paused = paused;
        if (paused) {
            this.pausedTracks.clear();
            for (const track of this.tracks) {
                if (track.audio.paused !== true) this.pausedTracks.add(track);
                track.audio.pause();
            }
            return;
        }
        for (const track of this.pausedTracks) {
            if (this.tracks.has(track)) this.startTrack(track);
        }
        this.pausedTracks.clear();
    }


    /** Updates day/night ambience and positional volume from the camera-centred listener. */
    public update(listenerWorldPosition?: Readonly<WorldPosition>): WeatherSnapshot {
        this.assertAlive();
        if (listenerWorldPosition) {
            if (!isFiniteNumber(listenerWorldPosition.x) || !isFiniteNumber(listenerWorldPosition.y)) {
                throw new Error("Audio listener position must contain finite coordinates.");
            }
            this.listenerWorldPosition = { ...listenerWorldPosition };
        }
        const date = this.clock();
        const phase: DayPhase = isDayAt(date) ? "day" : "night";
        if (phase !== this.phase) {
            const source = phase === "day" ? this.dayAmbienceUrl : this.nightAmbienceUrl;
            this.replaceAmbience(source);
            this.phase = phase;
            this.weatherSnapshot = { ...this.weatherSnapshot, phase, updatedAt: date.getTime() };
        }
        this.updateTrackVolumes();
        return this.getWeatherSnapshot();
    }

    public setVolumes(volumes: Partial<AudioVolumeSettings>): void {
        this.assertAlive();
        for (const key of Object.keys(volumes)) {
            if (key !== "master" && key !== "music" && key !== "ambient") {
                throw new Error(`Unknown audio volume '${key}'.`);
            }
            const value = volumes[key];
            assertVolume(key, value);
            this.volumes[key] = value;
        }

        for (const track of this.tracks) {
            const fade = this.fades.get(track);
            if (fade) {
                fade.target = fade.disposeAtEnd ? 0 : this.targetVolume(track);
            } else {
                track.audio.volume = this.targetVolume(track);
            }
        }
    }

    public getVolumes(): Readonly<AudioVolumeSettings> {
        return { ...this.volumes };
    }

    public setMuted(muted: boolean): void {
        this.assertAlive();
        if (typeof muted !== "boolean") {
            throw new Error("Muted must be a boolean.");
        }

        this.muted = muted;
        for (const track of this.tracks) {
            track.audio.muted = muted;
        }
    }

    public isMuted(): boolean {
        return this.muted;
    }

    public getWeatherSnapshot(): WeatherSnapshot {
        return { ...this.weatherSnapshot };
    }
    public setWeather(type: number): WeatherSnapshot {
        this.assertAlive();
        if (!Number.isSafeInteger(type) || type < 0) throw new Error("Weather type must be a non-negative safe integer");
        const weather = { type, intensity: type === 0 ? 0 : 1 };
        const kind = WEATHER_KINDS[type] ?? "unknown";
        const source = weather.intensity > 0 ? WEATHER_AUDIO[kind] : undefined;
        const next = source ? this.createTrack(validateBrowserUrl(source), "ambient", 1) : undefined;
        try {
            if (next) this.startTrack(next);
            this.transitionTrack(this.weatherAudio, next);
            this.weatherAudio = next;
            this.weatherSnapshot = this.makeWeatherSnapshot(weather, this.clock());
            return this.getWeatherSnapshot();
        } catch (error) {
            if (next) this.disposeTrack(next);
            throw error;
        }
    }


    public getSnapshot(): AudioWeatherSnapshot {
        return {
            destroyed: this.destroyed,
            muted: this.muted,
            volumes: this.getVolumes(),
            phase: this.phase,
            weather: this.getWeatherSnapshot(),
            emitters: this.emitters.map((emitter) => ({
                source: emitter.source,
                position: { ...emitter.position },
                worldPosition: { ...emitter.worldPosition },
                radius: emitter.radius,
                volume: emitter.volume,
            })),
        };
    }

    /** Stops every created Audio element and cancels the only scheduled crossfade frame. */
    public destroy(): void {
        if (this.destroyed) return;

        this.destroyed = true;
        if (this.frameHandle !== undefined) {
            this.frameScheduler.cancelFrame(this.frameHandle);
            this.frameHandle = undefined;
        }
        this.fades.clear();
        for (const track of [...this.tracks]) {
            this.disposeTrack(track);
        }
        this.music = undefined;
        this.ambience = undefined;
        this.weatherAudio = undefined;
        this.dayAmbienceUrl = undefined;
        this.nightAmbienceUrl = undefined;
        this.emitters.splice(0, this.emitters.length);
        this.listenerWorldPosition = undefined;
    }

    private createPlan(level: Pick<LVLData, "weather" | "environmentSounds">): LevelAudioPlan {
        if (!level || !level.environmentSounds) {
            throw new Error("A parsed LVL environment sound section is required.");
        }
        assertWeather(level.weather);

        const sounds = level.environmentSounds;
        if (typeof sounds.levelTheme !== "string" || typeof sounds.dayAmbience !== "string" || typeof sounds.nightAmbience !== "string" || !Array.isArray(sounds.otherSounds)) {
            throw new Error("LVL environment sounds must contain string theme and ambience resources plus an emitter array.");
        }
        const resolveOptional = (source: string): string | undefined => source.length === 0 ? undefined : validateBrowserUrl(this.resolveAudioUrl(source));
        const emitters = sounds.otherSounds.map((emitter) => this.planEmitter(emitter));
        const kind = WEATHER_KINDS[level.weather.type] ?? "unknown";
        const weatherSource = level.weather.intensity > 0 ? WEATHER_AUDIO[kind] : undefined;

        return {
            musicUrl: resolveOptional(sounds.levelTheme),
            dayAmbienceUrl: resolveOptional(sounds.dayAmbience),
            nightAmbienceUrl: resolveOptional(sounds.nightAmbience),
            weatherUrl: weatherSource ? validateBrowserUrl(weatherSource) : undefined,
            emitters,
            weather: { ...level.weather },
        };
    }

    private planEmitter(emitter: AmbientEmitterData): PlannedEmitter {
        const fields: (keyof AmbientEmitterData)[] = [
            "param1", "param2", "param3", "param4", "param5", "param6",
            "param7", "param8", "param9", "param10", "param11", "param12",
        ];
        if (!emitter || typeof emitter.path !== "string" || emitter.path.length === 0 || fields.some((field) => !isFiniteNumber(emitter[field]))) {
            throw new Error("LVL ambient emitter contains malformed data.");
        }

        const position: TilePosition = { x: emitter.param1, y: emitter.param2 };
        const minimumDistance = Math.max(0, emitter.param7);
        const maximumDistance = Math.max(minimumDistance, emitter.param8);
        return {
            url: validateBrowserUrl(this.resolveAudioUrl(emitter.path)),
            source: emitter.path,
            position,
            worldPosition: {
                x: position.x * WORLD_CHUNK_WIDTH,
                y: position.y * WORLD_CHUNK_HEIGHT,
            },
            radius: maximumDistance,
            volume: clamp(emitter.param6, 0, 1),
            minimumDistance,
            maximumDistance,
            delayMinimumMs: Math.max(0, emitter.param9) * 1000,
            delayMaximumMs: Math.max(emitter.param9, emitter.param10) * 1000,
            flags: emitter.param11,
        };
    }

    private createTrack(source: string, group: AudioTrack["group"], baseVolume: number, emitter?: PlannedEmitter): AudioTrack {
        const audio = this.createAudio(source);
        if (!audio || typeof audio.play !== "function" || typeof audio.pause !== "function") {
            throw new Error(`Audio factory returned an invalid audio element for '${source}'.`);
        }

        audio.src = source;
        audio.loop = emitter === undefined || (emitter.flags & 0x80) !== 0;
        audio.preload = "auto";
        audio.volume = 0;
        audio.muted = this.muted;
        return { audio, source, group, baseVolume, emitter };
    }

    private startTrack(track: AudioTrack): void {
        if (this.paused) {
            this.pausedTracks.add(track);
            return;
        }
        try {
            const playback = track.audio.play();
            if (playback && typeof playback.catch === "function") {
                void playback.catch((error: unknown) => this.onPlaybackError?.(error, track.source));
            }
        } catch (error) {
            this.onPlaybackError?.(error, track.source);
        }
    }

    private transitionTrack(previous: AudioTrack | undefined, next: AudioTrack | undefined): void {
        if (previous) this.fadeTrack(previous, 0, true);
        if (!next) return;

        this.tracks.add(next);
        this.fadeTrack(next, this.targetVolume(next), false);
    }

    private replaceAmbience(source: string | undefined): void {
        if (this.ambience?.source === source) return;
        const next = source ? this.createTrack(source, "ambient", 1) : undefined;
        if (next) this.startTrack(next);
        this.transitionTrack(this.ambience, next);
        this.ambience = next;
    }

    private stopEmitters(): void {
        const activeTracks = new Set([this.music, this.ambience, this.weatherAudio]);
        for (const track of [...this.tracks]) {
            if (!activeTracks.has(track)) this.disposeTrack(track);
        }
    }

    private fadeTrack(track: AudioTrack, target: number, disposeAtEnd: boolean): void {
        if (this.crossfadeDurationMs === 0 || track.audio.volume === target) {
            track.audio.volume = target;
            if (disposeAtEnd) this.disposeTrack(track);
            return;
        }

        this.fades.set(track, {
            track,
            startedAt: this.getClockTime(),
            from: track.audio.volume,
            target,
            disposeAtEnd,
        });
        this.scheduleFadeFrame();
    }

    private scheduleFadeFrame(): void {
        if (this.frameHandle !== undefined || this.fades.size === 0 || this.destroyed) return;
        this.frameHandle = this.frameScheduler.requestFrame(() => {
            this.frameHandle = undefined;
            this.advanceFades();
        });
    }

    private advanceFades(): void {
        if (this.destroyed) return;
        const now = this.getClockTime();
        for (const [track, fade] of this.fades) {
            const progress = clamp((now - fade.startedAt) / this.crossfadeDurationMs, 0, 1);
            track.audio.volume = fade.from + (fade.target - fade.from) * progress;
            if (progress === 1) {
                this.fades.delete(track);
                if (fade.disposeAtEnd) this.disposeTrack(track);
            }
        }
        this.scheduleFadeFrame();
    }

    private updateTrackVolumes(): void {
        for (const track of this.tracks) {
            const fade = this.fades.get(track);
            const target = this.targetVolume(track);
            if (fade) {
                if (!fade.disposeAtEnd) fade.target = target;
            } else {
                track.audio.volume = target;
            }
        }
    }

    private spatialGain(emitter: PlannedEmitter): number {
        const listener = this.listenerWorldPosition;
        if (!listener || !this.isEmitterActive(emitter)) return 0;
        const distance = Math.hypot(
            (emitter.worldPosition.x - listener.x) / WORLD_CHUNK_WIDTH,
            (emitter.worldPosition.y - listener.y) / WORLD_CHUNK_HEIGHT,
        );
        if (distance <= emitter.minimumDistance) return 1;
        if (emitter.maximumDistance <= emitter.minimumDistance || distance >= emitter.maximumDistance) return 0;
        return emitter.minimumDistance / distance;
    }

    private isEmitterActive(emitter: PlannedEmitter): boolean {
        const nightOnly = (emitter.flags & 0x01) !== 0 && (emitter.flags & 0x02) === 0;
        const dayOnly = (emitter.flags & 0x02) !== 0 && (emitter.flags & 0x01) === 0;
        return !nightOnly && !dayOnly || nightOnly && this.phase === "night" || dayOnly && this.phase === "day";
    }

    private targetVolume(track: AudioTrack): number {
        const groupVolume = track.group === "music" ? this.volumes.music : this.volumes.ambient;
        const spatialGain = track.emitter ? this.spatialGain(track.emitter) : 1;
        return clamp(track.baseVolume * spatialGain * groupVolume * this.volumes.master, 0, 1);
    }

    private disposeTrack(track: AudioTrack): void {
        this.fades.delete(track);
        this.pausedTracks.delete(track);
        this.tracks.delete(track);
        track.audio.pause();
        try {
            track.audio.currentTime = 0;
        } catch {
            // Some media streams do not permit seeking; pausing still releases playback.
        }
        track.audio.removeAttribute?.("src");
        track.audio.load?.();
    }

    private makeWeatherSnapshot(weather: LVLData["weather"], date: Date): WeatherSnapshot {
        const random = this.random();
        if (!isFiniteNumber(random) || random < 0 || random >= 1) {
            throw new Error("The audio weather random source must return a number in [0, 1).");
        }

        const timestamp = date.getTime();
        const kind = WEATHER_KINDS[weather.type] ?? "unknown";
        const active = weather.type !== 0 && weather.intensity > 0;
        return {
            type: weather.type,
            intensity: weather.intensity,
            strength: active ? clamp(weather.intensity, 0, 1) : 0,
            kind,
            active,
            phase: isDayAt(date) ? "day" : "night",
            seed: Math.floor(random * 0x1_0000_0000),
            updatedAt: timestamp,
        };
    }

    private getClockTime(): number {
        const time = this.clock().getTime();
        if (!Number.isFinite(time)) {
            throw new Error("The audio weather clock returned an invalid date.");
        }
        return time;
    }

    private assertAlive(): void {
        if (this.destroyed) {
            throw new Error("AudioWeatherRuntime has been destroyed.");
        }
    }
}
