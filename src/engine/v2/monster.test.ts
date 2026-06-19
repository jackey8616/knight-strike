import { describe, expect, it } from "vitest";
import { accumulateNests, applyMonsterKingKill } from "./monster";
import { resolveCombat } from "./combat";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { FactionId, GameState, House, MonsterNest, Unit } from "./types";

const nest = (id: string, x: number, y: number, accumulated = 0, createdTick = 0): MonsterNest => ({
  id,
  tile: tileId(x, y),
  accumulated,
  createdTick,
  durability: 100,
});

const unit = (id: string, owner: FactionId, x: number, y: number, pop: number, isMonster = false): Unit => ({
  id,
  owner,
  tile: tileId(x, y),
  population: pop,
  isMonster,
  isElite: false,
  task: null,
  combatLock: null,
});

const atTick = (s: GameState, tick: number): GameState => ({ ...s, tick });

describe("accumulateNests [AC-27]", () => {
  const withNest = (n: MonsterNest) => createGameState({ boardSize: 5, rngSeed: 1, nests: [n] });

  it("accumulates +10 every 8 ticks (4 days), nothing in between", () => {
    const s = withNest(nest("nest:1", 2, 2));
    expect(accumulateNests(atTick(s, 4)).state.nests[0]?.accumulated).toBe(0); // mid-cycle
    expect(accumulateNests(atTick(s, 8)).state.nests[0]?.accumulated).toBe(10); // 4 days
  });

  it("does not accumulate at the creation tick", () => {
    const s = withNest(nest("nest:1", 2, 2));
    expect(accumulateNests(atTick(s, 0)).state.nests[0]?.accumulated).toBe(0);
  });

  it("spawns a 100-monster unit at the threshold and resets the counter", () => {
    const s = withNest(nest("nest:1", 2, 2, 90)); // one more tick → 100
    const r = accumulateNests(atTick(s, 8));
    expect(r.state.nests[0]?.accumulated).toBe(0); // 90 + 10 = 100 → spawn → 0
    expect(r.state.units).toHaveLength(1);
    const m = r.state.units[0];
    expect(m?.owner).toBe("MONSTER");
    expect(m?.isMonster).toBe(true);
    expect(m?.population).toBe(100);
    expect(r.events.some((e) => e.kind === "monster.spawned")).toBe(true);
  });
});

describe("monster combat multiplier [AC-28]", () => {
  const fight = (s: GameState, max = 1000): GameState => {
    let cur = s;
    for (let i = 0; i < max; i++) cur = resolveCombat(cur).state;
    return cur;
  };
  const alive = (s: GameState, id: string) => s.units.some((u) => u.id === id);

  it("a monster beats an equal human headcount (×2 effective)", () => {
    const s = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("m", "MONSTER", 2, 2, 1000, true), unit("h", "TOKUGAWA", 3, 2, 1000)],
    });
    const end = fight(s);
    expect(alive(end, "m")).toBe(true);
    expect(alive(end, "h")).toBe(false);
  });

  it("a human force more than double the monster wins", () => {
    const s = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("m", "MONSTER", 2, 2, 1000, true), unit("h", "TOKUGAWA", 3, 2, 2500)],
    });
    const end = fight(s);
    expect(alive(end, "h")).toBe(true);
    expect(alive(end, "m")).toBe(false);
  });
});

describe("applyMonsterKingKill [AC-29]", () => {
  it("turns the victim's units to monsters, razes its territory, zeroes its gold, spares nests", () => {
    const house: House = {
      id: "house:1",
      owner: "TOKUGAWA",
      tile: tileId(1, 1),
      population: 50,
      connectedToCastle: true,
      lastGrowthDay: 0,
      lastExpansionDay: 0,
    };
    const s = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("u1", "TOKUGAWA", 0, 0, 500), unit("u2", "TAKEDA", 4, 4, 300)],
      houses: [house],
      fields: [{ owner: "TOKUGAWA", tile: tileId(1, 2) }],
      nests: [nest("nest:1", 2, 2, 30)],
      factions: { ...defaultFactions(), TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, gold: 999 }) },
    });

    const r = applyMonsterKingKill(s, "TOKUGAWA");
    // victim units became monsters
    const u1 = r.state.units.find((u) => u.id === "u1");
    expect(u1?.owner).toBe("MONSTER");
    expect(u1?.isMonster).toBe(true);
    // other nations untouched
    expect(r.state.units.find((u) => u.id === "u2")?.owner).toBe("TAKEDA");
    // territory razed, gold zeroed, nest spared
    expect(r.state.houses).toHaveLength(0);
    expect(r.state.fields).toHaveLength(0);
    expect(r.state.factions.TOKUGAWA.gold).toBe(0);
    expect(r.state.nests).toHaveLength(1);
    expect(r.events).toContainEqual({ kind: "nation.consumed_by_monster", nation: "TOKUGAWA" });
  });
});
