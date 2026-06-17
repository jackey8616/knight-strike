import { parseScenario, type ScenarioInput } from "@/playtest/runner";

// Selectable map sizes (PRD §3.1, v1.6). 11 is the original; the rest are the
// larger boards. The board auto-fits the viewport, so any size is playable.
export const MAP_SIZES = [11, 15, 19, 27] as const;
export type MapSize = (typeof MAP_SIZES)[number];
export const DEFAULT_MAP_SIZE: MapSize = 19;

// Build the standard 4-corner-castles + centre-neutral game at an arbitrary
// board size. Player (TOKUGAWA) idle so only the browser drives it; the other
// three corners run Normal-tier rule AI.
export function makeScenario(boardSize: number, seed = 42): ScenarioInput {
  const max = boardSize - 1;
  const mid = Math.floor(boardSize / 2);
  return parseScenario({
    name: `play-${boardSize}x${boardSize}`,
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
      TAKEDA: "normal",
      ODA: "normal",
      UESUGI: "normal",
    },
    rngSeed: seed,
  });
}

// The map size chosen via the `?size=` query param, falling back to the
// default. Unknown values are ignored.
export function readMapSize(search: string): MapSize {
  const v = Number(new URLSearchParams(search).get("size"));
  return (MAP_SIZES as readonly number[]).includes(v)
    ? (v as MapSize)
    : DEFAULT_MAP_SIZE;
}
