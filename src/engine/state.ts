import type { PairKey, TileId } from "./types";

export function tileId(x: number, y: number): TileId {
  return `tile:${x},${y}`;
}

const TILE_RE = /^tile:(-?\d+),(-?\d+)$/;

export function parseTileId(id: TileId): { readonly x: number; readonly y: number } {
  const m = TILE_RE.exec(id);
  if (m === null || m[1] === undefined || m[2] === undefined) {
    throw new Error(`invalid tile id: ${id}`);
  }
  return { x: Number(m[1]), y: Number(m[2]) };
}

export function pairKey(a: TileId, b: TileId): PairKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
