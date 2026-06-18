import { describe, expect, it } from "vitest";
import { buildHouse, validateBuild } from "./house";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { Field, FactionId, House, Province, Unit } from "./types";

const unit = (id: string, owner: FactionId, tile: string, pop: number): Unit => ({
  id,
  owner,
  tile,
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

const house = (id: string, owner: FactionId, tile: string): House => ({
  id,
  owner,
  tile,
  population: 50,
  connectedToCastle: false,
  lastGrowthDay: 0,
  lastExpansionDay: 0,
});

const prov = (x: number, y: number, terrain: Province["terrain"]): Province => ({
  id: tileId(x, y),
  x,
  y,
  terrain,
  isCastle: false,
  castleOwner: null,
});

// TOKUGAWA with a configurable treasury; the spawn target tile is (2,2).
const factionsWithGold = (gold: number) => ({
  ...defaultFactions(),
  TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, gold }),
});

type Opts = {
  gold?: number;
  units?: Unit[];
  houses?: House[];
  fields?: Field[];
  provinces?: Map<string, Province>;
};

const setup = (o: Opts = {}) =>
  createGameState({
    boardSize: 5,
    rngSeed: 1,
    factions: factionsWithGold(o.gold ?? 1000),
    units: o.units ?? [unit("unit:1", "TOKUGAWA", tileId(2, 2), 50)],
    houses: o.houses ?? [],
    fields: o.fields ?? [],
    provinces: o.provinces ?? new Map(),
  });

const cmd = { faction: "TOKUGAWA" as const, tile: tileId(2, 2) };

describe("validateBuild [AC-05]", () => {
  it("INSUFFICIENT_GOLD when treasury < 100", () => {
    expect(validateBuild(setup({ gold: 50 }), cmd)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_GOLD",
    });
  });

  it("NO_UNIT_ON_TILE when no own unit stands on the tile", () => {
    expect(validateBuild(setup({ units: [] }), cmd)).toEqual({
      ok: false,
      reason: "NO_UNIT_ON_TILE",
    });
  });

  it("NEIGHBOR_HAS_OWN_HOUSE when an own house is within the Moore 8", () => {
    const s = setup({ houses: [house("house:1", "TOKUGAWA", tileId(3, 3))] });
    expect(validateBuild(s, cmd)).toEqual({
      ok: false,
      reason: "NEIGHBOR_HAS_OWN_HOUSE",
    });
  });

  it("allows building when only an ENEMY house is within the Moore 8", () => {
    const s = setup({ houses: [house("house:9", "TAKEDA", tileId(3, 3))] });
    expect(validateBuild(s, cmd)).toEqual({ ok: true });
  });

  it("TILE_NOT_BUILDABLE on water / lava terrain", () => {
    const water = new Map([[tileId(2, 2), prov(2, 2, "WATER")]]);
    expect(validateBuild(setup({ provinces: water }), cmd)).toEqual({
      ok: false,
      reason: "TILE_NOT_BUILDABLE",
    });
  });

  it("TILE_OCCUPIED when an own field already sits on the tile", () => {
    const s = setup({ fields: [{ owner: "TOKUGAWA", tile: tileId(2, 2) }] });
    expect(validateBuild(s, cmd)).toEqual({ ok: false, reason: "TILE_OCCUPIED" });
  });
});

describe("buildHouse [AC-06] population split", () => {
  const build = (pop: number) => {
    const s = setup({ units: [unit("unit:1", "TOKUGAWA", tileId(2, 2), pop)] });
    const r = buildHouse(s, cmd);
    if (!r.ok) throw new Error(`build failed: ${r.reason}`);
    const builtHouse = r.state.houses.find((h) => h.id === r.houseId);
    const builder = r.state.units.find((u) => u.id === "unit:1");
    return { housePop: builtHouse?.population, unitPop: builder?.population ?? 0, r };
  };

  it("199 → house 99 / unit 100", () => {
    const { housePop, unitPop } = build(199);
    expect([housePop, unitPop]).toEqual([99, 100]);
  });

  it("200 → house 100 / unit 100", () => {
    const { housePop, unitPop } = build(200);
    expect([housePop, unitPop]).toEqual([100, 100]);
  });

  it("201 → house 100 / unit 101", () => {
    const { housePop, unitPop } = build(201);
    expect([housePop, unitPop]).toEqual([100, 101]);
  });

  it("1 → house 0 / unit 1 (allowed; house inert until growth)", () => {
    const { housePop, unitPop } = build(1);
    expect([housePop, unitPop]).toEqual([0, 1]);
  });

  it("deducts 100 gold, assigns the house to the faction, and emits house.built", () => {
    const s = setup({ gold: 250, units: [unit("unit:1", "TOKUGAWA", tileId(2, 2), 50)] });
    const r = buildHouse(s, cmd);
    if (!r.ok) throw new Error("build failed");
    expect(r.state.factions.TOKUGAWA.gold).toBe(150);
    expect(r.state.houses).toHaveLength(1);
    expect(r.state.houses[0]?.owner).toBe("TOKUGAWA");
    expect(r.state.nextEntityId).toBe(s.nextEntityId + 1);
    expect(r.events).toContainEqual({
      kind: "house.built",
      houseId: r.houseId,
      owner: "TOKUGAWA",
      tile: tileId(2, 2),
    });
  });

  it("refuses to build (returns the reason) when validation fails", () => {
    const r = buildHouse(setup({ gold: 0 }), cmd);
    expect(r.ok).toBe(false);
  });
});
