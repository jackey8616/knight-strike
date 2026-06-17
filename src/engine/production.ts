import type { GameState, Occupant, Province, TileId } from "./types";

// PRD §3.3 v1.3 self-replicate: any tile not engaged in combat with a
// non-NEUTRAL, non-defeated occupant grows that occupant +1 per tick (capped at
// 100). Any amount ≥ 1 qualifies — even a lone 1-troop survivor regenerates,
// matching the v1.1 "garrison breeds" feel the player relies on.
//
// PRD §3.6' (v1.4): "engaged" tiles are the `from` (sieging garrison) and `to`
// (target) of any AttackOrder — frozen so siege costs (defender damage,
// break/capture spend) stay visible instead of being silently regrown.
export const PRODUCTION_CAP = 100;

export function produce(state: GameState): GameState {
  if (state.tick <= 0) return state;

  const engaged = new Set<TileId>();
  for (const o of state.attackOrders) {
    engaged.add(o.from);
    engaged.add(o.to);
  }

  let provincesNext: Map<TileId, Province> | null = null;
  for (const [id, province] of state.provinces) {
    if (engaged.has(id)) continue;
    if (province.occupants.length === 0) continue;

    let changed = false;
    const updated: Occupant[] = province.occupants.map((o) => {
      if (o.faction === "NEUTRAL") return o;
      if (state.defeated.has(o.faction)) return o;
      if (o.amount <= 0) return o;
      if (o.amount >= PRODUCTION_CAP) return o;
      changed = true;
      return { ...o, amount: Math.min(o.amount + 1, PRODUCTION_CAP) };
    });

    if (!changed) continue;
    if (provincesNext === null) provincesNext = new Map(state.provinces);
    provincesNext.set(id, { ...province, occupants: updated });
  }

  if (provincesNext === null) return state;
  return { ...state, provinces: provincesNext };
}
