import { describe, expect, it } from "vitest";
import { produce } from "./production";
import { tileId } from "./state";
import type {
  AiMode,
  FactionId,
  GameState,
  Province,
  TileId,
} from "./types";

const idleAi: Readonly<Record<FactionId, AiMode>> = {
  TOKUGAWA: "idle",
  TAKEDA: "idle",
  ODA: "idle",
  UESUGI: "idle",
  NEUTRAL: "idle",
};

function makeProvince(
  x: number,
  y: number,
  owner: FactionId,
  count: number,
  isCastle: boolean,
): Province {
  return { id: tileId(x, y), x, y, owner, count, isCastle };
}

function buildState(
  tick: number,
  provinces: readonly Province[],
  options: { readonly defeated?: ReadonlySet<FactionId> } = {},
): GameState {
  const map = new Map<TileId, Province>();
  for (const p of provinces) map.set(p.id, p);
  return {
    boardSize: 11,
    tick,
    provinces: map,
    marchingStacks: [],
    stalemates: new Map(),
    aiConfig: idleAi,
    defeated: options.defeated ?? new Set<FactionId>(),
    rngSeed: 1,
    nextMarchingId: 1,
  };
}

const fourCastles: readonly Province[] = [
  makeProvince(0, 0, "TOKUGAWA", 3, true),
  makeProvince(10, 0, "TAKEDA", 3, true),
  makeProvince(0, 10, "ODA", 3, true),
  makeProvince(10, 10, "UESUGI", 3, true),
];

describe("produce", () => {
  it("[AC-03] tick 0 produces nothing (initial state)", () => {
    const before = buildState(0, fourCastles);
    const after = produce(before);
    for (const province of after.provinces.values()) {
      expect(province.count).toBe(3);
    }
  });

  it("[AC-03] tick 1 produces nothing (odd tick before first emission)", () => {
    const before = buildState(1, fourCastles);
    const after = produce(before);
    for (const province of after.provinces.values()) {
      expect(province.count).toBe(3);
    }
  });

  it("[AC-03] tick 2 is the first emission: every castle +1", () => {
    const before = buildState(2, fourCastles);
    const after = produce(before);
    for (const province of after.provinces.values()) {
      expect(province.isCastle).toBe(true);
      expect(province.count).toBe(4);
    }
  });

  it("[AC-03] tick 3 produces nothing (odd tick between emissions)", () => {
    const before = buildState(3, fourCastles);
    const after = produce(before);
    for (const province of after.provinces.values()) {
      expect(province.count).toBe(3);
    }
  });

  it("[AC-03] tick 4 keeps emitting on every even tick", () => {
    const before = buildState(4, fourCastles);
    const after = produce(before);
    for (const province of after.provinces.values()) {
      expect(province.count).toBe(4);
    }
  });

  it("[AC-03] 20s = 10 ticks (tick 2..10 inclusive) ⇒ castle +5", () => {
    let state = buildState(1, fourCastles);
    for (let t = 2; t <= 10; t++) {
      state = { ...state, tick: t };
      state = produce(state);
    }
    const castle = state.provinces.get(tileId(0, 0));
    expect(castle?.count).toBe(3 + 5);
  });

  it("non-castle tiles never produce, even on emission ticks", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 7, false),
      makeProvince(2, 0, "NEUTRAL", 0, false),
    ];
    const after = produce(buildState(2, provinces));
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(4);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(7);
    expect(after.provinces.get(tileId(2, 0))?.count).toBe(0);
  });

  it("NEUTRAL-owned castles do not produce", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "NEUTRAL", 5, true),
      makeProvince(10, 0, "TAKEDA", 2, true),
    ];
    const after = produce(buildState(2, provinces));
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(5);
    expect(after.provinces.get(tileId(10, 0))?.count).toBe(3);
  });

  it("castles owned by a defeated faction do not produce", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 4, true),
      makeProvince(10, 0, "TAKEDA", 4, true),
    ];
    const before = buildState(2, provinces, {
      defeated: new Set<FactionId>(["TAKEDA"]),
    });
    const after = produce(before);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(5);
    expect(after.provinces.get(tileId(10, 0))?.count).toBe(4);
  });

  it("returns a new state on emission tick (does not mutate input)", () => {
    const before = buildState(2, fourCastles);
    const beforeCounts = Array.from(before.provinces.values()).map(
      (p) => p.count,
    );
    const after = produce(before);
    expect(after).not.toBe(before);
    expect(after.provinces).not.toBe(before.provinces);
    const beforeCountsAfter = Array.from(before.provinces.values()).map(
      (p) => p.count,
    );
    expect(beforeCountsAfter).toEqual(beforeCounts);
  });

  it("returns the same state reference on no-op ticks", () => {
    const before = buildState(1, fourCastles);
    expect(produce(before)).toBe(before);
  });

  it("returns the same state reference when no castle is eligible", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "NEUTRAL", 5, true),
      makeProvince(1, 0, "TOKUGAWA", 2, false),
    ];
    const before = buildState(2, provinces);
    expect(produce(before)).toBe(before);
  });
});
