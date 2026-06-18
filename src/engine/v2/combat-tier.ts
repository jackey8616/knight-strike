import type { FactionId, GameState, Unit, UnitTier } from "./types";

// PRD §4.6 / combat-system-spec §1 — population → S/M/L band (display + damage
// magnitude). Replaces the v1 5/15/30 SOLDIER/KNIGHT/QUEEN/KING model.
export function getTier(population: number): UnitTier {
  if (population >= 10000) return "L";
  if (population >= 1000) return "M";
  return "S";
}

// PRD §4.6 — recompute the "elite star": the largest-population unit of each
// faction is the nation's main force. Ties break to the smaller id (lexical,
// deterministic). Returns the same state reference when no flag changes, so the
// per-tick recompute is free in the steady state.
export function recomputeElite(state: GameState): GameState {
  const eliteOf = new Map<FactionId, { id: string; pop: number }>();
  for (const u of state.units) {
    const cur = eliteOf.get(u.owner);
    if (
      cur === undefined ||
      u.population > cur.pop ||
      (u.population === cur.pop && u.id < cur.id)
    ) {
      eliteOf.set(u.owner, { id: u.id, pop: u.population });
    }
  }

  let changed = false;
  const units: Unit[] = state.units.map((u) => {
    const isElite = eliteOf.get(u.owner)?.id === u.id;
    if (isElite === u.isElite) return u;
    changed = true;
    return { ...u, isElite };
  });

  return changed ? { ...state, units } : state;
}
