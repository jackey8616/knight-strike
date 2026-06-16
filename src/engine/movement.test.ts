import { describe, expect, it } from "vitest";
import {
  advanceMarching,
  cancelMarchingStack,
  dispatch,
  findPath,
} from "./movement";
import { tileId } from "./state";
import {
  AI_IDLE,
  type FactionId,
  type GameState,
  type MarchingStack,
  type Occupant,
  type Province,
} from "./types";

function emptyState(boardSize = 5): GameState {
  const provinces = new Map<string, Province>();
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const id = tileId(x, y);
      provinces.set(id, {
        id,
        x,
        y,
        isCastle: false,
        castleOwner: null,
        occupants: [],
        combatStartTick: null,
        lastClaimedFaction: null,
      });
    }
  }
  return {
    boardSize,
    tick: 0,
    provinces,
    marchingStacks: [],
    aiConfig: {
      TOKUGAWA: AI_IDLE,
      TAKEDA: AI_IDLE,
      ODA: AI_IDLE,
      UESUGI: AI_IDLE,
      NEUTRAL: AI_IDLE,
    },
    defeated: new Set<FactionId>(),
    rngSeed: 42,
    nextMarchingId: 1,
  };
}

function setOccupants(
  state: GameState,
  x: number,
  y: number,
  occupants: readonly Occupant[],
  opts: { isCastle?: boolean; castleOwner?: FactionId | null } = {},
): GameState {
  const id = tileId(x, y);
  const prov = state.provinces.get(id);
  if (prov === undefined) throw new Error(`no province at ${id}`);
  const next = new Map(state.provinces);
  next.set(id, {
    ...prov,
    occupants,
    isCastle: opts.isCastle ?? prov.isCastle,
    castleOwner: opts.castleOwner ?? prov.castleOwner,
  });
  return { ...state, provinces: next };
}

function occ(
  faction: FactionId,
  amount: number,
  arrivalTick = 0,
  isDefender = false,
): Occupant {
  return { faction, amount, arrivalTick, isDefender };
}

describe("findPath", () => {
  it("returns null when source has no occupant of the dispatching faction", () => {
    const state = emptyState();
    expect(findPath(state, tileId(0, 0), tileId(1, 0), "TOKUGAWA")).toBeNull();
  });

  it("finds straight-line path through empty intermediates", () => {
    const s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    const path = findPath(s, tileId(0, 0), tileId(3, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.length).toBe(4); // 0,0 → 1,0 → 2,0 → 3,0
    expect(path?.[0]).toBe(tileId(0, 0));
    expect(path?.[3]).toBe(tileId(3, 0));
  });

  it("[AC-V2-23] BFS treats contested tile as non-passable intermediate", () => {
    let s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [
      occ("TAKEDA", 3, 0, true),
      occ("ODA", 3, 0, false),
    ]);
    // Path 0,0 → 2,0 must go around (1,0) which is contested
    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.some((id) => id === tileId(1, 0))).toBe(false);
  });

  it("treats target tile passable even if contested", () => {
    let s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [
      occ("TAKEDA", 3, 0, true),
      occ("ODA", 3, 0, false),
    ]);
    const path = findPath(s, tileId(0, 0), tileId(1, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.[1]).toBe(tileId(1, 0));
  });

  it("treats own-faction single-occupant tiles as passable", () => {
    let s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [occ("TOKUGAWA", 5, 0, true)]);
    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.[1]).toBe(tileId(1, 0)); // direct route through friendly
  });

  it("treats hostile single-occupant tiles as walls", () => {
    let s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [occ("TAKEDA", 5, 0, true)]);
    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.some((id) => id === tileId(1, 0))).toBe(false);
  });

  it("[AC-V2-22] no hop limit: 0,0 → 4,4 path exists on a 5x5 empty board", () => {
    const s = setOccupants(emptyState(5), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    const path = findPath(s, tileId(0, 0), tileId(4, 4), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThanOrEqual(9); // manhattan = 8 hops + start = 9 tiles
  });
});

describe("dispatch", () => {
  it("rejects when source has no own occupant", () => {
    const s = emptyState();
    const r = dispatch(s, { from: tileId(0, 0), to: tileId(1, 0), ratio: 1.0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong-owner");
  });

  it("[AC-V2-15] castle reserve: 100% ratio leaves at least 1 behind", () => {
    let s = setOccupants(
      emptyState(),
      0,
      0,
      [occ("TOKUGAWA", 10, 0, true)],
      { isCastle: true, castleOwner: "TOKUGAWA" },
    );
    s = setOccupants(s, 1, 0, []); // empty destination
    const r = dispatch(s, {
      from: tileId(0, 0),
      to: tileId(1, 0),
      ratio: 1.0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const source = r.state.provinces.get(tileId(0, 0));
    const tok = source?.occupants.find((o) => o.faction === "TOKUGAWA");
    expect(tok?.amount).toBe(1); // 10 → kept 1
    expect(r.stack.count).toBe(9);
  });

  it("castle with occupant amount = 1 rejects dispatch", () => {
    let s = setOccupants(
      emptyState(),
      0,
      0,
      [occ("TOKUGAWA", 1, 0, true)],
      { isCastle: true, castleOwner: "TOKUGAWA" },
    );
    s = setOccupants(s, 1, 0, []);
    const r = dispatch(s, { from: tileId(0, 0), to: tileId(1, 0), ratio: 1.0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("castle-min-1");
  });

  it("non-castle 100% ratio dispatches everyone and removes the occupant", () => {
    let s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 5, 0, true)]);
    s = setOccupants(s, 1, 0, []);
    const r = dispatch(s, { from: tileId(0, 0), to: tileId(1, 0), ratio: 1.0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const source = r.state.provinces.get(tileId(0, 0));
    expect(source?.occupants).toHaveLength(0);
    expect(r.stack.count).toBe(5);
  });
});

describe("advanceMarching — basic arrivals", () => {
  function withStack(state: GameState, stack: MarchingStack): GameState {
    return { ...state, marchingStacks: [...state.marchingStacks, stack] };
  }

  it("single-faction terminus arrival on empty tile creates defender occupant", () => {
    const s0 = emptyState(3);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const s = withStack({ ...s0, tick: 1 }, stack);
    const out = advanceMarching(s);
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(1);
    expect(tile?.occupants[0]?.faction).toBe("TOKUGAWA");
    expect(tile?.occupants[0]?.amount).toBe(4);
    expect(tile?.occupants[0]?.isDefender).toBe(true);
    expect(tile?.occupants[0]?.arrivalTick).toBe(1);
    expect(out.marchingStacks).toHaveLength(0);
  });

  it("single-faction non-terminus on empty intermediate passes through", () => {
    const s0 = emptyState(3);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const s = withStack({ ...s0, tick: 1 }, stack);
    const out = advanceMarching(s);
    expect(out.marchingStacks).toHaveLength(1);
    expect(out.marchingStacks[0]?.idx).toBe(1);
    expect(out.provinces.get(tileId(1, 0))?.occupants).toHaveLength(0);
  });

  it("[AC-V2-30] walk-through claim: non-terminus pass-through sets lastClaimedFaction", () => {
    const s0 = emptyState(3);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const s = { ...s0, marchingStacks: [stack], tick: 1 };
    const out = advanceMarching(s);
    const passed = out.provinces.get(tileId(1, 0));
    // Tile stays empty but is claimed
    expect(passed?.occupants).toHaveLength(0);
    expect(passed?.lastClaimedFaction).toBe("TOKUGAWA");
  });

  it("[AC-V2-30] walk-through claim: terminus landing also stamps lastClaimedFaction", () => {
    const s0 = emptyState(3);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const s = { ...s0, marchingStacks: [stack], tick: 1 };
    const out = advanceMarching(s);
    expect(out.provinces.get(tileId(1, 0))?.lastClaimedFaction).toBe("TOKUGAWA");
  });

  it("[AC-V2-30] force-join into contested leaves lastClaimedFaction alone", () => {
    let s = emptyState(3);
    s = setOccupants(s, 1, 0, [
      occ("TAKEDA", 3, 0, true),
      occ("ODA", 3, 0, false),
    ]);
    // Pre-existing claim from TAKEDA
    const prov = s.provinces.get(tileId(1, 0));
    if (prov === undefined) throw new Error("no province");
    const next = new Map(s.provinces);
    next.set(tileId(1, 0), { ...prov, lastClaimedFaction: "TAKEDA" });
    s = { ...s, provinces: next };

    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    s = { ...s, marchingStacks: [stack], tick: 1 };
    const out = advanceMarching(s);
    // Tile is now contested with 3 occupants; lastClaimedFaction stays TAKEDA
    expect(out.provinces.get(tileId(1, 0))?.lastClaimedFaction).toBe("TAKEDA");
  });

  it("relaxed BFS passable: passes through enemy-empty intermediate (no hostile amount > 0)", () => {
    let s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    // Empty enemy-claimed tile (no occupants, just lastClaimedFaction)
    const id1 = tileId(1, 0);
    const prov = s.provinces.get(id1);
    if (prov === undefined) throw new Error("no province");
    const next = new Map(s.provinces);
    next.set(id1, { ...prov, lastClaimedFaction: "TAKEDA" });
    s = { ...s, provinces: next };

    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.[1]).toBe(id1); // walks through the enemy-claimed empty
  });

  it("[AC-V2-07] same-faction terminus merge: amount adds to existing occupant", () => {
    let s = emptyState(3);
    s = setOccupants(s, 1, 0, [occ("TOKUGAWA", 3, 0, true)]);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    s = withStack({ ...s, tick: 1 }, stack);
    const out = advanceMarching(s);
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(1);
    expect(tile?.occupants[0]?.amount).toBe(7);
    expect(tile?.occupants[0]?.arrivalTick).toBe(0); // existing arrivalTick preserved
    expect(tile?.occupants[0]?.isDefender).toBe(true);
  });

  it("non-terminus through own-faction tile passes through without merge", () => {
    let s = emptyState(4);
    s = setOccupants(s, 1, 0, [occ("TOKUGAWA", 5, 0, true)]);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    s = { ...s, marchingStacks: [stack], tick: 1 };
    const out = advanceMarching(s);
    // marching continues
    expect(out.marchingStacks).toHaveLength(1);
    expect(out.marchingStacks[0]?.idx).toBe(1);
    // existing TOKUGAWA tile amount unchanged
    expect(
      out.provinces
        .get(tileId(1, 0))
        ?.occupants.find((o) => o.faction === "TOKUGAWA")?.amount,
    ).toBe(5);
  });

  it("[AC-V2-16] force-join: marching arrives at contested tile, becomes occupant", () => {
    let s = emptyState(3);
    s = setOccupants(s, 1, 0, [
      occ("TAKEDA", 3, 0, true),
      occ("ODA", 3, 0, false),
    ]);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    s = { ...s, marchingStacks: [stack], tick: 1 };
    const out = advanceMarching(s);
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(3);
    const tok = tile?.occupants.find((o) => o.faction === "TOKUGAWA");
    expect(tok?.amount).toBe(4);
    expect(tok?.isDefender).toBe(false);
    expect(tok?.arrivalTick).toBe(1);
    expect(out.marchingStacks).toHaveLength(0); // path dropped
  });

  it("force-join same-faction reinforcement (path mid-tile contested with own faction)", () => {
    let s = emptyState(3);
    s = setOccupants(s, 1, 0, [
      occ("TOKUGAWA", 5, 0, true),
      occ("TAKEDA", 3, 0, false),
    ]);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 7,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    s = { ...s, marchingStacks: [stack], tick: 1 };
    const out = advanceMarching(s);
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(2);
    const tok = tile?.occupants.find((o) => o.faction === "TOKUGAWA");
    expect(tok?.amount).toBe(12); // 5 + 7 reinforcement
    expect(tok?.arrivalTick).toBe(0); // preserved
    expect(out.marchingStacks).toHaveLength(0); // path dropped
  });

  it("[AC-V2-18] same-faction multi-stack same-tick arrival merges count + path", () => {
    const s0 = emptyState(5);
    const stackA: MarchingStack = {
      id: "A",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0), tileId(3, 0)], // remaining after step: 2 (idx=1, len=4 → rem=2)
      idx: 0,
      dispatchedAtTick: 0,
    };
    const stackB: MarchingStack = {
      id: "B",
      faction: "TOKUGAWA",
      count: 2,
      path: [tileId(2, 1), tileId(1, 0)], // remaining after step: 0 (terminus)
      idx: 0,
      dispatchedAtTick: 1,
    };
    const s = { ...s0, marchingStacks: [stackA, stackB], tick: 2 };
    const out = advanceMarching(s);
    // B is terminus → merged arrival is terminus → tile gets occupant
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(1);
    expect(tile?.occupants[0]?.amount).toBe(5);
    expect(out.marchingStacks).toHaveLength(0);
  });

  it("multi-faction same-tick empty tile arrival → RNG picks defender", () => {
    const s0 = emptyState(3);
    const stackA: MarchingStack = {
      id: "A",
      faction: "TOKUGAWA",
      count: 5,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const stackB: MarchingStack = {
      id: "B",
      faction: "TAKEDA",
      count: 5,
      path: [tileId(2, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const s = {
      ...s0,
      marchingStacks: [stackA, stackB],
      tick: 1,
      rngSeed: 12345,
    };
    const out = advanceMarching(s);
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(2);
    const defenders = tile?.occupants.filter((o) => o.isDefender) ?? [];
    expect(defenders).toHaveLength(1);
    expect(["TOKUGAWA", "TAKEDA"]).toContain(defenders[0]?.faction);
  });
});

describe("cancelMarchingStack", () => {
  it("drops the stack back to its current tile", () => {
    let s = emptyState(3);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 1,
      dispatchedAtTick: 0,
    };
    s = { ...s, marchingStacks: [stack], tick: 5 };
    const r = cancelMarchingStack(s, "m1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tile = r.state.provinces.get(tileId(1, 0));
    expect(tile?.occupants[0]?.faction).toBe("TOKUGAWA");
    expect(tile?.occupants[0]?.amount).toBe(4);
    expect(r.state.marchingStacks).toHaveLength(0);
  });
});
