import { describe, expect, it } from "vitest";
import { parseTileId, tileId } from "./state";
import {
  applyTerrainDefense,
  generateTerrain,
  isImpassableTerrain,
} from "./terrain";
import type { Terrain, TileId } from "./types";

const BOARD = 11;
const CASTLES: readonly TileId[] = [
  tileId(0, 0),
  tileId(10, 0),
  tileId(0, 10),
  tileId(10, 10),
];
const FIXED = new Set<TileId>([...CASTLES, tileId(5, 5)]);

// Passable flood-fill, mirroring the engine's impassable rule.
function reachable(
  grid: ReadonlyMap<TileId, Terrain>,
  root: TileId,
  size = BOARD,
): Set<TileId> {
  const seen = new Set<TileId>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift() as TileId;
    const { x, y } = parseTileId(cur);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const nid = tileId(nx, ny);
      if (seen.has(nid) || isImpassableTerrain(grid.get(nid))) continue;
      seen.add(nid);
      queue.push(nid);
    }
  }
  return seen;
}

function cornersAndCentre(size: number): Set<TileId> {
  const m = size - 1;
  const c = Math.floor(size / 2);
  return new Set<TileId>([
    tileId(0, 0),
    tileId(m, 0),
    tileId(0, m),
    tileId(m, m),
    tileId(c, c),
  ]);
}

describe("isImpassableTerrain", () => {
  it("mountain and water block; others pass", () => {
    expect(isImpassableTerrain("MOUNTAIN")).toBe(true);
    expect(isImpassableTerrain("WATER")).toBe(true);
    expect(isImpassableTerrain("PLAINS")).toBe(false);
    expect(isImpassableTerrain("HILL")).toBe(false);
    expect(isImpassableTerrain("FOREST")).toBe(false);
    expect(isImpassableTerrain(undefined)).toBe(false);
  });
});

describe("applyTerrainDefense", () => {
  it("[AC-V6-01] hill halves, forest 75%, plains unchanged (ceil, never zeroes)", () => {
    expect(applyTerrainDefense(4, "PLAINS")).toBe(4);
    expect(applyTerrainDefense(4, undefined)).toBe(4);
    expect(applyTerrainDefense(4, "HILL")).toBe(2);
    expect(applyTerrainDefense(8, "HILL")).toBe(4);
    expect(applyTerrainDefense(1, "HILL")).toBe(1); // ceil keeps ≥1
    expect(applyTerrainDefense(4, "FOREST")).toBe(3);
    expect(applyTerrainDefense(8, "FOREST")).toBe(6);
    expect(applyTerrainDefense(0, "HILL")).toBe(0);
  });
});

describe("generateTerrain", () => {
  it("is deterministic for a given seed", () => {
    const a = generateTerrain(BOARD, 123, FIXED);
    const b = generateTerrain(BOARD, 123, FIXED);
    for (const [id, t] of a) expect(b.get(id)).toBe(t);
  });

  it("different seeds produce different layouts", () => {
    const a = generateTerrain(BOARD, 1, FIXED);
    const b = generateTerrain(BOARD, 999, FIXED);
    let diff = 0;
    for (const [id, t] of a) if (b.get(id) !== t) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it("[AC-V6-02] fixed tiles stay PLAINS and have no impassable neighbour", () => {
    for (const seed of [1, 7, 42, 123, 999, 31337]) {
      const grid = generateTerrain(BOARD, seed, FIXED);
      for (const id of FIXED) {
        expect(grid.get(id)).toBe("PLAINS");
        const { x, y } = parseTileId(id);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= BOARD || ny < 0 || ny >= BOARD) continue;
          expect(isImpassableTerrain(grid.get(tileId(nx, ny)))).toBe(false);
        }
      }
    }
  });

  it("[AC-V6-03] all fixed tiles are mutually connected over passable terrain", () => {
    for (const seed of [1, 7, 42, 123, 999, 31337, 5, 88]) {
      const grid = generateTerrain(BOARD, seed, FIXED);
      const reach = reachable(grid, tileId(0, 0));
      for (const id of FIXED) expect(reach.has(id)).toBe(true);
    }
  });

  it("[AC-V6-03] connectivity holds at every selectable map size", () => {
    for (const size of [11, 15, 19, 27]) {
      const fixed = cornersAndCentre(size);
      for (const seed of [1, 42, 7, 999]) {
        const grid = generateTerrain(size, seed, fixed);
        const reach = reachable(grid, tileId(0, 0), size);
        for (const id of fixed) expect(reach.has(id)).toBe(true);
      }
    }
  });
});
