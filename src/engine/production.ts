import type { GameState, Province, TileId } from "./types";

export const PRODUCTION_INTERVAL_TICKS = 2;

export function produce(state: GameState): GameState {
  if (state.tick <= 0 || state.tick % PRODUCTION_INTERVAL_TICKS !== 0) {
    return state;
  }

  const next = new Map<TileId, Province>(state.provinces);
  let changed = false;
  for (const [id, province] of state.provinces) {
    if (!province.isCastle) continue;
    if (province.owner === "NEUTRAL") continue;
    if (state.defeated.has(province.owner)) continue;
    next.set(id, { ...province, count: province.count + 1 });
    changed = true;
  }

  if (!changed) return state;
  return { ...state, provinces: next };
}
