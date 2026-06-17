import { describe, expect, it } from "vitest";
import { resolveOrders, stageDamage } from "./combat";
import { derivedOwner, tileId } from "./state";
import {
  AI_IDLE,
  type AttackOrder,
  type FactionId,
  type GameState,
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

const F = tileId(0, 0); // attacker staging
const T = tileId(1, 0); // target

function order(from: string, to: string, faction: FactionId, startTick = 0): AttackOrder {
  return { from, to, faction, startTick };
}

function amountOf(state: GameState, id: string, faction: FactionId): number {
  const p = state.provinces.get(id) as Province;
  return p.occupants.find((o) => o.faction === faction)?.amount ?? 0;
}

describe("stageDamage", () => {
  it("matches PRD §3.6' step function (unchanged from v1.2)", () => {
    expect(stageDamage(0)).toBe(1);
    expect(stageDamage(1)).toBe(1);
    expect(stageDamage(2)).toBe(2);
    expect(stageDamage(3)).toBe(2);
    expect(stageDamage(4)).toBe(4);
    expect(stageDamage(7)).toBe(4);
    expect(stageDamage(8)).toBe(8);
    expect(stageDamage(15)).toBe(8);
    expect(stageDamage(16)).toBe(16);
  });
});

describe("resolveOrders", () => {
  it("no-op when there are no orders", () => {
    const state = makeState(new Map([[F, tile(F, [occ("TOKUGAWA", 5)], "TOKUGAWA")]]));
    const r = resolveOrders(state);
    expect(r.state).toBe(state);
    expect(r.events).toEqual([]);
  });

  it("[AC-V4-03] cross-edge stageDamage sequence: from 50 vs to 30, tick-0 defender only", () => {
    // from amounts then to amounts, ticks 0..9 (stage one).
    const expected: ReadonlyArray<readonly [number, number]> = [
      [49, 30], // t0: defender-only, attacker silent
      [48, 29], // t1: base 1
      [46, 27], // t2: base 2
      [44, 25],
      [40, 21], // t4: base 4
      [36, 17],
      [32, 13],
      [28, 9],
      [20, 1], // t8: base 8
      [19, 0], // t9: defender dies
    ];
    let state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 50)], "TOKUGAWA")],
        [T, tile(T, [occ("TAKEDA", 30)], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA")],
      0,
    );

    for (let t = 0; t < expected.length; t++) {
      const r = resolveOrders(state);
      const [ef, et] = expected[t] as readonly [number, number];
      expect([amountOf(r.state, F, "TOKUGAWA"), amountOf(r.state, T, "TAKEDA")]).toEqual([ef, et]);
      state = { ...r.state, tick: state.tick + 1 };
    }

    // After t9: target emptied but still TAKEDA-claimed; order persists.
    const tT = state.provinces.get(T) as Province;
    expect(tT.occupants).toHaveLength(0);
    expect(tT.lastClaimedFaction).toBe("TAKEDA");
    expect(state.attackOrders).toHaveLength(1);
  });

  it("[AC-V4-04] break→capture once the target is empty + enemy-claimed", () => {
    // tick 10 (t=10): break. tick 11 (t=11): capture.
    let state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 19)], "TOKUGAWA")],
        [T, tile(T, [], "TAKEDA")], // emptied enemy tile
      ]),
      [order(F, T, "TOKUGAWA", 0)],
      10,
    );

    let r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(18); // spent 1 on break
    expect((r.state.provinces.get(T) as Province).lastClaimedFaction).toBeNull();
    expect(r.state.attackOrders).toHaveLength(1); // continues to capture
    expect(r.events.some((e) => e.kind === "break")).toBe(true);
    state = { ...r.state, tick: 11 };

    r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(17); // spent 1 on capture
    const tT = r.state.provinces.get(T) as Province;
    expect(tT.lastClaimedFaction).toBe("TOKUGAWA");
    expect(tT.occupants).toHaveLength(0); // claim-only: no unit moved in
    expect(r.state.attackOrders).toHaveLength(0); // order complete
    expect(r.events.some((e) => e.kind === "capture")).toBe(true);
  });

  it("[AC-V4-05] neutral / unclaimed empty target captures in one step (no break)", () => {
    const state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 5)], "TOKUGAWA")],
        [T, tile(T, [], null)], // unclaimed empty
      ]),
      [order(F, T, "TOKUGAWA", 0)],
      3,
    );
    const r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(4);
    expect((r.state.provinces.get(T) as Province).lastClaimedFaction).toBe("TOKUGAWA");
    expect(r.state.attackOrders).toHaveLength(0);
  });

  it("[AC-V4-06] capture is claim-only: target empty, attacker stays on staging tile", () => {
    const state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 5)], "TOKUGAWA")],
        [T, tile(T, [], "NEUTRAL")],
      ]),
      [order(F, T, "TOKUGAWA", 0)],
      0,
    );
    const r = resolveOrders(state);
    const tT = r.state.provinces.get(T) as Province;
    expect(tT.occupants).toHaveLength(0);
    expect(derivedOwner(tT)).toBe("TOKUGAWA");
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(4); // attacker garrison still on F
  });

  it("[AC-V4-07] order drops when the attacking garrison is wiped by return fire", () => {
    // from 2 vs to 30: defender grinds the attacker to 0.
    let state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 2)], "TOKUGAWA")],
        [T, tile(T, [occ("TAKEDA", 30)], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 0)],
      0,
    );
    // t0: attacker 2 → 1 (defender only)
    let r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(1);
    expect(r.state.attackOrders).toHaveLength(1);
    state = { ...r.state, tick: 1 };
    // t1: attacker → 0, order dropped
    r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(0);
    expect((r.state.provinces.get(F) as Province).occupants).toHaveLength(0);
    expect(r.state.attackOrders).toHaveLength(0);
  });

  it("[AC-V4-09] NEUTRAL bandits never return fire, then capture in one step", () => {
    let state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 5)], "TOKUGAWA")],
        [T, tile(T, [occ("NEUTRAL", 2)], "NEUTRAL")],
      ]),
      [order(F, T, "TOKUGAWA", 0)],
      0,
    );
    // t0: defender-only, but NEUTRAL doesn't attack → nothing happens
    let r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(5);
    expect(amountOf(r.state, T, "NEUTRAL")).toBe(2);
    state = { ...r.state, tick: 1 };
    // t1: attacker hits NEUTRAL for 1, takes nothing back
    r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(5);
    expect(amountOf(r.state, T, "NEUTRAL")).toBe(1);
    state = { ...r.state, tick: 2 };
    // t2: base 2 kills the last bandit
    r = resolveOrders(state);
    expect(amountOf(r.state, T, "NEUTRAL")).toBe(0);
    state = { ...r.state, tick: 3 };
    // t3: target empty + NEUTRAL claim → one-step capture
    r = resolveOrders(state);
    expect((r.state.provinces.get(T) as Province).lastClaimedFaction).toBe("TOKUGAWA");
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(4);
  });

  it("multi-order on one target: each attacker deals & takes independent damage", () => {
    const F2 = tileId(2, 0);
    let state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 10)], "TOKUGAWA")],
        [F2, tile(F2, [occ("TOKUGAWA", 10)], "TOKUGAWA")],
        [T, tile(T, [occ("TAKEDA", 30)], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 0), order(F2, T, "TOKUGAWA", 0)],
      0,
    );
    // t0: defender hits each attacker once; attackers silent.
    let r = resolveOrders(state);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(9);
    expect(amountOf(r.state, F2, "TOKUGAWA")).toBe(9);
    expect(amountOf(r.state, T, "TAKEDA")).toBe(30);
    state = { ...r.state, tick: 1 };
    // t1: target takes 1 from each (=2); each attacker takes 1 back.
    r = resolveOrders(state);
    expect(amountOf(r.state, T, "TAKEDA")).toBe(28);
    expect(amountOf(r.state, F, "TOKUGAWA")).toBe(8);
    expect(amountOf(r.state, F2, "TOKUGAWA")).toBe(8);
  });

  it("drops an order whose attacking garrison no longer exists", () => {
    const state = makeState(
      new Map([
        [F, tile(F, [], "TOKUGAWA")], // no garrison
        [T, tile(T, [occ("TAKEDA", 5)], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 0)],
      0,
    );
    const r = resolveOrders(state);
    expect(r.state.attackOrders).toHaveLength(0);
    expect(amountOf(r.state, T, "TAKEDA")).toBe(5);
  });

  it("treats a defeated faction's claim as capturable (no break needed)", () => {
    const state = makeState(
      new Map([
        [F, tile(F, [occ("TOKUGAWA", 5)], "TOKUGAWA")],
        [T, tile(T, [], "TAKEDA")],
      ]),
      [order(F, T, "TOKUGAWA", 0)],
      0,
      ["TAKEDA"],
    );
    const r = resolveOrders(state);
    expect((r.state.provinces.get(T) as Province).lastClaimedFaction).toBe("TOKUGAWA");
    expect(r.state.attackOrders).toHaveLength(0); // captured directly
  });
});
