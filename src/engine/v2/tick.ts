import { dayOf } from "./clock";
import { ev, type GameEvent, type StepResult } from "./events";
import type { GameState } from "./types";

// PRD §4.2 — one tick. M5 ships the skeleton: it advances the clock and emits
// the time events. The per-system stages land in later milestones and slot in
// here, each reading the tick-start snapshot and returning {state, events}:
//
//   advanceMarch → resolveCombat → advanceConstruction → advanceDestruction
//   → accumulateNests → computeConnectivity(if dirty)
//   → [day boundary: growPopulation + expandFields + spawnFromHouses]
//   → applyMaintenance → recomputeElite → applyDefeats
//
// Day-boundary stages run only when this tick crosses into a new day (so the
// "per day" rules in §4.4 sit on the per-tick driver).
export function step(state: GameState): StepResult {
  const events: GameEvent[] = [];

  const nextTick = state.tick + 1;
  const nextDay = dayOf(nextTick);
  const crossedDay = nextDay > state.day;

  const next: GameState = { ...state, tick: nextTick, day: nextDay };

  events.push(ev.tickElapsed(nextTick));
  if (crossedDay) events.push(ev.dayElapsed(nextDay));

  return { state: next, events };
}

// Run `n` ticks, threading state and concatenating each tick's events. The
// determinism guarantee (AC-04) holds because step() is pure and order-stable.
export function runTicks(state: GameState, n: number): StepResult {
  let s = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = step(s);
    s = r.state;
    for (const e of r.events) events.push(e);
  }
  return { state: s, events };
}
