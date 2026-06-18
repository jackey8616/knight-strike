import { describe, expect, it } from "vitest";
import {
  createGameState,
  factionTerritory,
  makeFaction,
  mooreNeighbors,
  parseTileId,
  serializeState,
  tileId,
  tileIndex,
  unitsOf,
  vonNeumannNeighbors,
} from "./state";
import type { Field, House, Unit } from "./types";

const unit = (id: string, owner: Unit["owner"], tile: string, pop: number): Unit => ({
  id,
  owner,
  tile,
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

describe("tile ids", () => {
  it("round-trips tileId / parseTileId", () => {
    expect(tileId(3, 5)).toBe("tile:3,5");
    expect(parseTileId(tileId(3, 5))).toEqual({ x: 3, y: 5 });
    expect(parseTileId("tile:-2,7")).toEqual({ x: -2, y: 7 });
  });

  it("throws on a malformed tile id", () => {
    expect(() => parseTileId("nope")).toThrow();
  });
});

describe("neighbors", () => {
  it("mooreNeighbors: corner → 3, edge → 5, interior → 8 (in-bounds only)", () => {
    expect(mooreNeighbors(0, 0, 5)).toHaveLength(3);
    expect(mooreNeighbors(0, 2, 5)).toHaveLength(5);
    expect(mooreNeighbors(2, 2, 5)).toHaveLength(8);
    expect(new Set(mooreNeighbors(2, 2, 5))).toContain(tileId(1, 1));
    expect(new Set(mooreNeighbors(2, 2, 5))).toContain(tileId(3, 3));
  });

  it("vonNeumannNeighbors: corner → 2, interior → 4 (4-connected)", () => {
    expect(vonNeumannNeighbors(0, 0, 5)).toHaveLength(2);
    expect(vonNeumannNeighbors(2, 2, 5).sort()).toEqual(
      [tileId(2, 1), tileId(1, 2), tileId(3, 2), tileId(2, 3)].sort(),
    );
  });
});

describe("entity helpers", () => {
  const houses: House[] = [
    {
      id: "house:1",
      owner: "TOKUGAWA",
      tile: tileId(1, 1),
      population: 50,
      connectedToCastle: false,
      lastGrowthDay: 0,
      lastExpansionDay: 0,
    },
  ];
  const fields: Field[] = [
    { owner: "TOKUGAWA", tile: tileId(1, 2) },
    { owner: "TAKEDA", tile: tileId(4, 4) },
  ];
  const units: Unit[] = [
    unit("unit:1", "TOKUGAWA", tileId(1, 1), 10),
    unit("unit:2", "TOKUGAWA", tileId(1, 1), 20),
    unit("unit:3", "TAKEDA", tileId(4, 4), 30),
  ];
  const state = createGameState({ boardSize: 5, rngSeed: 1, units, houses, fields });

  it("tileIndex groups houses/fields/units by tile", () => {
    const idx = tileIndex(state);
    const home = idx.get(tileId(1, 1));
    expect(home?.house?.id).toBe("house:1");
    expect(home?.unitIds.sort()).toEqual(["unit:1", "unit:2"]);
    expect(idx.get(tileId(1, 2))?.field?.owner).toBe("TOKUGAWA");
  });

  it("unitsOf filters by faction", () => {
    expect(unitsOf(state, "TOKUGAWA").map((u) => u.id)).toEqual(["unit:1", "unit:2"]);
    expect(unitsOf(state, "TAKEDA")).toHaveLength(1);
    expect(unitsOf(state, "ODA")).toHaveLength(0);
  });

  it("factionTerritory collects own house + field tiles", () => {
    expect(factionTerritory(state, "TOKUGAWA").sort()).toEqual(
      [tileId(1, 1), tileId(1, 2)].sort(),
    );
    expect(factionTerritory(state, "TAKEDA")).toEqual([tileId(4, 4)]);
  });
});

describe("createGameState", () => {
  it("fills deterministic defaults; only TOKUGAWA is the player", () => {
    const s = createGameState({ boardSize: 11, rngSeed: 42 });
    expect(s.tick).toBe(0);
    expect(s.day).toBe(0);
    expect(s.speed).toBe("slow");
    expect(s.nextEntityId).toBe(1);
    expect(s.factions.TOKUGAWA.isPlayer).toBe(true);
    expect(s.factions.TAKEDA.isPlayer).toBe(false);
    expect(s.factions.MONSTER.isPlayer).toBe(false);
  });

  it("makeFaction applies overrides over zero defaults", () => {
    expect(makeFaction("ODA", { gold: 500, taxRate: 0.1 })).toEqual({
      id: "ODA",
      gold: 500,
      taxRate: 0.1,
      isPlayer: false,
      unitsLostTotal: 0,
      enemyLossesCredited: 0,
    });
  });
});

describe("serializeState (determinism)", () => {
  const prov = (x: number, y: number) =>
    [
      tileId(x, y),
      {
        id: tileId(x, y),
        x,
        y,
        terrain: "PLAINS" as const,
        isCastle: false,
        castleOwner: null,
      },
    ] as const;

  it("canonicalizes Map iteration order (provinces) — order-independent", () => {
    const a = createGameState({
      boardSize: 2,
      rngSeed: 7,
      provinces: new Map([prov(0, 0), prov(1, 1)]),
    });
    const b = createGameState({
      boardSize: 2,
      rngSeed: 7,
      provinces: new Map([prov(1, 1), prov(0, 0)]),
    });
    // Maps have no semantic order → canonical serialization sorts entries → equal
    expect(serializeState(a)).toBe(serializeState(b));
  });

  it("distinguishes states that actually differ", () => {
    const a = createGameState({ boardSize: 3, rngSeed: 7 });
    const b = createGameState({ boardSize: 3, rngSeed: 8 });
    expect(serializeState(a)).not.toBe(serializeState(b));
  });
});
