import { describe, expect, it } from "vitest";
import { isPassable } from "./terrain";
import { createGameState, tileId } from "./state";
import type { Building, Province } from "./types";

const prov = (x: number, y: number, terrain: Province["terrain"]): [string, Province] => [
  tileId(x, y),
  { id: tileId(x, y), x, y, terrain, isCastle: false, castleOwner: null },
];

const bridge = (x: number, y: number): Building => ({
  id: `b:${x},${y}`,
  kind: "BRIDGE",
  owner: null,
  tile: tileId(x, y),
  durability: 10,
  maxDurability: 10,
});

const fence = (x: number, y: number): Building => ({
  id: `f:${x},${y}`,
  kind: "FENCE",
  owner: "TOKUGAWA",
  tile: tileId(x, y),
  durability: 10,
  maxDurability: 10,
});

describe("isPassable", () => {
  it("walkable land (PLAINS/FOREST, incl. unmapped default) is passable", () => {
    const s = createGameState({
      boardSize: 4,
      rngSeed: 1,
      provinces: new Map([prov(0, 0, "PLAINS"), prov(1, 0, "FOREST")]),
    });
    expect(isPassable(s, tileId(0, 0))).toBe(true);
    expect(isPassable(s, tileId(1, 0))).toBe(true);
    expect(isPassable(s, tileId(3, 3))).toBe(true); // unmapped → PLAINS
  });

  it("MOUNTAIN is never passable", () => {
    const s = createGameState({ boardSize: 4, rngSeed: 1, provinces: new Map([prov(0, 0, "MOUNTAIN")]) });
    expect(isPassable(s, tileId(0, 0))).toBe(false);
  });

  it("WATER / LAVA are impassable without a bridge, passable with one", () => {
    const noBridge = createGameState({
      boardSize: 4,
      rngSeed: 1,
      provinces: new Map([prov(0, 0, "WATER"), prov(1, 0, "LAVA")]),
    });
    expect(isPassable(noBridge, tileId(0, 0))).toBe(false);
    expect(isPassable(noBridge, tileId(1, 0))).toBe(false);

    const bridged = createGameState({
      boardSize: 4,
      rngSeed: 1,
      provinces: new Map([prov(0, 0, "WATER"), prov(1, 0, "LAVA")]),
      buildings: [bridge(0, 0), bridge(1, 0)],
    });
    expect(isPassable(bridged, tileId(0, 0))).toBe(true);
    expect(isPassable(bridged, tileId(1, 0))).toBe(true);
  });

  it("a FENCE blocks an otherwise-walkable tile (for everyone)", () => {
    const s = createGameState({
      boardSize: 4,
      rngSeed: 1,
      provinces: new Map([prov(0, 0, "PLAINS")]),
      buildings: [fence(0, 0)],
    });
    expect(isPassable(s, tileId(0, 0))).toBe(false);
  });
});
