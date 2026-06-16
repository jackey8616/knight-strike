import { describe, expect, it } from "vitest";
import { RULE_PROFILES } from "./ai-profile";
import { shouldEvaluate, stepAi } from "./ai";
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
        combatStartTick: null,
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
      combatStartTick: null,
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
    aiConfig,
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

describe("ai: cadence / stagger (shouldEvaluate)", () => {
  it("staggers factions by offset Tokugawa 1 / Takeda 2 / Oda 3 / Uesugi 4", () => {
    expect(shouldEvaluate("TOKUGAWA", 1)).toBe(true);
    expect(shouldEvaluate("TAKEDA", 1)).toBe(false);
    expect(shouldEvaluate("TAKEDA", 2)).toBe(true);
    expect(shouldEvaluate("ODA", 3)).toBe(true);
    expect(shouldEvaluate("UESUGI", 4)).toBe(true);
  });

  it("repeats on the default interval and never fires for NEUTRAL", () => {
    expect(shouldEvaluate("TOKUGAWA", 6)).toBe(true);
    expect(shouldEvaluate("TOKUGAWA", 2)).toBe(false);
    expect(shouldEvaluate("NEUTRAL", 1)).toBe(false);
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

  it("respects the per-faction stagger (Oda acts at tick 3, not tick 1)", () => {
    const tiles: readonly TileSpec[] = [
      { x: 3, y: 3, faction: "ODA", amount: 10 },
    ];
    const atTick1 = stepAi(
      mkState({ boardSize: 6, tiles, aiConfig: { ODA: AI_NORMAL }, tick: 1 }),
    );
    const atTick3 = stepAi(
      mkState({ boardSize: 6, tiles, aiConfig: { ODA: AI_NORMAL }, tick: 3 }),
    );
    expect(atTick1.marchingStacks).toHaveLength(0);
    expect(atTick3.marchingStacks).toHaveLength(1);
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
