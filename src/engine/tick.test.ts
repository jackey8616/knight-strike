import { describe, expect, it } from "vitest";
import { makeEconomy, UPKEEP_THRESHOLD } from "./economy";
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
    economy: makeEconomy(),
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

  it("[AC-03] garrisons no longer self-replicate (auto-gen retired, §4.3)", () => {
    // No houses, no economy → a uncontested castle garrison stays put tick over
    // tick. Troops now come only from House spawns (§4.3).
    let out = step(makeState(castles(), 1));
    for (let i = 0; i < 6; i++) out = step(out); // cross an economy tick too
    for (const id of [tileId(0, 0), tileId(10, 0), tileId(0, 10), tileId(10, 10)]) {
      expect((out.provinces.get(id) as Province).occupants[0]?.amount).toBe(3);
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

  it("[AC-32] a broke faction's parked doom-stack starves toward the threshold via step()", () => {
    const D = tileId(5, 5);
    const provinces = castles();
    // A 300-troop hoard parked on one owned tile, owner broke (default gold 0).
    provinces.set(D, tile(D, [occ("TOKUGAWA", 300, 0, true)], { lastClaimedFaction: "TOKUGAWA" }));
    const stack = (st: GameState): number =>
      (st.provinces.get(D) as Province).occupants[0]?.amount ?? 0;

    // Tick 3 is an economy day: one starvation step sheds floor((300−40)/4)=65.
    let s = step(makeState(provinces, 3));
    expect(stack(s)).toBe(235);
    // Over many economy days it converges to the threshold and stops — never
    // below, so starvation alone never empties the tile or loses the castle.
    for (let i = 0; i < 120; i++) s = step(s);
    expect(stack(s)).toBe(UPKEEP_THRESHOLD);
    expect(s.defeated.has("TOKUGAWA")).toBe(false);
  });
});
