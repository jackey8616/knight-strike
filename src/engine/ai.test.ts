import { describe, expect, it } from "vitest";
import { RULE_PROFILES } from "./ai-profile";
import { shouldEvaluate, stepAi } from "./ai";
import { HOUSE_COST, makeEconomy } from "./economy";
import { tileId } from "./state";
import {
  AI_EASY,
  AI_IDLE,
  AI_NORMAL,
  type AiMode,
  type FactionId,
  type GameState,
  type Occupant,
  type Province,
  type TileId,
} from "./types";

type TileSpec = {
  readonly x: number;
  readonly y: number;
  readonly faction?: FactionId;
  readonly amount?: number;
  readonly isCastle?: boolean;
  readonly castleOwner?: FactionId;
};

type StateOpts = {
  readonly boardSize: number;
  readonly tiles: readonly TileSpec[];
  readonly aiConfig: Partial<Record<Exclude<FactionId, "NEUTRAL">, AiMode>>;
  readonly tick?: number;
  readonly seed?: number;
  readonly gold?: number;
  readonly defeated?: readonly FactionId[];
  // Mark every empty tile as last-claimed by this faction (so the expand /
  // rally rules treat the board as "already ours" and decline, isolating the
  // rule under test).
  readonly claimEmptiesFor?: FactionId;
};

function mkState(opts: StateOpts): GameState {
  const provinces = new Map<TileId, Province>();
  for (let y = 0; y < opts.boardSize; y++) {
    for (let x = 0; x < opts.boardSize; x++) {
      const id = tileId(x, y);
      provinces.set(id, {
        id,
        x,
        y,
        isCastle: false,
        castleOwner: null,
        occupants: [],
        lastClaimedFaction: null,
      });
    }
  }
  for (const t of opts.tiles) {
    const id = tileId(t.x, t.y);
    const hasTroops =
      t.faction !== undefined && t.amount !== undefined && t.amount > 0;
    const occupants: Occupant[] = hasTroops
      ? [
          {
            faction: t.faction as FactionId,
            amount: t.amount as number,
            arrivalTick: 0,
            isDefender: true,
          },
        ]
      : [];
    const castleOwner = t.isCastle
      ? (t.castleOwner ?? t.faction ?? null)
      : null;
    provinces.set(id, {
      id,
      x: t.x,
      y: t.y,
      isCastle: t.isCastle ?? false,
      castleOwner,
      occupants,
      lastClaimedFaction: hasTroops ? (t.faction as FactionId) : null,
    });
  }
  if (opts.claimEmptiesFor !== undefined) {
    for (const [id, p] of provinces) {
      if (p.occupants.length === 0) {
        provinces.set(id, { ...p, lastClaimedFaction: opts.claimEmptiesFor });
      }
    }
  }
  const aiConfig: Record<FactionId, AiMode> = {
    TOKUGAWA: opts.aiConfig.TOKUGAWA ?? AI_IDLE,
    TAKEDA: opts.aiConfig.TAKEDA ?? AI_IDLE,
    ODA: opts.aiConfig.ODA ?? AI_IDLE,
    UESUGI: opts.aiConfig.UESUGI ?? AI_IDLE,
    NEUTRAL: AI_IDLE,
  };
  return {
    boardSize: opts.boardSize,
    tick: opts.tick ?? 1,
    provinces,
    marchingStacks: [],
    attackOrders: [],
    aiConfig,
    economy: makeEconomy(opts.gold ?? 0),
    defeated: new Set<FactionId>(opts.defeated ?? []),
    rngSeed: (opts.seed ?? 1) >>> 0,
    nextMarchingId: 1,
  };
}

function from(stack: { path: readonly TileId[] }): TileId {
  return stack.path[0] as TileId;
}
function to(stack: { path: readonly TileId[] }): TileId {
  return stack.path[stack.path.length - 1] as TileId;
}

describe("ai: cadence (shouldEvaluate)", () => {
  it("evaluates all rule factions together every interval (no stagger)", () => {
    // Simultaneous evaluation: every faction fires on the same ticks (1, 6,
    // 11 … at the default interval 5) so there is no first / last mover.
    for (const f of ["TOKUGAWA", "TAKEDA", "ODA", "UESUGI"] as const) {
      expect(shouldEvaluate(f, 1)).toBe(true);
      expect(shouldEvaluate(f, 6)).toBe(true);
      expect(shouldEvaluate(f, 2)).toBe(false);
      expect(shouldEvaluate(f, 5)).toBe(false);
    }
  });

  it("repeats on the default interval and never fires for NEUTRAL / tick 0", () => {
    expect(shouldEvaluate("TOKUGAWA", 6)).toBe(true);
    expect(shouldEvaluate("TOKUGAWA", 2)).toBe(false);
    expect(shouldEvaluate("NEUTRAL", 1)).toBe(false);
    expect(shouldEvaluate("TOKUGAWA", 0)).toBe(false);
  });

  it("honours a custom evalInterval (Easy = 8)", () => {
    const easy = RULE_PROFILES.easy.evalInterval;
    expect(shouldEvaluate("TOKUGAWA", 1, easy)).toBe(true);
    expect(shouldEvaluate("TOKUGAWA", 9, easy)).toBe(true);
    expect(shouldEvaluate("TOKUGAWA", 2, easy)).toBe(false);
  });
});

describe("ai: mode gating", () => {
  const expandable: readonly TileSpec[] = [
    { x: 2, y: 2, faction: "TOKUGAWA", amount: 10 },
  ];

  it("idle mode never dispatches", () => {
    const s = mkState({
      boardSize: 5,
      tiles: expandable,
      aiConfig: { TOKUGAWA: AI_IDLE },
      tick: 1,
    });
    expect(stepAi(s).marchingStacks).toHaveLength(0);
  });

  it("scripted mode never dispatches", () => {
    const s = mkState({
      boardSize: 5,
      tiles: expandable,
      aiConfig: { TOKUGAWA: { kind: "scripted" } },
      tick: 1,
    });
    expect(stepAi(s).marchingStacks).toHaveLength(0);
  });

  it("defeated rule faction is skipped", () => {
    const s = mkState({
      boardSize: 5,
      tiles: expandable,
      aiConfig: { TOKUGAWA: AI_NORMAL },
      tick: 1,
      defeated: ["TOKUGAWA"],
    });
    expect(stepAi(s).marchingStacks).toHaveLength(0);
  });

  it("rule faction stays idle on a non-evaluation tick", () => {
    const s = mkState({
      boardSize: 5,
      tiles: expandable,
      aiConfig: { TOKUGAWA: AI_NORMAL },
      tick: 2, // Tokugawa evaluates at 1, 6, 11 ... not 2
    });
    expect(stepAi(s).marchingStacks).toHaveLength(0);
  });
});

describe("ai: rule #2 expand", () => {
  it("ships surplus from a field tile onto an adjacent empty tile", () => {
    const s = mkState({
      boardSize: 5,
      tiles: [{ x: 2, y: 2, faction: "TOKUGAWA", amount: 10 }],
      aiConfig: { TOKUGAWA: AI_NORMAL },
      tick: 1,
      seed: 7,
    });
    const next = stepAi(s);
    expect(next.marchingStacks).toHaveLength(1);
    const stack = next.marchingStacks[0]!;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(from(stack)).toBe(tileId(2, 2));
    expect(stack.count).toBe(5); // floor(10 * expandRatio 0.5)
    const neighbours = [
      tileId(1, 2),
      tileId(3, 2),
      tileId(2, 1),
      tileId(2, 3),
    ];
    expect(neighbours).toContain(to(stack));
  });

  it("only acts on an evaluation tick (tick 1, not tick 2)", () => {
    const tiles: readonly TileSpec[] = [
      { x: 3, y: 3, faction: "ODA", amount: 10 },
    ];
    const atTick1 = stepAi(
      mkState({ boardSize: 6, tiles, aiConfig: { ODA: AI_NORMAL }, tick: 1 }),
    );
    const atTick2 = stepAi(
      mkState({ boardSize: 6, tiles, aiConfig: { ODA: AI_NORMAL }, tick: 2 }),
    );
    expect(atTick1.marchingStacks).toHaveLength(1);
    expect(atTick2.marchingStacks).toHaveLength(0);
  });

  it("biases expansion toward the nearest enemy castle (directional)", () => {
    const s = mkState({
      boardSize: 7,
      tiles: [
        { x: 3, y: 3, faction: "TOKUGAWA", amount: 10 },
        // Strong enemy castle to the east: too tough to assault (9 < 100*1.15),
        // so expand runs and should push toward it rather than spread randomly.
        { x: 6, y: 3, faction: "TAKEDA", amount: 100, isCastle: true },
      ],
      aiConfig: { TOKUGAWA: AI_NORMAL, TAKEDA: AI_IDLE },
      tick: 1,
      seed: 7,
    });
    const next = stepAi(s);
    expect(next.marchingStacks).toHaveLength(1);
    const stack = next.marchingStacks[0]!;
    expect(from(stack)).toBe(tileId(3, 3));
    // (4,3) is the empty neighbour closest (manhattan 2) to the enemy castle at
    // (6,3); the other three neighbours are all distance 4.
    expect(to(stack)).toBe(tileId(4, 3));
  });
});

describe("ai: rule #1 defense", () => {
  it("rushes a reinforcement toward a threatened castle", () => {
    const s = mkState({
      boardSize: 5,
      tiles: [
        { x: 0, y: 0, faction: "TOKUGAWA", amount: 3, isCastle: true },
        { x: 1, y: 0, faction: "TAKEDA", amount: 2 }, // adjacent threat
        { x: 0, y: 2, faction: "TOKUGAWA", amount: 5 }, // reinforcement source
      ],
      aiConfig: { TOKUGAWA: AI_NORMAL, TAKEDA: AI_IDLE },
      tick: 1,
      // v1.4: reinforcement marches through (0,1); own-only passability needs
      // the lane claimed for the path to exist.
      claimEmptiesFor: "TOKUGAWA",
    });
    const next = stepAi(s);
    expect(next.marchingStacks).toHaveLength(1);
    const stack = next.marchingStacks[0]!;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(from(stack)).toBe(tileId(0, 2));
    expect(to(stack)).toBe(tileId(0, 0));
    expect(stack.count).toBe(2); // floor(5 * 0.5)
  });
});

describe("ai: rule #2.5 rally", () => {
  it("pulls from a neighbour into the strongest frontline anchor", () => {
    const s = mkState({
      boardSize: 5,
      tiles: [
        { x: 0, y: 0, faction: "TOKUGAWA", amount: 3, isCastle: true },
        { x: 2, y: 2, faction: "TOKUGAWA", amount: 3 }, // frontline anchor
        { x: 3, y: 2, faction: "NEUTRAL", amount: 1 }, // makes (2,2) a frontier
        { x: 1, y: 2, faction: "TOKUGAWA", amount: 10 }, // rally source
      ],
      aiConfig: { TOKUGAWA: AI_NORMAL },
      tick: 1,
      claimEmptiesFor: "TOKUGAWA", // suppress expand so rally is reached
    });
    const next = stepAi(s);
    expect(next.marchingStacks).toHaveLength(1);
    const stack = next.marchingStacks[0]!;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(from(stack)).toBe(tileId(1, 2));
    expect(to(stack)).toBe(tileId(2, 2));
    expect(stack.count).toBe(5); // min(floor(10 * 0.5), 10 - 1)
  });

  it("rally is disabled on Easy tier", () => {
    const s = mkState({
      boardSize: 5,
      tiles: [
        { x: 0, y: 0, faction: "TOKUGAWA", amount: 3, isCastle: true },
        { x: 2, y: 2, faction: "TOKUGAWA", amount: 3 },
        { x: 3, y: 2, faction: "NEUTRAL", amount: 1 },
        { x: 1, y: 2, faction: "TOKUGAWA", amount: 10 },
      ],
      aiConfig: { TOKUGAWA: AI_EASY },
      tick: 1,
      claimEmptiesFor: "TOKUGAWA",
    });
    // Easy: defense radius 1 (NEUTRAL too far), expand suppressed, rally off,
    // no live enemy castle → nothing to do.
    expect(stepAi(s).marchingStacks).toHaveLength(0);
  });
});

describe("ai: rule #3 attack", () => {
  it("sieges a reachable, weaker enemy castle", () => {
    const s = mkState({
      boardSize: 5,
      tiles: [
        { x: 0, y: 0, faction: "TOKUGAWA", amount: 3, isCastle: true },
        { x: 2, y: 2, faction: "TOKUGAWA", amount: 20 }, // strong striker
        { x: 4, y: 2, faction: "TAKEDA", amount: 2, isCastle: true }, // weak target
      ],
      aiConfig: { TOKUGAWA: AI_EASY, TAKEDA: AI_IDLE },
      tick: 1,
      claimEmptiesFor: "TOKUGAWA", // suppress expand; Easy has rally off
    });
    const next = stepAi(s);
    expect(next.marchingStacks).toHaveLength(1);
    const stack = next.marchingStacks[0]!;
    expect(stack.faction).toBe("TOKUGAWA");
    expect(from(stack)).toBe(tileId(2, 2));
    expect(to(stack)).toBe(tileId(4, 2));
    expect(stack.count).toBe(19); // count - 1 (keep one home)
  });

  it("converges multiple field tiles onto the weakest enemy castle", () => {
    const s = mkState({
      boardSize: 5,
      tiles: [
        { x: 1, y: 1, faction: "TOKUGAWA", amount: 100 },
        { x: 1, y: 3, faction: "TOKUGAWA", amount: 100 },
        { x: 3, y: 2, faction: "TAKEDA", amount: 100, isCastle: true },
      ],
      aiConfig: { TOKUGAWA: AI_NORMAL, TAKEDA: AI_IDLE },
      tick: 1,
      claimEmptiesFor: "TOKUGAWA",
    });
    const next = stepAi(s);
    // aggregate 99 + 99 = 198 ≥ 100 * 1.15 → both tiles march on the castle.
    expect(next.marchingStacks).toHaveLength(2);
    for (const stack of next.marchingStacks) {
      expect(stack.faction).toBe("TOKUGAWA");
      expect(to(stack)).toBe(tileId(3, 2));
      expect(stack.count).toBe(99);
    }
    const froms = next.marchingStacks.map(from).sort();
    expect(froms).toEqual([tileId(1, 1), tileId(1, 3)].sort());
  });

  it("declines when aggregate force can't beat the defender", () => {
    const s = mkState({
      boardSize: 5,
      tiles: [
        { x: 1, y: 1, faction: "TOKUGAWA", amount: 100 }, // 99 < 115 (100 * 1.15)
        { x: 3, y: 2, faction: "TAKEDA", amount: 100, isCastle: true },
      ],
      aiConfig: { TOKUGAWA: AI_NORMAL, TAKEDA: AI_IDLE },
      tick: 1,
      claimEmptiesFor: "TOKUGAWA", // no expand / rally outlet either
    });
    expect(stepAi(s).marchingStacks).toHaveLength(0);
  });

  it("attack reach scales with board size (fires past the old 8-hop cap)", () => {
    const s = mkState({
      boardSize: 15,
      tiles: [
        { x: 2, y: 7, faction: "TOKUGAWA", amount: 100 },
        { x: 2, y: 8, faction: "TOKUGAWA", amount: 100 },
        // 10 / 11 hops away — beyond the old fixed 8-hop cap, but within the
        // board-relative reach round(15 * 1.25) = 19.
        { x: 12, y: 7, faction: "TAKEDA", amount: 50, isCastle: true },
      ],
      aiConfig: { TOKUGAWA: AI_NORMAL, TAKEDA: AI_IDLE },
      tick: 1,
    });
    const next = stepAi(s);
    // aggregate 99 + 99 = 198 ≥ 50 * 1.15 → both converge on the distant castle.
    expect(next.marchingStacks).toHaveLength(2);
    for (const stack of next.marchingStacks) {
      expect(to(stack)).toBe(tileId(12, 7));
    }
  });
});

describe("ai: determinism", () => {
  function expandState(seed: number): GameState {
    return mkState({
      boardSize: 5,
      tiles: [{ x: 2, y: 2, faction: "TOKUGAWA", amount: 10 }],
      aiConfig: { TOKUGAWA: AI_NORMAL },
      tick: 1,
      seed,
    });
  }

  it("same seed + tick yields identical dispatches", () => {
    const a = stepAi(expandState(123));
    const b = stepAi(expandState(123));
    expect(a.marchingStacks).toEqual(b.marchingStacks);
  });

  it("the RNG shuffle is seed-sensitive (targets vary across seeds)", () => {
    const targets = new Set<TileId>();
    for (let seed = 1; seed <= 40; seed++) {
      const next = stepAi(expandState(seed));
      const stack = next.marchingStacks[0];
      if (stack !== undefined) targets.add(to(stack));
    }
    expect(targets.size).toBeGreaterThan(1);
  });
});

describe("tryBuildHouse (PRD §4.3)", () => {
  // A board fully claimed by TOKUGAWA (so expand finds no empty target and
  // declines), with a single garrisoned interior tile to build on and no enemy
  // (so defense / assault decline). Build is the only eligible rule.
  function buildState(gold: number): GameState {
    return mkState({
      boardSize: 5,
      tiles: [{ x: 2, y: 2, faction: "TOKUGAWA", amount: 5 }],
      aiConfig: { TOKUGAWA: AI_NORMAL },
      claimEmptiesFor: "TOKUGAWA",
      gold,
    });
  }

  it("[AC-27] a solvent AI builds a House on a garrisoned interior tile and spends gold", () => {
    const out = stepAi(buildState(HOUSE_COST));
    const p = out.provinces.get(tileId(2, 2)) as Province;
    expect(p.isHouse).toBe(true);
    expect(p.houseOwner).toBe("TOKUGAWA");
    expect(out.economy.TOKUGAWA.gold).toBe(0);
  });

  it("[AC-27] an insolvent AI does not build (no house, no spend)", () => {
    const out = stepAi(buildState(HOUSE_COST - 1));
    const p = out.provinces.get(tileId(2, 2)) as Province;
    expect(p.isHouse ?? false).toBe(false);
    expect(out.economy.TOKUGAWA.gold).toBe(HOUSE_COST - 1);
  });
});
