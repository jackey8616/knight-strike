import { tileId } from "./state";
import { deriveTier } from "./upgrade";
import type { GameState, Province, Tier, TileId } from "./types";

export const POWER_PER_TIER: Readonly<Record<Tier, number>> = {
  SOLDIER: 1,
  KNIGHT: 4,
  QUEEN: 12,
  KING: 30,
};

export function tilePower(count: number): number {
  if (count <= 0) return 0;
  return count * POWER_PER_TIER[deriveTier(count)];
}

export function computeLoss(ownPower: number, oppPower: number): number {
  // PRD §3.6: loss = max(0, floor((opp_power - own_power / 4) / 4)).
  // own_power / 4 is real division (the 2.5 in the worked example), not floor-div.
  return Math.max(0, Math.floor((oppPower - ownPower / 4) / 4));
}

export type CombatPair = {
  readonly a: TileId;
  readonly b: TileId;
  readonly lossA: number;
  readonly lossB: number;
};

export type CombatResult = {
  readonly state: GameState;
  readonly pairs: readonly CombatPair[];
};

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
];

export function resolveAdjacentCombat(state: GameState): CombatResult {
  const pairs: CombatPair[] = [];
  const lossPerTile = new Map<TileId, number>();

  for (const [id, p] of state.provinces) {
    if (p.count <= 0) continue;
    const powerA = tilePower(p.count);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nid = tileId(p.x + dx, p.y + dy);
      const np = state.provinces.get(nid);
      if (np === undefined) continue;
      if (np.owner === p.owner) continue;
      if (np.count <= 0) continue;
      const powerB = tilePower(np.count);
      const lossA = computeLoss(powerA, powerB);
      const lossB = computeLoss(powerB, powerA);
      // Order pair key by TileId so the downstream stalemate counter (M1.5) gets
      // a stable identity regardless of iteration order.
      const [a, b, la, lb] = id < nid ? [id, nid, lossA, lossB] : [nid, id, lossB, lossA];
      pairs.push({ a, b, lossA: la, lossB: lb });
      if (lossA > 0) lossPerTile.set(id, (lossPerTile.get(id) ?? 0) + lossA);
      if (lossB > 0) lossPerTile.set(nid, (lossPerTile.get(nid) ?? 0) + lossB);
    }
  }

  if (pairs.length === 0) return { state, pairs: [] };
  if (lossPerTile.size === 0) return { state, pairs };

  const next = new Map<TileId, Province>(state.provinces);
  for (const [id, loss] of lossPerTile) {
    const p = next.get(id);
    if (p === undefined) continue;
    next.set(id, { ...p, count: Math.max(0, p.count - loss) });
  }

  return { state: { ...state, provinces: next }, pairs };
}
