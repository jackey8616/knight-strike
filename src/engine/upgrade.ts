import type { Tier } from "./types";

// PRD v0.9 §3.4: 5 / 12 / 25. Original 5 / 15 / 30 made non-castle field
// tiles never reach Queen power, blocking M1.11 convergence; new values are
// a convergence patch documented in the PRD changelog.
export const KNIGHT_THRESHOLD = 5;
export const QUEEN_THRESHOLD = 12;
export const KING_THRESHOLD = 25;

export function deriveTier(count: number): Tier {
  if (count >= KING_THRESHOLD) return "KING";
  if (count >= QUEEN_THRESHOLD) return "QUEEN";
  if (count >= KNIGHT_THRESHOLD) return "KNIGHT";
  return "SOLDIER";
}
