import { describe, expect, it } from "vitest";
import {
  applyDefeats,
  battleEfficiency,
  evaluateOutcome,
  occupationPenalty,
  scoreLevelEnd,
} from "./victory";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { FactionId, Field, GameState, House, Province, Unit } from "./types";

const unit = (id: string, owner: FactionId, pop = 100): Unit => ({
  id,
  owner,
  tile: tileId(0, 0),
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

const house = (id: string, owner: FactionId): House => ({
  id,
  owner,
  tile: tileId(1, 1),
  population: 50,
  connectedToCastle: false,
  lastGrowthDay: 0,
  lastExpansionDay: 0,
});

const razedCastle = (owner: FactionId, killer: FactionId | "MONSTER"): Map<string, Province> =>
  new Map([
    [
      tileId(3, 3),
      {
        id: tileId(3, 3),
        x: 3,
        y: 3,
        terrain: "PLAINS",
        isCastle: true,
        castleOwner: owner,
        castleDurability: 0,
        castleDestroyedBy: killer,
      },
    ],
  ]);

describe("applyDefeats — TERRITORY_LOST [AC-30]", () => {
  it("a nation with no house and no unit is eliminated; one unit OR one house survives", () => {
    const s = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("u1", "TOKUGAWA")], // only TOKUGAWA has anything
      houses: [house("h1", "ODA")], // ODA survives on a house alone
    });
    const r = applyDefeats(s);
    expect(r.state.defeated.has("TAKEDA")).toBe(true); // nothing → lost
    expect(r.state.defeated.has("UESUGI")).toBe(true);
    expect(r.state.defeated.has("TOKUGAWA")).toBe(false); // has a unit
    expect(r.state.defeated.has("ODA")).toBe(false); // has a house
    expect(r.events.some((e) => e.kind === "nation.defeated" && e.cause === "TERRITORY_LOST")).toBe(true);
  });
});

describe("applyDefeats — KING_KILLED [AC-31]", () => {
  const everyoneAlive = (extra: Partial<{ units: Unit[]; houses: House[]; provinces: Map<string, Province> }>) =>
    createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: extra.units ?? [],
      houses: extra.houses ?? [],
      provinces: extra.provinces ?? new Map(),
      factions: {
        ...defaultFactions(),
        TAKEDA: makeFaction("TAKEDA", { gold: 500 }),
        ODA: makeFaction("ODA", { gold: 100 }),
      },
    });

  it("a human killer inherits the victim's units, houses and gold", () => {
    const s = everyoneAlive({
      units: [unit("v1", "TAKEDA", 300), unit("o1", "ODA", 100)],
      houses: [house("vh", "TAKEDA")],
      provinces: razedCastle("TAKEDA", "ODA"),
    });
    const r = applyDefeats(s);
    expect(r.state.defeated.has("TAKEDA")).toBe(true);
    expect(r.state.units.find((u) => u.id === "v1")?.owner).toBe("ODA"); // unit inherited
    expect(r.state.houses.find((h) => h.id === "vh")?.owner).toBe("ODA"); // house inherited
    expect(r.state.factions.ODA.gold).toBe(600); // 100 + 500
    expect(r.events.some((e) => e.kind === "nation.defeated" && e.killer === "ODA")).toBe(true);
  });

  it("a MONSTER killer triggers the catastrophe (units → monsters, gold → 0)", () => {
    const s = everyoneAlive({
      units: [unit("v1", "TAKEDA", 300)],
      houses: [house("vh", "TAKEDA")],
      provinces: razedCastle("TAKEDA", "MONSTER"),
    });
    const r = applyDefeats(s);
    expect(r.state.units.find((u) => u.id === "v1")?.owner).toBe("MONSTER");
    expect(r.state.houses).toHaveLength(0);
    expect(r.state.factions.TAKEDA.gold).toBe(0);
    expect(r.events.some((e) => e.kind === "nation.consumed_by_monster")).toBe(true);
  });
});

describe("applyDefeats — TIME_OUT [AC-32/33]", () => {
  it("the player loses when elapsed days exceed the remaining budget (priority over others)", () => {
    const s: GameState = {
      ...createGameState({
        boardSize: 5,
        rngSeed: 1,
        units: [unit("u1", "TOKUGAWA"), unit("u2", "TAKEDA"), unit("u3", "ODA"), unit("u4", "UESUGI")],
        remainingDays: 5,
      }),
      elapsedDaysThisLevel: 10,
    };
    const r = applyDefeats(s);
    expect(r.state.defeated.has("TOKUGAWA")).toBe(true);
    expect(r.state.defeated.has("TAKEDA")).toBe(false);
    expect(r.events.some((e) => e.kind === "nation.defeated" && e.cause === "TIME_OUT")).toBe(true);
  });
});

describe("evaluateOutcome [AC-33]", () => {
  it("last nation standing → win; player defeated → loss; otherwise ongoing", () => {
    const base = createGameState({ boardSize: 5, rngSeed: 1 });
    const won = { ...base, defeated: new Set<FactionId>(["TAKEDA", "ODA", "UESUGI"]) };
    expect(evaluateOutcome(won)).toEqual({ kind: "win", winner: "TOKUGAWA" });
    const lost = { ...base, defeated: new Set<FactionId>(["TOKUGAWA"]) };
    expect(evaluateOutcome(lost)).toEqual({ kind: "loss" });
    expect(evaluateOutcome(base)).toEqual({ kind: "ongoing" });
  });
});

describe("level scoring [AC-34/35/36]", () => {
  it("[AC-34] occupation penalty = floor(remaining × (1 − rate))", () => {
    expect(occupationPenalty(1000, 0.5)).toBe(500);
    expect(occupationPenalty(1234, 1)).toBe(0);
  });

  it("[AC-35] battle efficiency: 1:1 → 100, 10:1 → capped 600, losing more → < 100", () => {
    expect(battleEfficiency(100, 100)).toBe(100);
    expect(battleEfficiency(100, 1000)).toBe(600); // capped
    expect(battleEfficiency(100, 50)).toBe(50);
    expect(battleEfficiency(0, 0)).toBe(600); // no losses → max
  });

  it("[AC-36] settlement order: +3000 − elapsed − occ penalty + efficiency bonus", () => {
    const fields: Field[] = [
      { owner: "TOKUGAWA", tile: tileId(0, 0) },
      { owner: "TOKUGAWA", tile: tileId(0, 1) },
    ];
    const s: GameState = {
      ...createGameState({
        boardSize: 2, // 4 buildable tiles → 2 own fields = 50% occupation
        rngSeed: 1,
        fields,
        remainingDays: 1000,
        factions: {
          ...defaultFactions(),
          TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, unitsLostTotal: 100, enemyLossesCredited: 200 }),
        },
      }),
      elapsedDaysThisLevel: 200,
    };
    const result = scoreLevelEnd(s);
    // 1000 + 3000 = 4000; −200 = 3800; −floor(3800×0.5)=−1900 → 1900; eff 200 → +100 → 2000
    expect(result.occupationRate).toBe(0.5);
    expect(result.daysDecrease).toBe(1900);
    expect(result.battleEfficiency).toBe(200);
    expect(result.daysIncrease).toBe(100);
    expect(result.finalRemainingDays).toBe(2000);
  });
});
