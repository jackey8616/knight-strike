import { stepAi } from "./ai";
import { resolveOrders } from "./combat";
import {
  applyUpkeep,
  collectTax,
  growPopulation,
  isEconomyTick,
  spawnFromHouses,
} from "./economy";
import { advanceMarching } from "./movement";
import type { GameState } from "./types";
import { applyDefeats } from "./victory";

// PRD §4.2 (v2.6) step order:
//   1. AI (stepAi: rule factions dispatch / build houses; lands in state)
//   2. movement (advanceMarching: stacks step forward; arrivals settle or
//      register an AttackOrder)
//   3. economy — only on economy "days" (isEconomyTick):
//      a. growPopulation (houses grow, scaled by owned territory, minus tax)
//      b. collectTax (live houses pay floor(pop × taxPct/100) into the treasury)
//      c. applyUpkeep (parked garrisons over the threshold pay army upkeep out
//         of the gold just collected; can't pay → starve, §4.3) — before spawn
//         so a freshly-spawned stack isn't billed the day it appears.
//      d. spawnFromHouses (houses at/over the threshold spawn a troop stack)
//   4. combat (resolveOrders: cross-edge step-function + break→capture; a
//      captured House tile is razed, §4.3)
//   5. defeats (faction without castleOwner occupant on its own castle → defeated)
//   6. victory check is caller-side (evaluateOutcome reads state)
//
// Troops no longer self-replicate (v1's produce() is retired, §4.3) — the only
// troop source is House spawns.
export function step(state: GameState): GameState {
  let s = stepAi(state);
  s = advanceMarching(s);
  if (isEconomyTick(s.tick)) {
    s = growPopulation(s);
    s = collectTax(s);
    s = applyUpkeep(s);
    s = spawnFromHouses(s);
  }
  s = resolveOrders(s).state;
  s = applyDefeats(s);
  return { ...s, tick: s.tick + 1 };
}
