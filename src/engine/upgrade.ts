import type { Tier } from "./types";

export const KNIGHT_THRESHOLD = 5;
export const QUEEN_THRESHOLD = 15;
export const KING_THRESHOLD = 30;

export function deriveTier(count: number): Tier {
  if (count >= KING_THRESHOLD) return "KING";
  if (count >= QUEEN_THRESHOLD) return "QUEEN";
  if (count >= KNIGHT_THRESHOLD) return "KNIGHT";
  return "SOLDIER";
}
