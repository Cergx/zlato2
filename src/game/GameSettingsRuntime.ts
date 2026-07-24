export type GameSettingValue = boolean | number | string;
export type GameSettings = Record<number, GameSettingValue>;

const SETTINGS_KEY = "golden-land-2:options";

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
    2: 100,
    3: false,
    4: false,
    5: 50,
    6: 50,
    7: 50,
    8: false,
    9: 50,
    10: 3,
    11: 50,
    12: true,
    13: true,
    14: true,
    17: false,
});

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
