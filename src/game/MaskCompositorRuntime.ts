import type { LevelMask } from "./Level.ts";
import type { MaskHDR, MHDRTile } from "./parsers/LVLParser.ts";
import type { TilePosition } from "./parsers/SEFParser.ts";
import { WORLD_CHUNK_HEIGHT, WORLD_CHUNK_WIDTH } from "./WorldCoordinates.ts";

export interface NativeMaskDoorState {
    opened: boolean;
    cells: readonly TilePosition[];
}

export interface NativeMaskBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface NativeOccluderCell {
    x: number;
    y: number;
}

export interface NativeOccluderSelection {
    maskIndex: number;
    alternate: boolean;
    /** Matched viewport-grid cells (chunk coords, 24×18 px each) to clip the mask foreground to. */
    cells: readonly NativeOccluderCell[];
}

const maskTileKey = (x: number, y: number, slot: number): string => `${x}:${y}:${slot}`;

const getMaskTile = (header: MaskHDR, x: number, y: number, slot: number): MHDRTile | undefined =>
    header.chunks[x * header.height + y]?.[slot];

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

/** Build scan 0x1202BC54 phase 1: EAST along the row through the same mask run until bit1. */
const scanEastBoundary = (
    header: MaskHDR,
    startX: number,
    y: number,
    slot: number,
    maskIndex: number,
): boolean => {
    for (let x = startX; x < header.width; x += 1) {
        const tile = getMaskTile(header, x, y, slot);
        if (!tile || (tile.terrain & 1) === 0 || tile.maskIndex !== maskIndex) return false;
        if ((tile.terrain & 2) !== 0) return true;
    }
    return false;
};

/** Build scan 0x1202BC54 phase 2: SOUTH down the column through the same mask run until bit1. */
const scanSouthBoundary = (
    header: MaskHDR,
    x: number,
    startY: number,
    slot: number,
    maskIndex: number,
): boolean => {
    for (let y = startY; y < header.height; y += 1) {
        const tile = getMaskTile(header, x, y, slot);
        if (!tile || (tile.terrain & 1) === 0 || tile.maskIndex !== maskIndex) return false;
        if ((tile.terrain & 2) !== 0) return true;
    }
    return false;
};

/**
 * Client.dll 0x1202BF60 (grid init) + 0x1202BC54 (build) + 0x1202F17C (lookup).
 *
 * The occlusion grid is built from the DRAWABLE's own rect (globals 0x12110400..0c, kind 1/3/4
 * descriptor fields +0x2c/+0x30 etc., clamped to the screen — a no-op for on-screen sprites):
 *  - leftBound = floor(rectX/24), anchorRow = floor((rectY+rectH)/18) — the drawable's feet row,
 *  - colCount = floor(rectRight/24)+1-leftBound, clamped to 13 (0x1202c0d5),
 *  - build (0x1202BC54) registers slot (col,slot) iff the feet-row cell has terrain bit0 and a
 *    stable maskIndex AND BOTH scans hit a bit1 boundary: phase 1 scans EAST along the anchor
 *    row, phase 2 scans SOUTH down the column (bounded by this+0x95a0/0x95a4 = map width/height,
 *    set once at level setup 0x1202E370 via manager vtable 0x44);
 *    expectedMask[slot][col] = the feet cell's maskIndex,
 *  - grid rows = floor(rectH/18)+2 above the feet row (0x1202c26c),
 *  - lookup (0x1202F17C) matches a grid cell's slot iff flag[slot] && its maskIndex equals the
 *    registered expectedMask → ApplyCellMask (0x1202F251) draws that cell's mask tile piece,
 *    clipped to the drawable rect, over the drawable.
 */
export const findNativeOccluders = (
    header: MaskHDR,
    masks: readonly LevelMask[],
    bounds: NativeMaskBounds,
    alternateTiles: ReadonlySet<string>,
    options?: { anchorRow?: number; bodyHeight?: number; rowsBelow?: number },
): readonly NativeOccluderSelection[] => {
    if (header.chunks.length === 0 || header.width <= 0 || header.height <= 0) return [];
    const leftBound = Math.floor(bounds.x / WORLD_CHUNK_WIDTH);
    // The anchor row is always the drawable's feet row (0x958c = D.y>>1); a composite
    // rect (body ∪ shadow) must not move it. bodyHeight keeps the upward sweep at the
    // body's own floor(h/18)+2 rows; rowsBelow extends the cell window south.
    const anchorRow = options?.anchorRow ?? Math.floor((bounds.y + Math.max(1, bounds.height)) / WORLD_CHUNK_HEIGHT);
    let colCount = Math.floor((bounds.x + Math.max(1, bounds.width)) / WORLD_CHUNK_WIDTH) + 1 - leftBound;
    if (colCount > 13) colCount = 13;
    if (colCount <= 0 || leftBound < 0 || anchorRow < 0 || anchorRow >= header.height) return [];

    const flag = [0, 0, 0, 0];
    const expected: number[][] = [0, 1, 2, 3].map(() => new Array<number>(13).fill(-1));
    for (let col = 0; col < colCount; col += 1) {
        const chunkX = leftBound + col;
        if (chunkX >= header.width) break;
        for (let slot = 0; slot < 4; slot += 1) {
            const tile = getMaskTile(header, chunkX, anchorRow, slot);
            if (!tile || (tile.terrain & 1) === 0 || tile.maskIndex < 0) continue;
            const maskIndex = tile.maskIndex;
            if (!scanEastBoundary(header, chunkX, anchorRow, slot, maskIndex)) continue;
            if (!scanSouthBoundary(header, chunkX, anchorRow, slot, maskIndex)) continue;
            flag[slot] = 1;
            expected[slot][col] = maskIndex;
        }
    }
    if (!flag.some(Boolean)) return [];

    const rowsUp = Math.floor(Math.max(1, options?.bodyHeight ?? bounds.height) / WORLD_CHUNK_HEIGHT) + 2;
    const rowsBelow = options?.rowsBelow ?? 0;
    const grouped = new Map<string, NativeOccluderSelection>();
    for (let chunkY = anchorRow - rowsUp + 1; chunkY <= anchorRow + rowsBelow; chunkY += 1) {
        if (chunkY < 0) continue;
        if (chunkY >= header.height) break;
        for (let col = 0; col < colCount; col += 1) {
            const chunkX = leftBound + col;
            if (chunkX >= header.width) break;
            for (let slot = 0; slot < 4; slot += 1) {
                if (!flag[slot]) continue;
                const maskIndex = expected[slot][col];
                const tile = getMaskTile(header, chunkX, chunkY, slot);
                if (!tile || (tile.terrain & 1) === 0 || tile.maskIndex !== maskIndex) continue;
                const mask = masks[maskIndex];
                if (!mask?.foreground) continue;
                const alternate = alternateTiles.has(maskTileKey(chunkX, chunkY, slot)) && Boolean(mask.alternateForeground);
                const key = `${maskIndex}:${alternate ? 1 : 0}`;
                const selection = grouped.get(key);
                if (selection) {
                    (selection.cells as NativeOccluderCell[]).push({ x: chunkX, y: chunkY });
                } else {
                    grouped.set(key, { maskIndex, alternate, cells: [{ x: chunkX, y: chunkY }] });
                }
            }
        }
    }
    return [...grouped.values()];
};
