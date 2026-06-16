import { describe, expect, it } from "vitest";
import { produce } from "./production";
import { tileId } from "./state";
import { AI_IDLE } from "./types";
import type {
  AiMode,
  FactionId,
  GameState,
  Province,
  TileId,
} from "./types";

const idleAi: Readonly<Record<FactionId, AiMode>> = {
  TOKUGAWA: AI_IDLE,
  TAKEDA: AI_IDLE,
  ODA: AI_IDLE,
  UESUGI: AI_IDLE,
  NEUTRAL: AI_IDLE,
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

describe("produce (PRD §3.3 v1.1 amendment)", () => {
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

  it("[AC-03 v1.1] tick 3 produces nothing (odd ticks never emit)", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 4, false),
    ];
    const after = produce(buildState(3, provinces));
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(4);
  });

  it("[AC-03 v1.1] castles never produce, even on emission ticks", () => {
    const after = produce(buildState(2, fourCastles));
    for (const province of after.provinces.values()) {
      expect(province.isCastle).toBe(true);
      expect(province.count).toBe(3);
    }
  });

  it("[AC-03 v1.1] non-castle garrisoned tiles +1 on every even tick", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 4, false),
      makeProvince(2, 0, "TAKEDA", 7, false),
    ];
    const after = produce(buildState(2, provinces));
    // Castle untouched.
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(3);
    // Field garrisons +1.
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(5);
    expect(after.provinces.get(tileId(2, 0))?.count).toBe(8);
  });

  it("[AC-03 v1.1] empty (count=0) tiles don't produce — no seed from nothing", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 0, false), // empty own
      makeProvince(2, 0, "NEUTRAL", 0, false), // empty neutral
    ];
    const after = produce(buildState(2, provinces));
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(0);
    expect(after.provinces.get(tileId(2, 0))?.count).toBe(0);
  });

  it("[AC-03 v1.1] NEUTRAL bandit tiles never produce", () => {
    const provinces: readonly Province[] = [
      makeProvince(5, 5, "NEUTRAL", 3, false),
      makeProvince(0, 0, "TOKUGAWA", 4, false),
    ];
    const after = produce(buildState(2, provinces));
    expect(after.provinces.get(tileId(5, 5))?.count).toBe(3);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(5);
  });

  it("[AC-03 v1.1] 10 emission ticks ⇒ non-castle garrison +10", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 4, false),
    ];
    let state = buildState(1, provinces);
    for (let t = 2; t <= 20; t += 2) {
      state = { ...state, tick: t };
      state = produce(state);
    }
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(4 + 10);
    // Castle stays static.
    expect(state.provinces.get(tileId(0, 0))?.count).toBe(3);
  });

  it("[AC-03 v1.1] tiles owned by a defeated faction don't produce", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 4, false),
      makeProvince(10, 0, "TAKEDA", 4, false),
    ];
    const before = buildState(2, provinces, {
      defeated: new Set<FactionId>(["TAKEDA"]),
    });
    const after = produce(before);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(5);
    expect(after.provinces.get(tileId(10, 0))?.count).toBe(4);
  });

  it("returns a new state on emission tick (does not mutate input)", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 2, false),
    ];
    const before = buildState(2, provinces);
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

  it("returns the same state reference when no producer is eligible", () => {
    // Only castles + NEUTRAL — nothing to grow.
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "NEUTRAL", 5, true),
      makeProvince(1, 0, "TOKUGAWA", 0, true),
    ];
    const before = buildState(2, provinces);
    expect(produce(before)).toBe(before);
  });
});
