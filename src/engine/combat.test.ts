import { describe, expect, it } from "vitest";
import { resolveOrders, stageDamage } from "./combat";
import { advanceMarching } from "./movement";
import { derivedOwner, tileId } from "./state";
import {
  AI_IDLE,
  type AttackOrder,
  type FactionId,
  type GameState,
  type MarchingStack,
  type Occupant,
  type Province,
} from "./types";

function makeState(
  provinces: ReadonlyMap<string, Province>,
  attackOrders: readonly AttackOrder[] = [],
  tick = 0,
  defeated: readonly FactionId[] = [],
): GameState {
  return {
    boardSize: 3,
    tick,
    provinces,
    marchingStacks: [],
    attackOrders,
    aiConfig: {
      TOKUGAWA: AI_IDLE,
      TAKEDA: AI_IDLE,
      ODA: AI_IDLE,
      UESUGI: AI_IDLE,
      NEUTRAL: AI_IDLE,
    },
    defeated: new Set<FactionId>(defeated),
    rngSeed: 42,
    nextMarchingId: 1,
  };
}

function occ(faction: FactionId, amount: number): Occupant {
  return { faction, amount, arrivalTick: 0, isDefender: false };
}

function tile(
  id: string,
  occupants: readonly Occupant[],
  lastClaimedFaction: FactionId | null = null,
): Province {
  return { id, x: 0, y: 0, isCastle: false, castleOwner: null, occupants, lastClaimedFaction };
}

const F = tileId(0, 0); // column staging
const T = tileId(1, 0); // target

function order(
  from: string,
  to: string,
  faction: FactionId,
  count: number,
  route: readonly string[] = [],
  startTick = 0,
): AttackOrder {
  return { from, to, faction, count, route, startTick };
}

function colCount(state: GameState, from: string, to: string): number {
  return state.attackOrders.find((o) => o.from === from && o.to === to)?.count ?? 0;
}
function amountOf(state: GameState, id: string, faction: FactionId): number {
  const p = state.provinces.get(id) as Province;
  return p.occupants.find((o) => o.faction === faction)?.amount ?? 0;
}

describe("stageDamage", () => {
  it("matches PRD §4.6 step function", () => {
    expect([0, 1, 2, 3, 4, 7, 8, 15, 16].map(stageDamage)).toEqual([1, 1, 2, 2, 4, 4, 8, 8, 16]);
  });
});

describe("resolveOrders (v1.5 conquer-march)", () => {
  it("no-op when there are no orders", () => {
    const state = makeState(new Map([[F, tile(F, [occ("TOKUGAWA", 5)], "TOKUGAWA")]]));
    expect(resolveOrders(state).state).toBe(state);
  });

  it("[AC-V4-03] cross-edge stageDamage: column 50 vs defender 30 → break → capture + garrison", () => {
    const expected: ReadonlyArray<readonly [number, number]> = [
      [49, 30], [48, 29], [46, 27], [44, 25], [40, 21],
      [36, 17], [32, 13], [28, 9], [20, 1], [19, 0],
    ];
    let state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")],
        [T, tile(T, [occ("TAKEDA", 30)], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 50)],
      0,
    );
    for (let t = 0; t < expected.length; t++) {
      const r = resolveOrders(state);
      const [col, def] = expected[t] as readonly [number, number];
      expect([colCount(r.state, F, T), amountOf(r.state, T, "TAKEDA")]).toEqual([col, def]);
      state = { ...r.state, tick: state.tick + 1 };
    }
    // t10: break (enemy claim → neutral); t11: capture → column advances onto T.
    state = { ...resolveOrders(state).state, tick: 11 };
    expect((state.provinces.get(T) as Province).lastClaimedFaction).toBeNull(); // broke to neutral
    expect(colCount(state, F, T)).toBe(18);

    const r11 = resolveOrders(state);
    const tT = r11.state.provinces.get(T) as Province;
    expect(tT.lastClaimedFaction).toBe("TOKUGAWA");
    expect(r11.state.attackOrders).toHaveLength(0);
    // Surviving column advances onto T as a marcher (settles into a garrison
    // on the next advanceMarching) instead of popping into an instant garrison.
    expect(r11.state.marchingStacks).toHaveLength(1);
    const ms = r11.state.marchingStacks[0] as MarchingStack;
    expect(ms.path).toEqual([F, T]);
    expect(ms.idx).toBe(1);
    expect(ms.count).toBe(17);
  });

  it("[AC-V4-05] final target capture: column advances onto the tile (slide-then-settle)", () => {
    const state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")],
        [T, tile(T, [], null)],
      ]),
      [order(F, T, "TOKUGAWA", 5)],
      0,
    );
    const r = resolveOrders(state);
    const tT = r.state.provinces.get(T) as Province;
    expect(tT.lastClaimedFaction).toBe("TOKUGAWA");
    expect(tT.occupants).toHaveLength(0); // not an instant garrison
    expect(r.state.attackOrders).toHaveLength(0);
    // The column advances onto T (path[0]=from for a smooth slide), garrisoning
    // next tick via advanceMarching.
    const ms = r.state.marchingStacks[0] as MarchingStack;
    expect(ms.path).toEqual([F, T]);
    expect(ms.idx).toBe(1);
    expect(ms.count).toBe(4); // 5 - 1 capture cost
    // Next advanceMarching settles the arrived column into a garrison on T.
    const settled = advanceMarching(r.state);
    expect(amountOf(settled, T, "TOKUGAWA")).toBe(4);
    expect(settled.marchingStacks).toHaveLength(0);
  });

  it("[AC-V5-01] intermediate capture advances: re-spawns the column on the captured tile", () => {
    const U = tileId(2, 0);
    const state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")],
        [T, tile(T, [], null)],
        [U, tile(U, [], null)],
      ]),
      [order(F, T, "TOKUGAWA", 5, [U])], // route continues to U
      0,
    );
    const r = resolveOrders(state);
    expect((r.state.provinces.get(T) as Province).lastClaimedFaction).toBe("TOKUGAWA");
    expect((r.state.provinces.get(T) as Province).occupants).toHaveLength(0); // intermediate left empty-claim
    expect(r.state.attackOrders).toHaveLength(0); // order consumed
    // Column re-spawned advancing onto T (idx 1), still heading to U. `from`
    // stays at path[0] so the renderer can tween the move out of it.
    expect(r.state.marchingStacks).toHaveLength(1);
    const ms = r.state.marchingStacks[0] as MarchingStack;
    expect(ms.count).toBe(4);
    expect(ms.path).toEqual([F, T, U]);
    expect(ms.idx).toBe(1);
    expect(ms.path[ms.idx]).toBe(T); // current tile is the captured one
    expect(ms.faction).toBe("TOKUGAWA");
    expect(r.state.nextMarchingId).toBe(2);
  });

  it("[AC-V4-07] order drops when the column is wiped by return fire", () => {
    let state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")],
        [T, tile(T, [occ("TAKEDA", 30)], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 2)],
      0,
    );
    let r = resolveOrders(state); // t0: column 2 → 1
    expect(colCount(r.state, F, T)).toBe(1);
    state = { ...r.state, tick: 1 };
    r = resolveOrders(state); // t1: column 1 → 0 → order dropped
    expect(r.state.attackOrders).toHaveLength(0);
    expect(amountOf(r.state, T, "TAKEDA")).toBe(29); // defender took 1 from t1 column hit
  });

  it("[AC-V4-09] NEUTRAL bandits never return fire", () => {
    let state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")],
        [T, tile(T, [occ("NEUTRAL", 2)], "NEUTRAL")],
      ]),
      [order(F, T, "TOKUGAWA", 5)],
      0,
    );
    let r = resolveOrders(state); // t0: nothing (defender NEUTRAL, attacker silent)
    expect(colCount(r.state, F, T)).toBe(5);
    expect(amountOf(r.state, T, "NEUTRAL")).toBe(2);
    state = { ...r.state, tick: 1 };
    r = resolveOrders(state); // t1: column hits for 1, takes none
    expect(colCount(r.state, F, T)).toBe(5);
    expect(amountOf(r.state, T, "NEUTRAL")).toBe(1);
  });

  it("multi-order one target: each column deals/takes independent damage", () => {
    const F2 = tileId(2, 0);
    const state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")],
        [F2, tile(F2, [], "TOKUGAWA")],
        [T, tile(T, [occ("TAKEDA", 30)], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 10), order(F2, T, "TOKUGAWA", 10)],
      1, // t=1 so both sides fire
    );
    const r = resolveOrders(state);
    expect(amountOf(r.state, T, "TAKEDA")).toBe(28); // 1 from each column
    expect(colCount(r.state, F, T)).toBe(9);
    expect(colCount(r.state, F2, T)).toBe(9);
  });

  it("[AC-V6-05] a defender in a forest takes reduced combat damage", () => {
    const toForest: Province = {
      id: T,
      x: 0,
      y: 0,
      isCastle: false,
      castleOwner: null,
      occupants: [occ("TAKEDA", 30)],
      lastClaimedFaction: "TAKEDA",
      terrain: "FOREST",
    };
    // t=4 → base 4. On plains the defender would lose 4; in forest ceil(4*0.75)=3.
    const state = makeState(
      new Map([[F, tile(F, [], "TOKUGAWA")], [T, toForest]]),
      [order(F, T, "TOKUGAWA", 50)],
      4,
    );
    const r = resolveOrders(state);
    expect(amountOf(r.state, T, "TAKEDA")).toBe(27);
  });

  it("treats a defeated faction's claim as directly capturable", () => {
    const state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")],
        [T, tile(T, [], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 5)],
      0,
      ["TAKEDA"],
    );
    const r = resolveOrders(state);
    expect((r.state.provinces.get(T) as Province).lastClaimedFaction).toBe("TOKUGAWA");
    expect(derivedOwner(r.state.provinces.get(T) as Province)).toBe("TOKUGAWA");
  });
});
