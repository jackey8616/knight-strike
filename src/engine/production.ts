import type { GameState, Province, TileId } from "./types";

// PRD §3.3 v1.1: production fires every tick (no skip every other), so the
// emission interval is degenerate. Kept as an exported constant for callers
// that key off cadence rather than open-coding the check.
export const PRODUCTION_INTERVAL_TICKS = 1;

// PRD §3.3 v1.1: tiles cap out at 100 to keep field garrisons from running
// off into 4-digit territory over a long game. Caps apply only to production
// itself — combat survivors / dispatch arrivals / walk-through claims can
// still push a tile above 100 by other means; subsequent production just
// won't add more until the count drops back below the cap.
export const PRODUCTION_CAP = 100;

// PRD §3.3 (v1.1 amendment r3): garrisoned troops self-replicate. Every tile
// (including castles) owned by a still-alive non-NEUTRAL faction with at
// least one troop grows +1 every tick. The castle as a *building* does not
// auto-mint — an empty castle stays at 0. NEUTRAL bandits stay static.
// Empty tiles (count = 0) can't seed themselves into production from nothing.
export function produce(state: GameState): GameState {
  if (state.tick <= 0) return state;

  const next = new Map<TileId, Province>(state.provinces);
  let changed = false;
  for (const [id, province] of state.provinces) {
    if (province.owner === "NEUTRAL") continue;
    if (province.count <= 0) continue;
    if (province.count >= PRODUCTION_CAP) continue;
    if (state.defeated.has(province.owner)) continue;
    next.set(id, {
      ...province,
      count: Math.min(province.count + 1, PRODUCTION_CAP),
    });
    changed = true;
  }

  if (!changed) return state;
  return { ...state, provinces: next };
}
