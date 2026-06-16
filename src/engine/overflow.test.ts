import { describe, expect, it } from "vitest";
import {
  applyCastleOverflow,
  castleOverflow,
  CASTLE_OVERFLOW_THRESHOLD,
} from "./overflow";
import { tileId } from "./state";
import type {
  AiMode,
  FactionId,
  GameState,
  MarchingStack,
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
  isCastle = false,
): Province {
  return { id: tileId(x, y), x, y, owner, count, isCastle };
}

type BuildOpts = {
  readonly provinces: readonly Province[];
  readonly tick?: number;
  readonly rngSeed?: number;
  readonly nextMarchingId?: number;
  readonly defeated?: ReadonlySet<FactionId>;
};

function buildState(opts: BuildOpts): GameState {
  const map = new Map<TileId, Province>();
  for (const p of opts.provinces) map.set(p.id, p);
  return {
    boardSize: 11,
    tick: opts.tick ?? 1,
    provinces: map,
    marchingStacks: [],
    stalemates: new Map(),
    aiConfig: idleAi,
    defeated: opts.defeated ?? new Set<FactionId>(),
    rngSeed: opts.rngSeed ?? 42,
    nextMarchingId: opts.nextMarchingId ?? 1,
  };
}

describe("CASTLE_OVERFLOW_THRESHOLD constant", () => {
  it("is 30 — aligned with PRD §3.5.5 King tier entrance", () => {
    expect(CASTLE_OVERFLOW_THRESHOLD).toBe(30);
  });
});

describe("[AC-33] castle overflow triggers at count > 30 with adjacent frontline target", () => {
  it("count=32 with own frontline at (1,0): emits mstack count=2 to (1,0), castle count → 30", () => {
    // Castle (0,0) count=32 (King). (1,0) own count=1 — frontline because (2,0)
    // is a NEUTRAL empty (non-own). overflow = min(2, 32-30) = 2.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 32, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
      nextMarchingId: 7,
    });
    const out = applyCastleOverflow(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(stack.count).toBe(2);
    expect(stack.path[0]).toBe(tileId(0, 0));
    expect(stack.path[stack.path.length - 1]).toBe(tileId(1, 0));
    expect(stack.idx).toBe(0);
    expect(stack.dispatchedAtTick).toBe(1);
    expect(stack.id).toBe("mstack:7");
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(30);
    expect(out.nextMarchingId).toBe(8);
  });

  it("count=30 (not > 30) → no overflow, state unchanged", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 30, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
    });
    const out = applyCastleOverflow(state);
    expect(out).toBe(state);
    expect(out.marchingStacks.length).toBe(0);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(30);
  });

  it("count=31 caps overflow at min(2, 1) = 1", () => {
    // Boundary check: castle just over the threshold ships 1 unit (the floor of
    // the min clamp), proving the formula is min(2, count-30) rather than a
    // flat 2.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 31, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
    });
    const out = applyCastleOverflow(state);
    expect(out.marchingStacks.length).toBe(1);
    expect((out.marchingStacks[0] as MarchingStack).count).toBe(1);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(30);
  });
});

describe("castleOverflow target selection", () => {
  it("returns planner data shape (no state mutation)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 32, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
      nextMarchingId: 5,
    });
    const before = state.marchingStacks.length;
    const result = castleOverflow(state);
    expect(state.marchingStacks.length).toBe(before);
    expect(result.newMarchingStacks.length).toBe(1);
    expect(result.castleCountChanges.get(tileId(0, 0))).toBe(30);
  });

  it("skips defeated factions and NEUTRAL castles", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 32, true),
        makeProvince(10, 10, "NEUTRAL", 50, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
      defeated: new Set<FactionId>(["TOKUGAWA"]),
    });
    const out = applyCastleOverflow(state);
    expect(out.marchingStacks.length).toBe(0);
  });

  it("no frontline → skip overflow this tick", () => {
    // Castle owns the whole isolated island; no own tile has a non-own neighbour.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 32, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
      ],
      tick: 1,
    });
    const out = applyCastleOverflow(state);
    expect(out.marchingStacks.length).toBe(0);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(32);
  });

  it("nearest frontline wins when two own tiles qualify at different distances", () => {
    // (1,0) own count=1 — frontline via NEUTRAL at (2,0). Distance 1.
    // (0,2) own count=1 — frontline via NEUTRAL at (0,3). Distance 2.
    // Closer one must win.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 32, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
        makeProvince(0, 1, "TOKUGAWA", 0, false),
        makeProvince(0, 2, "TOKUGAWA", 1, false),
        makeProvince(0, 3, "NEUTRAL", 0, false),
      ],
      tick: 1,
    });
    const out = applyCastleOverflow(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.path[stack.path.length - 1]).toBe(tileId(1, 0));
  });

  it("BFS routes through own corridor (passable rule §3.5.2)", () => {
    // Castle (0,0) needs to reach own frontline (3,0) via corridor (1,0)(2,0).
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 32, true),
        makeProvince(1, 0, "TOKUGAWA", 0, false),
        makeProvince(2, 0, "TOKUGAWA", 0, false),
        makeProvince(3, 0, "TOKUGAWA", 1, false),
        makeProvince(4, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
    });
    const out = applyCastleOverflow(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.path).toEqual([tileId(0, 0), tileId(1, 0), tileId(2, 0), tileId(3, 0)]);
  });
});

describe("castleOverflow purity", () => {
  it("does not mutate input state", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 32, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
    });
    const snapshot = (state.provinces.get(tileId(0, 0)) as Province).count;
    applyCastleOverflow(state);
    expect((state.provinces.get(tileId(0, 0)) as Province).count).toBe(snapshot);
    expect(state.marchingStacks.length).toBe(0);
  });
});
