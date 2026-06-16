import { pairKey, tileId } from "./state";
import type { GameState, PairKey, Province, TileId } from "./types";

// PRD §3.6 (v1.1): per-pair ramp damage, count-only. damage at `engagementTicks
// = 0` is 0 (the visual "encounter" tick); subsequent ticks deal 2^(n-1) each.
export function pairDamage(engagementTicks: number): number {
  if (engagementTicks <= 0) return 0;
  return 2 ** (engagementTicks - 1);
}

export type CombatPair = {
  readonly a: TileId;
  readonly b: TileId;
  readonly damage: number;
  readonly engagementTicks: number;
};

export type CombatResult = {
  readonly state: GameState;
  readonly pairs: readonly CombatPair[];
};

// 4-conn iteration uses only the (+x, +y) cardinals so each unordered pair is
// visited exactly once.
const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
];

export function resolveAdjacentCombat(state: GameState): CombatResult {
  const pairs: CombatPair[] = [];
  const lossPerTile = new Map<TileId, number>();

  for (const [id, p] of state.provinces) {
    if (p.count <= 0) continue;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nid = tileId(p.x + dx, p.y + dy);
      const np = state.provinces.get(nid);
      if (np === undefined) continue;
      if (np.owner === p.owner) continue;
      if (np.count <= 0) continue;
      const [a, b] = id < nid ? [id, nid] : [nid, id];
      const key = pairKey(a, b);
      const prev = state.engagements.get(key) ?? 0;
      const damage = pairDamage(prev);
      pairs.push({ a, b, damage, engagementTicks: prev });
      if (damage > 0) {
        lossPerTile.set(id, (lossPerTile.get(id) ?? 0) + damage);
        lossPerTile.set(nid, (lossPerTile.get(nid) ?? 0) + damage);
      }
    }
  }

  if (pairs.length === 0) {
    if (state.engagements.size === 0) return { state, pairs: [] };
    // All previously-engaged pairs dissolved this tick — drop counter map.
    return { state: { ...state, engagements: new Map() }, pairs: [] };
  }

  // Apply damage first so we know which tiles still have count > 0 to keep
  // their counters alive.
  let nextProvinces: ReadonlyMap<TileId, Province> = state.provinces;
  if (lossPerTile.size > 0) {
    const map = new Map<TileId, Province>(state.provinces);
    for (const [id, loss] of lossPerTile) {
      const p = map.get(id);
      if (p === undefined) continue;
      map.set(id, { ...p, count: Math.max(0, p.count - loss) });
    }
    nextProvinces = map;
  }

  // Advance counters for pairs whose both tiles survive; pairs that just had
  // a side reduced to 0 dissolve (key omitted, counter discarded — matches
  // PRD §3.6 dissolution rule and v1.0 §3.7.1 semantics).
  const nextEngagements = new Map<PairKey, number>();
  for (const pair of pairs) {
    const ap = nextProvinces.get(pair.a);
    const bp = nextProvinces.get(pair.b);
    if (ap === undefined || bp === undefined) continue;
    if (ap.count <= 0 || bp.count <= 0) continue;
    nextEngagements.set(pairKey(pair.a, pair.b), pair.engagementTicks + 1);
  }

  return {
    state: { ...state, provinces: nextProvinces, engagements: nextEngagements },
    pairs,
  };
}
