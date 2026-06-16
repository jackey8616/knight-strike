import { stepAi } from "./ai";
import { resolveSameTileCombat } from "./combat";
import { advanceMarching } from "./movement";
import { produce } from "./production";
import type { GameState } from "./types";
import { applyDefeats } from "./victory";

// PRD §3.2 v1.2 step order:
//   1. movement + arrival addition (advanceMarching: marching stacks step
//      forward; arrivals merge into same-faction occupant or land as new)
//   2. production (castle owner's occupant gains +1; behaves as an extra
//      reinforcement on contested castle tiles since combat damage runs after)
//   3. combat (resolveSameTileCombat: per-contested-tile step-function ramp
//      with defender tick-0 advantage and multi-party independent attacks)
//   4. defeats (faction without castleOwner occupant on its own castle →
//      defeated; remnants → NEUTRAL, marching stacks dropped)
//   5. victory check is caller-side (evaluateOutcome reads state)
//
// stepAi() stays at the top for the same reason as v1.1 — when AI logic is
// restored its dispatches must hit marchingStacks before advanceMarching.
// Today it is a no-op (PRD §9.1 v1.2 stub).
export function step(state: GameState): GameState {
  let s = stepAi(state);
  s = advanceMarching(s);
  s = produce(s);
  s = resolveSameTileCombat(s).state;
  s = applyDefeats(s);
  return { ...s, tick: s.tick + 1 };
}
