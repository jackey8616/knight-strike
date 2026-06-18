import { describe, expect, it } from "vitest";
import { ev } from "./events";

describe("events", () => {
  it("[AC-37] tickElapsed / dayElapsed factories produce tagged events", () => {
    expect(ev.tickElapsed(5)).toEqual({ kind: "tick.elapsed", tick: 5 });
    expect(ev.dayElapsed(2)).toEqual({ kind: "day.elapsed", day: 2 });
  });
});
