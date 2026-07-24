import type { PixelPosition } from "./parsers/LVLParser.ts";
import type { TilePosition } from "./parsers/SEFParser.ts";

export type WorldPosition = PixelPosition;

export const WORLD_CELL_WIDTH = 12;
export const WORLD_CELL_HEIGHT = 9;
export const WORLD_CHUNK_WIDTH = WORLD_CELL_WIDTH * 2;
export const WORLD_CHUNK_HEIGHT = WORLD_CELL_HEIGHT * 2;

export const cellToWorld = (position: TilePosition): WorldPosition => ({
    x: position.x * WORLD_CELL_WIDTH,
    y: position.y * WORLD_CELL_HEIGHT,
});

export const worldToCell = (position: WorldPosition): TilePosition => ({
    x: Math.round(position.x / WORLD_CELL_WIDTH),
    y: Math.round(position.y / WORLD_CELL_HEIGHT),
});
