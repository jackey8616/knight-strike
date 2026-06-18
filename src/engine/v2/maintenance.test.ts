import { describe, expect, it } from "vitest";
import { applyMaintenance, maintenanceFee } from "./maintenance";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { FactionId, Unit } from "./types";

let seq = 0;
const unit = (owner: FactionId, pop: number): Unit => ({
  id: `unit:${(seq += 1)}`,
  owner,
  tile: tileId(0, 0),
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

const withGold = (gold: number, units: Unit[]) =>
  createGameState({
    boardSize: 5,
    rngSeed: 1,
    units,
    factions: { ...defaultFactions(), TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, gold }) },
  });

describe("maintenanceFee [AC-20]", () => {
  it("2000 → no fee; 2001 → fee (min 1)", () => {
    expect(maintenanceFee(2000)).toBe(0);
    expect(maintenanceFee(2001)).toBe(1);
    expect(maintenanceFee(3000)).toBe(10);
    expect(maintenanceFee(1000)).toBe(0);
  });
});

describe("applyMaintenance [AC-20/21]", () => {
  it("a 2000-person army owes nothing (gold untouched, no starvation)", () => {
    seq = 0;
    const r = applyMaintenance(withGold(50, [unit("TOKUGAWA", 2000)]));
    expect(r.state.factions.TOKUGAWA.gold).toBe(50);
    expect(r.state.units[0]?.population).toBe(2000);
    expect(r.events).toEqual([]);
  });

  it("a 2001-person army is charged (gold drops by the fee)", () => {
    seq = 0;
    const r = applyMaintenance(withGold(50, [unit("TOKUGAWA", 2001)]));
    expect(r.state.factions.TOKUGAWA.gold).toBe(49); // fee 1
    expect(r.state.units[0]?.population).toBe(2001); // no starvation, it paid
  });

  it("[AC-21] treasury exactly covers the summed upkeep → all fine, no starvation", () => {
    seq = 0;
    // two 3000-armies: fee 10 each → 20 total; gold exactly 20
    const r = applyMaintenance(withGold(20, [unit("TOKUGAWA", 3000), unit("TOKUGAWA", 3000)]));
    expect(r.state.factions.TOKUGAWA.gold).toBe(0);
    expect(r.state.units.every((u) => u.population === 3000)).toBe(true);
    expect(r.events).toEqual([]);
  });

  it("[AC-21] insufficient treasury → armies starve toward < 2000", () => {
    seq = 0;
    const r = applyMaintenance(withGold(5, [unit("TOKUGAWA", 3000), unit("TOKUGAWA", 3000)]));
    expect(r.state.factions.TOKUGAWA.gold).toBe(0);
    expect(r.state.units.every((u) => u.population < 3000)).toBe(true);
    expect(r.events.some((e) => e.kind === "unit.starvation")).toBe(true);
  });

  it("[AC-21] starvation shrinks a big army down to 2000 over repeated ticks", () => {
    seq = 0;
    let s = withGold(0, [unit("TOKUGAWA", 5000)]);
    for (let i = 0; i < 50; i++) s = applyMaintenance(s).state;
    expect(s.units[0]?.population).toBe(2000); // converged, never below
  });
});
