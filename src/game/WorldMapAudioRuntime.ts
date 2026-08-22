import {
    createBrowserAudio,
    resolveLevelAudioUrl,
    type BrowserAudio,
    type FrameScheduler,
} from "./AudioWeatherRuntime.ts";
import type { WorldMapAudioState } from "./WorldMapRuntime.ts";

interface WorldMapAudioRuntimeOptions {
    readonly createAudio?: (url: string) => BrowserAudio;
    readonly resolveAudioUrl?: (source: string) => string;
    readonly frameScheduler?: FrameScheduler;
    readonly onPlaybackError?: (error: unknown, source: string) => void;
}

interface Track {
    readonly source: string;
    readonly audio: BrowserAudio;
    baseVolume: number;
    groupVolume: number;
}
interface Fade {
    readonly track: Track;
    readonly startedAt: number;
    readonly duration: number;
    readonly from: number;
    target: number;
    readonly disposeAtEnd: boolean;
}

const MUSIC_FADE_MS = 1000;
const clampVolume = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const nativePercent = (value: number): number => Math.trunc(clampVolume(value) * 100) / 100;
const defaultScheduler: FrameScheduler = {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/**
 * Client.dll global-map audio path:
 * - 0x120B52FC..0x120B5417 selects music by map_snd_music.csx and crossfades for 1000 ms;
 * - 0x120B58A0..0x120B5AC0 selects environment audio and applies the grayscale volume mask;
 * - source records use max(0, 1 - distance / 50) spatial gain.
 */
export class WorldMapAudioRuntime {
    private readonly createAudio: (url: string) => BrowserAudio;
    private readonly resolveAudioUrl: (source: string) => string;
    private readonly scheduler: FrameScheduler;
    private readonly onPlaybackError?: (error: unknown, source: string) => void;
    private music?: Track;
    private environment?: Track;
    private readonly sources = new Map<string, Track>();
    private readonly fades = new Set<Fade>();
    private frame?: number;
    private musicVolume = 1;
    private ambientVolume = 1;
    private environmentEnabled = true;
    private muted = false;
    private destroyed = false;

    public constructor(options: WorldMapAudioRuntimeOptions = {}) {
        this.createAudio = options.createAudio ?? createBrowserAudio;
        this.resolveAudioUrl = options.resolveAudioUrl ?? resolveLevelAudioUrl;
        this.scheduler = options.frameScheduler ?? defaultScheduler;
        this.onPlaybackError = options.onPlaybackError;
    }

    public setVolumes(music: number, ambient: number): void {
        this.assertAlive();
        this.musicVolume = clampVolume(music);
        this.ambientVolume = clampVolume(ambient);
        if (this.music) this.setTrackTarget(this.music, true);
        if (this.environment) this.setTrackTarget(this.environment, false);
        for (const track of this.sources.values()) this.setTrackTarget(track, false);
    }

    public setEnvironmentEnabled(enabled: boolean): void {
        this.assertAlive();
        this.environmentEnabled = enabled;
        if (this.environment) this.setTrackTarget(this.environment, false);
        for (const track of this.sources.values()) this.setTrackTarget(track, false);
    }

    public setMuted(muted: boolean): void {
        this.assertAlive();
        this.muted = muted;
        if (this.music) this.music.audio.muted = muted;
        if (this.environment) this.environment.audio.muted = muted;
        for (const track of this.sources.values()) track.audio.muted = muted;
    }

    public setState(state: WorldMapAudioState): void {
        this.assertAlive();
        this.music = this.switchMusic(this.music, state.music);
        this.environment = this.switchImmediate(this.environment, state.environment, state.environmentVolume, this.ambientVolume, this.environmentEnabled);

        const nextSources = new Set(state.sources.map((source) => source.source));
        for (const [source, track] of this.sources) {
            if (nextSources.has(source)) continue;
            this.disposeTrack(track);
            this.sources.delete(source);
        }
        for (const source of state.sources) {
            const existing = this.sources.get(source.source);
            if (existing) {
                existing.baseVolume = clampVolume(source.volume);
                existing.groupVolume = this.ambientVolume;
                this.setTrackTarget(existing, false);
                continue;
            }
            const track = this.createTrack(source.source, source.volume, this.ambientVolume);
            this.sources.set(source.source, track);
            this.setTrackTarget(track, false);
        }
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.frame !== undefined) this.scheduler.cancelFrame(this.frame);
        this.frame = undefined;
        this.fades.clear();
        if (this.music) this.disposeTrack(this.music);
        if (this.environment) this.disposeTrack(this.environment);
        for (const track of this.sources.values()) this.disposeTrack(track);
        this.music = undefined;
        this.environment = undefined;
        this.sources.clear();
    }

    private switchMusic(current: Track | undefined, source: string | undefined): Track | undefined {
        if (current && current.source === source) {
            current.groupVolume = this.musicVolume;
            this.setTrackTarget(current, true);
            return current;
        }
        if (current) this.fade(current, 0, MUSIC_FADE_MS, true);
        if (!source) return undefined;
        const next = this.createTrack(source, 1, this.musicVolume);
        next.audio.volume = 0;
        this.fade(next, this.targetVolume(next, true), MUSIC_FADE_MS, false);
        return next;
    }

    private switchImmediate(
        current: Track | undefined,
        source: string | undefined,
        baseVolume: number,
        groupVolume: number,
        enabled: boolean,
    ): Track | undefined {
        if (current?.source !== source) {
            if (current) this.disposeTrack(current);
            current = source ? this.createTrack(source, baseVolume, groupVolume) : undefined;
        }
        if (!current) return undefined;
        current.baseVolume = clampVolume(baseVolume);
        current.groupVolume = groupVolume;
        current.audio.volume = enabled ? this.targetVolume(current, false) : 0;
        return current;
    }

    private createTrack(source: string, baseVolume: number, groupVolume: number): Track {
        const audio = this.createAudio(this.resolveAudioUrl(source));
        audio.loop = true;
        audio.preload = "auto";
        audio.muted = this.muted;
        const track = { source, audio, baseVolume: clampVolume(baseVolume), groupVolume: clampVolume(groupVolume) };
        const result = audio.play();
        if (result && typeof result.catch === "function") result.catch((error) => this.onPlaybackError?.(error, source));
        return track;
    }

    private targetVolume(track: Track, music: boolean): number {
        if (this.muted || (!music && !this.environmentEnabled)) return 0;
        return nativePercent(track.baseVolume * track.groupVolume);
    }

    private setTrackTarget(track: Track, music: boolean): void {
        const target = this.targetVolume(track, music);
        const fade = [...this.fades].find((candidate) => candidate.track === track && !candidate.disposeAtEnd);
        if (fade) fade.target = target;
        else track.audio.volume = target;
    }

    private fade(track: Track, target: number, duration: number, disposeAtEnd: boolean): void {
        for (const fade of this.fades) {
            if (fade.track === track) this.fades.delete(fade);
        }
        this.fades.add({
            track,
            startedAt: performance.now(),
            duration,
            from: track.audio.volume,
            target: clampVolume(target),
            disposeAtEnd,
        });
        this.scheduleFrame();
    }

    private scheduleFrame(): void {
        if (this.frame !== undefined || this.fades.size === 0) return;
        this.frame = this.scheduler.requestFrame(() => this.updateFades());
    }

    private updateFades(): void {
        this.frame = undefined;
        const now = performance.now();
        for (const fade of [...this.fades]) {
            const progress = Math.min(1, (now - fade.startedAt) / fade.duration);
            fade.track.audio.volume = fade.from + (fade.target - fade.from) * progress;
            if (progress < 1) continue;
            this.fades.delete(fade);
            if (fade.disposeAtEnd) this.disposeTrack(fade.track);
        }
        this.scheduleFrame();
    }

    private disposeTrack(track: Track): void {
        for (const fade of this.fades) if (fade.track === track) this.fades.delete(fade);
        track.audio.pause();
        track.audio.removeAttribute?.("src");
        track.audio.load?.();
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error("World-map audio runtime has been destroyed");
    }
}
