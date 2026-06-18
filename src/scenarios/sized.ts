import {
  DEFAULT_MAP_SHAPE,
  MAP_SHAPES,
  type MapShape,
  parseScenario,
  type ScenarioInput,
} from "@/playtest/runner";
import type { RuleTier } from "@/engine/types";

export { DEFAULT_MAP_SHAPE, MAP_SHAPES, type MapShape } from "@/playtest/runner";

// Selectable map sizes (PRD §4.1). 11 is the original; the rest are the larger
// boards. The board auto-fits the viewport, so any size is playable.
export const MAP_SIZES = [11, 15, 19, 27] as const;
export type MapSize = (typeof MAP_SIZES)[number];
export const DEFAULT_MAP_SIZE: MapSize = 19;

// Selectable AI difficulty (PRD §5.3 / §6.2.1). Picked at the Start Menu and
// applied to all three non-player factions.
export const AI_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type Difficulty = (typeof AI_DIFFICULTIES)[number];
export const DEFAULT_DIFFICULTY: Difficulty = "normal";

// Build the standard 4-corner-castles + centre-neutral game at an arbitrary
// board size, AI difficulty, and map shape. Player (TOKUGAWA) idle so only the
// browser drives it; the other three corners run the chosen rule-AI difficulty
// (PRD §6.2.1).
export function makeScenario(
  boardSize: number,
  difficulty: RuleTier = DEFAULT_DIFFICULTY,
  shape: MapShape = DEFAULT_MAP_SHAPE,
  seed = 42,
): ScenarioInput {
  const max = boardSize - 1;
  const mid = Math.floor(boardSize / 2);
  return parseScenario({
    name: `play-${boardSize}x${boardSize}-${difficulty}-${shape}`,
    boardSize,
    initialState: [
      { x: 0, y: 0, owner: "TOKUGAWA", count: 3, isCastle: true },
      { x: max, y: 0, owner: "TAKEDA", count: 3, isCastle: true },
      { x: 0, y: max, owner: "ODA", count: 3, isCastle: true },
      { x: max, y: max, owner: "UESUGI", count: 3, isCastle: true },
      { x: mid, y: mid, owner: "NEUTRAL", count: 3, isCastle: false },
    ],
    aiConfig: {
      TOKUGAWA: "idle",
      TAKEDA: difficulty,
      ODA: difficulty,
      UESUGI: difficulty,
    },
    rngSeed: seed,
    mapShape: shape,
  });
}

// The map size chosen via the `?size=` query param, falling back to the
// default. Unknown values are ignored. PRD §4.1: the URL param is only the
// Start Menu's initial value (deep-link), not an in-game switcher.
export function readMapSize(search: string): MapSize {
  const v = Number(new URLSearchParams(search).get("size"));
  return (MAP_SIZES as readonly number[]).includes(v)
    ? (v as MapSize)
    : DEFAULT_MAP_SIZE;
}

// The AI difficulty chosen via the `?ai=` query param, falling back to the
// default. Unknown values are ignored. Seeds the Start Menu's initial pick.
export function readDifficulty(search: string): Difficulty {
  const v = new URLSearchParams(search).get("ai") ?? "";
  return (AI_DIFFICULTIES as readonly string[]).includes(v)
    ? (v as Difficulty)
    : DEFAULT_DIFFICULTY;
}

// The map shape chosen via the `?shape=` query param, falling back to the
// default. Unknown values are ignored. Seeds the Start Menu's initial pick.
export function readMapShape(search: string): MapShape {
  const v = new URLSearchParams(search).get("shape");
  return (MAP_SHAPES as readonly string[]).includes(v ?? "")
    ? (v as MapShape)
    : DEFAULT_MAP_SHAPE;
}

// The terrain seed: an explicit `?seed=N` (to reproduce a map) or a fresh random
// one per game so each Start gives a different map. Render-only callers pass it
// to setHeightSeed; the engine gets it via makeScenario's rngSeed.
export function readSeed(search: string, randomSeed: number): number {
  const v = Number(new URLSearchParams(search).get("seed"));
  return Number.isInteger(v) && v > 0 ? v >>> 0 : randomSeed >>> 0 || 1;
}
