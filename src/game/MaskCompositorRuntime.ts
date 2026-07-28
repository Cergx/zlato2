import type { LevelMask } from "./Level.ts";
import type { MaskHDR, MHDRTile } from "./parsers/LVLParser.ts";
import type { TilePosition } from "./parsers/SEFParser.ts";
import { WORLD_CHUNK_HEIGHT, WORLD_CHUNK_WIDTH } from "./WorldCoordinates.ts";

export interface NativeMaskDoorState {
    readonly opened: boolean;
    readonly cells: readonly TilePosition[];
}

export interface NativeMaskBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface NativeOccluderSelection {
    readonly maskIndex: number;
    readonly alternate: boolean;
}

const maskTileKey = (x: number, y: number, slot: number): string => `${x}:${y}:${slot}`;

const getMaskTile = (header: MaskHDR, x: number, y: number, slot: number): MHDRTile | undefined =>
    header.chunks[x * header.height + y]?.[slot];

const isMatchingMask = (tile: MHDRTile | undefined, maskIndex: number): tile is MHDRTile =>
    tile !== undefined && (tile.terrain & 1) !== 0 && tile.maskIndex === maskIndex;

const maskExtendsPastAnchor = (
    header: MaskHDR,
    startX: number,
    startY: number,
    slot: number,
    maskIndex: number,
    anchorCellX: number,
): boolean => {
    let horizontalBoundary = false;
    for (let x = startX; x < header.width; x += 1) {
        const tile = getMaskTile(header, x, startY, slot);
        if (!isMatchingMask(tile, maskIndex)) break;
        if ((tile.terrain & 2) !== 0 && anchorCellX <= x) {
            horizontalBoundary = true;
            break;
        }
    }
    if (!horizontalBoundary) return false;

    for (let y = startY; y < header.height; y += 1) {
        const tile = getMaskTile(header, startX, y, slot);
        if (!isMatchingMask(tile, maskIndex)) break;
        if ((tile.terrain & 2) !== 0) return true;
    }
    return false;
};

/** Client.dll 0x1202B4B0 marks every type-1 mask slot in a closed door's cell group. */
export const buildNativeAlternateMaskTiles = (
    header: MaskHDR,
    masks: readonly LevelMask[],
    doors: readonly NativeMaskDoorState[],
): ReadonlySet<string> => {
    const alternateTiles = new Set<string>();
    for (const door of doors) {
        if (door.opened) continue;
        for (const cell of door.cells) {
            const x = Math.floor(cell.x / 2);
            const y = Math.floor(cell.y / 2);
            if (x < 0 || y < 0 || x >= header.width || y >= header.height) continue;
            for (let slot = 0; slot < 4; slot += 1) {
                const tile = getMaskTile(header, x, y, slot);
                const mask = tile && tile.maskIndex >= 0 ? masks[tile.maskIndex] : undefined;
                if (tile && (tile.terrain & 1) !== 0 && mask && (mask.type & 1) !== 0 && mask.alternateForeground) {
                    alternateTiles.add(maskTileKey(x, y, slot));
                }
            }
        }
    }
    return alternateTiles;
};

/** Client.dll 0x1202F251..0x1202F413 entity-local ApplyCellMask selection. */
export const findNativeOccluders = (
    header: MaskHDR,
    masks: readonly LevelMask[],
    bounds: NativeMaskBounds,
    anchorX: number,
    anchorY: number,
    alternateTiles: ReadonlySet<string>,
): readonly NativeOccluderSelection[] => {
    if (header.chunks.length === 0 || header.width <= 0 || header.height <= 0) return [];
    const left = Math.max(0, Math.floor(bounds.x / WORLD_CHUNK_WIDTH));
    const right = Math.min(header.width - 1, Math.floor((bounds.x + Math.max(1, bounds.width) - 1) / WORLD_CHUNK_WIDTH));
    const anchorCellX = Math.floor(anchorX / WORLD_CHUNK_WIDTH);
    const anchorCellY = Math.floor(anchorY / WORLD_CHUNK_HEIGHT);
    if (left > right || anchorCellX < 0 || anchorCellY < 0 || anchorCellX >= header.width || anchorCellY >= header.height) return [];

    const selected = new Map<string, NativeOccluderSelection>();
    for (let x = left; x <= right; x += 1) {
        for (let slot = 0; slot < 4; slot += 1) {
            const tile = getMaskTile(header, x, anchorCellY, slot);
            if (!tile || (tile.terrain & 1) === 0 || tile.maskIndex < 0) continue;
            if (!maskExtendsPastAnchor(header, x, anchorCellY, slot, tile.maskIndex, anchorCellX)) continue;
            const mask = masks[tile.maskIndex];
            if (!mask?.foreground) continue;
            const alternate = alternateTiles.has(maskTileKey(x, anchorCellY, slot)) && Boolean(mask.alternateForeground);
            selected.set(`${tile.maskIndex}:${alternate ? 1 : 0}`, { maskIndex: tile.maskIndex, alternate });
        }
    }
    return [...selected.values()];
};
