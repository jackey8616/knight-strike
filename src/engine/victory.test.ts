import { describe, expect, it } from "vitest";
import { tileId } from "./state";
import { AI_IDLE } from "./types";
import type {
  AiMode,
  FactionId,
  GameState,
  MarchingStack,
  Province,
  TileId,
} from "./types";
import { applyDefeats, evaluateOutcome } from "./victory";

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

function makeStack(
  id: string,
  faction: FactionId,
  count: number,
  path: readonly TileId[],
  idx = 0,
  dispatchedAtTick = 1,
): MarchingStack {
  return { id, faction, count, path, idx, dispatchedAtTick };
}

function buildState(
  provinces: readonly Province[],
  options: {
    readonly defeated?: ReadonlySet<FactionId>;
    readonly marchingStacks?: readonly MarchingStack[];
  } = {},
): GameState {
  const map = new Map<TileId, Province>();
  for (const p of provinces) map.set(p.id, p);
  return {
    boardSize: 11,
    tick: 1,
    provinces: map,
    marchingStacks: options.marchingStacks ?? [],
    engagements: new Map(),
    aiConfig: idleAi,
    defeated: options.defeated ?? new Set<FactionId>(),
    rngSeed: 1,
    nextMarchingId: 1,
  };
}

const fourCastles: readonly Province[] = [
  makeProvince(0, 0, "TOKUGAWA", 3, true),
  makeProvince(10, 0, "TAKEDA", 3, true),
  makeProvince(0, 10, "ODA", 3, true),
  makeProvince(10, 10, "UESUGI", 3, true),
];

describe("applyDefeats", () => {
  it("marks a faction defeated when its castle is captured", () => {
    const provinces: readonly Province[] = [
      // Takeda's corner castle now flies the Tokugawa flag — Takeda is out.
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(10, 0, "TOKUGAWA", 4, true),
      makeProvince(0, 10, "ODA", 3, true),
      makeProvince(10, 10, "UESUGI", 3, true),
    ];
    const before = buildState(provinces);
    const after = applyDefeats(before);
    expect(after.defeated.has("TAKEDA")).toBe(true);
    expect(after.defeated.has("TOKUGAWA")).toBe(false);
    expect(after.defeated.has("ODA")).toBe(false);
    expect(after.defeated.has("UESUGI")).toBe(false);
  });

  it("[AC-10] converts the defeated faction's non-castle tiles to NEUTRAL", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(10, 0, "TOKUGAWA", 4, true),
      // Takeda's outer holdings keep their counts but flip to NEUTRAL bandits.
      makeProvince(9, 0, "TAKEDA", 7, false),
      makeProvince(10, 1, "TAKEDA", 2, false),
      makeProvince(0, 10, "ODA", 3, true),
      makeProvince(10, 10, "UESUGI", 3, true),
    ];
    const before = buildState(provinces);
    const after = applyDefeats(before);
    const t1 = after.provinces.get(tileId(9, 0));
    const t2 = after.provinces.get(tileId(10, 1));
    expect(t1?.owner).toBe("NEUTRAL");
    expect(t1?.count).toBe(7);
    expect(t2?.owner).toBe("NEUTRAL");
    expect(t2?.count).toBe(2);
  });

  it("[AC-10] preserves the captured castle's new owner", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      // Captured castle stays with the conqueror, not flipped to NEUTRAL.
      makeProvince(10, 0, "TOKUGAWA", 4, true),
      makeProvince(0, 10, "ODA", 3, true),
      makeProvince(10, 10, "UESUGI", 3, true),
    ];
    const after = applyDefeats(buildState(provinces));
    const castle = after.provinces.get(tileId(10, 0));
    expect(castle?.owner).toBe("TOKUGAWA");
    expect(castle?.count).toBe(4);
    expect(castle?.isCastle).toBe(true);
  });

  it("[§6.3] re-flags defeated faction's marching stacks as NEUTRAL", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(10, 0, "TOKUGAWA", 4, true),
      makeProvince(0, 10, "ODA", 3, true),
      makeProvince(10, 10, "UESUGI", 3, true),
      makeProvince(5, 0, "NEUTRAL", 0, false),
      makeProvince(6, 0, "NEUTRAL", 0, false),
    ];
    const stack = makeStack(
      "mstack:7",
      "TAKEDA",
      5,
      [tileId(5, 0), tileId(6, 0)],
      0,
      3,
    );
    const before = buildState(provinces, { marchingStacks: [stack] });
    const after = applyDefeats(before);
    expect(after.marchingStacks).toHaveLength(1);
    const survivor = after.marchingStacks[0] as MarchingStack;
    expect(survivor.faction).toBe("NEUTRAL");
    expect(survivor.count).toBe(5);
    expect(survivor.path).toBe(stack.path);
    expect(survivor.idx).toBe(0);
    expect(survivor.dispatchedAtTick).toBe(3);
    expect(survivor.id).toBe("mstack:7");
  });

  it("leaves living factions' marching stacks untouched", () => {
    const stack = makeStack("mstack:1", "TOKUGAWA", 2, [
      tileId(1, 0),
      tileId(2, 0),
    ]);
    const before = buildState(fourCastles, { marchingStacks: [stack] });
    const after = applyDefeats(before);
    expect(after.marchingStacks[0]).toBe(stack);
  });

  it("handles multiple newly defeated factions in a single call", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      // Tokugawa just rolled up two castles in the same tick.
      makeProvince(10, 0, "TOKUGAWA", 4, true),
      makeProvince(0, 10, "TOKUGAWA", 2, true),
      makeProvince(9, 0, "TAKEDA", 3, false),
      makeProvince(1, 10, "ODA", 6, false),
      makeProvince(10, 10, "UESUGI", 3, true),
    ];
    const after = applyDefeats(buildState(provinces));
    expect(after.defeated.has("TAKEDA")).toBe(true);
    expect(after.defeated.has("ODA")).toBe(true);
    expect(after.defeated.has("UESUGI")).toBe(false);
    expect(after.provinces.get(tileId(9, 0))?.owner).toBe("NEUTRAL");
    expect(after.provinces.get(tileId(1, 10))?.owner).toBe("NEUTRAL");
  });

  it("keeps already-defeated factions in the set without re-processing", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(10, 0, "TAKEDA", 3, true),
      makeProvince(0, 10, "ODA", 3, true),
      makeProvince(10, 10, "UESUGI", 3, true),
    ];
    const before = buildState(provinces, {
      defeated: new Set<FactionId>(["ODA"]),
    });
    const after = applyDefeats(before);
    expect(after).toBe(before);
    expect(after.defeated.has("ODA")).toBe(true);
  });

  it("returns the same state reference when no faction is newly defeated", () => {
    const before = buildState(fourCastles);
    expect(applyDefeats(before)).toBe(before);
  });

  it("does not mutate the input state", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(10, 0, "TOKUGAWA", 4, true),
      makeProvince(9, 0, "TAKEDA", 7, false),
      makeProvince(0, 10, "ODA", 3, true),
      makeProvince(10, 10, "UESUGI", 3, true),
    ];
    const stack = makeStack("mstack:1", "TAKEDA", 4, [
      tileId(8, 0),
      tileId(9, 0),
    ]);
    const before = buildState(provinces, { marchingStacks: [stack] });
    const beforeDefeated = new Set(before.defeated);
    const beforeTakedaTile = before.provinces.get(tileId(9, 0));
    const beforeStackFaction = (
      before.marchingStacks[0] as MarchingStack
    ).faction;

    const after = applyDefeats(before);

    expect(after).not.toBe(before);
    expect(after.provinces).not.toBe(before.provinces);
    expect(after.defeated).not.toBe(before.defeated);
    expect(Array.from(before.defeated)).toEqual(Array.from(beforeDefeated));
    expect(beforeTakedaTile?.owner).toBe("TAKEDA");
    expect(beforeStackFaction).toBe("TAKEDA");
  });
});

describe("evaluateOutcome", () => {
  it("returns ongoing when 2+ non-NEUTRAL factions remain", () => {
    const state = buildState(fourCastles);
    expect(evaluateOutcome(state)).toEqual({ status: "ongoing" });
  });

  it("[AC-12 engine] returns ended with the lone survivor as winner", () => {
    const state = buildState(fourCastles, {
      defeated: new Set<FactionId>(["TAKEDA", "ODA", "UESUGI"]),
    });
    expect(evaluateOutcome(state)).toEqual({
      status: "ended",
      winner: "TOKUGAWA",
    });
  });

  it("[AC-11 engine] returns ended with another faction as winner when player is defeated and one rival remains", () => {
    const state = buildState(fourCastles, {
      defeated: new Set<FactionId>(["TOKUGAWA", "ODA", "UESUGI"]),
    });
    expect(evaluateOutcome(state)).toEqual({
      status: "ended",
      winner: "TAKEDA",
    });
  });

  it("returns ended with winner=null when zero factions remain", () => {
    const state = buildState(fourCastles, {
      defeated: new Set<FactionId>(["TOKUGAWA", "TAKEDA", "ODA", "UESUGI"]),
    });
    expect(evaluateOutcome(state)).toEqual({ status: "ended", winner: null });
  });

  it("still ongoing when player is defeated but two rivals remain", () => {
    const state = buildState(fourCastles, {
      defeated: new Set<FactionId>(["TOKUGAWA", "ODA"]),
    });
    expect(evaluateOutcome(state)).toEqual({ status: "ongoing" });
  });
});

describe("applyDefeats + evaluateOutcome", () => {
  it("[AC-12 engine] player captures last enemy castle → ended, winner=TOKUGAWA", () => {
    const provinces: readonly Province[] = [
      makeProvince(0, 0, "TOKUGAWA", 3, true),
      makeProvince(10, 0, "TOKUGAWA", 4, true),
      makeProvince(0, 10, "TOKUGAWA", 2, true),
      makeProvince(10, 10, "TOKUGAWA", 2, true),
    ];
    const before = buildState(provinces);
    const after = applyDefeats(before);
    expect(after.defeated.has("TAKEDA")).toBe(true);
    expect(after.defeated.has("ODA")).toBe(true);
    expect(after.defeated.has("UESUGI")).toBe(true);
    expect(evaluateOutcome(after)).toEqual({
      status: "ended",
      winner: "TOKUGAWA",
    });
  });

  it("[AC-11 engine] player's castle is taken → player defeated; if rivals remain it stays ongoing", () => {
    const provinces: readonly Province[] = [
      // Takeda has overrun Tokugawa's home corner.
      makeProvince(0, 0, "TAKEDA", 5, true),
      makeProvince(10, 0, "TAKEDA", 3, true),
      makeProvince(0, 10, "ODA", 3, true),
      makeProvince(10, 10, "UESUGI", 3, true),
    ];
    const after = applyDefeats(buildState(provinces));
    expect(after.defeated.has("TOKUGAWA")).toBe(true);
    expect(evaluateOutcome(after)).toEqual({ status: "ongoing" });
  });
});
