import { isContested } from "./state";
import type { GameState, Occupant, Province, TileId } from "./types";

// PRD §3.3 v1.3 self-replicate: any tile not in combat with a non-NEUTRAL
// non-defeated occupant whose amount is > 1 and < cap grows +1 per tick.
// amount = 1 is the deliberate "派完只剩 1 不會無限補滿" carve-out so the
// player's dispatch decisions actually drain the source.
export const PRODUCTION_CAP = 100;

export function produce(state: GameState): GameState {
  if (state.tick <= 0) return state;

  let provincesNext: Map<TileId, Province> | null = null;
  for (const [id, province] of state.provinces) {
    if (isContested(province)) continue;
    if (province.occupants.length === 0) continue;

    let changed = false;
    const updated: Occupant[] = province.occupants.map((o) => {
      if (o.faction === "NEUTRAL") return o;
      if (state.defeated.has(o.faction)) return o;
      if (o.amount <= 1) return o;
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
