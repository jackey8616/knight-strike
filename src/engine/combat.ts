import { pairKey, tileId } from "./state";
import { deriveTier } from "./upgrade";
import type {
  GameState,
  PairKey,
  Province,
  StalemateMap,
  Tier,
  TileId,
} from "./types";

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

export const STALEMATE_DRAIN_THRESHOLD = 5;

export type StalemateUpdate = {
  readonly nextMap: StalemateMap;
  readonly drainDeductions: ReadonlyMap<TileId, number>;
};

export function updateStalemates(
  prev: StalemateMap,
  combatPairs: readonly CombatPair[],
): StalemateUpdate {
  const nextMap = new Map<PairKey, number>();
  const drain = new Map<TileId, number>();
  for (const { a, b, lossA, lossB } of combatPairs) {
    const key = pairKey(a, b);
    // PRD §3.7.1: counter only ticks up on a true 0-loss stalemate; any real
    // damage resets it. Pairs absent from combatPairs (dissolved) are
    // naturally dropped because we only ever write keys we saw this tick.
    const prevCount = prev.get(key) ?? 0;
    const nextCount = lossA === 0 && lossB === 0 ? prevCount + 1 : 0;
    nextMap.set(key, nextCount);
    if (nextCount >= STALEMATE_DRAIN_THRESHOLD) {
      drain.set(a, (drain.get(a) ?? 0) + 1);
      drain.set(b, (drain.get(b) ?? 0) + 1);
    }
  }
  return { nextMap, drainDeductions: drain };
}

export function applyDrainDeductions(
  state: GameState,
  deductions: ReadonlyMap<TileId, number>,
): GameState {
  if (deductions.size === 0) return state;
  const next = new Map<TileId, Province>(state.provinces);
  for (const [id, drop] of deductions) {
    const p = next.get(id);
    if (p === undefined) continue;
    next.set(id, { ...p, count: Math.max(0, p.count - drop) });
  }
  return { ...state, provinces: next };
}
