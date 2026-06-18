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
  type Terrain,
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
        lastClaimedFaction: null,
      });
    }
  }
  return {
    boardSize,
    tick: 0,
    provinces,
    marchingStacks: [],
    attackOrders: [],
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
    // Mirror the §4.6 invariant: a garrison stamps the tile's claim.
    lastClaimedFaction: occupants[0]?.faction ?? prov.lastClaimedFaction,
    isCastle: opts.isCastle ?? prov.isCastle,
    castleOwner: opts.castleOwner ?? prov.castleOwner,
  });
  return { ...state, provinces: next };
}

// Mark an empty tile as own-claimed (walk-through trail / post-capture), making
// it passable as a marching intermediate.
function claim(state: GameState, x: number, y: number, faction: FactionId): GameState {
  const id = tileId(x, y);
  const prov = state.provinces.get(id);
  if (prov === undefined) throw new Error(`no province at ${id}`);
  const next = new Map(state.provinces);
  next.set(id, { ...prov, lastClaimedFaction: faction });
  return { ...state, provinces: next };
}

function setTerrain(
  state: GameState,
  x: number,
  y: number,
  terrain: Terrain,
): GameState {
  const id = tileId(x, y);
  const prov = state.provinces.get(id);
  if (prov === undefined) throw new Error(`no province at ${id}`);
  const next = new Map(state.provinces);
  next.set(id, { ...prov, terrain });
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

describe("findPath (v1.5: own target = own-only, non-own = shortest)", () => {
  it("returns null when source has no occupant of the dispatching faction", () => {
    const state = emptyState();
    expect(findPath(state, tileId(0, 0), tileId(1, 0), "TOKUGAWA")).toBeNull();
  });

  it("[AC-V4-01] own (reinforce) target needs an all-own path; unclaimed gap blocks", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = claim(s, 2, 0, "TOKUGAWA"); // make (2,0) an OWN target (reinforcement)
    // (1,0) unclaimed gap → no own route → null.
    expect(findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA")).toBeNull();
    s = claim(s, 1, 0, "TOKUGAWA");
    expect(findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA")).toEqual([
      tileId(0, 0),
      tileId(1, 0),
      tileId(2, 0),
    ]);
  });

  it("[AC-V5-02] non-own target → shortest path ignoring ownership (conquer-march)", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = claim(s, 1, 0, "TAKEDA"); // enemy-claimed empty in the way
    // Target (2,0) is non-own → the column will march straight through (1,0).
    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path).toEqual([tileId(0, 0), tileId(1, 0), tileId(2, 0)]);
  });

  it("[AC-V5-02] non-own target marches straight through an enemy garrison", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [occ("TAKEDA", 5, 0, true)]);
    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path?.some((id) => id === tileId(1, 0))).toBe(true);
  });

  it("own (reinforce) target walks through own-occupant intermediates", () => {
    let s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [occ("TOKUGAWA", 5, 0, true)]); // own occupant
    s = claim(s, 2, 0, "TOKUGAWA"); // own target
    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path?.[1]).toBe(tileId(1, 0));
  });

  it("own (reinforce) target with an enemy garrison gap and no own detour → null", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [occ("TAKEDA", 5, 0, true)]); // enemy gap
    s = claim(s, 2, 0, "TOKUGAWA"); // own target, no own route to it
    expect(findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA")).toBeNull();
  });

  it("target tile need not be own (adjacent enemy target reachable)", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [occ("TAKEDA", 5, 0, true)]);
    expect(findPath(s, tileId(0, 0), tileId(1, 0), "TOKUGAWA")).toEqual([
      tileId(0, 0),
      tileId(1, 0),
    ]);
  });

  it("[AC-V6-04] impassable terrain is routed around and can't be targeted", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setTerrain(s, 1, 0, "MOUNTAIN");
    // Non-own target (2,0): path must detour around the mountain at (1,0).
    const path = findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA");
    expect(path).not.toBeNull();
    expect(path?.some((id) => id === tileId(1, 0))).toBe(false);
    // The mountain itself is never a valid target.
    expect(findPath(s, tileId(0, 0), tileId(1, 0), "TOKUGAWA")).toBeNull();
  });

  it("[AC-V4-08] no hop limit across own territory", () => {
    let s = setOccupants(emptyState(5), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    for (let x = 1; x <= 3; x++) s = claim(s, x, 0, "TOKUGAWA");
    const path = findPath(s, tileId(0, 0), tileId(4, 0), "TOKUGAWA");
    expect(path).toEqual([
      tileId(0, 0),
      tileId(1, 0),
      tileId(2, 0),
      tileId(3, 0),
      tileId(4, 0),
    ]);
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
    const s = setOccupants(
      emptyState(),
      0,
      0,
      [occ("TOKUGAWA", 10, 0, true)],
      { isCastle: true, castleOwner: "TOKUGAWA" },
    );
    const r = dispatch(s, { from: tileId(0, 0), to: tileId(1, 0), ratio: 1.0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tok = r.state.provinces
      .get(tileId(0, 0))
      ?.occupants.find((o) => o.faction === "TOKUGAWA");
    expect(tok?.amount).toBe(1);
    expect(r.stack.count).toBe(9);
  });

  it("castle with occupant amount = 1 rejects dispatch", () => {
    const s = setOccupants(
      emptyState(),
      0,
      0,
      [occ("TOKUGAWA", 1, 0, true)],
      { isCastle: true, castleOwner: "TOKUGAWA" },
    );
    const r = dispatch(s, { from: tileId(0, 0), to: tileId(1, 0), ratio: 1.0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("castle-min-1");
  });

  it("non-castle 100% ratio dispatches everyone and removes the occupant", () => {
    const s = setOccupants(emptyState(), 0, 0, [occ("TOKUGAWA", 5, 0, true)]);
    const r = dispatch(s, { from: tileId(0, 0), to: tileId(1, 0), ratio: 1.0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.provinces.get(tileId(0, 0))?.occupants).toHaveLength(0);
    expect(r.stack.count).toBe(5);
  });
});

describe("advanceMarching (v1.4 move-in / step / siege)", () => {
  it("[AC-V4-10] terminus on own-claimed empty tile → unit moves in (garrison)", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = claim(s, 1, 0, "TOKUGAWA");
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const out = advanceMarching({ ...s, marchingStacks: [stack], tick: 1 });
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(1);
    expect(tile?.occupants[0]?.faction).toBe("TOKUGAWA");
    expect(tile?.occupants[0]?.amount).toBe(4);
    expect(out.marchingStacks).toHaveLength(0);
    expect(out.attackOrders).toHaveLength(0);
  });

  it("[AC-V2-07] terminus on own occupant tile merges amount", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = setOccupants(s, 1, 0, [occ("TOKUGAWA", 3, 0, true)]);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const out = advanceMarching({ ...s, marchingStacks: [stack], tick: 1 });
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(1);
    expect(tile?.occupants[0]?.amount).toBe(7);
    expect(tile?.occupants[0]?.arrivalTick).toBe(0); // existing preserved
  });

  it("non-terminus own intermediate → steps through without garrison", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 10, 0, true)]);
    s = claim(s, 1, 0, "TOKUGAWA");
    s = claim(s, 2, 0, "TOKUGAWA");
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const out = advanceMarching({ ...s, marchingStacks: [stack], tick: 1 });
    expect(out.marchingStacks).toHaveLength(1);
    expect(out.marchingStacks[0]?.idx).toBe(1);
    expect(out.provinces.get(tileId(1, 0))?.occupants).toHaveLength(0);
  });

  it("[AC-V4-02] terminus on enemy tile → siege: order carries the column's count (no staging garrison)", () => {
    let s = setOccupants(emptyState(3), 0, 0, []); // staging is own-claimed empty
    s = claim(s, 0, 0, "TOKUGAWA");
    s = setOccupants(s, 1, 0, [occ("TAKEDA", 6, 0, true)]); // enemy target
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const out = advanceMarching({ ...s, marchingStacks: [stack], tick: 2 });
    expect(out.marchingStacks).toHaveLength(0);
    // v1.5: the column's troops go into the order, NOT a staging garrison.
    const staging = out.provinces.get(tileId(0, 0));
    expect(staging?.occupants).toHaveLength(0);
    expect(out.attackOrders).toHaveLength(1);
    expect(out.attackOrders[0]).toMatchObject({
      from: tileId(0, 0),
      to: tileId(1, 0),
      faction: "TOKUGAWA",
      count: 4,
      route: [],
      startTick: 2,
    });
    const target = out.provinces.get(tileId(1, 0));
    expect(target?.occupants.some((o) => o.faction === "TOKUGAWA")).toBe(false);
  });

  it("mid-path tile that is not own → siege from the previous own tile", () => {
    let s = setOccupants(emptyState(3), 0, 0, [occ("TOKUGAWA", 8, 0, true)]);
    // (1,0) is enemy-occupied; the path tries to cross it.
    s = setOccupants(s, 1, 0, [occ("ODA", 3, 0, true)]);
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const out = advanceMarching({ ...s, marchingStacks: [stack], tick: 1 });
    expect(out.marchingStacks).toHaveLength(0);
    expect(out.attackOrders[0]).toMatchObject({
      from: tileId(0, 0),
      to: tileId(1, 0),
    });
  });

  it("[AC-V2-18] same-faction stacks co-arriving at one own tile merge", () => {
    let s = emptyState(5);
    s = claim(s, 1, 0, "TOKUGAWA");
    const stackA: MarchingStack = {
      id: "A",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const stackB: MarchingStack = {
      id: "B",
      faction: "TOKUGAWA",
      count: 2,
      path: [tileId(2, 1), tileId(1, 1), tileId(1, 0)],
      idx: 1,
      dispatchedAtTick: 1,
    };
    const out = advanceMarching({ ...s, marchingStacks: [stackA, stackB], tick: 2 });
    const tile = out.provinces.get(tileId(1, 0));
    expect(tile?.occupants).toHaveLength(1);
    expect(tile?.occupants[0]?.amount).toBe(5);
    expect(out.marchingStacks).toHaveLength(0);
  });

  it("reinforces an existing siege order instead of duplicating it (keeps earliest startTick)", () => {
    let s = emptyState(3);
    s = claim(s, 0, 0, "TOKUGAWA");
    s = setOccupants(s, 1, 0, [occ("TAKEDA", 6, 0, true)]);
    const existing = {
      from: tileId(0, 0),
      to: tileId(1, 0),
      faction: "TOKUGAWA" as FactionId,
      count: 2,
      route: [] as string[],
      startTick: 1,
    };
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 3,
    };
    const out = advanceMarching({
      ...s,
      attackOrders: [existing],
      marchingStacks: [stack],
      tick: 5,
    });
    expect(out.attackOrders).toHaveLength(1);
    expect(out.attackOrders[0]?.startTick).toBe(1); // earliest kept
    expect(out.attackOrders[0]?.count).toBe(6); // 2 + 4 reinforcement
  });
});

describe("cancelMarchingStack", () => {
  it("drops the stack onto its current tile as a garrison", () => {
    let s = emptyState(3);
    s = claim(s, 1, 0, "TOKUGAWA");
    const stack: MarchingStack = {
      id: "m1",
      faction: "TOKUGAWA",
      count: 4,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 1,
      dispatchedAtTick: 0,
    };
    const r = cancelMarchingStack({ ...s, marchingStacks: [stack], tick: 5 }, "m1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tile = r.state.provinces.get(tileId(1, 0));
    expect(tile?.occupants[0]?.faction).toBe("TOKUGAWA");
    expect(tile?.occupants[0]?.amount).toBe(4);
    expect(r.state.marchingStacks).toHaveLength(0);
  });
});
