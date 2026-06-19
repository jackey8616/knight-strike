import { describe, expect, it } from "vitest";
import { buildScenarioState, runScenario } from "./runner";
import { NEST_DRIP, QUICK_WIN, SPECTATOR_4 } from "./scenarios";

describe("buildScenarioState", () => {
  it("expands a scenario into a v2 GameState", () => {
    const s = buildScenarioState({
      boardSize: 5,
      rngSeed: 9,
      factions: { TOKUGAWA: { gold: 500, isPlayer: true } },
      units: [{ owner: "TOKUGAWA", x: 1, y: 1, population: 300 }],
      castles: [{ owner: "TOKUGAWA", x: 0, y: 0 }],
    });
    expect(s.factions.TOKUGAWA.gold).toBe(500);
    expect(s.units).toHaveLength(1);
    expect(s.units[0]?.population).toBe(300);
    expect(s.provinces.get("tile:0,0")?.isCastle).toBe(true);
  });
});

describe("runScenario", () => {
  it("resolves QUICK_WIN to a player win quickly", () => {
    const r = runScenario(QUICK_WIN, { maxTicks: 50 });
    expect(r.outcome).toEqual({ kind: "win", winner: "TOKUGAWA" });
    expect(r.ticks).toBeLessThan(10);
  });

  it("runs the 4-nation spectator board: economies grow, game stays ongoing", () => {
    const r = runScenario(SPECTATOR_4, { maxTicks: 120, emitEvents: true });
    expect(r.outcome.kind).toBe("ongoing");
    expect(r.ticks).toBe(120);
    const events = r.events ?? [];
    expect(events.some((e) => e.kind === "house.spawned_unit")).toBe(true);
    expect(events.some((e) => e.kind === "house.expanded_field")).toBe(true);
    expect(events.some((e) => e.kind === "day.elapsed")).toBe(true);
  });

  it("spawns monsters from a nest over a long run", () => {
    const r = runScenario(NEST_DRIP, { maxTicks: 120, emitEvents: true });
    expect((r.events ?? []).some((e) => e.kind === "monster.spawned")).toBe(true);
  });
});

describe("[AC-37] event-log determinism / replay", () => {
  it("same scenario + seed → byte-identical event sequence", () => {
    const a = runScenario(SPECTATOR_4, { maxTicks: 100, emitEvents: true });
    const b = runScenario(SPECTATOR_4, { maxTicks: 100, emitEvents: true });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.events?.length).toBeGreaterThan(0);
  });
});
