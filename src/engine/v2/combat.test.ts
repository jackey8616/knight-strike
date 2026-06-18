import { describe, expect, it } from "vitest";
import { calcDamage, effectivePopulation, resolveCombat } from "./combat";
import { createGameState, tileId } from "./state";
import type { FactionId, GameState, Unit } from "./types";

let seq = 0;
const unit = (owner: FactionId, x: number, y: number, pop: number, isMonster = false): Unit => ({
  id: `unit:${(seq += 1)}`,
  owner,
  tile: tileId(x, y),
  population: pop,
  isMonster,
  isElite: false,
  task: null,
  combatLock: null,
});

const withUnits = (units: Unit[]): GameState =>
  createGameState({ boardSize: 6, rngSeed: 1, units });

// run combat to completion (idempotent once no adjacency remains)
const fight = (state: GameState, max = 1000): GameState => {
  let s = state;
  for (let i = 0; i < max; i++) s = resolveCombat(s).state;
  return s;
};

const popOf = (s: GameState, id: string) => s.units.find((u) => u.id === id)?.population;
const alive = (s: GameState, id: string) => s.units.some((u) => u.id === id);

describe("calcDamage [AC-19]", () => {
  it("= max(1, floor(pop × tierWeight/100)), tierWeight {S:1,M:10,L:100}", () => {
    expect(calcDamage(1)).toBe(1); // S floor(0.01) → 1
    expect(calcDamage(999)).toBe(9); // S
    expect(calcDamage(1000)).toBe(100); // M
    expect(calcDamage(4999)).toBe(499); // M
    expect(calcDamage(5000)).toBe(500); // M
    expect(calcDamage(8000)).toBe(800); // M
    expect(calcDamage(9999)).toBe(999); // M
    expect(calcDamage(10000)).toBe(10000); // L
    expect(calcDamage(10001)).toBe(10001); // L
  });

  it("no tier overlap: an M floor out-damages any S", () => {
    expect(calcDamage(1000)).toBeGreaterThan(calcDamage(999));
  });
});

describe("effectivePopulation", () => {
  it("is the population for humans, doubled for monsters", () => {
    expect(effectivePopulation({ population: 1000, isMonster: false } as Unit)).toBe(1000);
    expect(effectivePopulation({ population: 1000, isMonster: true } as Unit)).toBe(2000);
  });
});

describe("resolveCombat", () => {
  it("[AC-16] the larger force wins and the gap widens (5000 vs 4999)", () => {
    seq = 0;
    const a = unit("TOKUGAWA", 2, 2, 5000); // unit:1
    const b = unit("TAKEDA", 3, 2, 4999); // unit:2
    const end = fight(withUnits([a, b]));
    expect(alive(end, a.id)).toBe(true);
    expect(alive(end, b.id)).toBe(false);
    expect(popOf(end, a.id)).toBeGreaterThan(0);
  });

  it("[AC-16] no merging: 8000 beats two separate 5000s (fought 1v1 in turn)", () => {
    seq = 0;
    const x = unit("TOKUGAWA", 1, 2, 5000); // unit:1
    const y = unit("TOKUGAWA", 3, 2, 5000); // unit:2
    const big = unit("TAKEDA", 2, 2, 8000); // unit:3, adjacent to both
    const end = fight(withUnits([x, y, big]));
    expect(alive(end, big.id)).toBe(true);
    expect(alive(end, x.id)).toBe(false);
    expect(alive(end, y.id)).toBe(false);
  });

  it("[AC-17] a higher tier overwhelms a lower one (L 10001 vs M 9999, ~1 tick)", () => {
    seq = 0;
    const l = unit("TOKUGAWA", 2, 2, 10001);
    const m = unit("TAKEDA", 3, 2, 9999);
    const after = resolveCombat(withUnits([l, m])).state;
    expect(alive(after, m.id)).toBe(false); // M gone in a single tick
    expect(popOf(after, l.id)).toBeGreaterThan(9000); // L barely scratched
  });

  it("[AC-18] contact locks the pair and fights to the death (can't interrupt)", () => {
    seq = 0;
    const a = unit("TOKUGAWA", 2, 2, 5000);
    const b = unit("TAKEDA", 3, 2, 5000);
    const oneTick = resolveCombat(withUnits([a, b]));
    // mid-battle: both alive, both locked onto each other
    expect(alive(oneTick.state, a.id)).toBe(true);
    expect(alive(oneTick.state, b.id)).toBe(true);
    expect(oneTick.state.units.find((u) => u.id === a.id)?.combatLock).toBe(b.id);
    expect(oneTick.events.some((e) => e.kind === "combat.engaged")).toBe(true);
    // equal armies → mutual annihilation resolves to the smaller id (deterministic)
    const end = fight(oneTick.state);
    expect(alive(end, a.id)).toBe(true);
    expect(alive(end, b.id)).toBe(false);
  });

  it("[AC-18] NEUTRAL never retaliates but takes damage and dies", () => {
    seq = 0;
    const me = unit("TOKUGAWA", 2, 2, 1000);
    const wild = unit("NEUTRAL", 3, 2, 1000);
    const end = fight(withUnits([me, wild]));
    expect(popOf(end, me.id)).toBe(1000); // untouched — neutral dealt no damage
    expect(alive(end, wild.id)).toBe(false);
  });

  it("emits damage_dealt and unit_destroyed events", () => {
    seq = 0;
    const a = unit("TOKUGAWA", 2, 2, 3000);
    const b = unit("TAKEDA", 3, 2, 100);
    const kinds = new Set<string>();
    let s = withUnits([a, b]);
    for (let i = 0; i < 50; i++) {
      const r = resolveCombat(s);
      for (const e of r.events) kinds.add(e.kind);
      s = r.state;
    }
    expect(kinds.has("combat.damage_dealt")).toBe(true);
    expect(kinds.has("combat.unit_destroyed")).toBe(true);
  });
});
