import { describe, expect, it } from "vitest";
import { getTier, recomputeElite } from "./combat-tier";
import { createGameState, tileId } from "./state";
import type { FactionId, Unit } from "./types";

const unit = (id: string, owner: FactionId, pop: number, isElite = false): Unit => ({
  id,
  owner,
  tile: tileId(0, 0),
  population: pop,
  isMonster: false,
  isElite,
  task: null,
  combatLock: null,
});

const withUnits = (units: Unit[]) =>
  createGameState({ boardSize: 5, rngSeed: 1, units });

describe("getTier", () => {
  it("[AC-14] S/M/L bands at 1 / 1000 / 10000", () => {
    expect(getTier(1)).toBe("S");
    expect(getTier(999)).toBe("S");
    expect(getTier(1000)).toBe("M");
    expect(getTier(9999)).toBe("M");
    expect(getTier(10000)).toBe("L");
    expect(getTier(99999)).toBe("L");
  });

  it("[AC-14] non-positive population is S (defensive)", () => {
    expect(getTier(0)).toBe("S");
    expect(getTier(-5)).toBe("S");
  });
});

describe("recomputeElite", () => {
  it("[AC-15] a nation's single unit is elite", () => {
    const s = recomputeElite(withUnits([unit("unit:1", "TOKUGAWA", 10)]));
    expect(s.units[0]?.isElite).toBe(true);
  });

  it("[AC-15] the largest of three is elite, the others are not", () => {
    const s = recomputeElite(
      withUnits([
        unit("unit:1", "TOKUGAWA", 10),
        unit("unit:2", "TOKUGAWA", 50),
        unit("unit:3", "TOKUGAWA", 30),
      ]),
    );
    const byId = new Map(s.units.map((u) => [u.id, u.isElite]));
    expect(byId.get("unit:2")).toBe(true);
    expect(byId.get("unit:1")).toBe(false);
    expect(byId.get("unit:3")).toBe(false);
  });

  it("[AC-15] elite is per-faction (each nation has its own star)", () => {
    const s = recomputeElite(
      withUnits([
        unit("unit:1", "TOKUGAWA", 10),
        unit("unit:2", "TAKEDA", 5),
      ]),
    );
    const byId = new Map(s.units.map((u) => [u.id, u.isElite]));
    expect(byId.get("unit:1")).toBe(true);
    expect(byId.get("unit:2")).toBe(true);
  });

  it("[AC-15] ties break to the smaller id", () => {
    const s = recomputeElite(
      withUnits([
        unit("unit:1", "TOKUGAWA", 40),
        unit("unit:2", "TOKUGAWA", 40),
      ]),
    );
    const byId = new Map(s.units.map((u) => [u.id, u.isElite]));
    expect(byId.get("unit:1")).toBe(true);
    expect(byId.get("unit:2")).toBe(false);
  });

  it("[AC-15] the star transfers when the former elite is no longer largest", () => {
    // unit:1 starts elite, but unit:2 is now bigger → star moves to unit:2
    const s = recomputeElite(
      withUnits([
        unit("unit:1", "TOKUGAWA", 20, true),
        unit("unit:2", "TOKUGAWA", 60, false),
      ]),
    );
    const byId = new Map(s.units.map((u) => [u.id, u.isElite]));
    expect(byId.get("unit:1")).toBe(false);
    expect(byId.get("unit:2")).toBe(true);
  });

  it("returns the same reference when nothing changes (no needless spread)", () => {
    const s0 = recomputeElite(withUnits([unit("unit:1", "TOKUGAWA", 10)]));
    const s1 = recomputeElite(s0);
    expect(s1).toBe(s0);
  });
});
