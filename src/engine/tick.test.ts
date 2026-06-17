import { describe, expect, it } from "vitest";
import { tileId } from "./state";
import { step } from "./tick";
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
  tick = 0,
  attackOrders: readonly AttackOrder[] = [],
): GameState {
  return {
    boardSize: 11,
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

function occ(
  faction: FactionId,
  amount: number,
  arrivalTick = 0,
  isDefender = false,
): Occupant {
  return { faction, amount, arrivalTick, isDefender };
}

function tile(
  id: string,
  occupants: readonly Occupant[],
  opts: {
    isCastle?: boolean;
    castleOwner?: FactionId | null;
    lastClaimedFaction?: FactionId | null;
  } = {},
): Province {
  return {
    id,
    x: 0,
    y: 0,
    isCastle: opts.isCastle ?? false,
    castleOwner: opts.castleOwner ?? null,
    occupants,
    lastClaimedFaction:
      opts.lastClaimedFaction ?? occupants[0]?.faction ?? null,
  };
}

// Four corner castles so applyDefeats stays quiet during focused tests.
function castles(): Map<string, Province> {
  return new Map([
    [tileId(0, 0), tile(tileId(0, 0), [occ("TOKUGAWA", 3, 0, true)], { isCastle: true, castleOwner: "TOKUGAWA" })],
    [tileId(10, 0), tile(tileId(10, 0), [occ("TAKEDA", 3, 0, true)], { isCastle: true, castleOwner: "TAKEDA" })],
    [tileId(0, 10), tile(tileId(0, 10), [occ("ODA", 3, 0, true)], { isCastle: true, castleOwner: "ODA" })],
    [tileId(10, 10), tile(tileId(10, 10), [occ("UESUGI", 3, 0, true)], { isCastle: true, castleOwner: "UESUGI" })],
  ]);
}

describe("step (tick orchestrator)", () => {
  it("[AC-V2-02] increments tick by 1", () => {
    expect(step(makeState(new Map(), 5)).tick).toBe(6);
  });

  it("[AC-V2-29] uncontested castles self-replicate +1 each tick", () => {
    const out = step(makeState(castles(), 1));
    for (const id of [tileId(0, 0), tileId(10, 0), tileId(0, 10), tileId(10, 10)]) {
      expect((out.provinces.get(id) as Province).occupants[0]?.amount).toBe(4);
    }
  });

  it("[AC-V4-03] tick-0 gives the defender the only attack; besieged target is frozen", () => {
    const F = tileId(5, 5);
    const T = tileId(6, 5);
    const provinces = castles();
    provinces.set(F, tile(F, [], { lastClaimedFaction: "TOKUGAWA" })); // own empty staging
    provinces.set(T, tile(T, [occ("TAKEDA", 5, 0, true)]));
    const order: AttackOrder = {
      from: F, to: T, faction: "TOKUGAWA", count: 5, route: [], startTick: 1,
    };
    const out = step(makeState(provinces, 1, [order]));
    // combat t=0 → only TAKEDA fires at the column (5 → 4); T frozen at 5.
    expect(out.attackOrders[0]?.count).toBe(4);
    expect((out.provinces.get(T) as Province).occupants[0]?.amount).toBe(5);
  });

  it("[AC-V4-05] step captures a neutral empty target, then the column settles onto it", () => {
    const F = tileId(5, 5);
    const T = tileId(6, 5);
    const provinces = castles();
    provinces.set(F, tile(F, [], { lastClaimedFaction: "TOKUGAWA" }));
    provinces.set(T, tile(T, [], { lastClaimedFaction: null }));
    const order: AttackOrder = {
      from: F, to: T, faction: "TOKUGAWA", count: 5, route: [], startTick: 1,
    };
    // Tick 1: capture → claim flips, column advances onto T as a marcher.
    let out = step(makeState(provinces, 1, [order]));
    expect((out.provinces.get(T) as Province).lastClaimedFaction).toBe("TOKUGAWA");
    expect(out.attackOrders).toHaveLength(0);
    expect(out.marchingStacks).toHaveLength(1);
    // Tick 2: the arrived column settles into a garrison on T.
    out = step(out);
    const tT = out.provinces.get(T) as Province;
    expect(tT.occupants[0]?.faction).toBe("TOKUGAWA");
    expect(tT.occupants[0]?.amount ?? 0).toBeGreaterThanOrEqual(4);
    expect(out.marchingStacks).toHaveLength(0);
  });
});
