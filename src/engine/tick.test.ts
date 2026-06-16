import { describe, expect, it } from "vitest";
import { tileId } from "./state";
import { step } from "./tick";
import type {
  AiMode,
  FactionId,
  GameState,
  MarchingStack,
  Province,
  TileId,
} from "./types";

const idleAi: Readonly<Record<FactionId, AiMode>> = {
  TOKUGAWA: "idle",
  TAKEDA: "idle",
  ODA: "idle",
  UESUGI: "idle",
  NEUTRAL: "idle",
};

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
  return { id: tileId(x, y), x, y, owner, count, isCastle, lastClaimedAtTick: null };
}

type BuildOpts = {
  readonly provinces: readonly Province[];
  readonly tick?: number;
  readonly aiConfig?: Readonly<Record<FactionId, AiMode>>;
  readonly marchingStacks?: readonly MarchingStack[];
  readonly defeated?: ReadonlySet<FactionId>;
  readonly rngSeed?: number;
  readonly nextMarchingId?: number;
};

function buildState(opts: BuildOpts): GameState {
  const map = new Map<TileId, Province>();
  for (const p of opts.provinces) map.set(p.id, p);
  return {
    boardSize: 11,
    tick: opts.tick ?? 0,
    provinces: map,
    marchingStacks: opts.marchingStacks ?? [],
    stalemates: new Map(),
    aiConfig: opts.aiConfig ?? idleAi,
    defeated: opts.defeated ?? new Set<FactionId>(),
    rngSeed: opts.rngSeed ?? 42,
    nextMarchingId: opts.nextMarchingId ?? 1,
  };
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
  const defeated = [...state.defeated].sort().join(",");
  return `t${state.tick}|p[${provs.join(",")}]|m[${stacks.join(",")}]|d[${defeated}]`;
}

describe("[AC-02] step advances tick by exactly 1", () => {
  it("tick 0 → 1, tick 1 → 2, tick 9 → 10", () => {
    const base: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
    ];
    for (const startTick of [0, 1, 9]) {
      const out = step(buildState({ provinces: base, tick: startTick }));
      expect(out.tick).toBe(startTick + 1);
    }
  });
});

describe("step is pure (does not mutate input)", () => {
  it("input snapshot is unchanged after step()", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3, true),
        makeProvince(1, 0, "TAKEDA", 3, false),
      ],
      tick: 2,
    });
    const before = hashState(state);
    step(state);
    expect(hashState(state)).toBe(before);
  });

  it("same input → same output (deterministic under fixed rngSeed)", () => {
    const make = (): GameState =>
      buildState({
        provinces: [
          makeProvince(0, 0, "TOKUGAWA", 5, true),
          makeProvince(1, 0, "NEUTRAL", 0, false),
          makeProvince(0, 1, "NEUTRAL", 0, false),
        ],
        tick: 1,
        aiConfig: defaultAi,
        rngSeed: 42,
      });
    expect(hashState(step(make()))).toBe(hashState(step(make())));
  });
});

describe("production fires on PRD §3.2 cadence", () => {
  it("tick 1 → 2: no production (1 is odd)", () => {
    const state = buildState({
      provinces: [makeProvince(0, 0, "TOKUGAWA", 3, true)],
      tick: 1,
    });
    const out = step(state);
    expect(out.tick).toBe(2);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(3);
  });

  it("tick 2 → 3: castle +1 (2 is the first production tick)", () => {
    const state = buildState({
      provinces: [makeProvince(0, 0, "TOKUGAWA", 3, true)],
      tick: 2,
    });
    const out = step(state);
    expect(out.tick).toBe(3);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(4);
  });

  it("tick 0 → 1: no production (tick 0 is the initial-state guard)", () => {
    const state = buildState({
      provinces: [makeProvince(0, 0, "TOKUGAWA", 3, true)],
      tick: 0,
    });
    const out = step(state);
    expect(out.tick).toBe(1);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(3);
  });
});

describe("step composes movement before combat (PRD §3.2 step order)", () => {
  it("a marching stack at idx 0 advances to idx 1 within one step", () => {
    // Pre-seed a marching stack so we don't depend on AI's dispatch decision.
    const stack: MarchingStack = {
      id: "mstack:seed",
      faction: "TOKUGAWA",
      count: 2,
      path: [tileId(0, 0), tileId(1, 0), tileId(2, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 1, true),
        makeProvince(1, 0, "TOKUGAWA", 0, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
      marchingStacks: [stack],
      nextMarchingId: 2,
    });
    const out = step(state);
    expect(out.marchingStacks.length).toBe(1);
    expect((out.marchingStacks[0] as MarchingStack).idx).toBe(1);
  });

  it("a stack arriving at an empty tile terminus claims the tile (movement before defeats)", () => {
    const stack: MarchingStack = {
      id: "mstack:seed",
      faction: "TOKUGAWA",
      count: 3,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 0,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 1, true),
        makeProvince(1, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
      marchingStacks: [stack],
      nextMarchingId: 2,
    });
    const out = step(state);
    expect(out.marchingStacks.length).toBe(0);
    const claimed = out.provinces.get(tileId(1, 0)) as Province;
    expect(claimed.owner).toBe("TOKUGAWA");
    expect(claimed.count).toBe(3);
  });
});

describe("step composes defeats before production (PRD §3.2 step 3 then 4)", () => {
  it("castle captured this tick does not produce for the losing faction", () => {
    // Marching Tokugawa stack arrives at Takeda's castle (tick=2 so produce
    // would otherwise fire). After defeat conversion, Takeda is in `defeated`
    // and produce() skips it; the captured castle now belongs to Tokugawa, who
    // gets the +1 production instead.
    const stack: MarchingStack = {
      id: "mstack:seed",
      faction: "TOKUGAWA",
      count: 50,
      path: [tileId(0, 0), tileId(1, 0)],
      idx: 0,
      dispatchedAtTick: 1,
    };
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 1, true),
        makeProvince(1, 0, "TAKEDA", 3, true),
      ],
      tick: 2,
      marchingStacks: [stack],
      nextMarchingId: 2,
    });
    const out = step(state);
    const captured = out.provinces.get(tileId(1, 0)) as Province;
    expect(captured.owner).toBe("TOKUGAWA");
    expect(captured.isCastle).toBe(true);
    // capture surplus = arrival.count - lossOwn; the +1 from production lands
    // on top because the castle now belongs to Tokugawa, an undefeated faction.
    expect(captured.count).toBeGreaterThanOrEqual(1);
    expect(out.defeated.has("TAKEDA")).toBe(true);
  });
});

describe("step runs castle overflow after produce (PRD §3.2 v0.11 step order)", () => {
  it("produce push from count=30 to 31 immediately overflows the +1 to frontline", () => {
    // Castle starts at 30 (not over the threshold). On a production tick the
    // castle goes to 31, then overflow phase emits a marching stack count=1
    // and the castle drops back to 30 — all within the same tick. The (2,0)
    // tile is a TAK garrison (not NEUTRAL empty) so the claim phase between
    // combat and overflow can't convert it and erase the frontline; loss=0
    // both ways at count 1 vs 1, so the garrison still stands when overflow
    // evaluates.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 30, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "TAKEDA", 1, false),
      ],
      tick: 2,
    });
    const out = step(state);
    expect(out.tick).toBe(3);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(30);
    expect(out.marchingStacks.length).toBe(1);
    const stack = out.marchingStacks[0] as MarchingStack;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(stack.count).toBe(1);
    expect(stack.path[0]).toBe(tileId(0, 0));
    expect(stack.path[stack.path.length - 1]).toBe(tileId(1, 0));
    expect(stack.dispatchedAtTick).toBe(2);
  });

  it("castle at 30 on a non-production tick does not overflow", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 30, true),
        makeProvince(1, 0, "TOKUGAWA", 1, false),
        makeProvince(2, 0, "NEUTRAL", 0, false),
      ],
      tick: 1,
    });
    const out = step(state);
    expect(out.tick).toBe(2);
    expect((out.provinces.get(tileId(0, 0)) as Province).count).toBe(30);
    expect(out.marchingStacks.length).toBe(0);
  });
});

describe("step integrates AI input → movement → combat → defeats → produce", () => {
  it("full board runs 30 ticks without throwing and tick advances monotonically", () => {
    const size = 11;
    const provinces: Province[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        provinces.push(makeProvince(x, y, "NEUTRAL", 0, false));
      }
    }
    const set = (x: number, y: number, p: Province): void => {
      provinces[y * size + x] = p;
    };
    set(0, 0, makeProvince(0, 0, "TOKUGAWA", 3, true));
    set(size - 1, 0, makeProvince(size - 1, 0, "TAKEDA", 3, true));
    set(0, size - 1, makeProvince(0, size - 1, "ODA", 3, true));
    set(size - 1, size - 1, makeProvince(size - 1, size - 1, "UESUGI", 3, true));
    set(5, 5, makeProvince(5, 5, "NEUTRAL", 3, false));
    let state = buildState({
      provinces,
      tick: 1,
      aiConfig: defaultAi,
      rngSeed: 42,
    });
    for (let i = 0; i < 30; i++) {
      const before = state.tick;
      state = step(state);
      expect(state.tick).toBe(before + 1);
    }
  });
});
