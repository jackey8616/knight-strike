import { describe, expect, it } from "vitest";
import { pairDamage, resolveAdjacentCombat } from "./combat";
import { pairKey, tileId } from "./state";
import { deriveTier } from "./upgrade";
import { AI_IDLE } from "./types";
import type {
  AiMode,
  EngagementMap,
  FactionId,
  GameState,
  Province,
  TileId,
} from "./types";

const idleAi: Readonly<Record<FactionId, AiMode>> = {
  TOKUGAWA: AI_IDLE,
  TAKEDA: AI_IDLE,
  ODA: AI_IDLE,
  UESUGI: AI_IDLE,
  NEUTRAL: AI_IDLE,
};

function makeProvince(
  x: number,
  y: number,
  owner: FactionId,
  count: number,
  isCastle = false,
): Province {
  return { id: tileId(x, y), x, y, owner, count, isCastle };
}

function buildState(
  provinces: readonly Province[],
  engagements: EngagementMap = new Map(),
): GameState {
  const map = new Map<TileId, Province>();
  for (const p of provinces) map.set(p.id, p);
  return {
    boardSize: 11,
    tick: 1,
    provinces: map,
    marchingStacks: [],
    engagements,
    aiConfig: idleAi,
    defeated: new Set<FactionId>(),
    rngSeed: 1,
    nextMarchingId: 1,
  };
}

describe("pairDamage", () => {
  it("engagementTicks = 0 → 0 damage (the encounter tick is no-dmg)", () => {
    expect(pairDamage(0)).toBe(0);
  });

  it("ramp matches 2^(n-1) for n ≥ 1", () => {
    expect(pairDamage(1)).toBe(1);
    expect(pairDamage(2)).toBe(2);
    expect(pairDamage(3)).toBe(4);
    expect(pairDamage(4)).toBe(8);
    expect(pairDamage(5)).toBe(16);
  });

  it("negative input clamps to 0 (defensive)", () => {
    expect(pairDamage(-1)).toBe(0);
  });
});

describe("resolveAdjacentCombat", () => {
  it("first encounter (engagementTicks = 0): both sides take 0 damage, counter advances to 1", () => {
    const before = buildState([
      makeProvince(0, 0, "TOKUGAWA", 6),
      makeProvince(1, 0, "TAKEDA", 5),
    ]);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(after.provinces.get(tileId(0, 0))?.count).toBe(6);
    expect(after.provinces.get(tileId(1, 0))?.count).toBe(5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.damage).toBe(0);
    expect(pairs[0]?.engagementTicks).toBe(0);
    const key = pairKey(tileId(0, 0), tileId(1, 0));
    expect(after.engagements.get(key)).toBe(1);
  });

  it("[AC-08] 6 Knight vs 5 Knight ramp: (6,5)→(6,5)→(5,4)→(3,2)→(0,0)", () => {
    let state = buildState([
      makeProvince(0, 0, "TOKUGAWA", 6),
      makeProvince(1, 0, "TAKEDA", 5),
    ]);
    const a = tileId(0, 0);
    const b = tileId(1, 0);

    function advance(): void {
      state = resolveAdjacentCombat(state).state;
    }

    advance(); // engagementTicks 0→1, dmg 0
    expect(state.provinces.get(a)?.count).toBe(6);
    expect(state.provinces.get(b)?.count).toBe(5);
    expect(state.engagements.get(pairKey(a, b))).toBe(1);

    advance(); // engagementTicks 1→2, dmg 1
    expect(state.provinces.get(a)?.count).toBe(5);
    expect(state.provinces.get(b)?.count).toBe(4);
    expect(state.engagements.get(pairKey(a, b))).toBe(2);

    advance(); // engagementTicks 2→3, dmg 2
    expect(state.provinces.get(a)?.count).toBe(3);
    expect(state.provinces.get(b)?.count).toBe(2);
    expect(deriveTier(state.provinces.get(a)?.count ?? -1)).toBe("SOLDIER");
    expect(deriveTier(state.provinces.get(b)?.count ?? -1)).toBe("SOLDIER");
    expect(state.engagements.get(pairKey(a, b))).toBe(3);

    advance(); // engagementTicks 3→dissolved, dmg 4 (clamped to 0 on both)
    expect(state.provinces.get(a)?.count).toBe(0);
    expect(state.provinces.get(b)?.count).toBe(0);
    // Both sides at 0 → pair dissolves; key not written.
    expect(state.engagements.has(pairKey(a, b))).toBe(false);
  });

  it("[AC-19] 3v3 Soldier ramp: (3,3)→(3,3)→(2,2)→(0,0); pair dissolves after both clear", () => {
    let state = buildState([
      makeProvince(0, 0, "TOKUGAWA", 3),
      makeProvince(1, 0, "TAKEDA", 3),
    ]);
    const a = tileId(0, 0);
    const b = tileId(1, 0);
    const key = pairKey(a, b);

    function advance(): void {
      state = resolveAdjacentCombat(state).state;
    }

    advance(); // dmg 0 → (3, 3); counter = 1
    expect(state.provinces.get(a)?.count).toBe(3);
    expect(state.provinces.get(b)?.count).toBe(3);
    expect(state.engagements.get(key)).toBe(1);

    advance(); // dmg 1 → (2, 2); counter = 2
    expect(state.provinces.get(a)?.count).toBe(2);
    expect(state.provinces.get(b)?.count).toBe(2);
    expect(state.engagements.get(key)).toBe(2);

    advance(); // dmg 2 → (0, 0); pair dissolves (both at 0)
    expect(state.provinces.get(a)?.count).toBe(0);
    expect(state.provinces.get(b)?.count).toBe(0);
    expect(state.engagements.has(key)).toBe(false);

    advance(); // pair no longer combatPair → engagements stays empty
    expect(state.engagements.has(key)).toBe(false);
  });

  it("pair dissolution drops counter when one side clears mid-ramp", () => {
    // 1 vs 4 at engagementTicks = 1 (carried over) → dmg 1 → (0, 3). pair gone.
    const a = tileId(0, 0);
    const b = tileId(1, 0);
    const key = pairKey(a, b);
    const before = buildState(
      [makeProvince(0, 0, "TOKUGAWA", 1), makeProvince(1, 0, "TAKEDA", 4)],
      new Map([[key, 1]]),
    );
    const { state: after } = resolveAdjacentCombat(before);
    expect(after.provinces.get(a)?.count).toBe(0);
    expect(after.provinces.get(b)?.count).toBe(3);
    expect(after.engagements.has(key)).toBe(false);
  });

  it("re-engagement after dissolution restarts at engagementTicks = 0", () => {
    // Counter dropped, both sides newly garrisoned → next tick is a fresh
    // encounter with damage 0.
    const a = tileId(0, 0);
    const b = tileId(1, 0);
    const before = buildState([
      makeProvince(0, 0, "TOKUGAWA", 5),
      makeProvince(1, 0, "TAKEDA", 5),
    ]);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs[0]?.damage).toBe(0);
    expect(after.provinces.get(a)?.count).toBe(5);
    expect(after.provinces.get(b)?.count).toBe(5);
    expect(after.engagements.get(pairKey(a, b))).toBe(1);
  });

  it("4-adjacent only: diagonal tiles do not fight", () => {
    const before = buildState([
      makeProvince(0, 0, "TOKUGAWA", 10),
      makeProvince(1, 1, "TAKEDA", 10),
    ]);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
    expect(after).toBe(before);
  });

  it("[AC-36] 4-conn adjacency: combat pairs include cardinals, exclude diagonals", () => {
    const provinces = [
      makeProvince(5, 5, "TOKUGAWA", 10),
      makeProvince(6, 5, "TAKEDA", 10),
      makeProvince(4, 5, "TAKEDA", 10),
      makeProvince(5, 6, "TAKEDA", 10),
      makeProvince(5, 4, "TAKEDA", 10),
      makeProvince(6, 6, "TAKEDA", 10),
      makeProvince(4, 4, "TAKEDA", 10),
      makeProvince(6, 4, "TAKEDA", 10),
      makeProvince(4, 6, "TAKEDA", 10),
    ];
    const { pairs } = resolveAdjacentCombat(buildState(provinces));
    const center = tileId(5, 5);
    const partnersOfCenter = new Set<TileId>();
    for (const p of pairs) {
      if (p.a === center) partnersOfCenter.add(p.b);
      else if (p.b === center) partnersOfCenter.add(p.a);
    }
    expect(partnersOfCenter.size).toBe(4);
    expect(partnersOfCenter.has(tileId(6, 5))).toBe(true);
    expect(partnersOfCenter.has(tileId(4, 5))).toBe(true);
    expect(partnersOfCenter.has(tileId(5, 6))).toBe(true);
    expect(partnersOfCenter.has(tileId(5, 4))).toBe(true);
    expect(partnersOfCenter.has(tileId(6, 6))).toBe(false);
    expect(partnersOfCenter.has(tileId(4, 4))).toBe(false);
    expect(partnersOfCenter.has(tileId(6, 4))).toBe(false);
    expect(partnersOfCenter.has(tileId(4, 6))).toBe(false);
  });

  it("same-faction adjacent: no combat, engagements unchanged", () => {
    const before = buildState([
      makeProvince(0, 0, "TOKUGAWA", 10),
      makeProvince(1, 0, "TOKUGAWA", 10),
    ]);
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
    expect(after).toBe(before);
  });

  it("NEUTRAL vs NEUTRAL adjacent: no combat", () => {
    const before = buildState([
      makeProvince(0, 0, "NEUTRAL", 3),
      makeProvince(1, 0, "NEUTRAL", 3),
    ]);
    const { pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
  });

  it("NEUTRAL vs player: NEUTRAL participates (engages, ramps normally)", () => {
    // Encounter tick: dmg 0; next tick (counter 1): dmg 1.
    let state = buildState([
      makeProvince(0, 0, "NEUTRAL", 3),
      makeProvince(1, 0, "TOKUGAWA", 5),
    ]);
    state = resolveAdjacentCombat(state).state;
    expect(state.provinces.get(tileId(0, 0))?.count).toBe(3);
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(5);
    state = resolveAdjacentCombat(state).state;
    expect(state.provinces.get(tileId(0, 0))?.count).toBe(2);
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(4);
  });

  it("count = 0 on either side: skip combat, drop counter if it was stored", () => {
    const a = tileId(0, 0);
    const b = tileId(1, 0);
    const key = pairKey(a, b);
    const before = buildState(
      [makeProvince(0, 0, "TOKUGAWA", 0), makeProvince(1, 0, "TAKEDA", 10)],
      new Map([[key, 3]]),
    );
    const { state: after, pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(0);
    expect(after.engagements.has(key)).toBe(false);
  });

  it("multiple enemy attackers: per-pair counters independent, damage stacks", () => {
    // Defender at (1,0) flanked by two attackers. All three first-encounter
    // → counter 0 → dmg 0 across the board.
    let state = buildState([
      makeProvince(0, 0, "TOKUGAWA", 5),
      makeProvince(1, 0, "TAKEDA", 6),
      makeProvince(2, 0, "TOKUGAWA", 5),
    ]);
    state = resolveAdjacentCombat(state).state;
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(6);

    // Tick 2: counter 1 on both pairs → defender absorbs 1+1=2; attackers 1 each.
    state = resolveAdjacentCombat(state).state;
    expect(state.provinces.get(tileId(0, 0))?.count).toBe(4);
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(4);
    expect(state.provinces.get(tileId(2, 0))?.count).toBe(4);

    // Tick 3: counter 2 → defender absorbs 2+2=4; attackers 2 each.
    state = resolveAdjacentCombat(state).state;
    expect(state.provinces.get(tileId(0, 0))?.count).toBe(2);
    expect(state.provinces.get(tileId(1, 0))?.count).toBe(0);
    expect(state.provinces.get(tileId(2, 0))?.count).toBe(2);
  });

  it("pair output ordering: a < b lexicographically for stable keying", () => {
    const before = buildState([
      makeProvince(5, 5, "TOKUGAWA", 10),
      makeProvince(5, 6, "TAKEDA", 10),
    ]);
    const { pairs } = resolveAdjacentCombat(before);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    if (!pair) return;
    expect(pair.a < pair.b).toBe(true);
  });

  it("returns new state when damage is applied, does not mutate input", () => {
    const a = tileId(0, 0);
    const b = tileId(1, 0);
    const before = buildState(
      [makeProvince(0, 0, "TOKUGAWA", 10), makeProvince(1, 0, "TAKEDA", 5)],
      new Map([[pairKey(a, b), 2]]),
    );
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

  it("returns same state reference when no engagement pairs exist", () => {
    const before = buildState([
      makeProvince(0, 0, "TOKUGAWA", 10),
      makeProvince(5, 5, "TAKEDA", 10),
    ]);
    expect(resolveAdjacentCombat(before).state).toBe(before);
  });

  it("simultaneous (dry-run) symmetry: both sides take same damage in a single tick", () => {
    // Pre-set counter so we actually deal damage this tick.
    const a = tileId(0, 0);
    const b = tileId(1, 0);
    const before = buildState(
      [makeProvince(0, 0, "TOKUGAWA", 5), makeProvince(1, 0, "TAKEDA", 5)],
      new Map([[pairKey(a, b), 1]]),
    );
    const { state: after } = resolveAdjacentCombat(before);
    expect(after.provinces.get(a)?.count).toBe(4);
    expect(after.provinces.get(b)?.count).toBe(4);
  });

  it("damage clamps count at 0 (cannot go negative)", () => {
    const a = tileId(0, 0);
    const b = tileId(1, 0);
    const before = buildState(
      [makeProvince(0, 0, "TOKUGAWA", 1), makeProvince(1, 0, "TAKEDA", 30)],
      new Map([[pairKey(a, b), 5]]), // dmg 16
    );
    const { state: after } = resolveAdjacentCombat(before);
    expect(after.provinces.get(a)?.count).toBe(0);
    expect(after.provinces.get(b)?.count).toBe(14);
  });
});
