import { type StepResult } from "./events";
import { mooreNeighbors, parseTileId } from "./state";
import type { FactionId, GameState, TileId } from "./types";

// PRD §4.4 / house-system-spec §3.1 — daily growth. At tax 0%: 2 + adjacent own
// fields (so 0 fields → +2, 8 fields → +10). Growth scales linearly down to 0 at
// 30% tax (§6 default curve). Done in integer percent to stay deterministic
// (AC-04): no float division into the stored population.
export function growthPerDay(adjacentOwnFields: number, taxRate: number): number {
  const base = 2 + adjacentOwnFields;
  const taxPct = Math.round(taxRate * 100);
  const factorNum = Math.max(0, 30 - taxPct); // 0 .. 30
  return Math.floor((base * factorNum) / 30);
}

// PRD §4.4 — apply one day of growth to every house whose growth day hasn't yet
// been settled (self-gating on lastGrowthDay, so calling twice in a day is a
// no-op). Disconnected houses are taxed at 0 (§4.5) — they grow fastest.
export function growPopulation(state: GameState): StepResult {
  const fieldOwner = new Map<TileId, FactionId>();
  for (const f of state.fields) fieldOwner.set(f.tile, f.owner);

  let changed = false;
  const houses = state.houses.map((h) => {
    if (state.day <= h.lastGrowthDay) return h;
    const { x, y } = parseTileId(h.tile);
    let adjacent = 0;
    for (const nbr of mooreNeighbors(x, y, state.boardSize)) {
      if (fieldOwner.get(nbr) === h.owner) adjacent += 1;
    }
    const taxRate = h.connectedToCastle ? state.factions[h.owner].taxRate : 0;
    const growth = growthPerDay(adjacent, taxRate);
    changed = true;
    return { ...h, population: h.population + growth, lastGrowthDay: state.day };
  });

  if (!changed) return { state, events: [] };
  return { state: { ...state, houses }, events: [] };
}
