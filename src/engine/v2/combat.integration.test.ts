import { describe, expect, it } from "vitest";
import { runTicks } from "./tick";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { FactionId, Unit } from "./types";

const unit = (id: string, owner: FactionId, x: number, y: number, pop: number): Unit => ({
  id,
  owner,
  tile: tileId(x, y),
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

describe("M7 combat + maintenance integration", () => {
  it("two adjacent armies fight through the tick pipeline; the larger survives", () => {
    const s0 = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 2, 2, 6000), unit("unit:2", "TAKEDA", 3, 2, 4000)],
    });
    const end = runTicks(s0, 60).state;
    expect(end.units.some((u) => u.id === "unit:1")).toBe(true);
    expect(end.units.some((u) => u.id === "unit:2")).toBe(false);
    // the lone survivor is its nation's elite
    expect(end.units.find((u) => u.id === "unit:1")?.isElite).toBe(true);
  });

  it("a broke faction's oversized army starves down to 2000 through the pipeline", () => {
    const s0 = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 0, 0, 5000)],
      factions: { ...defaultFactions(), TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, gold: 0 }) },
    });
    const r = runTicks(s0, 60);
    expect(r.state.units[0]?.population).toBe(2000);
    expect(r.events.some((e) => e.kind === "unit.starvation")).toBe(true);
  });
});
