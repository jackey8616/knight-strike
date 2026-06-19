import { describe, expect, it } from "vitest";
import { runTicks } from "./tick";
import { createGameState, tileId } from "./state";
import type { MonsterNest } from "./types";

const nest = (id: string, x: number, y: number): MonsterNest => ({
  id,
  tile: tileId(x, y),
  accumulated: 0,
  createdTick: 0,
  durability: 100,
});

describe("M9 monster integration", () => {
  it("a nest spawns monster units through the tick pipeline (100 by day 40)", () => {
    const s0 = createGameState({ boardSize: 5, rngSeed: 1, nests: [nest("nest:1", 2, 2)] });
    // accumulations land on ticks 8,16,…,80 (the 10th → 100 → spawn); run past
    // tick 80 (runTicks processes ticks 0..n-1)
    const { state, events } = runTicks(s0, 84);
    expect(state.units.some((u) => u.owner === "MONSTER" && u.isMonster)).toBe(true);
    expect(events.some((e) => e.kind === "monster.spawned")).toBe(true);
    expect(events.some((e) => e.kind === "nest.accumulated")).toBe(true);
  });
});
