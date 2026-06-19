import { describe, expect, it } from "vitest";
import { step } from "./tick";
import { evaluateOutcome, scoreLevelEnd } from "./victory";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { FactionId, Province, Unit } from "./types";

const unit = (id: string, owner: FactionId): Unit => ({
  id,
  owner,
  tile: tileId(0, 0),
  population: 100,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

describe("M10 victory integration", () => {
  it("defeats resolve through the tick pipeline to a player win", () => {
    // TOKUGAWA alive; TAKEDA's castle already razed (by TOKUGAWA); ODA/UESUGI empty
    const provinces: Map<string, Province> = new Map([
      [
        tileId(4, 4),
        {
          id: tileId(4, 4),
          x: 4,
          y: 4,
          terrain: "PLAINS",
          isCastle: true,
          castleOwner: "TAKEDA",
          castleDurability: 0,
          castleDestroyedBy: "TOKUGAWA",
        },
      ],
    ]);
    const s0 = createGameState({
      boardSize: 5,
      rngSeed: 1,
      units: [unit("u1", "TOKUGAWA")],
      provinces,
      factions: { ...defaultFactions(), TAKEDA: makeFaction("TAKEDA", { gold: 200 }) },
    });

    // step twice to cross a day boundary (applyDefeats runs there)
    let s = step(s0).state;
    s = step(s).state;

    expect(s.defeated.has("TAKEDA")).toBe(true); // king killed
    expect(s.defeated.has("ODA")).toBe(true); // territory lost
    expect(s.defeated.has("UESUGI")).toBe(true);
    expect(s.factions.TOKUGAWA.gold).toBe(200); // inherited TAKEDA's treasury
    expect(evaluateOutcome(s)).toEqual({ kind: "win", winner: "TOKUGAWA" });
  });

  it("the level score carries a positive remainingDays into the next level", () => {
    const s = createGameState({
      boardSize: 3,
      rngSeed: 1,
      remainingDays: 500,
      factions: {
        ...defaultFactions(),
        TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, unitsLostTotal: 50, enemyLossesCredited: 150 }),
      },
    });
    const result = scoreLevelEnd(s);
    // 500 + 3000 − 0 elapsed − occ penalty + (efficiency 300 − 100)
    expect(result.finalRemainingDays).toBeGreaterThan(0);
    expect(result.battleEfficiency).toBe(300);
  });
});
