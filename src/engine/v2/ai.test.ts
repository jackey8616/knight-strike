import { describe, expect, it } from "vitest";
import { mixSeed, stepAi } from "./ai";
import { createGameState, defaultFactions, makeFaction, serializeState, tileId } from "./state";
import type { AiMode, FactionId, Province, Unit } from "./types";

const unit = (id: string, owner: FactionId, x: number, y: number, pop: number): Unit => ({
  id,
  owner,
  tile: tileId(x, y),
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

const ai = (overrides: Partial<Record<FactionId, AiMode>>) => ({
  ...(Object.fromEntries(["TOKUGAWA", "TAKEDA", "ODA", "UESUGI", "NEUTRAL", "MONSTER"].map((f) => [f, "idle"])) as Record<FactionId, AiMode>),
  ...overrides,
});

const goldFor = (faction: FactionId, amount: number) => ({
  ...defaultFactions(),
  [faction]: makeFaction(faction, { gold: amount, isPlayer: faction === "TOKUGAWA" }),
});

describe("mixSeed", () => {
  it("is deterministic and varies by faction / tick", () => {
    expect(mixSeed(1, "TAKEDA", 5)).toBe(mixSeed(1, "TAKEDA", 5));
    expect(mixSeed(1, "TAKEDA", 5)).not.toBe(mixSeed(1, "ODA", 5));
    expect(mixSeed(1, "TAKEDA", 5)).not.toBe(mixSeed(1, "TAKEDA", 6));
  });
});

describe("stepAi", () => {
  it("[AI determinism] same state → identical result", () => {
    const s = createGameState({
      boardSize: 7,
      rngSeed: 9,
      aiConfig: ai({ TAKEDA: "normal" }),
      units: [unit("t1", "TAKEDA", 3, 3, 300)],
      factions: goldFor("TAKEDA", 200),
    });
    expect(serializeState(stepAi(s))).toBe(serializeState(stepAi(s)));
  });

  it("[AI economy] a funded AI builds a house from an idle army on open land", () => {
    const s = createGameState({
      boardSize: 7,
      rngSeed: 1,
      aiConfig: ai({ TAKEDA: "normal" }), // eval interval 5; tick 0 % 5 === 0
      units: [unit("t1", "TAKEDA", 3, 3, 200)], // below attack threshold, no enemies
      factions: goldFor("TAKEDA", 200),
    });
    const after = stepAi(s);
    expect(after.houses.some((h) => h.owner === "TAKEDA")).toBe(true);
    expect(after.factions.TAKEDA.gold).toBe(100); // spent 100
  });

  it("[AI attack] a strong AI army sieges an adjacent enemy castle", () => {
    const castle: Province = {
      id: tileId(4, 3),
      x: 4,
      y: 3,
      terrain: "PLAINS",
      isCastle: true,
      castleOwner: "TOKUGAWA",
      castleDurability: 300,
    };
    const s = createGameState({
      boardSize: 7,
      rngSeed: 1,
      aiConfig: ai({ TAKEDA: "hard" }), // threshold 150
      units: [unit("t1", "TAKEDA", 3, 3, 500)], // adjacent to (4,3), strong
      provinces: new Map([[tileId(4, 3), castle]]),
      factions: goldFor("TAKEDA", 0),
    });
    const after = stepAi(s);
    expect(after.units.find((u) => u.id === "t1")?.task?.kind).toBe("destruct");
  });

  it("[AI rally] a weak army with nothing to build marches to its own castle to merge", () => {
    const castle: Province = {
      id: tileId(0, 0),
      x: 0,
      y: 0,
      terrain: "PLAINS",
      isCastle: true,
      castleOwner: "TAKEDA",
      castleDurability: 300,
    };
    const s = createGameState({
      boardSize: 7,
      rngSeed: 1,
      aiConfig: ai({ TAKEDA: "normal" }),
      units: [unit("t1", "TAKEDA", 4, 4, 100)], // weak, far from its castle
      provinces: new Map([[tileId(0, 0), castle]]),
      factions: goldFor("TAKEDA", 0), // no gold → can't build → rally
    });
    const after = stepAi(s);
    expect(after.marchOrders.some((o) => o.unitId === "t1")).toBe(true);
  });

  it("[AI attack-march] a strong army marches toward a distant enemy castle", () => {
    const enemyCastle: Province = {
      id: tileId(6, 6),
      x: 6,
      y: 6,
      terrain: "PLAINS",
      isCastle: true,
      castleOwner: "TOKUGAWA",
      castleDurability: 300,
    };
    const s = createGameState({
      boardSize: 7,
      rngSeed: 1,
      aiConfig: ai({ TAKEDA: "hard" }), // range 1.75 × 7 ≈ 12 → in range
      units: [unit("t1", "TAKEDA", 5, 5, 500)], // strong, near but not adjacent
      provinces: new Map([[tileId(6, 6), enemyCastle]]),
      factions: goldFor("TAKEDA", 0),
    });
    const after = stepAi(s);
    const order = after.marchOrders.find((o) => o.unitId === "t1");
    expect(order).toBeDefined();
    expect(order?.path.at(-1)).toBe(tileId(6, 6)); // heading for the enemy castle
  });

  it("[AI economy] relocates to found a new house when it can't build in place", () => {
    const s = createGameState({
      boardSize: 7,
      rngSeed: 1,
      aiConfig: ai({ TAKEDA: "normal" }),
      units: [unit("t1", "TAKEDA", 2, 2, 100)], // weak, standing on its own house tile
      houses: [
        {
          id: "house:1",
          owner: "TAKEDA",
          tile: tileId(2, 2),
          population: 50,
          connectedToCastle: false,
          lastGrowthDay: 0,
          lastExpansionDay: 0,
        },
      ],
      factions: goldFor("TAKEDA", 300),
    });
    const after = stepAi(s);
    // tile occupied → can't build here → marches off to a build spot
    expect(after.marchOrders.some((o) => o.unitId === "t1")).toBe(true);
  });

  it("[idle] an idle faction never acts", () => {
    const s = createGameState({
      boardSize: 7,
      rngSeed: 1,
      aiConfig: ai({}), // all idle
      units: [unit("p1", "TOKUGAWA", 3, 3, 500)],
      factions: goldFor("TOKUGAWA", 500),
    });
    const after = stepAi(s);
    expect(after).toBe(s); // untouched
  });
});
