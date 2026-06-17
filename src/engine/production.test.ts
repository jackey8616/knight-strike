import { describe, expect, it } from "vitest";
import { produce } from "./production";
import { tileId } from "./state";
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
  tick = 1,
  attackOrders: readonly AttackOrder[] = [],
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
    defeated: new Set<FactionId>(),
    rngSeed: 42,
    nextMarchingId: 1,
  };
}

function tile(
  id: string,
  occupants: readonly Occupant[],
  opts: { isCastle?: boolean; castleOwner?: FactionId | null } = {},
): Province {
  return {
    id,
    x: 0,
    y: 0,
    isCastle: opts.isCastle ?? false,
    castleOwner: opts.castleOwner ?? null,
    occupants,
    lastClaimedFaction: occupants[0]?.faction ?? null,
  };
}

const tok = (amount: number): Occupant => ({
  faction: "TOKUGAWA",
  amount,
  arrivalTick: 0,
  isDefender: true,
});

describe("produce (v1.3 self-replicate)", () => {
  it("[AC-V2-29] non-engaged tile with amount ≥ 1 grows by 1", () => {
    const id = tileId(0, 0);
    const out = produce(makeState(new Map([[id, tile(id, [tok(3)])]])));
    expect(out.provinces.get(id)?.occupants[0]?.amount).toBe(4);
  });

  it("[AC-V2-29] amount = 1 also grows to 2 (lone survivor regenerates)", () => {
    const id = tileId(0, 0);
    const out = produce(makeState(new Map([[id, tile(id, [tok(1)])]])));
    expect(out.provinces.get(id)?.occupants[0]?.amount).toBe(2);
  });

  it("[AC-V2-29] tiles engaged in a siege (from / to of an AttackOrder) are frozen", () => {
    const from = tileId(0, 0);
    const to = tileId(1, 0);
    const provinces = new Map([
      [from, tile(from, [tok(5)])],
      [
        to,
        tile(to, [
          { faction: "TAKEDA", amount: 5, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const order: AttackOrder = { from, to, faction: "TOKUGAWA", startTick: 0 };
    const state = makeState(provinces, 1, [order]);
    const out = produce(state);
    expect(out).toBe(state); // both tiles skipped → no change
  });

  it("NEUTRAL bandit does not grow", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(id, [
          { faction: "NEUTRAL", amount: 3, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const state = makeState(provinces);
    expect(produce(state)).toBe(state);
  });

  it("defeated faction does not grow", () => {
    const id = tileId(0, 0);
    const state = {
      ...makeState(new Map([[id, tile(id, [tok(3)])]])),
      defeated: new Set<FactionId>(["TOKUGAWA"]),
    };
    expect(produce(state)).toBe(state);
  });

  it("amount caps at 100", () => {
    const id = tileId(0, 0);
    const state = makeState(new Map([[id, tile(id, [tok(100)])]]));
    expect(produce(state)).toBe(state);
  });

  it("amount=99 grows to 100 (boundary)", () => {
    const id = tileId(0, 0);
    const out = produce(makeState(new Map([[id, tile(id, [tok(99)])]])));
    expect(out.provinces.get(id)?.occupants[0]?.amount).toBe(100);
  });

  it("castle and non-castle tiles grow identically", () => {
    const castleId = tileId(0, 0);
    const fieldId = tileId(1, 0);
    const provinces = new Map([
      [castleId, tile(castleId, [tok(4)], { isCastle: true, castleOwner: "TOKUGAWA" })],
      [fieldId, tile(fieldId, [tok(4)])],
    ]);
    const out = produce(makeState(provinces));
    expect(out.provinces.get(castleId)?.occupants[0]?.amount).toBe(5);
    expect(out.provinces.get(fieldId)?.occupants[0]?.amount).toBe(5);
  });

  it("skips at tick 0", () => {
    const id = tileId(0, 0);
    const state = makeState(new Map([[id, tile(id, [tok(5)])]]), 0);
    expect(produce(state)).toBe(state);
  });

  it("empty tile is left alone (no occupant to grow)", () => {
    const id = tileId(0, 0);
    const state = makeState(new Map([[id, tile(id, [])]]));
    expect(produce(state)).toBe(state);
  });
});
