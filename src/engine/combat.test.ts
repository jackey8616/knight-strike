import { describe, expect, it } from "vitest";
import {
  resolveSameTileCombat,
  stageDamage,
} from "./combat";
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
  tick = 0,
  rngSeed = 42,
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
    rngSeed,
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

function makeTile(
  id: string,
  occupants: readonly Occupant[],
  combatStartTick: number | null = null,
  isCastle = false,
  castleOwner: FactionId | null = null,
): Province {
  return {
    id,
    x: 0,
    y: 0,
    isCastle,
    castleOwner,
    occupants,
    combatStartTick,
  };
}

describe("stageDamage", () => {
  it("matches PRD §3.6 step function", () => {
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

describe("resolveSameTileCombat", () => {
  it("no-op when tile is empty or single-faction", () => {
    const id = tileId(0, 0);
    const provinces = new Map<string, Province>([
      [id, makeTile(id, [occ("TOKUGAWA", 5, 0, true)])],
    ]);
    const state = makeState(provinces);
    const result = resolveSameTileCombat(state);
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });

  it("[AC-V2-08] case 1: defender 50 vs invader 36 ramp sequence", () => {
    const expected: ReadonlyArray<readonly [number, number]> = [
      [50, 35], // tick 0: t=0 defender only → -1 to B
      [49, 34], // tick 1: t=1 damage=1
      [47, 32], // tick 2: t=2 damage=2
      [45, 30],
      [41, 26], // tick 4: t=4 damage=4
      [37, 22],
      [33, 18],
      [29, 14],
      [21, 6], // tick 8: t=8 damage=8
      [15, 0], // tick 9: B capped at 6
    ];

    const id = tileId(1, 1);
    // combatStartTick is pre-set so assignDefender doesn't re-pick the
    // defender via the arrivalTick-tie RNG — TOKUGAWA stays the defender
    // for the whole sequence.
    const provinces = new Map<string, Province>([
      [
        id,
        makeTile(
          id,
          [occ("TOKUGAWA", 50, 0, true), occ("TAKEDA", 36, 0, false)],
          0,
        ),
      ],
    ]);
    let state = makeState(provinces, 0);

    for (let i = 0; i < expected.length; i++) {
      const tickPair = expected[i] as readonly [number, number];
      const result = resolveSameTileCombat(state);
      const tile = result.state.provinces.get(id) as Province;
      const a = tile.occupants.find((o) => o.faction === "TOKUGAWA");
      const b = tile.occupants.find((o) => o.faction === "TAKEDA");
      expect([a?.amount ?? 0, b?.amount ?? 0]).toEqual([
        tickPair[0],
        tickPair[1],
      ]);
      state = { ...result.state, tick: state.tick + 1 };
    }

    const finalTile = state.provinces.get(id) as Province;
    expect(finalTile.occupants).toHaveLength(1);
    expect(finalTile.occupants[0]?.faction).toBe("TOKUGAWA");
    expect(finalTile.combatStartTick).toBeNull();
  });

  it("[AC-V2-17] case 2: reinforcement at tick 9 keeps B alive one more tick", () => {
    const id = tileId(1, 1);
    const provinces = new Map<string, Province>([
      [
        id,
        makeTile(
          id,
          [occ("TOKUGAWA", 21, 0, true), occ("TAKEDA", 16, 0, false)],
          0,
        ),
      ],
    ]);
    const state = makeState(provinces, 9);
    const result = resolveSameTileCombat(state);
    const tile = result.state.provinces.get(id) as Province;
    expect(tile.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(13);
    expect(tile.occupants.find((o) => o.faction === "TAKEDA")?.amount).toBe(8);
    expect(tile.combatStartTick).toBe(0);
  });

  it("[AC-V2-28] 3 vs 3 step ramp through tick 2", () => {
    const id = tileId(0, 0);
    // Pre-set combatStartTick=0 so TOKUGAWA stays the defender (skip the
    // RNG tiebreak path in assignDefender).
    const provinces = new Map<string, Province>([
      [
        id,
        makeTile(
          id,
          [occ("TOKUGAWA", 3, 0, true), occ("TAKEDA", 3, 0, false)],
          0,
        ),
      ],
    ]);
    let state = makeState(provinces, 0);

    // tick 0: t=0, damage=1, only defender (TOK) attacks → A=3, B=2
    let r = resolveSameTileCombat(state);
    let tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(3);
    expect(tile.occupants.find((o) => o.faction === "TAKEDA")?.amount).toBe(2);
    state = { ...r.state, tick: 1 };

    // tick 1: t=1, damage=1, both attack → A=2, B=1
    r = resolveSameTileCombat(state);
    tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(2);
    expect(tile.occupants.find((o) => o.faction === "TAKEDA")?.amount).toBe(1);
    state = { ...r.state, tick: 2 };

    // tick 2: damage=2. A→B = min(2, 2) = 2 → B = 0 (eliminated).
    // B→A = min(2, 1) = 1 (capped at B's own amount) → A = 1.
    r = resolveSameTileCombat(state);
    tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants).toHaveLength(1);
    expect(tile.occupants[0]?.faction).toBe("TOKUGAWA");
    expect(tile.occupants[0]?.amount).toBe(1);
    expect(tile.combatStartTick).toBeNull();
  });

  it("[AC-V2-24] mutual annihilation clears combatStartTick and tile occupants", () => {
    const id = tileId(0, 0);
    const provinces = new Map<string, Province>([
      [
        id,
        makeTile(
          id,
          [occ("TOKUGAWA", 1, 0, true), occ("TAKEDA", 1, 0, false)],
          0,
        ),
      ],
    ]);
    const state = makeState(provinces, 1);
    const r = resolveSameTileCombat(state);
    const tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants).toHaveLength(0);
    expect(tile.combatStartTick).toBeNull();
  });

  it("[AC-V2-10] multi-party: 3 hostile factions, independent attacks", () => {
    const id = tileId(0, 0);
    // combatStartTick=0 so assignDefender keeps TOK as defender (avoids
    // RNG tiebreak across the 3-way arrivalTick=0 set).
    const provinces = new Map<string, Province>([
      [
        id,
        makeTile(
          id,
          [
            occ("TOKUGAWA", 50, 0, true),
            occ("TAKEDA", 30, 0, false),
            occ("ODA", 20, 0, false),
          ],
          0,
        ),
      ],
    ]);
    let state = makeState(provinces, 0);

    // tick 0: t=0 only defender (TOK) attacks. TOK hits both TAK and ODA for 1.
    let r = resolveSameTileCombat(state);
    let tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(50);
    expect(tile.occupants.find((o) => o.faction === "TAKEDA")?.amount).toBe(29);
    expect(tile.occupants.find((o) => o.faction === "ODA")?.amount).toBe(19);
    state = { ...r.state, tick: 1 };

    // tick 1: t=1 damage=1; everyone attacks every hostile.
    // TOK takes 1+1 = 2 → 48
    // TAK takes 1+1 = 2 → 27
    // ODA takes 1+1 = 2 → 17
    r = resolveSameTileCombat(state);
    tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(48);
    expect(tile.occupants.find((o) => o.faction === "TAKEDA")?.amount).toBe(27);
    expect(tile.occupants.find((o) => o.faction === "ODA")?.amount).toBe(17);
  });

  it("[AC-V2-11] defender RNG pick deterministic for the same seed", () => {
    const id = tileId(0, 0);
    const tile = makeTile(
      id,
      [occ("TOKUGAWA", 10, 0, false), occ("TAKEDA", 10, 0, false)],
      null,
    );
    const stateA = makeState(new Map([[id, tile]]), 0, 12345);
    const stateB = makeState(new Map([[id, tile]]), 0, 12345);
    const rA = resolveSameTileCombat(stateA);
    const rB = resolveSameTileCombat(stateB);
    const defA = (rA.state.provinces.get(id) as Province).occupants.find(
      (o) => o.isDefender,
    )?.faction;
    const defB = (rB.state.provinces.get(id) as Province).occupants.find(
      (o) => o.isDefender,
    )?.faction;
    expect(defA).toBe(defB);
    expect(["TOKUGAWA", "TAKEDA"]).toContain(defA);
  });

  it("[AC-V2-11] different seeds yield different defender picks (at least 2 distinct)", () => {
    const id = tileId(0, 0);
    const tile = makeTile(
      id,
      [occ("TOKUGAWA", 10, 0, false), occ("TAKEDA", 10, 0, false)],
      null,
    );
    const results = new Set<string>();
    for (const seed of [1, 7, 19, 23, 42, 99, 100, 200, 500, 1000]) {
      const state = makeState(new Map([[id, tile]]), 0, seed);
      const r = resolveSameTileCombat(state);
      const def = (r.state.provinces.get(id) as Province).occupants.find(
        (o) => o.isDefender,
      )?.faction;
      if (def !== undefined) results.add(def);
    }
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it("defender = smallest arrivalTick when not a tie", () => {
    const id = tileId(0, 0);
    const provinces = new Map<string, Province>([
      [
        id,
        makeTile(
          id,
          [occ("TOKUGAWA", 10, 0, false), occ("TAKEDA", 10, 5, false)],
          null,
        ),
      ],
    ]);
    const state = makeState(provinces, 5);
    const r = resolveSameTileCombat(state);
    const tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants.find((o) => o.isDefender)?.faction).toBe("TOKUGAWA");
    expect(tile.occupants.find((o) => o.faction === "TAKEDA")?.amount).toBe(9);
    expect(tile.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(10);
    expect(tile.combatStartTick).toBe(5);
  });

  it("NEUTRAL is a punching bag (takes damage, never attacks)", () => {
    const id = tileId(0, 0);
    const provinces = new Map<string, Province>([
      [
        id,
        makeTile(
          id,
          [occ("TOKUGAWA", 5, 0, true), occ("NEUTRAL", 3, 0, false)],
          0,
        ),
      ],
    ]);
    const state = makeState(provinces, 1);
    const r = resolveSameTileCombat(state);
    const tile = r.state.provinces.get(id) as Province;
    expect(tile.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(5);
    expect(tile.occupants.find((o) => o.faction === "NEUTRAL")?.amount).toBe(2);
  });

  it("clears stale combatStartTick on non-contested tile", () => {
    const id = tileId(0, 0);
    const provinces = new Map<string, Province>([
      [id, makeTile(id, [occ("TOKUGAWA", 5, 0, true)], 3)],
    ]);
    const state = makeState(provinces, 5);
    const r = resolveSameTileCombat(state);
    const tile = r.state.provinces.get(id) as Province;
    expect(tile.combatStartTick).toBeNull();
  });
});
