import { describe, expect, it } from "vitest";
import { advanceClock, dayOf, tickMs, TICK_RATES } from "./clock";

describe("clock", () => {
  it("[AC-01] tickMs: slow/medium/fast → 500/250/125 (2/4/8 ticks/sec)", () => {
    expect(tickMs("slow")).toBe(500);
    expect(tickMs("medium")).toBe(250);
    expect(tickMs("fast")).toBe(125);
    expect(TICK_RATES).toEqual({ slow: 2, medium: 4, fast: 8 });
  });

  it("[AC-02] dayOf: tick 0–1 → day 0, tick 2–3 → day 1", () => {
    expect(dayOf(0)).toBe(0);
    expect(dayOf(1)).toBe(0);
    expect(dayOf(2)).toBe(1);
    expect(dayOf(3)).toBe(1);
    expect(dayOf(8)).toBe(4);
  });

  it("[AC-03] advanceClock consumes whole ticks and carries the remainder", () => {
    // 1000ms at medium (250ms/tick) → exactly 4 ticks, no remainder
    expect(advanceClock(0, 1000, "medium")).toEqual({ ticks: 4, acc: 0 });
    // 1000ms at slow (500ms/tick) → 2 ticks
    expect(advanceClock(0, 1000, "slow")).toEqual({ ticks: 2, acc: 0 });
    // 600ms at slow → 1 tick, 100ms carried
    expect(advanceClock(0, 600, "slow")).toEqual({ ticks: 1, acc: 100 });
    // carried remainder accumulates across calls
    expect(advanceClock(100, 600, "slow")).toEqual({ ticks: 1, acc: 200 });
  });

  it("[AC-03] pause (deltaMs = 0) advances no tick and leaves the accumulator", () => {
    expect(advanceClock(0, 0, "fast")).toEqual({ ticks: 0, acc: 0 });
    expect(advanceClock(123, 0, "slow")).toEqual({ ticks: 0, acc: 123 });
  });

  it("[AC-03] speed switch keeps the accumulator (no skipped/renumbered ticks)", () => {
    // accumulate 400ms at slow (under one 500ms tick) → no tick yet, 400 carried
    const a = advanceClock(0, 400, "slow");
    expect(a).toEqual({ ticks: 0, acc: 400 });
    // switch to fast (125ms/tick): the carried 400ms now yields 3 ticks (+25 left)
    const b = advanceClock(a.acc, 0, "fast");
    expect(b).toEqual({ ticks: 3, acc: 25 });
  });
});
