import { describe, expect, it } from "vitest";
import { produce, PRODUCTION_CAP } from "./production";
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
    engagements: new Map(),
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

  it("[AC-03 v1.1] castles with garrisons also self-replicate (+1/tick)", () => {
    // PRD §3.3 v1.1 r3: garrisoned troops grow regardless of tile type. The
    // castle building doesn't auto-mint, but the soldiers stationed there do.
    const after = produce(buildState(1, fourCastles));
    for (const province of after.provinces.values()) {
      expect(province.isCastle).toBe(true);
      expect(province.count).toBe(4);
    }
  });

  it("[AC-03 v1.1] both castle + field garrison grow +1 every tick", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 4, false),
      makeProvince(2, 0, "TAKEDA", 7, false),
    ];
    // tick 1: every garrisoned non-NEUTRAL tile +1.
    const afterTick1 = produce(buildState(1, provinces));
    expect(afterTick1.provinces.get(tileId(0, 0))?.count).toBe(4);
    expect(afterTick1.provinces.get(tileId(1, 0))?.count).toBe(5);
    expect(afterTick1.provinces.get(tileId(2, 0))?.count).toBe(8);

    // tick 2 likewise.
    const afterTick2 = produce(buildState(2, provinces));
    expect(afterTick2.provinces.get(tileId(0, 0))?.count).toBe(4);
    expect(afterTick2.provinces.get(tileId(1, 0))?.count).toBe(5);
    expect(afterTick2.provinces.get(tileId(2, 0))?.count).toBe(8);
  });

  it("[AC-03 v1.1] empty castle still does not produce (no troops to replicate)", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 0, true),
    ];
    const before = buildState(1, provinces);
    expect(produce(before)).toBe(before);
  });

  it("[AC-03 v1.1] empty (count=0) tiles don't produce — no seed from nothing", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 0, false), // empty own
      makeProvince(2, 0, "NEUTRAL", 0, false), // empty neutral
    ];
    const after = produce(buildState(1, provinces));
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(0);
    expect(after.provinces.get(tileId(2, 0))?.count).toBe(0);
  });

  it("[AC-03 v1.1] NEUTRAL bandit tiles never produce", () => {
    const provinces: readonly Province[] = [
      makeProvince(5, 5, "NEUTRAL", 3, false),
      makeProvince(0, 0, "TOKUGAWA", 4, false),
    ];
    const after = produce(buildState(1, provinces));
    expect(after.provinces.get(tileId(5, 5))?.count).toBe(3);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(5);
  });

  it("[AC-03 v1.1] garrisoned tiles +1 every tick: 10 ticks ⇒ +10 each", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 4, false),
    ];
    let state = buildState(0, provinces);
    for (let t = 1; t <= 10; t++) {
      state = { ...state, tick: t };
      state = produce(state);
    }
    // Both castle (garrisoned) and field tile grow.
    expect(state.provinces.get(tileId(0, 0))?.count).toBe(3 + 10);
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(4 + 10);
  });

  it("[AC-03 v1.1] tiles owned by a defeated faction don't produce", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 4, false),
      makeProvince(10, 0, "TAKEDA", 4, false),
    ];
    const before = buildState(1, provinces, {
      defeated: new Set<FactionId>(["TAKEDA"]),
    });
    const after = produce(before);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(5);
    expect(after.provinces.get(tileId(10, 0))?.count).toBe(4);
  });

  it("[AC-03 v1.1] production cap: a tile at PRODUCTION_CAP-1 grows to cap exactly once", () => {
    // Use a lone field tile so we don't have to think about a castle growing
    // in parallel.
    const provinces: readonly Province[] = [
      makeProvince(1, 0, "TOKUGAWA", PRODUCTION_CAP - 1, false),
    ];
    let state = buildState(0, provinces);
    state = { ...state, tick: 1 };
    state = produce(state);
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(PRODUCTION_CAP);
    // Next tick: stays capped, doesn't overshoot.
    state = { ...state, tick: 2 };
    const before = state;
    state = produce(state);
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(PRODUCTION_CAP);
    // No producers eligible after the cap → produce returns the same ref.
    expect(state).toBe(before);
  });

  it("[AC-03 v1.1] cap does not retroactively clip tiles that exceed it via combat / dispatch", () => {
    // Dispatch arrival can push a tile above PRODUCTION_CAP. produce() leaves
    // it alone; only its own growth is gated by the cap. Lone tile to avoid
    // an unrelated castle producer below the cap.
    const provinces: readonly Province[] = [
      makeProvince(1, 0, "TOKUGAWA", PRODUCTION_CAP + 10, false),
    ];
    const before = buildState(1, provinces);
    const after = produce(before);
    expect(after).toBe(before);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(
      PRODUCTION_CAP + 10,
    );
  });

  it("returns a new state on emission tick (does not mutate input)", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(1, 0, "TOKUGAWA", 2, false),
    ];
    const before = buildState(1, provinces);
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

  it("returns the same state reference on tick 0", () => {
    const before = buildState(0, fourCastles);
    expect(produce(before)).toBe(before);
  });

  it("returns the same state reference when no producer is eligible", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "NEUTRAL", 5, true),
      makeProvince(1, 0, "TOKUGAWA", 0, true),
    ];
    const before = buildState(1, provinces);
    expect(produce(before)).toBe(before);
  });
});
