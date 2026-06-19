import { describe, expect, it } from "vitest";
import { advanceMarch, findPath, issueMarch, mergeFriendlyUnits } from "./movement";
import { createGameState, tileId } from "./state";
import type { FactionId, Province, Unit } from "./types";

const unit = (id: string, owner: FactionId, x: number, y: number): Unit => ({
  id,
  owner,
  tile: tileId(x, y),
  population: 100,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

const mountain = (x: number, y: number): [string, Province] => [
  tileId(x, y),
  { id: tileId(x, y), x, y, terrain: "MOUNTAIN", isCastle: false, castleOwner: null },
];

describe("findPath", () => {
  it("finds the shortest 4-connected path over walkable terrain", () => {
    const s = createGameState({ boardSize: 5, rngSeed: 1 });
    const path = findPath(s, tileId(0, 0), tileId(2, 0));
    expect(path).toEqual([tileId(0, 0), tileId(1, 0), tileId(2, 0)]);
  });

  it("detours around an impassable tile", () => {
    const s = createGameState({ boardSize: 5, rngSeed: 1, provinces: new Map([mountain(1, 0)]) });
    const path = findPath(s, tileId(0, 0), tileId(2, 0));
    expect(path).not.toBeNull();
    expect(path).not.toContain(tileId(1, 0));
  });

  it("returns null when a mountain wall seals the target off", () => {
    const wall = new Map([mountain(1, 0), mountain(1, 1), mountain(1, 2), mountain(1, 3), mountain(1, 4)]);
    const s = createGameState({ boardSize: 5, rngSeed: 1, provinces: wall });
    expect(findPath(s, tileId(0, 0), tileId(2, 0))).toBeNull();
  });
});

describe("issueMarch / advanceMarch", () => {
  it("marches a unit one tile per tick to its destination, then clears the order", () => {
    let s = createGameState({ boardSize: 5, rngSeed: 1, units: [unit("unit:1", "TOKUGAWA", 0, 0)] });
    s = issueMarch(s, "unit:1", tileId(2, 0));
    expect(s.marchOrders).toHaveLength(1);

    s = advanceMarch(s).state;
    expect(s.units[0]?.tile).toBe(tileId(1, 0));
    s = advanceMarch(s).state;
    expect(s.units[0]?.tile).toBe(tileId(2, 0));
    expect(s.marchOrders).toHaveLength(0); // arrived
  });

  it("does not march a combat-locked unit", () => {
    let s = createGameState({ boardSize: 5, rngSeed: 1, units: [unit("unit:1", "TOKUGAWA", 0, 0)] });
    s = issueMarch(s, "unit:1", tileId(2, 0));
    s = { ...s, units: [{ ...(s.units[0] as Unit), combatLock: "unit:9" }] };
    const after = advanceMarch(s).state;
    expect(after.units[0]?.tile).toBe(tileId(0, 0)); // stayed put
  });

  it("stops when the next tile is occupied by an enemy (kept for AC coverage)", () => {
    let s = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 0, 0), unit("unit:2", "TAKEDA", 1, 0)],
    });
    s = issueMarch(s, "unit:1", tileId(2, 0)); // path runs through (1,0) where the enemy stands
    const after = advanceMarch(s).state;
    expect(after.units.find((u) => u.id === "unit:1")?.tile).toBe(tileId(0, 0));
    expect(after.marchOrders).toHaveLength(0); // order dropped, will fight instead
  });
});

describe("mergeFriendlyUnits [AC-16]", () => {
  const at = (id: string, owner: FactionId, x: number, y: number, pop: number): Unit => ({
    id,
    owner,
    tile: tileId(x, y),
    population: pop,
    isMonster: false,
    isElite: false,
    task: null,
    combatLock: null,
  });

  it("merges co-located idle friendly units into one summed army", () => {
    const s = createGameState({
      boardSize: 3,
      rngSeed: 1,
      units: [at("a", "TOKUGAWA", 1, 1, 5000), at("b", "TOKUGAWA", 1, 1, 5000)],
    });
    const after = mergeFriendlyUnits(s);
    expect(after.units).toHaveLength(1);
    expect(after.units[0]?.population).toBe(10000); // stacked → one big army
  });

  it("never merges enemies, nor units that are fighting / building", () => {
    const s = createGameState({
      boardSize: 3,
      rngSeed: 1,
      units: [
        at("a", "TOKUGAWA", 1, 1, 100),
        at("e", "TAKEDA", 1, 1, 100), // enemy on the same tile — not merged
        { ...at("b", "TOKUGAWA", 2, 2, 100), combatLock: "x" }, // busy
        { ...at("c", "TOKUGAWA", 2, 2, 100), combatLock: "y" }, // busy
      ],
    });
    expect(mergeFriendlyUnits(s).units).toHaveLength(4); // nothing merges
  });
});
