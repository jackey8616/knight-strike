import { Application, Graphics, type Texture } from "pixi.js";

import type { Tier } from "@/engine/types";

// PRD §5.1: per-tier unit models drawn as pixel-art bitmaps. Each cell is
// one texel; the texture is scaled up with NEAREST (set in app.ts) so it reads
// as crisp chunky pixels at any zoom. The body uses white ('*') so Pixi's
// multiplicative tint colours it to the faction hue; a mid-grey shade ('+')
// tints to a darker faction tone; the outline ('#') is near-black and stays
// dark under any tint. So one bitmap serves all four factions.
const PALETTE: Readonly<Record<string, number | null>> = {
  ".": null, // transparent
  "#": 0x1b1b24, // outline (stays dark under tint)
  "*": 0xffffff, // body → faction colour
  "+": 0x8c8c8c, // shade → darker faction tone
};

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

function bitmapTexture(app: Application, rows: readonly string[]): Texture {
  const g = new Graphics();
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < row.length; x++) {
      const color = PALETTE[row[x] as string];
      if (color === null || color === undefined) continue;
      g.rect(x, y, 1, 1);
      g.fill({ color });
    }
  }
  // resolution 1 → 1 cell = 1 texel; NEAREST scaling (app default) keeps it
  // pixel-crisp when the board scales it up.
  const tex = app.renderer.generateTexture({ target: g, resolution: 1 });
  g.destroy();
  return tex;
}

export type TierTextures = Readonly<Record<Tier, Texture>>;

export function createTierTextures(app: Application): TierTextures {
  const make = (tier: Tier): Texture =>
    bitmapTexture(app, [...HEADS[tier], ...BODY]);
  return {
    SOLDIER: make("SOLDIER"),
    KNIGHT: make("KNIGHT"),
    QUEEN: make("QUEEN"),
    KING: make("KING"),
  };
}
