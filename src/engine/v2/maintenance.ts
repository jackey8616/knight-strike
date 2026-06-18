import { ev, type GameEvent, type StepResult } from "./events";
import type { FactionId, GameState, Unit } from "./types";

// PRD §4.8 / combat-system-spec §5.
export const MAINTENANCE_THRESHOLD = 2000;

// §6 default: max(1, floor((pop−2000)/100)) above the threshold, else 0 — the
// max(1) makes a just-over army (2001) still owe upkeep (AC-20).
export function maintenanceFee(population: number): number {
  if (population <= MAINTENANCE_THRESHOLD) return 0;
  return Math.max(1, Math.floor((population - MAINTENANCE_THRESHOLD) / 100));
}

// §6 default starvation rate: shrink toward the threshold by floor(excess/4)
// (≥1), never overshooting below 2000.
function starvationShrink(population: number): number {
  const excess = population - MAINTENANCE_THRESHOLD;
  if (excess <= 0) return 0;
  return Math.min(excess, Math.max(1, Math.floor(excess / 4)));
}

// PRD §4.8 — each tick, sum every faction's upkeep over its >2000 armies and
// debit the treasury. If a faction can't cover it, its treasury empties and
// those armies starve (shrink toward <2000) rather than being destroyed.
export function applyMaintenance(state: GameState): StepResult {
  const fees = new Map<FactionId, number>();
  for (const u of state.units) {
    const fee = maintenanceFee(u.population);
    if (fee > 0) fees.set(u.owner, (fees.get(u.owner) ?? 0) + fee);
  }
  if (fees.size === 0) return { state, events: [] };

  const newGold = new Map<FactionId, number>();
  const starving = new Set<FactionId>();
  for (const [faction, fee] of fees) {
    const gold = state.factions[faction].gold;
    if (gold >= fee) {
      newGold.set(faction, gold - fee);
    } else {
      newGold.set(faction, 0);
      starving.add(faction);
    }
  }

  const events: GameEvent[] = [];
  const units: Unit[] = state.units.map((u) => {
    if (!starving.has(u.owner)) return u;
    const shrink = starvationShrink(u.population);
    if (shrink <= 0) return u;
    events.push(ev.unitStarvation(u.id, shrink));
    return { ...u, population: u.population - shrink };
  });

  const factions = { ...state.factions };
  for (const [faction, gold] of newGold) {
    factions[faction] = { ...factions[faction], gold };
  }

  return { state: { ...state, units, factions }, events };
}
