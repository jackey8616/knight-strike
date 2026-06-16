import { stepAi } from "./ai";
import {
  applyDrainDeductions,
  resolveAdjacentCombat,
  updateStalemates,
} from "./combat";
import { advanceMarching } from "./movement";
import { applyCastleOverflow } from "./overflow";
import { produce } from "./production";
import type { GameState } from "./types";
import { applyDefeats } from "./victory";

export function step(state: GameState): GameState {
  // PRD §3.2 v0.12 settlement order. AI evaluation sits at the top of the tick
  // because its dispatches must be in marchingStacks before advanceMarching
  // runs (newly dispatched stacks advance idx 0 → 1 in the same tick, per
  // §3.5.3). The §3.6.1 adjacent-claim phase was removed in v0.12 — empty-tile
  // ownership now flips only via §3.5.4 marching arrival (already handled
  // inside advanceMarching).
  let s = stepAi(state);
  s = advanceMarching(s);
  const cr = resolveAdjacentCombat(s);
  s = cr.state;
  const su = updateStalemates(s.stalemates, cr.pairs);
  s = applyDrainDeductions({ ...s, stalemates: su.nextMap }, su.drainDeductions);
  // §3.2 step 3: castle captured this tick triggers faction defeat. Runs
  // before produce so a dying faction can't push out an extra count.
  s = applyDefeats(s);
  s = produce(s);
  // §3.2 v0.11: castle overflow runs after produce so any freshly produced
  // unit that pushes the castle above CASTLE_OVERFLOW_THRESHOLD can ship out
  // the same tick. Stays before upgrade because tier is derived on read —
  // deriveTier on next access reflects the post-overflow count.
  s = applyCastleOverflow(s);
  // §3.2 step 5 (tier upgrade) is implicit — deriveTier is recomputed on read.
  // §3.2 step 6 (victory) is caller-side: evaluateOutcome reads state.
  return { ...s, tick: s.tick + 1 };
}
