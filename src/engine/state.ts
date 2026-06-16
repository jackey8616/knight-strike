import type { FactionId, Occupant, Province, TileId } from "./types";

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

// PRD §3.4 (v1.2): a tile is "owned" by a single faction only when exactly one
// non-empty occupant sits on it. Empty / contested tiles have no derived owner
// — callers handling those cases must branch on the null themselves.
export function derivedOwner(province: Province): FactionId | null {
  if (province.occupants.length === 1) {
    return (province.occupants[0] as Occupant).faction;
  }
  return null;
}

// Sum of all occupant amounts. For BFS + UI it's the natural "tile strength";
// for combat the individual amounts matter and you read .occupants directly.
export function totalAmount(province: Province): number {
  let sum = 0;
  for (const o of province.occupants) sum += o.amount;
  return sum;
}

// True when the tile has 2+ distinct faction occupants — the §3.6 combat
// trigger condition.
export function isContested(province: Province): boolean {
  if (province.occupants.length < 2) return false;
  const first = (province.occupants[0] as Occupant).faction;
  for (let i = 1; i < province.occupants.length; i++) {
    if ((province.occupants[i] as Occupant).faction !== first) return true;
  }
  return false;
}

export function findOccupant(
  province: Province,
  faction: FactionId,
): Occupant | undefined {
  for (const o of province.occupants) if (o.faction === faction) return o;
  return undefined;
}
