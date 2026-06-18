import { describe, expect, it } from "vitest";
import { growPopulation, growthPerDay } from "./population";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { FactionId, Field, GameState, House } from "./types";

const house = (population: number, connectedToCastle: boolean): House => ({
  id: "house:1",
  owner: "TOKUGAWA",
  tile: tileId(2, 2),
  population,
  connectedToCastle,
  lastGrowthDay: 0,
  lastExpansionDay: 0,
});

// own fields on all 8 Moore neighbours of (2,2)
const eightFields = (): Field[] =>
  [
    [1, 1],
    [2, 1],
    [3, 1],
    [1, 2],
    [3, 2],
    [1, 3],
    [2, 3],
    [3, 3],
  ].map(([x, y]) => ({ owner: "TOKUGAWA" as FactionId, tile: tileId(x as number, y as number) }));

const atDay1 = (s: GameState): GameState => ({ ...s, day: 1 });

const taxed = (rate: number) => ({
  ...defaultFactions(),
  TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, taxRate: rate }),
});

describe("growthPerDay [AC-09]", () => {
  it("tax 0%: +2 with no fields, +10 with 8 fields", () => {
    expect(growthPerDay(0, 0)).toBe(2);
    expect(growthPerDay(8, 0)).toBe(10);
  });

  it("tax 30%: growth halts to 0", () => {
    expect(growthPerDay(0, 0.3)).toBe(0);
    expect(growthPerDay(8, 0.3)).toBe(0);
  });

  it("tax 15%: linear half (8 fields → floor(10/2) = 5)", () => {
    expect(growthPerDay(8, 0.15)).toBe(5);
  });
});

describe("growPopulation [AC-09]", () => {
  it("adds 8-field growth at tax 0 on a new day", () => {
    const s = atDay1(
      createGameState({ boardSize: 5, rngSeed: 1, houses: [house(50, true)], fields: eightFields() }),
    );
    const r = growPopulation(s);
    expect(r.state.houses[0]?.population).toBe(60); // +10
    expect(r.state.houses[0]?.lastGrowthDay).toBe(1);
  });

  it("a connected house at 30% tax does not grow", () => {
    const s = atDay1(
      createGameState({
        boardSize: 5,
        rngSeed: 1,
        houses: [house(50, true)],
        fields: eightFields(),
        factions: taxed(0.3),
      }),
    );
    expect(growPopulation(s).state.houses[0]?.population).toBe(50);
  });

  it("[AC-13] a disconnected house ignores tax (grows as if tax 0)", () => {
    const s = atDay1(
      createGameState({
        boardSize: 5,
        rngSeed: 1,
        houses: [house(50, false)], // disconnected
        fields: eightFields(),
        factions: taxed(0.3), // 30% — would halt if it applied
      }),
    );
    expect(growPopulation(s).state.houses[0]?.population).toBe(60); // +10 anyway
  });

  it("is day-gated: a second call on the same day adds nothing", () => {
    const s = atDay1(
      createGameState({ boardSize: 5, rngSeed: 1, houses: [house(50, true)], fields: eightFields() }),
    );
    const once = growPopulation(s).state;
    const twice = growPopulation(once);
    expect(twice.state).toBe(once);
  });
});
