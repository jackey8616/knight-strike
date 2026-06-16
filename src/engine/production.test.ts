import { describe, expect, it } from "vitest";
import { produce } from "./production";
import { tileId } from "./state";
import {
  AI_IDLE,
  type FactionId,
  type GameState,
  type Occupant,
  type Province,
} from "./types";

function makeState(
  provinces: ReadonlyMap<string, Province>,
  tick = 1,
): GameState {
  return {
    boardSize: 3,
    tick,
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

function tile(
  id: string,
  occupants: readonly Occupant[],
  opts: {
    isCastle?: boolean;
    castleOwner?: FactionId | null;
    combatStartTick?: number | null;
  } = {},
): Province {
  return {
    id,
    x: 0,
    y: 0,
    isCastle: opts.isCastle ?? false,
    castleOwner: opts.castleOwner ?? null,
    occupants,
    combatStartTick: opts.combatStartTick ?? null,
    lastClaimedFaction: null,
  };
}

describe("produce (v1.3 self-replicate)", () => {
  it("[AC-V2-29] non-contested tile + amount > 1 grows by 1", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(id, [
          { faction: "TOKUGAWA", amount: 3, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const out = produce(makeState(provinces));
    expect(out.provinces.get(id)?.occupants[0]?.amount).toBe(4);
  });

  it("[AC-V2-29] amount = 1 does not grow", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(id, [
          { faction: "TOKUGAWA", amount: 1, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const state = makeState(provinces);
    const out = produce(state);
    expect(out).toBe(state);
  });

  it("[AC-V2-29] contested tile does not grow for any side", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(
          id,
          [
            { faction: "TOKUGAWA", amount: 5, arrivalTick: 0, isDefender: true },
            { faction: "TAKEDA", amount: 5, arrivalTick: 1, isDefender: false },
          ],
          { combatStartTick: 0 },
        ),
      ],
    ]);
    const state = makeState(provinces);
    const out = produce(state);
    expect(out).toBe(state);
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
    const out = produce(state);
    expect(out).toBe(state);
  });

  it("defeated faction does not grow", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(id, [
          { faction: "TOKUGAWA", amount: 3, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const state = {
      ...makeState(provinces),
      defeated: new Set<FactionId>(["TOKUGAWA"]),
    };
    const out = produce(state);
    expect(out).toBe(state);
  });

  it("amount caps at 100", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(id, [
          {
            faction: "TOKUGAWA",
            amount: 100,
            arrivalTick: 0,
            isDefender: true,
          },
        ]),
      ],
    ]);
    const state = makeState(provinces);
    const out = produce(state);
    expect(out).toBe(state);
  });

  it("amount=99 grows to 100 (boundary)", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(id, [
          {
            faction: "TOKUGAWA",
            amount: 99,
            arrivalTick: 0,
            isDefender: true,
          },
        ]),
      ],
    ]);
    const out = produce(makeState(provinces));
    expect(out.provinces.get(id)?.occupants[0]?.amount).toBe(100);
  });

  it("castle and non-castle tiles grow identically", () => {
    const castleId = tileId(0, 0);
    const fieldId = tileId(1, 0);
    const provinces = new Map([
      [
        castleId,
        tile(
          castleId,
          [
            { faction: "TOKUGAWA", amount: 4, arrivalTick: 0, isDefender: true },
          ],
          { isCastle: true, castleOwner: "TOKUGAWA" },
        ),
      ],
      [
        fieldId,
        tile(fieldId, [
          { faction: "TOKUGAWA", amount: 4, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const out = produce(makeState(provinces));
    expect(out.provinces.get(castleId)?.occupants[0]?.amount).toBe(5);
    expect(out.provinces.get(fieldId)?.occupants[0]?.amount).toBe(5);
  });

  it("skips at tick 0", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(id, [
          { faction: "TOKUGAWA", amount: 5, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const state = makeState(provinces, 0);
    const out = produce(state);
    expect(out).toBe(state);
  });

  it("empty tile is left alone (no occupant to grow)", () => {
    const id = tileId(0, 0);
    const provinces = new Map([[id, tile(id, [])]]);
    const state = makeState(provinces);
    const out = produce(state);
    expect(out).toBe(state);
  });
});
