export type GameSettingValue = boolean | number | string;
export type GameSettings = Record<number, GameSettingValue>;

const SETTINGS_KEY = "golden-land-2:options";

/**
 * Native registry fallback values registered during Client.dll startup.
 * The options menu's “restore” command intentionally uses a different music
 * volume and scrolling speed; see NATIVE_RESTORED_GAME_SETTINGS below.
 */
export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
    2: 100,
    3: true,
    4: true,
    5: 100,
    6: 35,
    7: 100,
    8: true,
    9: 50,
    10: 6,
    11: 50,
    12: false,
    13: true,
    14: true,
    17: false,
});

const NATIVE_RESTORED_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
    ...DEFAULT_GAME_SETTINGS,
    6: 100,
    10: 2,
});

const NATIVE_RESET_SETTING_IDS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const);

export const resetGameSettings = (current: Readonly<GameSettings>): GameSettings => {
    const reset = { ...current };
    for (const id of NATIVE_RESET_SETTING_IDS) reset[id] = NATIVE_RESTORED_GAME_SETTINGS[id];
    return reset;
};

export const gameGamma = (settings: Readonly<GameSettings>): number => {
    const slider = Number(settings[2]);
    return Number.isFinite(slider) ? Math.max(0.5, Math.min(3, slider / 100)) : 1;
};

export const gameAnimationSpeed = (settings: Readonly<GameSettings>): number => {
    const slider = Number(settings[9]);
    return Number.isFinite(slider) ? Math.max(0.5, Math.min(1.5, 0.5 + slider / 100)) : 1;
};

export const gameScrollSpeed = (settings: Readonly<GameSettings>): number => {
    const slider = Number(settings[10]);
    return Number.isFinite(slider) ? Math.max(0.5, Math.min(2, 0.5 + slider * 0.25)) : 1;
};

export const gameHintDelayMs = (settings: Readonly<GameSettings>): number => {
    const slider = Number(settings[11]);
    return Number.isFinite(slider) ? Math.max(200, Math.min(2000, 2000 - slider * 18)) : 1100;
};

export const readGameSettings = (): GameSettings => {
    try {
        const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as unknown;
        return parsed && typeof parsed === "object"
            ? { ...DEFAULT_GAME_SETTINGS, ...(parsed as GameSettings) }
            : { ...DEFAULT_GAME_SETTINGS };
    } catch {
        return { ...DEFAULT_GAME_SETTINGS };
    }
};

export const writeGameSettings = (settings: Readonly<GameSettings>): GameSettings => {
    const stored = { ...DEFAULT_GAME_SETTINGS, ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    return stored;
};
