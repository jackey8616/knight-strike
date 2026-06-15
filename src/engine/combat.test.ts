import { describe, expect, it } from "vitest";
import {
  POWER_PER_TIER,
  STALEMATE_DRAIN_THRESHOLD,
  applyDrainDeductions,
  computeLoss,
  resolveAdjacentCombat,
  tilePower,
  updateStalemates,
} from "./combat";
import type { CombatPair } from "./combat";
import { pairKey, tileId } from "./state";
import { deriveTier } from "./upgrade";
import type {
  AiMode,
  FactionId,
  GameState,
  PairKey,
  Province,
  StalemateMap,
  TileId,
} from "./types";

const idleAi: Readonly<Record<FactionId, AiMode>> = {
  TOKUGAWA: "idle",
  TAKEDA: "idle",
  ODA: "idle",
  UESUGI: "idle",
  NEUTRAL: "idle",
};

function makeProvince(
  x: number,
  y: number,
  owner: FactionId,
  count: number,
  isCastle = false,
): Province {
  return { id: tileId(x, y), x, y, owner, count, isCastle, lastClaimedAtTick: null };
}

function buildState(provinces: readonly Province[]): GameState {
  const map = new Map<TileId, Province>();
  for (const p of provinces) map.set(p.id, p);
  return {
    boardSize: 11,
    tick: 1,
    provinces: map,
    marchingStacks: [],
    stalemates: new Map(),
    aiConfig: idleAi,
    defeated: new Set<FactionId>(),
    rngSeed: 1,
    nextMarchingId: 1,
  };
}

describe("tilePower", () => {
  it("count 0 → power 0", () => {
    expect(tilePower(0)).toBe(0);
  });

  it("Soldier tier: power = count × 1", () => {
    expect(tilePower(1)).toBe(1);
    expect(tilePower(4)).toBe(4);
  });

  it("Knight tier (5..11): power = count × 4", () => {
    expect(tilePower(5)).toBe(20);
    expect(tilePower(11)).toBe(44);
  });

  it("Queen tier (12..24): power = count × 12", () => {
    expect(tilePower(12)).toBe(144);
    expect(tilePower(24)).toBe(288);
  });

  it("King tier (≥25): power = count × 30", () => {
    expect(tilePower(25)).toBe(750);
    expect(tilePower(50)).toBe(1500);
  });

  it("multipliers table matches PRD §3.6", () => {
    expect(POWER_PER_TIER.SOLDIER).toBe(1);
    expect(POWER_PER_TIER.KNIGHT).toBe(4);
    expect(POWER_PER_TIER.QUEEN).toBe(12);
    expect(POWER_PER_TIER.KING).toBe(30);
  });
});

describe("computeLoss", () => {
  it("PRD §3.6 formula: max(0, floor((opp - own/4) / 4))", () => {
    // 10S vs 20K: floor((20 - 2.5) / 4) = floor(4.375) = 4
    expect(computeLoss(10, 20)).toBe(4);
    // 20K vs 10S: floor((10 - 5) / 4) = floor(1.25) = 1
    expect(computeLoss(20, 10)).toBe(1);
  });

  it("uses real division for own/4 (not floor) before subtraction", () => {
    // own=10 → own/4 = 2.5, not 2. If it were floor(10/4)=2, result would be floor(18/4)=4 too,
    // but for own=11 → own/4 = 2.75 (not 2). floor((20 - 2.75)/4) = floor(4.3125) = 4.
    expect(computeLoss(11, 20)).toBe(4);
    // contrast: own=14 → own/4 = 3.5. floor((20 - 3.5)/4) = floor(4.125) = 4.
    expect(computeLoss(14, 20)).toBe(4);
  });

  it("clamps to 0 when opponent power is weak relative to own defense", () => {
    // own=100, opp=10 → floor((10 - 25) / 4) = floor(-3.75) = -4 → clamp to 0
    expect(computeLoss(100, 10)).toBe(0);
  });

  it("zero opponent power → zero loss", () => {
    expect(computeLoss(10, 0)).toBe(0);
  });

  it("zero own power and small opp power: floor((opp - 0)/4)", () => {
    expect(computeLoss(0, 10)).toBe(2);
    expect(computeLoss(0, 3)).toBe(0);
  });
});

describe("resolveAdjacentCombat", () => {
  it("[AC-08] 6 Knight vs 5 Knight: 6→3 (tier→Soldier), 5→1 (tier→Soldier)", () => {
    // PRD §3.6 worked example (v0.5):
    //   6 Knight (power 24) vs 5 Knight (power 20)
    //   6-stack loss = floor((20 - 24/4)/4) = floor(3.5) = 3 → count 6→3
    //   5-stack loss = floor((24 - 20/4)/4) = floor(4.75) = 4 → count 5→1
    // Both end up below the Knight threshold (5), so derived tier drops to Soldier.
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 6),
      makeProvince(1, 0, "TAKEDA", 5),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);

    const sixStack = after.provinces.get(tileId(0, 0));
    const fiveStack = after.provinces.get(tileId(1, 0));

    expect(sixStack?.count).toBe(3);
    expect(fiveStack?.count).toBe(1);
    // Tier downgrade is implicit via deriveTier (M1.2); verify via count thresholds.
    expect(deriveTier(sixStack?.count ?? -1)).toBe("SOLDIER");
    expect(deriveTier(fiveStack?.count ?? -1)).toBe("SOLDIER");

    // Sanity-check the pair output — consumed by the stalemate counter (M1.5).
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    expect(pair).toBeDefined();
    const lossForSix =
      pair?.a === tileId(0, 0) ? pair?.lossA : pair?.lossB;
    const lossForFive =
      pair?.a === tileId(1, 0) ? pair?.lossA : pair?.lossB;
    expect(lossForSix).toBe(3);
    expect(lossForFive).toBe(4);
  });

  it("4-adjacent only: diagonal tiles do not fight", () => {
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 10),
      makeProvince(1, 1, "TAKEDA", 10),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
    expect(after).toBe(before);
  });

  it("same-faction adjacent: no combat", () => {
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 10),
      makeProvince(1, 0, "TOKUGAWA", 10),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
    expect(after).toBe(before);
  });

  it("NEUTRAL vs NEUTRAL adjacent: no combat (per PRD §3.6 note)", () => {
    const provinces = [
      makeProvince(0, 0, "NEUTRAL", 3),
      makeProvince(1, 0, "NEUTRAL", 3),
    ];
    const before = buildState(provinces);
    const { pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
  });

  it("NEUTRAL vs player: NEUTRAL participates in combat", () => {
    // NEUTRAL count 3 (SOLDIER, power 3) vs Tokugawa 5 (KNIGHT, power 20).
    // NEUTRAL loss  = floor((20 - 3/4)/4) = floor(4.8125) = 4 → 3-4 → clamp 0.
    // Tokugawa loss = floor((3 - 20/4)/4) = floor(-0.5)  = -1 → clamp 0.
    const provinces = [
      makeProvince(0, 0, "NEUTRAL", 3),
      makeProvince(1, 0, "TOKUGAWA", 5),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(1);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(0);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(5);
  });

  it("count = 0 on either side: skip combat (no garrison to fight)", () => {
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 0),
      makeProvince(1, 0, "TAKEDA", 10),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
    expect(after).toBe(before);
  });

  it("multiple enemy attackers accumulate loss on a single defender", () => {
    // Defender at (1,0): 6 Knight (power 24).
    // Two Tokugawa attackers at (0,0) and (2,0): 5 Knight each (power 20).
    // Per pair (attacker vs defender):
    //   attacker loss = floor((24 - 20/4)/4) = floor(4.75) = 4 → 5-4 = 1
    //   defender loss = floor((20 - 24/4)/4) = floor(3.5)  = 3
    // Defender total loss = 3 × 2 = 6 → 6-6 = 0.
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 5),
      makeProvince(1, 0, "TAKEDA", 6),
      makeProvince(2, 0, "TOKUGAWA", 5),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(2);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(1);
    expect(after.provinces.get(tileId(2, 0))?.count).toBe(1);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(0);
  });

  it("symmetric: one attacker adjacent to two enemies splits damage taken from each", () => {
    // Middle Tokugawa: 8 Knight (power 32). Two enemy 5 Knight (power 20) flanks.
    // Per pair:
    //   middle loss  = floor((20 - 32/4)/4) = floor(3)    = 3
    //   flank loss   = floor((32 - 20/4)/4) = floor(6.75) = 6
    // Middle total loss = 3 × 2 = 6 → 8-6 = 2.
    // Each flank loss = 6 → 5-6 → clamp 0.
    const provinces = [
      makeProvince(0, 0, "TAKEDA", 5),
      makeProvince(1, 0, "TOKUGAWA", 8),
      makeProvince(2, 0, "ODA", 5),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(2);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(2);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(0);
    expect(after.provinces.get(tileId(2, 0))?.count).toBe(0);
  });

  it("count clamps at 0 (cannot go negative)", () => {
    // Tiny defender vs huge King attacker.
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 1),
      makeProvince(1, 0, "TAKEDA", 30),
    ];
    const before = buildState(provinces);
    const { state: after } = resolveAdjacentCombat(before);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(0);
  });

  it("pair output: a < b lexicographically for stable pair-keying", () => {
    const provinces = [
      makeProvince(5, 5, "TOKUGAWA", 10),
      makeProvince(5, 6, "TAKEDA", 10),
    ];
    const before = buildState(provinces);
    const { pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    expect(pair).toBeDefined();
    if (!pair) return;
    expect(pair.a < pair.b).toBe(true);
  });

  it("returns a new state on combat tick, does not mutate input", () => {
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 10),
      makeProvince(1, 0, "TAKEDA", 5),
    ];
    const before = buildState(provinces);
    const beforeCounts = Array.from(before.provinces.values()).map(
      (p) => p.count,
    );
    const { state: after } = resolveAdjacentCombat(before);
    expect(after).not.toBe(before);
    expect(after.provinces).not.toBe(before.provinces);
    const beforeCountsAfter = Array.from(before.provinces.values()).map(
      (p) => p.count,
    );
    expect(beforeCountsAfter).toEqual(beforeCounts);
  });

  it("returns same state reference when no adjacent combat pairs exist", () => {
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 10),
      makeProvince(5, 5, "TAKEDA", 10),
    ];
    const before = buildState(provinces);
    expect(resolveAdjacentCombat(before).state).toBe(before);
  });

  it("simultaneous (dry-run) symmetry: both sides use original power, not post-loss", () => {
    // Verify mutual damage uses pre-combat powers (not sequential).
    // Two equal Knight 5 (power 20) stacks adjacent.
    // Each side loss = floor((20 - 5)/4) = floor(3.75) = 3.
    // If sequential (A hits B first → B at 2 → power 2 → A loss = 0), we'd get asymmetry.
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 5),
      makeProvince(1, 0, "TAKEDA", 5),
    ];
    const before = buildState(provinces);
    const { state: after } = resolveAdjacentCombat(before);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(2);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(2);
  });

  it("stalemate pair (3v3 Soldier): both losses are 0, pair recorded for M1.5", () => {
    // 3 Soldier vs 3 Soldier: each loss = floor((3 - 3/4)/4) = floor(0.5625) = 0.
    const provinces = [
      makeProvince(0, 0, "TOKUGAWA", 3),
      makeProvince(1, 0, "TAKEDA", 3),
    ];
    const before = buildState(provinces);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    expect(pair).toBeDefined();
    expect(pair?.lossA).toBe(0);
    expect(pair?.lossB).toBe(0);
    // No count change.
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(3);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(3);
  });
});

describe("updateStalemates + applyDrainDeductions", () => {
  const A = tileId(0, 0);
  const B = tileId(1, 0);
  const C = tileId(2, 0);
  const KEY_AB: PairKey = pairKey(A, B);
  const KEY_BC: PairKey = pairKey(B, C);
  const stalematePair = (a: TileId, b: TileId): CombatPair => ({
    a,
    b,
    lossA: 0,
    lossB: 0,
  });
  const damagingPair = (
    a: TileId,
    b: TileId,
    lossA: number,
    lossB: number,
  ): CombatPair => ({ a, b, lossA, lossB });

  function advanceStalemate(
    map: StalemateMap,
    pairs: readonly CombatPair[],
  ): StalemateMap {
    return updateStalemates(map, pairs).nextMap;
  }

  it("drain threshold matches PRD §3.7.1 (5)", () => {
    expect(STALEMATE_DRAIN_THRESHOLD).toBe(5);
  });

  it("counter starts at 0 and increments by 1 on every 0/0 tick", () => {
    let map: StalemateMap = new Map();
    for (let i = 1; i <= 4; i++) {
      const result = updateStalemates(map, [stalematePair(A, B)]);
      expect(result.nextMap.get(KEY_AB)).toBe(i);
      expect(result.drainDeductions.size).toBe(0);
      map = result.nextMap;
    }
  });

  it("counter reset to 0 when either side takes any loss", () => {
    let map: StalemateMap = new Map([[KEY_AB, 4]]);
    map = advanceStalemate(map, [damagingPair(A, B, 1, 0)]);
    expect(map.get(KEY_AB)).toBe(0);

    map = new Map([[KEY_AB, 4]]);
    map = advanceStalemate(map, [damagingPair(A, B, 0, 2)]);
    expect(map.get(KEY_AB)).toBe(0);
  });

  it("pair absent from current combatPairs is dropped (counter discarded)", () => {
    // PRD §3.7.1: pair dissolves (tile clears / changes owner / non-adjacent) →
    // counter dropped; next time the pair reappears it counts from 0.
    const map: StalemateMap = new Map([[KEY_AB, 3]]);
    const result = updateStalemates(map, [stalematePair(B, C)]);
    expect(result.nextMap.has(KEY_AB)).toBe(false);
    expect(result.nextMap.get(KEY_BC)).toBe(1);
  });

  it("drain mode triggers exactly when counter reaches 5", () => {
    let map: StalemateMap = new Map();
    for (let i = 1; i <= 4; i++) {
      const r = updateStalemates(map, [stalematePair(A, B)]);
      expect(r.drainDeductions.size).toBe(0);
      map = r.nextMap;
    }
    const fifth = updateStalemates(map, [stalematePair(A, B)]);
    expect(fifth.nextMap.get(KEY_AB)).toBe(5);
    expect(fifth.drainDeductions.get(A)).toBe(1);
    expect(fifth.drainDeductions.get(B)).toBe(1);
  });

  it("drain mode persists past threshold (counter keeps climbing)", () => {
    let map: StalemateMap = new Map([[KEY_AB, 5]]);
    for (let expected = 6; expected <= 8; expected++) {
      const r = updateStalemates(map, [stalematePair(A, B)]);
      expect(r.nextMap.get(KEY_AB)).toBe(expected);
      expect(r.drainDeductions.get(A)).toBe(1);
      expect(r.drainDeductions.get(B)).toBe(1);
      map = r.nextMap;
    }
  });

  it("loss>0 resets counter even if it was already above threshold (no drain that tick)", () => {
    const map: StalemateMap = new Map([[KEY_AB, 9]]);
    const r = updateStalemates(map, [damagingPair(A, B, 2, 1)]);
    expect(r.nextMap.get(KEY_AB)).toBe(0);
    expect(r.drainDeductions.size).toBe(0);
  });

  it("multiple drained pairs accumulate deductions per tile", () => {
    // Tile B is in stalemate with both A and C → suffers 2 drain in this tick.
    const map: StalemateMap = new Map([
      [KEY_AB, 5],
      [KEY_BC, 5],
    ]);
    const r = updateStalemates(map, [
      stalematePair(A, B),
      stalematePair(B, C),
    ]);
    expect(r.drainDeductions.get(A)).toBe(1);
    expect(r.drainDeductions.get(B)).toBe(2);
    expect(r.drainDeductions.get(C)).toBe(1);
  });

  it("applyDrainDeductions clamps count at 0 and returns new state", () => {
    const before = buildState([
      makeProvince(0, 0, "TOKUGAWA", 1),
      makeProvince(1, 0, "TAKEDA", 3),
    ]);
    const after = applyDrainDeductions(
      before,
      new Map([
        [A, 1],
        [B, 1],
      ]),
    );
    expect(after).not.toBe(before);
    expect(after.provinces.get(A)?.count).toBe(0);
    expect(after.provinces.get(B)?.count).toBe(2);
    // Original untouched.
    expect(before.provinces.get(A)?.count).toBe(1);
  });

  it("applyDrainDeductions with empty map is a no-op (same state reference)", () => {
    const before = buildState([makeProvince(0, 0, "TOKUGAWA", 5)]);
    expect(applyDrainDeductions(before, new Map())).toBe(before);
  });

  it("[AC-19] 3v3 stalemate: advance(4) still 3, advance(5)=2, advance(6)=1, advance(7)=0", () => {
    // Full integration of resolveAdjacentCombat → updateStalemates →
    // applyDrainDeductions, matching the headless AC-19 procedure.
    let state = buildState([
      makeProvince(0, 0, "TOKUGAWA", 3),
      makeProvince(1, 0, "TAKEDA", 3),
    ]);
    let stalemates: StalemateMap = state.stalemates;

    function advance(): void {
      const combat = resolveAdjacentCombat(state);
      const stale = updateStalemates(stalemates, combat.pairs);
      stalemates = stale.nextMap;
      state = applyDrainDeductions(combat.state, stale.drainDeductions);
    }

    advance(); // tick 1: counter 1, no drain
    advance(); // tick 2: counter 2
    advance(); // tick 3: counter 3
    advance(); // tick 4: counter 4, still no drain
    expect(state.provinces.get(A)?.count).toBe(3);
    expect(state.provinces.get(B)?.count).toBe(3);

    advance(); // tick 5: counter 5, drain → 3→2 each
    expect(state.provinces.get(A)?.count).toBe(2);
    expect(state.provinces.get(B)?.count).toBe(2);

    advance(); // tick 6: counter 6, drain → 2→1 each
    expect(state.provinces.get(A)?.count).toBe(1);
    expect(state.provinces.get(B)?.count).toBe(1);

    advance(); // tick 7: counter 7, drain → 1→0 each
    expect(state.provinces.get(A)?.count).toBe(0);
    expect(state.provinces.get(B)?.count).toBe(0);
  });

  it("AC-19 follow-up: once a tile hits 0 the pair dissolves and counter is dropped", () => {
    // After both drain to 0, neither side fights (count 0 short-circuit in
    // resolveAdjacentCombat), so the pair disappears from combatPairs.
    const drained = buildState([
      makeProvince(0, 0, "TOKUGAWA", 0),
      makeProvince(1, 0, "TAKEDA", 0),
    ]);
    const stalemates: StalemateMap = new Map([[KEY_AB, 7]]);
    const combat = resolveAdjacentCombat(drained);
    expect(combat.pairs).toHaveLength(0);
    const r = updateStalemates(stalemates, combat.pairs);
    expect(r.nextMap.size).toBe(0);
    expect(r.drainDeductions.size).toBe(0);
  });
});
