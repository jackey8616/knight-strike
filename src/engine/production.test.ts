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

function castle(
  id: string,
  castleOwner: FactionId | null,
  occupants: readonly Occupant[],
): Province {
  return {
    id,
    x: 0,
    y: 0,
    isCastle: true,
    castleOwner,
    occupants,
    combatStartTick: null,
  };
}

describe("produce", () => {
  it("[AC-V2-03] castle owner's occupant gains +1", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        castle(id, "TOKUGAWA", [
          { faction: "TOKUGAWA", amount: 3, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const out = produce(makeState(provinces));
    const tile = out.provinces.get(id);
    expect(tile?.occupants[0]?.amount).toBe(4);
  });

  it("skips when castleOwner has no occupant", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        castle(id, "TOKUGAWA", [
          { faction: "TAKEDA", amount: 3, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const state = makeState(provinces);
    const out = produce(state);
    expect(out).toBe(state); // unchanged reference
  });

  it("skips at tick 0", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        castle(id, "TOKUGAWA", [
          { faction: "TOKUGAWA", amount: 3, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const state = makeState(provinces, 0);
    const out = produce(state);
    expect(out).toBe(state);
  });

  it("skips when castleOwner is defeated", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        castle(id, "TOKUGAWA", [
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

  it("caps at PRODUCTION_CAP", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        castle(id, "TOKUGAWA", [
          { faction: "TOKUGAWA", amount: 100, arrivalTick: 0, isDefender: true },
        ]),
      ],
    ]);
    const state = makeState(provinces);
    const out = produce(state);
    expect(out).toBe(state); // at cap → no change
  });

  it("non-castle tiles don't produce", () => {
    const id = tileId(0, 0);
    const prov: Province = {
      id,
      x: 0,
      y: 0,
      isCastle: false,
      castleOwner: null,
      occupants: [
        { faction: "TOKUGAWA", amount: 5, arrivalTick: 0, isDefender: true },
      ],
      combatStartTick: null,
    };
    const state = makeState(new Map([[id, prov]]));
    const out = produce(state);
    expect(out).toBe(state);
  });

  it("produces alongside hostile co-occupant (castleOwner still has occupant)", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        castle(id, "TOKUGAWA", [
          { faction: "TOKUGAWA", amount: 3, arrivalTick: 0, isDefender: true },
          { faction: "TAKEDA", amount: 5, arrivalTick: 1, isDefender: false },
        ]),
      ],
    ]);
    const out = produce(makeState(provinces, 2));
    const tile = out.provinces.get(id);
    const tok = tile?.occupants.find((o) => o.faction === "TOKUGAWA");
    const tak = tile?.occupants.find((o) => o.faction === "TAKEDA");
    expect(tok?.amount).toBe(4);
    expect(tak?.amount).toBe(5); // unaffected
  });
});
