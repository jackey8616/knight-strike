import { describe, expect, it } from "vitest";
import { resolveAdjacentCombat } from "./combat";
import {
  advanceMarching,
  cancelMarchingStack,
  dispatch,
  findPath,
} from "./movement";
import { tileId } from "./state";
import { AI_IDLE } from "./types";
import type {
  AiMode,
  FactionId,
  GameState,
  MarchingStack,
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
  isCastle = false,
): Province {
  return { id: tileId(x, y), x, y, owner, count, isCastle };
}

type BuildOpts = {
  readonly provinces: readonly Province[];
  readonly marchingStacks?: readonly MarchingStack[];
  readonly tick?: number;
  readonly nextMarchingId?: number;
};

function buildState(opts: BuildOpts): GameState {
  const map = new Map<TileId, Province>();
  for (const p of opts.provinces) map.set(p.id, p);
  return {
    boardSize: 11,
    tick: opts.tick ?? 1,
    provinces: map,
    marchingStacks: opts.marchingStacks ?? [],
    engagements: new Map(),
    aiConfig: idleAi,
    defeated: new Set<FactionId>(),
    rngSeed: 1,
    nextMarchingId: opts.nextMarchingId ?? 1,
  };
}

describe("findPath", () => {
  it("from === to returns null (degenerate)", () => {
    const state = buildState({
      provinces: [makeProvince(0, 0, "TOKUGAWA", 3)],
    });
    expect(findPath(state, tileId(0, 0), tileId(0, 0), "TOKUGAWA")).toBeNull();
  });

  it("adjacent enemy target: 2-tile path", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TAKEDA", 3),
      ],
    });
    const path = findPath(state, tileId(0, 0), tileId(1, 0), "TOKUGAWA");
    expect(path).toEqual([tileId(0, 0), tileId(1, 0)]);
  });

  it("path through own + neutral-empty intermediates to enemy target", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(3, 0, "TAKEDA", 3),
      ],
    });
    const path = findPath(state, tileId(0, 0), tileId(3, 0), "TOKUGAWA");
    expect(path).toEqual([
      tileId(0, 0),
      tileId(1, 0),
      tileId(2, 0),
      tileId(3, 0),
    ]);
  });

  it("enemy garrison blocks intermediates → forces detour or no-path", () => {
    // Direct row blocked by TAKEDA garrison at (1,0); only path is around via (0,1)/(1,1)/(2,1).
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TAKEDA", 3),
        makeProvince(2, 0, "ODA", 3),
        makeProvince(0, 1, "TOKUGAWA", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
        makeProvince(2, 1, "TOKUGAWA", 0),
      ],
    });
    const path = findPath(state, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    if (path === null) return;
    // BFS finds the 4-step detour via (0,1) → (1,1) → (2,1) → (2,0).
    expect(path[0]).toBe(tileId(0, 0));
    expect(path[path.length - 1]).toBe(tileId(2, 0));
    // Path must not pass through the garrisoned blocker.
    expect(path.includes(tileId(1, 0))).toBe(false);
  });

  it("returns null when target is fully cut off", () => {
    // (1,0) and (0,1) both garrisoned enemies → (0,0) is fully isolated from (2,2).
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TAKEDA", 3),
        makeProvince(0, 1, "TAKEDA", 3),
        makeProvince(2, 2, "TAKEDA", 3),
      ],
    });
    expect(findPath(state, tileId(0, 0), tileId(2, 2), "TOKUGAWA")).toBeNull();
  });

  it("source not owned by faction → null", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TAKEDA", 3),
        makeProvince(1, 0, "TAKEDA", 0),
      ],
    });
    expect(findPath(state, tileId(0, 0), tileId(1, 0), "TOKUGAWA")).toBeNull();
  });

  it("target or source missing from board → null", () => {
    const state = buildState({
      provinces: [makeProvince(0, 0, "TOKUGAWA", 3)],
    });
    expect(findPath(state, tileId(0, 0), tileId(5, 5), "TOKUGAWA")).toBeNull();
    expect(findPath(state, tileId(5, 5), tileId(0, 0), "TOKUGAWA")).toBeNull();
  });

  it("target tile is exempt from passable: enemy garrison target allowed at adjacent", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TAKEDA", 10), // enemy garrison
      ],
    });
    const path = findPath(state, tileId(0, 0), tileId(1, 0), "TOKUGAWA");
    expect(path).toEqual([tileId(0, 0), tileId(1, 0)]);
  });

  it("[AC-36] BFS finds non-diagonal path from (5,5) to (6,6) — exactly 2 hops via a cardinal", () => {
    // §3.8 formalisation regression: 4-conn adjacency means there is no 1-hop
    // diagonal move; the path from (5,5) to (6,6) must transit one of the
    // cardinal neighbours (6,5) or (5,6), giving a length of 3 (start + 1 step
    // + terminus). Board left fully neutral-empty so BFS is unconstrained.
    const provinces: Province[] = [makeProvince(5, 5, "TOKUGAWA", 3)];
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 11; x++) {
        if (x === 5 && y === 5) continue;
        provinces.push(makeProvince(x, y, "NEUTRAL", 0));
      }
    }
    const state = buildState({ provinces });
    const path = findPath(state, tileId(5, 5), tileId(6, 6), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path).toHaveLength(3);
    expect(path?.[0]).toBe(tileId(5, 5));
    expect(path?.[2]).toBe(tileId(6, 6));
    const mid = path?.[1];
    expect(mid === tileId(6, 5) || mid === tileId(5, 6)).toBe(true);
  });
});

describe("dispatch", () => {
  it("[AC-16] castle 100% leaves 1 behind: count=10 → source 1, stack 9", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 10, true),
        makeProvince(1, 0, "TOKUGAWA", 0),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 1.0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.provinces.get(tileId(0, 0))?.count).toBe(1);
    expect(res.stack.count).toBe(9);
    expect(res.stack.faction).toBe("TOKUGAWA");
    expect(res.stack.idx).toBe(0);
    expect(res.stack.path[0]).toBe(tileId(0, 0));
  });

  it("[AC-16] castle count=1 cannot dispatch (would violate reserve)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 1, true),
        makeProvince(1, 0, "TOKUGAWA", 0),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 1.0,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("castle-min-1");
  });

  it("non-castle count=1 with ratio 1.0 sends all (no reserve)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 1),
        makeProvince(1, 0, "TOKUGAWA", 0),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 1.0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.provinces.get(tileId(0, 0))?.count).toBe(0);
    expect(res.stack.count).toBe(1);
  });

  it("ratio 25% on count=10 sends 2 (floor)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 10),
        makeProvince(1, 0, "TOKUGAWA", 0),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 0.25,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.stack.count).toBe(2);
    expect(res.state.provinces.get(tileId(0, 0))?.count).toBe(8);
  });

  it("ratio 25% on tiny count still sends at least 1", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 2),
        makeProvince(1, 0, "TOKUGAWA", 0),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 0.25,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.stack.count).toBe(1);
  });

  it("rejects NEUTRAL source", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "NEUTRAL", 3),
        makeProvince(1, 0, "TOKUGAWA", 0),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 1.0,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("wrong-owner");
  });

  it("rejects count=0 source", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 0),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 1.0,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no-count");
  });

  it("rejects when no path exists", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5),
        makeProvince(1, 0, "TAKEDA", 5),
        makeProvince(0, 1, "TAKEDA", 5),
        makeProvince(2, 2, "TAKEDA", 5),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(2, 2),
      ratio: 1.0,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no-path");
  });

  it("dispatch fills MarchingStack fields per PRD §3.5.3", () => {
    const state = buildState({
      tick: 7,
      nextMarchingId: 42,
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TAKEDA", 3),
      ],
    });
    const res = dispatch(state, {
      from: tileId(0, 0),
      to: tileId(2, 0),
      ratio: 0.5,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.stack.id).toBe("mstack:42");
    expect(res.stack.dispatchedAtTick).toBe(7);
    expect(res.stack.idx).toBe(0);
    expect(res.state.nextMarchingId).toBe(43);
    expect(res.state.marchingStacks).toHaveLength(1);
  });
});

describe("advanceMarching: solo stack movement", () => {
  it("advances idx by 1 per tick along passable path", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0), tileId(3, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TOKUGAWA", 0),
        makeProvince(3, 0, "TAKEDA", 3),
      ],
      marchingStacks: [stack],
    });

    const after1 = advanceMarching(state);
    expect(after1.marchingStacks).toHaveLength(1);
    expect(after1.marchingStacks[0]?.idx).toBe(1);

    const after2 = advanceMarching(after1);
    expect(after2.marchingStacks[0]?.idx).toBe(2);
  });

  it("arrival at empty own tile (terminus) merges into garrison count", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 2),
      ],
      marchingStacks: [stack],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(0);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(6);
    expect(after.provinces.get(tileId(1, 0))?.owner).toBe("TOKUGAWA");
  });

  it("arrival at empty neutral tile (terminus) claims ownership", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(0);
    const tile = after.provinces.get(tileId(1, 0));
    expect(tile?.owner).toBe("TOKUGAWA");
    expect(tile?.count).toBe(3);
  });

  it("arrival at enemy garrison (terminus): one-shot mutual −1 (v1.1)", () => {
    // PRD §3.5.4 #5 (v1.1): marching vs garrison runs §3.6 engagementTicks = 1
    // — both sides lose 1. 5 TOKUGAWA marching arrives at 5 TAKEDA garrison →
    // TOKUGAWA surv 4, TAKEDA surv 4. Defender holds the tile (ties go to
    // garrison since attacker can't co-occupy).
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 5,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TAKEDA", 5),
      ],
      marchingStacks: [stack],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(0);
    const tile = after.provinces.get(tileId(1, 0));
    expect(tile?.owner).toBe("TAKEDA");
    expect(tile?.count).toBe(4);
  });

  it("marching wins terminus against weaker enemy garrison (v1.1: 1-count defender wiped)", () => {
    // 10 TOKUGAWA marching arrives at 1 TAKEDA garrison. Both lose 1
    // (§3.5.4 #5 one-shot). Defender → 0; marching → 9. Attacker takes the
    // tile with the survivors.
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 10,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TAKEDA", 1),
      ],
      marchingStacks: [stack],
    });

    const after = advanceMarching(state);
    const tile = after.provinces.get(tileId(1, 0));
    expect(tile?.owner).toBe("TOKUGAWA");
    expect(tile?.count).toBe(9);
  });

  it("non-terminus pass-through own garrison does not merge", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 4),
        makeProvince(2, 0, "TAKEDA", 0),
      ],
      marchingStacks: [stack],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(1);
    expect(after.marchingStacks[0]?.count).toBe(3);
    expect(after.marchingStacks[0]?.idx).toBe(1);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(4);
  });

  it("[AC-18] path cut: marching idx stalls; adjacent garrison combat fires next tick", () => {
    // TOKUGAWA garrison at (1,0) count 5 (Knight, power 20).
    // Marching stack at idx 1 (sitting at (1,0)) wants to advance to (2,0).
    // (2,0) is suddenly TAKEDA count 3 → non-passable, non-terminus → stall.
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 5,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0), tileId(3, 0)],
      idx: 1,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 5),
        makeProvince(2, 0, "TAKEDA", 3),
        makeProvince(3, 0, "TAKEDA", 5, true),
      ],
      marchingStacks: [stack],
    });

    const moved = advanceMarching(state);
    // Stalled: idx unchanged, stack still alive.
    expect(moved.marchingStacks).toHaveLength(1);
    expect(moved.marchingStacks[0]?.idx).toBe(1);
    expect(moved.marchingStacks[0]?.id).toBe("mstack:1");

    // PRD §3.5.4 #6 follow-up: §3.6 combat fires from (1,0) garrison vs (2,0) blocker.
    const combat = resolveAdjacentCombat(moved);
    expect(combat.pairs.length).toBeGreaterThanOrEqual(1);
    const pair = combat.pairs.find(
      (p) =>
        (p.a === tileId(1, 0) && p.b === tileId(2, 0)) ||
        (p.a === tileId(2, 0) && p.b === tileId(1, 0)),
    );
    expect(pair).toBeDefined();
    // PRD §3.6 v1.1: first combat tick of a new pair (engagementTicks 0) deals
    // no damage; the blocker stays at 3 this tick. The engagement counter
    // advances to 1 so subsequent ticks ramp.
    expect(combat.state.provinces.get(tileId(2, 0))?.count).toBe(3);
    expect(pair?.damage).toBe(0);
    expect(pair?.engagementTicks).toBe(0);
  });

  it("stalled stack remains stalled while block persists, advances after block clears", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const blocked = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TAKEDA", 3),
        makeProvince(2, 0, "TAKEDA", 5),
      ],
      marchingStacks: [stack],
    });

    const stalled1 = advanceMarching(blocked);
    expect(stalled1.marchingStacks[0]?.idx).toBe(0);

    const stalled2 = advanceMarching(stalled1);
    expect(stalled2.marchingStacks[0]?.idx).toBe(0);

    // Now clear the block (simulate combat result) and re-advance.
    const cleared: GameState = {
      ...stalled2,
      provinces: new Map(stalled2.provinces).set(tileId(1, 0), {
        ...(stalled2.provinces.get(tileId(1, 0)) as Province),
        owner: "TOKUGAWA",
        count: 0,
      }),
    };
    const moved = advanceMarching(cleared);
    expect(moved.marchingStacks[0]?.idx).toBe(1);
  });
});

describe("advanceMarching: same-faction merge (AC-20)", () => {
  it("[AC-20] two same-faction stacks merge at shared tile: shorter remaining path wins", () => {
    // Both at (1,0) after this tick. A has 3 remaining, B has 1 remaining → B's path wins.
    const stackA: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 4,
      path: [
        tileId(0, 0),
        tileId(1, 0),
        tileId(2, 0),
        tileId(3, 0),
        tileId(4, 0),
      ],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const stackB: MarchingStack = {
      id: "mstack:2",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(1, 1), tileId(1, 0), tileId(1, -1)],
      idx: 0,
      dispatchedAtTick: 2,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TOKUGAWA", 0),
        makeProvince(3, 0, "TOKUGAWA", 0),
        makeProvince(4, 0, "TAKEDA", 3),
        makeProvince(1, 1, "TOKUGAWA", 0),
        makeProvince(1, -1, "TAKEDA", 3),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(1);
    const merged = after.marchingStacks[0] as MarchingStack;
    expect(merged.faction).toBe("TOKUGAWA");
    expect(merged.count).toBe(7);
    // PRD §3.5.4 #2: fewest remaining wins → B's path adopted.
    expect(merged.path).toEqual(stackB.path);
    expect(merged.idx).toBe(1);
  });

  it("[AC-20] tiebreak by earlier dispatchedAtTick when remaining ties", () => {
    // Both arrive at (1,0) with remaining=1. A dispatched at tick 1, B at tick 2 → A wins.
    const stackA: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 2,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const stackB: MarchingStack = {
      id: "mstack:2",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(1, 1), tileId(1, 0), tileId(1, -1)],
      idx: 0,
      dispatchedAtTick: 2,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TAKEDA", 3),
        makeProvince(1, 1, "TOKUGAWA", 0),
        makeProvince(1, -1, "TAKEDA", 3),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(1);
    const merged = after.marchingStacks[0] as MarchingStack;
    expect(merged.count).toBe(5);
    expect(merged.path).toEqual(stackA.path);
    expect(merged.dispatchedAtTick).toBe(1);
  });

  it("[AC-20] tiebreak by id lex when dispatchedAtTick also ties", () => {
    const stackA: MarchingStack = {
      id: "mstack:a",
      faction: "TOKUGAWA",
      count: 2,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 5,
    };
    const stackB: MarchingStack = {
      id: "mstack:b",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(1, 1), tileId(1, 0), tileId(1, -1)],
      idx: 0,
      dispatchedAtTick: 5,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TAKEDA", 3),
        makeProvince(1, 1, "TOKUGAWA", 0),
        makeProvince(1, -1, "TAKEDA", 3),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    const merged = after.marchingStacks[0] as MarchingStack;
    expect(merged.path).toEqual(stackA.path);
  });

  it("[AC-20] any terminus among merging stacks stops them all at this tile", () => {
    // A arrives at (1,0) which is non-terminus for A but is B's terminus.
    const stackA: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const stackB: MarchingStack = {
      id: "mstack:2",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(1, 1), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 2,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TAKEDA", 3),
        makeProvince(1, 1, "TOKUGAWA", 0),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(0);
    const tile = after.provinces.get(tileId(1, 0));
    expect(tile?.owner).toBe("TOKUGAWA");
    expect(tile?.count).toBe(7);
  });
});

describe("advanceMarching: head-on enemy collision (AC-17, AC-21)", () => {
  it("[AC-17] enemy marching stacks colliding mid-tile: one-shot mutual −1 (v1.1)", () => {
    // PRD §3.5.4 #4 (v1.1): head-on collisions are transient — engagementTicks
    // = 1 single resolution, both sides lose 1 (multi-way 3+ stacks linear
    // pile-on). 5 TOKUGAWA vs 5 TAKEDA crossing (5,5) → each survives at 4.
    const stackA: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 5,
      path: [tileId(4, 5), tileId(5, 5), tileId(6, 5)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const stackB: MarchingStack = {
      id: "mstack:2",
      faction: "TAKEDA",
      count: 5,
      path: [tileId(6, 5), tileId(5, 5), tileId(4, 5)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(4, 5, "TOKUGAWA", 0),
        makeProvince(5, 5, "NEUTRAL", 0),
        makeProvince(6, 5, "TAKEDA", 0),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    expect(after.marchingStacks).toHaveLength(2);
    const tokSurv = after.marchingStacks.find((s) => s.faction === "TOKUGAWA");
    const takSurv = after.marchingStacks.find((s) => s.faction === "TAKEDA");
    expect(tokSurv?.count).toBe(4);
    expect(takSurv?.count).toBe(4);
    // Pair is transient — not written to engagementMap.
    expect(after.engagements.size).toBe(0);
  });

  it("[AC-21] head-on non-terminus: survivors continue, tile unchanged", () => {
    const stackA: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 5,
      path: [tileId(4, 5), tileId(5, 5), tileId(6, 5)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const stackB: MarchingStack = {
      id: "mstack:2",
      faction: "TAKEDA",
      count: 5,
      path: [tileId(6, 5), tileId(5, 5), tileId(4, 5)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(4, 5, "TOKUGAWA", 0),
        makeProvince(5, 5, "NEUTRAL", 0),
        makeProvince(6, 5, "TAKEDA", 0),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    // Tile ownership unchanged.
    expect(after.provinces.get(tileId(5, 5))?.owner).toBe("NEUTRAL");
    expect(after.provinces.get(tileId(5, 5))?.count).toBe(0);
    // Both survivors advanced their idx and continue along their paths.
    const tokSurv = after.marchingStacks.find((s) => s.faction === "TOKUGAWA");
    const takSurv = after.marchingStacks.find((s) => s.faction === "TAKEDA");
    expect(tokSurv?.idx).toBe(1);
    expect(takSurv?.idx).toBe(1);
    expect(tokSurv?.path).toEqual(stackA.path);
    expect(takSurv?.path).toEqual(stackB.path);
  });

  it("head-on non-terminus pass-through: tile owner unchanged regardless of survivors", () => {
    // v1.1 head-on is one-shot −1 each, so 100 vs 100 leaves both at 99 and
    // both continue. The assertion below only cares about the §3.5.4 (b)
    // sub-scenario invariant: the collision tile keeps its prior owner.
    const stackA: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 100,
      path: [tileId(4, 5), tileId(5, 5), tileId(6, 5)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const stackB: MarchingStack = {
      id: "mstack:2",
      faction: "TAKEDA",
      count: 100,
      path: [tileId(6, 5), tileId(5, 5), tileId(4, 5)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(4, 5, "TOKUGAWA", 0),
        makeProvince(5, 5, "NEUTRAL", 0),
        makeProvince(6, 5, "TAKEDA", 0),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    // v1.1 each side loses 1 → 99 each, both pass through, tile owner stays NEUTRAL.
    expect(after.provinces.get(tileId(5, 5))?.owner).toBe("NEUTRAL");
  });

  it("head-on mixed terminus (sub-scenario c): terminus survivor claims tile, pass-through survivor continues", () => {
    // TOKUGAWA path terminus at (5,5). TAKEDA path passes through (5,5) en route to (4,5).
    // v1.1 head-on one-shot −1 each → both survive at 4.
    // TOKUGAWA terminus → claims (5,5). TAKEDA pass-through → continues to (4,5).
    const stackA: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 5,
      path: [tileId(4, 5), tileId(5, 5)], // (5,5) is terminus
      idx: 0,
      dispatchedAtTick: 1,
    };
    const stackB: MarchingStack = {
      id: "mstack:2",
      faction: "TAKEDA",
      count: 5,
      path: [tileId(6, 5), tileId(5, 5), tileId(4, 5)], // (5,5) is intermediate
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(4, 5, "TOKUGAWA", 0),
        makeProvince(5, 5, "NEUTRAL", 0),
        makeProvince(6, 5, "TAKEDA", 0),
      ],
      marchingStacks: [stackA, stackB],
    });

    const after = advanceMarching(state);
    // TOKUGAWA claims (5,5) with surv count 4.
    expect(after.provinces.get(tileId(5, 5))?.owner).toBe("TOKUGAWA");
    expect(after.provinces.get(tileId(5, 5))?.count).toBe(4);
    // TAKEDA continues as marching stack.
    expect(after.marchingStacks).toHaveLength(1);
    const tak = after.marchingStacks[0];
    expect(tak?.faction).toBe("TAKEDA");
    expect(tak?.count).toBe(4);
    expect(tak?.idx).toBe(1);
  });
});

describe("advanceMarching: purity", () => {
  it("does not mutate the input state", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const before = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(1, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });
    const beforeStackCount = before.marchingStacks.length;
    const beforeTileOwner = before.provinces.get(tileId(1, 0))?.owner;

    const after = advanceMarching(before);
    expect(after).not.toBe(before);
    expect(before.marchingStacks.length).toBe(beforeStackCount);
    expect(before.provinces.get(tileId(1, 0))?.owner).toBe(beforeTileOwner);
  });

  it("no marching stacks → returns same state reference", () => {
    const before = buildState({
      provinces: [makeProvince(0, 0, "TOKUGAWA", 3)],
    });
    expect(advanceMarching(before)).toBe(before);
  });
});

describe("walk-through claim (PRD §3.5.4 v1.1 amendment)", () => {
  it("intermediate NEUTRAL empty flips owner mid-march, count stays 0", () => {
    // Path (0,0) own → (1,0) NEUTRAL 0 → (2,0) NEUTRAL 0 (terminus).
    // After advance: stack at idx 1 on (1,0), (1,0) flipped to TOKUGAWA count 0.
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const before = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "NEUTRAL", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });

    const after = advanceMarching(before);
    const intermediate = after.provinces.get(tileId(1, 0));
    expect(intermediate?.owner).toBe("TOKUGAWA");
    expect(intermediate?.count).toBe(0);
    // Stack still in flight at idx 1, count unchanged.
    expect(after.marchingStacks).toHaveLength(1);
    expect(after.marchingStacks[0]?.idx).toBe(1);
    expect(after.marchingStacks[0]?.count).toBe(3);
  });

  it("intermediate enemy-empty tile also flips and is passable", () => {
    // Path through (1,0) which is enemy with count=0. Pre-v1.1 BFS would have
    // refused to plan this path; post-amendment it's passable + claimed.
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const before = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TAKEDA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });

    const after = advanceMarching(before);
    const intermediate = after.provinces.get(tileId(1, 0));
    expect(intermediate?.owner).toBe("TOKUGAWA");
    expect(intermediate?.count).toBe(0);
    expect(after.marchingStacks[0]?.idx).toBe(1);
  });

  it("findPath routes through enemy-empty per v1.1 §3.5.2 amendment", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TAKEDA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(3, 0, "TAKEDA", 3),
      ],
    });
    const path = findPath(state, tileId(0, 0), tileId(3, 0), "TOKUGAWA");
    expect(path).toEqual([
      tileId(0, 0),
      tileId(1, 0),
      tileId(2, 0),
      tileId(3, 0),
    ]);
  });

  it("intermediate own tile still passes through without changes", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const before = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TOKUGAWA", 2),
        makeProvince(2, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });
    const after = advanceMarching(before);
    // Garrison untouched by pass-through.
    expect(after.provinces.get(tileId(1, 0))?.owner).toBe("TOKUGAWA");
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(2);
  });
});

describe("cancelMarchingStack (PRD §3.5.4 v1.1 amendment)", () => {
  it("drops onto own tile → count joins the garrison", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 1,
      dispatchedAtTick: 1,
    };
    const before = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TOKUGAWA", 2),
        makeProvince(2, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });
    const out = cancelMarchingStack(before, "mstack:1");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.marchingStacks).toHaveLength(0);
    expect(out.state.provinces.get(tileId(1, 0))?.count).toBe(6);
    expect(out.state.provinces.get(tileId(1, 0))?.owner).toBe("TOKUGAWA");
  });

  it("drops onto empty NEUTRAL tile → flips owner + sets count", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 1,
      dispatchedAtTick: 1,
    };
    const before = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "NEUTRAL", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });
    const out = cancelMarchingStack(before, "mstack:1");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.marchingStacks).toHaveLength(0);
    expect(out.state.provinces.get(tileId(1, 0))?.owner).toBe("TOKUGAWA");
    expect(out.state.provinces.get(tileId(1, 0))?.count).toBe(4);
  });

  it("unknown stack id → not-found, state untouched", () => {
    const before = buildState({
      provinces: [makeProvince(0, 0, "TOKUGAWA", 3)],
    });
    const out = cancelMarchingStack(before, "mstack:does-not-exist");
    expect(out.ok).toBe(false);
    expect(out.state).toBe(before);
  });

  it("purity: returns a new state, leaves input untouched", () => {
    const stack: MarchingStack = {
      id: "mstack:1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const before = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "NEUTRAL", 0),
      ],
      marchingStacks: [stack],
    });
    const beforeCount = before.marchingStacks.length;
    const out = cancelMarchingStack(before, "mstack:1");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state).not.toBe(before);
    expect(before.marchingStacks.length).toBe(beforeCount);
    expect(before.provinces.get(tileId(0, 0))?.count).toBe(3);
  });
});
