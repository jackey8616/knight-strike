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

// PRD §3.5.2 (v1.4): a tile is "own-claimed" — and thus passable as a marching
// intermediate — iff its derived owner is `faction`. That covers a tile with an
// own garrison (any amount) and an empty tile trail-marked by walk-through
// claim (lastClaimedFaction === faction). Neutral / unclaimed / enemy tiles are
// walls; territory only expands one captured tile at a time.
export function isOwnClaimed(province: Province, faction: FactionId): boolean {
  return derivedOwner(province) === faction;
}

// Has any hostile (= different faction) occupant with amount > 0. Retained for
// the (idle) rule AI; v1.4 BFS no longer uses it (passable is own-claimed only).
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

export function findOccupant(
  province: Province,
  faction: FactionId,
): Occupant | undefined {
  for (const o of province.occupants) if (o.faction === faction) return o;
  return undefined;
}
