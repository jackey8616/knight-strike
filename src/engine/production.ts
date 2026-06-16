import type { GameState, Province, TileId } from "./types";

export const PRODUCTION_INTERVAL_TICKS = 2;

// PRD §3.3 (v1.1 amendment): production source = every garrisoned, non-castle,
// non-NEUTRAL tile owned by a still-alive faction. Castles are purely
// strategic ground (lose castle = lose game); they no longer mint troops.
// NEUTRAL bandits stay static. Empty tiles can't seed production from nothing.
export function produce(state: GameState): GameState {
  if (state.tick <= 0 || state.tick % PRODUCTION_INTERVAL_TICKS !== 0) {
    return state;
  }

  const next = new Map<TileId, Province>(state.provinces);
  let changed = false;
  for (const [id, province] of state.provinces) {
    if (province.isCastle) continue;
    if (province.owner === "NEUTRAL") continue;
    if (province.count <= 0) continue;
    if (state.defeated.has(province.owner)) continue;
    next.set(id, { ...province, count: province.count + 1 });
    changed = true;
  }

  if (!changed) return state;
  return { ...state, provinces: next };
}
