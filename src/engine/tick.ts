import { stepAi } from "./ai";
import { resolveOrders } from "./combat";
import { advanceMarching } from "./movement";
import { produce } from "./production";
import type { GameState } from "./types";
import { applyDefeats } from "./victory";

// PRD §4.2 v1.4 step order:
//   1. movement (advanceMarching: stacks step forward; arrivals move into an
//      own tile or register an AttackOrder against a non-own target)
//   2. production (castle / garrison +1; tiles engaged in a siege are frozen)
//   3. combat (resolveOrders: per-AttackOrder cross-edge step-function ramp
//      then break→capture once the target is empty)
//   4. defeats (faction without castleOwner occupant on its own castle →
//      defeated; remnants → NEUTRAL, marching stacks + its orders dropped)
//   5. victory check is caller-side (evaluateOutcome reads state)
//
// stepAi() stays at the top so any (currently idle) AI dispatch lands in
// marchingStacks before advanceMarching.
export function step(state: GameState): GameState {
  let s = stepAi(state);
  s = advanceMarching(s);
  s = produce(s);
  s = resolveOrders(s).state;
  s = applyDefeats(s);
  return { ...s, tick: s.tick + 1 };
}
