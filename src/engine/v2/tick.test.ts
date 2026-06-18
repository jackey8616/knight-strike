import { describe, expect, it } from "vitest";
import { runTicks, step } from "./tick";
import { createGameState, serializeState, tileId } from "./state";
import type { House, Unit } from "./types";

const unit = (id: string, tile: string, pop: number): Unit => ({
  id,
  owner: "TOKUGAWA",
  tile,
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

const house: House = {
  id: "house:1",
  owner: "TOKUGAWA",
  tile: tileId(1, 1),
  population: 50,
  connectedToCastle: true,
  lastGrowthDay: 0,
  lastExpansionDay: 0,
};

const baseState = () =>
  createGameState({
    boardSize: 5,
    rngSeed: 99,
    units: [unit("unit:1", tileId(0, 0), 100)],
    houses: [house],
    fields: [{ owner: "TOKUGAWA", tile: tileId(1, 2) }],
  });

describe("step (M5 skeleton)", () => {
  it("advances tick and derives day = floor(tick/2) without mutating input", () => {
    const s0 = baseState();
    const r1 = step(s0);
    expect(r1.state.tick).toBe(1);
    expect(r1.state.day).toBe(0);
    expect(s0.tick).toBe(0); // pure: input untouched

    const r2 = step(r1.state);
    expect(r2.state.tick).toBe(2);
    expect(r2.state.day).toBe(1);
  });

  it("emits tick.elapsed every tick and day.elapsed only on a day boundary", () => {
    const { events } = runTicks(baseState(), 4);
    expect(events).toEqual([
      { kind: "tick.elapsed", tick: 1 },
      { kind: "tick.elapsed", tick: 2 },
      { kind: "day.elapsed", day: 1 },
      { kind: "tick.elapsed", tick: 3 },
      { kind: "tick.elapsed", tick: 4 },
      { kind: "day.elapsed", day: 2 },
    ]);
  });
});

describe("[AC-04] determinism", () => {
  it("same initial state + same tick count → identical final state (golden-hash)", () => {
    const a = runTicks(baseState(), 20);
    const b = runTicks(baseState(), 20);
    expect(serializeState(a.state)).toBe(serializeState(b.state));
  });

  it("runTicks does not mutate the input state", () => {
    const s0 = baseState();
    const snap = serializeState(s0);
    runTicks(s0, 10);
    expect(serializeState(s0)).toBe(snap);
  });
});
