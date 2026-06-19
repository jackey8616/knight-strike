import { dayOf } from "./clock";
import { resolveCombat } from "./combat";
import { recomputeElite } from "./combat-tier";
import { computeConnectivity } from "./connectivity";
import { advanceConstruction, advanceDestruction } from "./construction";
import { ev, type GameEvent, type StepResult } from "./events";
import { expandFields, spawnFromHouses } from "./house";
import { applyMaintenance } from "./maintenance";
import { accumulateNests } from "./monster";
import { advanceMarch } from "./movement";
import { growPopulation } from "./population";
import type { GameState } from "./types";

// PRD §4.2 — one tick. Stages land milestone by milestone; each reads the
// running snapshot and returns {state, events}. Order:
//
//   advanceMarch → resolveCombat → advanceConstruction → advanceDestruction
//   → accumulateNests → computeConnectivity(if dirty)
//   → [day boundary: growPopulation + expandFields + spawnFromHouses]
//   → applyMaintenance → recomputeElite → applyDefeats
//
// M6 wires the economy: on a day boundary we recompute connectivity (tax routes
// may have shifted), then grow / expand / spawn. The combat / construction /
// monster / maintenance / victory stages join in M7+ where the comments mark.
export function step(state: GameState): StepResult {
  const events: GameEvent[] = [];
  let s = state;

  s = absorb(events, advanceMarch(s));
  s = absorb(events, resolveCombat(s));
  s = absorb(events, advanceConstruction(s));
  s = absorb(events, advanceDestruction(s));
  s = absorb(events, accumulateNests(s));

  const nextTick = s.tick + 1;
  const nextDay = dayOf(nextTick);
  const crossedDay = nextDay > s.day;
  s = { ...s, tick: nextTick, day: nextDay };
  events.push(ev.tickElapsed(nextTick));

  if (crossedDay) {
    events.push(ev.dayElapsed(nextDay));
    s = absorb(events, computeConnectivity(s));
    s = absorb(events, growPopulation(s));
    s = absorb(events, expandFields(s));
    s = absorb(events, spawnFromHouses(s));
  }

  s = absorb(events, applyMaintenance(s));
  s = recomputeElite(s);
  // M9/M10: applyDefeats slots in here.

  return { state: s, events };
}

function absorb(sink: GameEvent[], result: StepResult): GameState {
  for (const e of result.events) sink.push(e);
  return result.state;
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
