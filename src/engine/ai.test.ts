import { describe, expect, it } from "vitest";
import {
  applyDrainDeductions,
  resolveAdjacentCombat,
  updateStalemates,
} from "./combat";
import { AI_EVAL_INTERVAL, shouldEvaluate, stepAi } from "./ai";
import { advanceMarching } from "./movement";
import { produce } from "./production";
import { tileId } from "./state";
import type {
  AiMode,
  FactionId,
  GameState,
  MarchingStack,
  Province,
  TileId,
} from "./types";
import { applyDefeats } from "./victory";

const defaultAi: Readonly<Record<FactionId, AiMode>> = {
  TOKUGAWA: "default",
  TAKEDA: "default",
  ODA: "default",
  UESUGI: "default",
  NEUTRAL: "idle",
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

type BuildOpts = {
  readonly provinces: readonly Province[];
  readonly marchingStacks?: readonly MarchingStack[];
  readonly tick?: number;
  readonly nextMarchingId?: number;
  readonly aiConfig?: Readonly<Record<FactionId, AiMode>>;
  readonly rngSeed?: number;
  readonly defeated?: ReadonlySet<FactionId>;
  readonly boardSize?: number;
};

function buildState(opts: BuildOpts): GameState {
  const map = new Map<TileId, Province>();
  for (const p of opts.provinces) map.set(p.id, p);
  return {
    boardSize: opts.boardSize ?? 11,
    tick: opts.tick ?? 1,
    provinces: map,
    marchingStacks: opts.marchingStacks ?? [],
    stalemates: new Map(),
    aiConfig: opts.aiConfig ?? defaultAi,
    defeated: opts.defeated ?? new Set<FactionId>(),
    rngSeed: opts.rngSeed ?? 42,
    nextMarchingId: opts.nextMarchingId ?? 1,
  };
}

function buildDefaultBoard(opts: {
  readonly tick?: number;
  readonly rngSeed?: number;
}): GameState {
  const size = 11;
  const provinces: Province[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      provinces.push(makeProvince(x, y, "NEUTRAL", 0, false));
    }
  }
  const set = (x: number, y: number, p: Province): void => {
    const idx = y * size + x;
    provinces[idx] = p;
  };
  set(0, 0, makeProvince(0, 0, "TOKUGAWA", 3, true));
  set(size - 1, 0, makeProvince(size - 1, 0, "TAKEDA", 3, true));
  set(0, size - 1, makeProvince(0, size - 1, "ODA", 3, true));
  set(size - 1, size - 1, makeProvince(size - 1, size - 1, "UESUGI", 3, true));
  set(5, 5, makeProvince(5, 5, "NEUTRAL", 3, false));
  return buildState({
    provinces,
    boardSize: size,
    tick: opts.tick ?? 1,
    rngSeed: opts.rngSeed ?? 42,
  });
}

// Composes the engine pieces M1.8 has access to, in PRD §3.2 step order
// (input → movement → combat+stalemate → produce → defeats). The real `step()`
// arrives in M1.9; this is a thin local fake just for AC-15 integration.
function fakeStep(state: GameState): GameState {
  let s = stepAi(state);
  s = advanceMarching(s);
  const cr = resolveAdjacentCombat(s);
  s = cr.state;
  const su = updateStalemates(s.stalemates, cr.pairs);
  s = applyDrainDeductions(
    { ...s, stalemates: su.nextMap },
    su.drainDeductions,
  );
  s = produce(s);
  s = applyDefeats(s);
  return { ...s, tick: s.tick + 1 };
}

function countOwnedTiles(state: GameState, faction: FactionId): number {
  let n = 0;
  for (const p of state.provinces.values()) if (p.owner === faction) n++;
  return n;
}

function hashState(state: GameState): string {
  const provs: string[] = [];
  for (const p of state.provinces.values()) {
    provs.push(`${p.id}:${p.owner}:${p.count}:${p.isCastle ? 1 : 0}`);
  }
  provs.sort();
  const stacks = state.marchingStacks
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(
      (s) =>
        `${s.id}:${s.faction}:${s.count}:${s.idx}:${s.dispatchedAtTick}:${s.path.join(">")}`,
    );
  return `t${state.tick}|p[${provs.join(",")}]|m[${stacks.join(",")}]`;
}

describe("shouldEvaluate (PRD §4.3 staggered offsets)", () => {
  it("TOKUGAWA fires at ticks 1, 6, 11 and skips between", () => {
    expect(shouldEvaluate("TOKUGAWA", 0)).toBe(false);
    expect(shouldEvaluate("TOKUGAWA", 1)).toBe(true);
    expect(shouldEvaluate("TOKUGAWA", 2)).toBe(false);
    expect(shouldEvaluate("TOKUGAWA", 5)).toBe(false);
    expect(shouldEvaluate("TOKUGAWA", 6)).toBe(true);
    expect(shouldEvaluate("TOKUGAWA", 11)).toBe(true);
  });

  it("TAKEDA / ODA / UESUGI fire on their offsets", () => {
    expect(shouldEvaluate("TAKEDA", 2)).toBe(true);
    expect(shouldEvaluate("TAKEDA", 7)).toBe(true);
    expect(shouldEvaluate("ODA", 3)).toBe(true);
    expect(shouldEvaluate("ODA", 8)).toBe(true);
    expect(shouldEvaluate("UESUGI", 4)).toBe(true);
    expect(shouldEvaluate("UESUGI", 9)).toBe(true);
  });

  it("NEUTRAL never evaluates", () => {
    for (let t = 0; t < 20; t++) expect(shouldEvaluate("NEUTRAL", t)).toBe(false);
  });

  it("interval is exactly 5 ticks", () => {
    expect(AI_EVAL_INTERVAL).toBe(5);
  });
});

describe("stepAi gating", () => {
  it("skips factions whose aiConfig is not 'default'", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5, true),
        makeProvince(1, 0, "NEUTRAL", 0),
      ],
      tick: 1,
      aiConfig: {
        TOKUGAWA: "idle",
        TAKEDA: "idle",
        ODA: "idle",
        UESUGI: "idle",
        NEUTRAL: "idle",
      },
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(0);
    expect(out).toBe(state);
  });

  it("skips defeated factions", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5, true),
        makeProvince(1, 0, "NEUTRAL", 0),
      ],
      tick: 1,
      defeated: new Set<FactionId>(["TOKUGAWA"]),
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(0);
  });

  it("does nothing when no rule triggers (count=3 castle, empty board)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3, true),
        makeProvince(1, 0, "NEUTRAL", 0),
        makeProvince(0, 1, "NEUTRAL", 0),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(0);
  });
});

describe("rule priority", () => {
  it("rule #1 (defense) preempts rule #2 when castle is threatened", () => {
    // Tokugawa castle at (0,0) count=5 (would trigger rule #2 alone), threatened
    // by Takeda garrison at (1,1) within manhattan 2. Own non-castle source at
    // (0,1) count=4 has BFS path back to the castle.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5, true),
        makeProvince(0, 1, "TOKUGAWA", 4),
        makeProvince(1, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "TAKEDA", 3),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.faction).toBe("TOKUGAWA");
    // 50% of 4 = 2 sent toward the castle, source (0,1) drops to 2.
    expect(stack.count).toBe(2);
    expect(stack.path[0]).toBe(tileId(0, 1));
    expect(stack.path[stack.path.length - 1]).toBe(tileId(0, 0));
    expect((out.provinces.get(tileId(0, 1)) as Province).count).toBe(2);
  });

  it("rule #2 (expansion) chains through own corridor when frontier empties are non-adjacent to the only ≥5 source", () => {
    // PRD §4.2: filter sources (count≥5), iterate until a deployable empty-target
    // combo is found — adjacency between source and target is not required, only
    // BFS-reachability. Castle (0,0) is the only eligible source under the v0.8
    // tiered reserve: Knight (count=6) sends `min(floor(6*0.25), 6-5) = 1`,
    // keeping source at 5. Direct neighbours (0,1)/(1,0) are own corridor;
    // frontier empties at (0,2)/(1,1)/(2,0) sit one hop further out.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 6, true),
        makeProvince(0, 1, "TOKUGAWA", 2),
        makeProvince(1, 0, "TOKUGAWA", 2),
        makeProvince(0, 2, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(stack.count).toBe(1);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(5);
    expect(stack.path[0]).toBe(tileId(0, 0));
    const dest = stack.path[stack.path.length - 1] as TileId;
    expect([tileId(0, 2), tileId(1, 1), tileId(2, 0)]).toContain(dest);
  });

  it("rule #2 (expansion) fires when castle ≥ 6 and adjacent empty exists, no threat", () => {
    // count=5 castle is a Knight at the reserve floor — sends 0, so we bump to
    // 6 to exercise the dispatch path. send = min(floor(6*0.25), 6-5) = 1.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 6, true),
        makeProvince(1, 0, "NEUTRAL", 0),
        makeProvince(0, 1, "NEUTRAL", 0),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.count).toBe(1);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(5);
    const dest = stack.path[stack.path.length - 1] as TileId;
    expect([tileId(1, 0), tileId(0, 1)]).toContain(dest);
  });

  it("rule #3 (attack) fires when reachable enemy castle within ATTACK_RANGE_HOPS and power ≥ 1.5×", () => {
    // Own (3,0) count=20 (Queen). PRD v0.8 §3.5.1 AI rule #3 keeps 1 troop on
    // source, so effectiveCount = 19 (still Queen, power 228). Target castle
    // count=3 (Soldier, power 3). Distance 1 hop. Send count=19.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 1, true),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TOKUGAWA", 0),
        makeProvince(3, 0, "TOKUGAWA", 20),
        makeProvince(4, 0, "TAKEDA", 3, true),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(stack.count).toBe(19);
    expect((out.provinces.get(tileId(3, 0)) as Province).count).toBe(1);
    expect(stack.path[stack.path.length - 1]).toBe(tileId(4, 0));
  });

  it("rule #3 skipped when power ratio is unfavorable", () => {
    // Source has only 3 vs enemy castle count=3 → power tie, fails ≥ 1.5×.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 1, true),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "TOKUGAWA", 0),
        makeProvince(3, 0, "TOKUGAWA", 3),
        makeProvince(4, 0, "TAKEDA", 3, true),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(0);
  });

  it("rule #3 skipped when enemy castle is farther than ATTACK_RANGE_HOPS (8)", () => {
    // PRD v0.8: ATTACK_RANGE_HOPS = 8. Source (1,0) → enemy (10,0) is 9 hops
    // through own corridor (2,0)..(9,0). 9 > 8 → skip.
    const provinces: Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 1, true),
      makeProvince(1, 0, "TOKUGAWA", 50),
    ];
    for (let x = 2; x <= 9; x++) provinces.push(makeProvince(x, 0, "TOKUGAWA", 0));
    provinces.push(makeProvince(10, 0, "TAKEDA", 3, true));
    const state = buildState({ provinces, tick: 1 });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(0);
  });

  it("[AC-27] castle Knight tier sends min(floor(c*0.25), c-5), source keeps ≥ 5", () => {
    // PRD v0.8 §4.1 rule #2: Knight castle count=8 → send min(2, 3)=2, source=6.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 8, true),
        makeProvince(1, 0, "NEUTRAL", 0),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.count).toBe(2);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(6);
  });

  it("[AC-28] castle Soldier tier (count < 5) blocks rule #2 entirely", () => {
    // No marching stack emerges: castle is the only source, Soldier-tier (<5)
    // is frozen by §4.1 reserve. No other rule fires (no threat, no enemy
    // castle in range), so fallthrough to rule #4 hoarding.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 4, true),
        makeProvince(1, 0, "NEUTRAL", 0),
        makeProvince(0, 1, "NEUTRAL", 0),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(0);
  });

  it("[AC-29] rule #3 fires at distance = 7 hops (≤ 8); source.count → 1", () => {
    // PRD v0.8 §4.1: ATTACK_RANGE_HOPS = 8. Source (3,0) Knight count=10
    // (power=40); target TAKEDA castle (10,0) count=3 (power=3). Path through
    // own corridor (4,0)..(9,0) has length 8 (7 hops). 7 ≤ 8, power 40 > 4.5.
    const provinces: Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 1, true),
      makeProvince(1, 0, "TOKUGAWA", 0),
      makeProvince(2, 0, "TOKUGAWA", 0),
      makeProvince(3, 0, "TOKUGAWA", 10),
    ];
    for (let x = 4; x <= 9; x++) provinces.push(makeProvince(x, 0, "TOKUGAWA", 0));
    provinces.push(makeProvince(10, 0, "TAKEDA", 3, true));
    const state = buildState({ provinces, tick: 1 });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.count).toBe(9); // 10 - 1 reserve
    expect((out.provinces.get(tileId(3, 0)) as Province).count).toBe(1);
    expect(stack.path[stack.path.length - 1]).toBe(tileId(10, 0));
    // Path length = 8 tiles (7 hops).
    expect(stack.path.length).toBe(8);
  });

  it("[AC-34] rule #2.5 rally: anchor = highest-count frontline non-castle; sources send min(floor(c*0.5), c-1)", () => {
    // PRD §4.1 rule #2.5: A (2,2) count=8 and B (5,5) count=5 are both
    // frontline non-castle tiles (TAK garrisons at (3,2)/(6,5) make them so
    // without enabling rule #2 expansion targets — targets need count=0).
    // A wins on count, anchoring the rally.
    // S1 (1,2) count=4 → min(floor(4*0.5), 4-1) = 2; S2 (2,1) count=6 →
    // min(floor(6*0.5), 6-1) = 3.
    // Castle (0,0) count=4 keeps rule #2 silent (Soldier tier reserve floor),
    // and the limited province map ensures expand has no count=0 targets to
    // chase, so rule #2.5 wins the short-circuit chain.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 4, true),
        makeProvince(2, 2, "TOKUGAWA", 8),
        makeProvince(5, 5, "TOKUGAWA", 5),
        makeProvince(1, 2, "TOKUGAWA", 4),
        makeProvince(2, 1, "TOKUGAWA", 6),
        makeProvince(3, 2, "TAKEDA", 1),
        makeProvince(6, 5, "TAKEDA", 1),
      ],
      tick: 1,
    });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(2);
    const byFrom = new Map<TileId, MarchingStack>();
    for (const ms of out.marchingStacks) {
      byFrom.set(ms.path[0] as TileId, ms);
    }
    const fromS1 = byFrom.get(tileId(1, 2)) as MarchingStack;
    const fromS2 = byFrom.get(tileId(2, 1)) as MarchingStack;
    expect(fromS1).toBeDefined();
    expect(fromS2).toBeDefined();
    expect(fromS1.count).toBe(2);
    expect(fromS1.path[fromS1.path.length - 1]).toBe(tileId(2, 2));
    expect(fromS2.count).toBe(3);
    expect(fromS2.path[fromS2.path.length - 1]).toBe(tileId(2, 2));
    expect((out.provinces.get(tileId(1, 2)) as Province).count).toBe(2);
    expect((out.provinces.get(tileId(2, 1)) as Province).count).toBe(3);
    expect((out.provinces.get(tileId(2, 2)) as Province).count).toBe(8);
  });

  it("[AC-30] rule #3 skipped at distance = 9 hops (> 8)", () => {
    // Same shape as AC-29 but source pushed one tile back so distance = 9.
    const provinces: Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 1, true),
      makeProvince(1, 0, "TOKUGAWA", 10),
    ];
    for (let x = 2; x <= 9; x++) provinces.push(makeProvince(x, 0, "TOKUGAWA", 0));
    provinces.push(makeProvince(10, 0, "TAKEDA", 3, true));
    const state = buildState({ provinces, tick: 1 });
    const out = stepAi(state);
    expect(out.marchingStacks.length).toBe(0);
  });
});

describe("[AC-22] AI evaluation is deterministic under rngSeed + factionId + tick", () => {
  function scenarioWithChoices(seed: number): GameState {
    // Castle has four adjacent empty NEUTRAL tiles → four valid rule #2 pairs,
    // shuffle order picks which one fires. Centre placement guarantees four
    // neighbors, exercising the RNG every time. count=6 so PRD v0.8 §4.1
    // Knight reserve permits dispatch (sends 1, source keeps 5).
    return buildState({
      provinces: [
        makeProvince(5, 5, "TOKUGAWA", 6, true),
        makeProvince(4, 5, "NEUTRAL", 0),
        makeProvince(6, 5, "NEUTRAL", 0),
        makeProvince(5, 4, "NEUTRAL", 0),
        makeProvince(5, 6, "NEUTRAL", 0),
      ],
      tick: 1,
      rngSeed: seed,
    });
  }

  it("same seed → identical destination", () => {
    const a = stepAi(scenarioWithChoices(42));
    const b = stepAi(scenarioWithChoices(42));
    const da = (a.marchingStacks[0] as MarchingStack).path.at(-1);
    const db = (b.marchingStacks[0] as MarchingStack).path.at(-1);
    expect(da).toBe(db);
  });

  it("at least one of several other seeds picks a different destination", () => {
    const baseline = (
      stepAi(scenarioWithChoices(42)).marchingStacks[0] as MarchingStack
    ).path.at(-1);
    const dests = new Set<string>();
    for (const seed of [1, 7, 13, 99, 256, 2024]) {
      const stack = stepAi(scenarioWithChoices(seed))
        .marchingStacks[0] as MarchingStack;
      dests.add(stack.path.at(-1) as string);
    }
    expect(dests.size).toBeGreaterThan(1);
    expect(dests.has(baseline as string)).toBe(true);
  });

  it("same factionId + rngSeed + tick reproduces shuffle across separate runs", () => {
    const sA = scenarioWithChoices(2024);
    const sB = scenarioWithChoices(2024);
    expect(hashState(stepAi(sA))).toBe(hashState(stepAi(sB)));
  });
});

describe("[AC-15] AI expansion within 30 ticks", () => {
  it("each AI faction controls ≥ 2 tiles by tick 30", () => {
    let state = buildDefaultBoard({ tick: 1, rngSeed: 42 });
    for (let i = 0; i < 30; i++) state = fakeStep(state);
    for (const faction of ["TOKUGAWA", "TAKEDA", "ODA", "UESUGI"] as const) {
      expect(countOwnedTiles(state, faction)).toBeGreaterThanOrEqual(2);
    }
  });

  it("seed reproducibility: hashState matches across two full 30-tick runs", () => {
    let a = buildDefaultBoard({ tick: 1, rngSeed: 42 });
    let b = buildDefaultBoard({ tick: 1, rngSeed: 42 });
    for (let i = 0; i < 30; i++) {
      a = fakeStep(a);
      b = fakeStep(b);
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it("different seeds produce a mix of end-states over a 30-tick run", () => {
    // 2-choice shuffles can coincidentally land on the same selection for some
    // seed pairs; require that across a sample of seeds at least two distinct
    // end-states appear, confirming RNG actually drives divergence.
    const hashes = new Set<string>();
    for (const seed of [42, 7, 99, 256, 12345, 2024]) {
      let s = buildDefaultBoard({ tick: 1, rngSeed: seed });
      for (let i = 0; i < 30; i++) s = fakeStep(s);
      hashes.add(hashState(s));
    }
    expect(hashes.size).toBeGreaterThan(1);
  });
});
