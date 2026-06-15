import { stepAi } from "./ai";
import {
  applyDrainDeductions,
  resolveAdjacentCombat,
  updateStalemates,
} from "./combat";
import { advanceMarching } from "./movement";
import { produce } from "./production";
import type { GameState } from "./types";
import { applyDefeats } from "./victory";

export function step(state: GameState): GameState {
  // PRD §3.2 settlement order. AI evaluation sits at the top of the tick
  // because its dispatches must be in marchingStacks before advanceMarching
  // runs (newly dispatched stacks advance idx 0 → 1 in the same tick, per
  // §3.5.3).
  let s = stepAi(state);
  s = advanceMarching(s);
  const cr = resolveAdjacentCombat(s);
  s = cr.state;
  const su = updateStalemates(s.stalemates, cr.pairs);
  s = applyDrainDeductions({ ...s, stalemates: su.nextMap }, su.drainDeductions);
  // §3.2 step 3: occupation/defeat conversion. Must run before produce so a
  // castle captured this tick can't push out an extra count from the dying
  // faction.
  s = applyDefeats(s);
  s = produce(s);
  // §3.2 step 5 (tier upgrade) is implicit — deriveTier is recomputed on read.
  // §3.2 step 6 (victory) is caller-side: evaluateOutcome reads state.
  return { ...s, tick: s.tick + 1 };
}
