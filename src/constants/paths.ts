import { GameMode } from "./levels.ts";

export const AssetsBase = "/assets";

export const Paths = {
    CURSORS: `${AssetsBase}/cursors`,
    ENGINERES: `${AssetsBase}/engineres`,
    ITEMS: `${AssetsBase}/items`,
    LEVELS: `${AssetsBase}/levels`,
    MAGIC: `${AssetsBase}/magic`,
    MUSIC: `${AssetsBase}/music`,
    PERSONS: `${AssetsBase}/persons`,
    SCRIPTS: `${AssetsBase}/scripts`,
    SDB: `${AssetsBase}/sdb`,
    SOUNDS: `${AssetsBase}/sounds`,
    WEAR: `${AssetsBase}/wear`,

    LEVEL_SDB: (level: string, levelType: GameMode) => `${Paths.LEVELS}/${levelType}/${level}/${level}.sdb`,
    LEVEL_SEF: (level: string, levelType: GameMode) => `${Paths.LEVELS}/${levelType}/${level}/${level}.sef`,
    LEVEL_SCRIPT: (level: string, levelType: GameMode, scriptFileName: string) => `${Paths.LEVELS}/${levelType}/${level}/scripts/${scriptFileName}`,
    LEVEL_SCRIPT_CORE: (level: string, levelType: GameMode) => Paths.LEVEL_SCRIPT(level, levelType, 'core.scr'),
    LEVEL_SCRIPT_INITIALIZATION: (level: string, levelType: GameMode) => Paths.LEVEL_SCRIPT(level, levelType, 'init.scr'),

    LEVEL: (levelPack: string) => `${Paths.LEVELS}/lvl/${levelPack}.lvl`,

    LEVEL_IMAGE: (levelPack: string) => `${Paths.LEVELS}/pack/${levelPack}/bitmaps/layer.jpg`,
    LEVEL_MININAP: (levelPack: string) => `${Paths.LEVELS}/pack/${levelPack}/bitmaps/minimap.csx`,

    LEVEL_ANIMATION: (levelPack: string, index: number) => `${Paths.LEVELS}/pack/${levelPack}/bitmaps/animated/anim_${index}.csx`,
    LEVEL_LAO: (levelPack: string) => `${Paths.LEVELS}/pack/${levelPack}/data/animated/${levelPack}.lao`,

    LEVEL_MASK: (levelPack: string, index: number) => `${Paths.LEVELS}/pack/${levelPack}/bitmaps/masks/mask_${index}.csx`,
    LEVEL_STATIC: (levelPack: string, index: number) => `${Paths.LEVELS}/pack/${levelPack}/bitmaps/static/static_${index}.csx`,
    LEVEL_TRIGGER: (levelPack: string, index: number) => `${Paths.LEVELS}/pack/${levelPack}/bitmaps/triggers/trigger_${index}.csx`
};
