import type { Tier } from "@/engine/types";

// Pixel-art source for unit sprites, shared by the Pixi renderer (sprites.ts,
// which bakes it into tinted textures) and the DOM Start-Menu demo
// (ui/start-menu.ts, which draws it as tinted SVG rects) so both render the
// identical figure. One bitmap serves all four factions: a '*' body cell is
// tinted to the faction colour, '+' to a darker faction tone, '#' is a
// near-black outline that survives any tint, '.' is transparent.
export type UnitCell = "outline" | "body" | "shade" | "empty";

export function unitCellOf(ch: string): UnitCell {
  switch (ch) {
    case "#":
      return "outline";
    case "*":
      return "body";
    case "+":
      return "shade";
    default:
      return "empty";
  }
}

// Shared lower body (rows 6–15) — a robed figure widening to a base.
const BODY: readonly string[] = [
  "...#######...",
  "..#*******#..",
  "..#*******#..",
  "..#**+++**#..",
  "..#*******#..",
  ".#*********#.",
  ".#*********#.",
  "#***********#",
  "#***********#",
  "#############",
];

// Head / crown rows (0–5) per tier.
const HEADS: Readonly<Record<Tier, readonly string[]>> = {
  SOLDIER: [
    ".............",
    ".....###.....",
    "....#***#....",
    "....#*+*#....",
    "....#***#....",
    ".....#*#.....",
  ],
  KNIGHT: [
    ".............",
    "....#####....",
    "...#*****#...",
    "...##***##...",
    "...#*###*#...",
    "....#***#....",
  ],
  QUEEN: [
    "...#*#*#*#...",
    "...#*****#...",
    "....#***#....",
    "....#*+*#....",
    "....#***#....",
    ".....#*#.....",
  ],
  KING: [
    "..#*#*#*#*#..",
    "..#*******#..",
    "...#*****#...",
    "....#***#....",
    "....#*+*#....",
    ".....#*#.....",
  ],
};

export function unitBitmapRows(tier: Tier): readonly string[] {
  return [...HEADS[tier], ...BODY];
}
