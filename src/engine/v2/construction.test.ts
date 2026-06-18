import { describe, expect, it } from "vitest";
import {
  advanceConstruction,
  advanceDestruction,
  destructionPower,
  startConstruction,
  startDestruction,
  validateConstruction,
} from "./construction";
import { isPassable } from "./terrain";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { Building, FactionId, House, Province, Unit } from "./types";

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

const prov = (x: number, y: number, terrain: Province["terrain"], extra: Partial<Province> = {}): [string, Province] => [
  tileId(x, y),
  { id: tileId(x, y), x, y, terrain, isCastle: false, castleOwner: null, ...extra },
];

const gold = (amount: number) => ({
  ...defaultFactions(),
  TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, gold: amount }),
});

const runDestruct = (s0: ReturnType<typeof createGameState>, n: number) => {
  let s = s0;
  const events = [];
  for (let i = 0; i < n; i++) {
    const r = advanceDestruction(s);
    s = r.state;
    for (const e of r.events) events.push(e);
  }
  return { state: s, events };
};

describe("validateConstruction [AC-22/23]", () => {
  const base = (terrain: Province["terrain"], goldAmt = 5000) =>
    createGameState({
      boardSize: 4,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 0, 0, 100)],
      provinces: new Map([prov(1, 0, terrain)]),
      factions: gold(goldAmt),
    });
  const bridge = { faction: "TOKUGAWA" as const, unitId: "unit:1", kind: "BRIDGE" as const, tile: tileId(1, 0) };

  it("a bridge needs water/lava terrain", () => {
    expect(validateConstruction(base("PLAINS"), bridge).ok).toBe(false);
    expect(validateConstruction(base("WATER"), bridge)).toEqual({ ok: true });
  });

  it("a fence needs land terrain", () => {
    const fenceCmd = { ...bridge, kind: "FENCE" as const };
    expect(validateConstruction(base("WATER"), fenceCmd).ok).toBe(false);
    expect(validateConstruction(base("PLAINS"), fenceCmd)).toEqual({ ok: true });
  });

  it("requires enough gold", () => {
    expect(validateConstruction(base("WATER", 1999), bridge)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_GOLD",
    });
  });
});

describe("startConstruction + advanceConstruction [AC-22]", () => {
  const waterboard = () =>
    createGameState({
      boardSize: 4,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 0, 0, 100)],
      provinces: new Map([prov(1, 0, "WATER")]),
      factions: gold(5000),
    });
  const cmd = { faction: "TOKUGAWA" as const, unitId: "unit:1", kind: "BRIDGE" as const, tile: tileId(1, 0) };

  it("a bridge costs 2000, takes 2 ticks, drains 10/tick, and then is passable", () => {
    const started = startConstruction(waterboard(), cmd);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.state.factions.TOKUGAWA.gold).toBe(3000); // −2000
    expect(started.state.constructions).toHaveLength(1);

    const t1 = advanceConstruction(started.state).state;
    expect(t1.units[0]?.population).toBe(90); // −10
    expect(t1.buildings).toHaveLength(0); // not done yet

    const t2 = advanceConstruction(t1).state;
    expect(t2.units[0]?.population).toBe(80); // −10
    expect(t2.buildings).toHaveLength(1); // bridge up
    expect(isPassable(t2, tileId(1, 0))).toBe(true); // water now crossable
    expect(t2.constructions).toHaveLength(0);
  });

  it("aborts when the builder is drained to zero (no bridge)", () => {
    let s = waterboard();
    s = { ...s, units: [unit("unit:1", "TOKUGAWA", 0, 0, 10)] };
    const started = startConstruction(s, cmd);
    if (!started.ok) return;
    const r = advanceConstruction(started.state);
    expect(r.state.units).toHaveLength(0); // builder gone
    expect(r.state.buildings).toHaveLength(0); // no bridge
    expect(r.events.some((e) => e.kind === "construction.aborted")).toBe(true);
  });
});

describe("destructionPower + advanceDestruction [AC-24]", () => {
  it("destructionPower: S/M = floor(sqrt(pop/100)); L = floor(sqrt(pop/10))", () => {
    expect(destructionPower(100)).toBe(1);
    expect(destructionPower(2500)).toBe(5);
    expect(destructionPower(10000)).toBe(31); // L wrecks fast
  });

  it("an S army chips a house by 1/tick and loses 10/tick", () => {
    const house: House = {
      id: "house:1",
      owner: "TAKEDA",
      tile: tileId(1, 1),
      population: 100,
      connectedToCastle: false,
      lastGrowthDay: 0,
      lastExpansionDay: 0,
    };
    let s = createGameState({ boardSize: 4, rngSeed: 1, units: [unit("unit:1", "TOKUGAWA", 1, 1, 100)], houses: [house] });
    s = startDestruction(s, { faction: "TOKUGAWA", unitId: "unit:1", targetKind: "HOUSE", targetId: "house:1" }).state;
    const r = advanceDestruction(s);
    expect(r.state.houses[0]?.population).toBe(99); // −1
    expect(r.state.units[0]?.population).toBe(90); // −10
  });

  it("an L army wrecks a bridge in a single tick", () => {
    const bridge: Building = { id: "b:1", kind: "BRIDGE", owner: null, tile: tileId(1, 0), durability: 10, maxDurability: 10 };
    let s = createGameState({ boardSize: 4, rngSeed: 1, units: [unit("unit:1", "TOKUGAWA", 0, 0, 10000)], buildings: [bridge] });
    s = startDestruction(s, { faction: "TOKUGAWA", unitId: "unit:1", targetKind: "BRIDGE", targetId: "b:1" }).state;
    const r = advanceDestruction(s);
    expect(r.state.buildings).toHaveLength(0);
    expect(r.events.some((e) => e.kind === "building.destroyed")).toBe(true);
  });

  it("[AC-25] destroying a castle drives its durability to 0 (king-down marker for M10)", () => {
    const castleProv = prov(2, 2, "PLAINS", { isCastle: true, castleOwner: "TAKEDA", castleDurability: 60 });
    let s = createGameState({
      boardSize: 4,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 2, 2, 10000)], // L, power 31
      provinces: new Map([castleProv]),
    });
    s = startDestruction(s, { faction: "TOKUGAWA", unitId: "unit:1", targetKind: "CASTLE", targetId: tileId(2, 2) }).state;
    const r = runDestruct(s, 5); // 31, 62 → down by tick 2
    expect(r.state.provinces.get(tileId(2, 2))?.castleDurability).toBe(0);
    expect(r.events.some((e) => e.kind === "building.destroyed")).toBe(true);
  });

  it("a field is razed in a single hit (durability 1)", () => {
    let s = createGameState({
      boardSize: 4,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 1, 1, 100)],
      fields: [{ owner: "TAKEDA", tile: tileId(1, 1) }],
    });
    s = startDestruction(s, { faction: "TOKUGAWA", unitId: "unit:1", targetKind: "FIELD", targetId: tileId(1, 1) }).state;
    const r = advanceDestruction(s);
    expect(r.state.fields).toHaveLength(0);
    expect(r.events.some((e) => e.kind === "building.destroyed")).toBe(true);
  });
});

describe("construction validation edge cases", () => {
  const board = createGameState({
    boardSize: 4,
    rngSeed: 1,
    units: [unit("unit:1", "TOKUGAWA", 0, 0, 100)],
    provinces: new Map([prov(1, 0, "WATER")]),
    factions: gold(5000),
  });
  const cmd = { faction: "TOKUGAWA" as const, unitId: "unit:1", kind: "BRIDGE" as const, tile: tileId(1, 0) };

  it("reports NO_UNIT / UNIT_BUSY / NOT_ADJACENT", () => {
    const noUnit = validateConstruction(board, { ...cmd, unitId: "ghost" });
    expect(noUnit.ok === false && noUnit.reason).toBe("NO_UNIT");

    const busy = { ...board, units: [{ ...(board.units[0] as Unit), combatLock: "x" }] };
    const busyV = validateConstruction(busy, cmd);
    expect(busyV.ok === false && busyV.reason).toBe("UNIT_BUSY");

    const far = validateConstruction(board, { ...cmd, tile: tileId(3, 3) });
    expect(far.ok === false && far.reason).toBe("NOT_ADJACENT");
  });

  it("startConstruction surfaces the validation reason instead of building", () => {
    const onLand = startConstruction(board, { ...cmd, tile: tileId(0, 1) }); // land, not water
    expect(onLand.ok).toBe(false);
  });

  it("startDestruction refuses a busy unit", () => {
    const busy = { ...board, units: [{ ...(board.units[0] as Unit), task: { kind: "destruct" as const, target: { unitId: "unit:1", targetKind: "HOUSE" as const, targetId: "h" } } }] };
    const r = startDestruction(busy, { faction: "TOKUGAWA", unitId: "unit:1", targetKind: "HOUSE", targetId: "h" });
    expect(r.ok).toBe(false);
  });
});
