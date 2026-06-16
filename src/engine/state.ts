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

// PRD §3.4 / §3.5.4 (v1.3): tile ownership precedence —
//   1 occupant     → that occupant's faction
//   0 occupants    → lastClaimedFaction (walk-through trail; may be null)
//   2+ occupants   → null (contested)
// Render layer uses this for tile colour; dispatch source check uses this
// but also requires an actual occupant of the same faction (lastClaimedFaction
// alone never grants dispatch).
export function derivedOwner(province: Province): FactionId | null {
  if (province.occupants.length === 1) {
    return (province.occupants[0] as Occupant).faction;
  }
  if (province.occupants.length === 0) {
    return province.lastClaimedFaction;
  }
  return null;
}

// Has any hostile (= different faction) occupant with amount > 0. Used by
// BFS passable check (v1.3 relaxed: walkable as long as no hostile troops
// stand in the way; own-faction occupants and lastClaimedFaction don't block).
export function hasHostileOccupant(
  province: Province,
  faction: FactionId,
): boolean {
  for (const o of province.occupants) {
    if (o.faction !== faction && o.amount > 0) return true;
  }
  return false;
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
