import type { Terrain } from "@/engine/types";

// Terrain palette + shading helpers, extracted from board.ts so the geometry/
// tint layer (board.ts) and the textured top-face authoring (terrain-texture.ts)
// share one source of truth. Pure constants — no Pixi/DOM, safe to import
// anywhere in the render layer.

export const TILE_OUTLINE_COLOR = 0x111111;

// PRD §6.1: terrain top-face base colours. The textured swatches in
// terrain-texture.ts dither around these; the faction colour is laid over the
// top face as a translucent wash so territory reads while terrain shows through.
export const TERRAIN_TOP: Readonly<Record<Terrain, number>> = {
  PLAINS: 0x3f6b3a,
  MOUNTAIN: 0x6f6f78,
  WATER: 0x2f5aa0,
  FOREST: 0x2f5530,
};

// Per-terrain pixel-art decorations drawn on the tile top face (grass tufts,
// trees, ripples, snow-capped rock) — chunky little features matching the
// pixel-art unit sprites. Seeded per-tile and drawn once at load.
export const DECOR = {
  GRASS: 0x6fa256,
  GRASS_DARK: 0x3c6b34,
  TRUNK: 0x6b4423,
  LEAF: 0x357a3c,
  LEAF_HI: 0x4f9a52,
  LEAF_DARK: 0x214b27,
  RIPPLE: 0x6fa0d8,
  SNOW: 0xeef2f6,
} as const;

// Dither tones for the textured top-faces (terrain-texture.ts swatchTexture):
// 2–4 shades per terrain around TERRAIN_TOP give plains a grass/dirt speckle,
// water horizontal streaks, and forest a darker ground that mostly sits under
// the tree decor.
export const GROUND = {
  PLAINS_LIGHT: 0x4d8048,
  PLAINS_DARK: 0x335a2f,
  PLAINS_DIRT: 0x6f5d39,
  WATER_DEEP: 0x244a86,
  WATER_SHALLOW: 0x3f6fbf,
  WATER_FOAM: 0x9cc0e8,
  FOREST_GROUND: 0x365f37,
  FOREST_DARK: 0x223f24,
} as const;

// Cosmetic raised lip on flat tiles (PRD §6.1): a few px of shaded side wall so
// tiles read as little raised earth blocks like the lm_exp ground. This is
// purely visual and is kept DISTINCT from a mountain's logical `elevation`
// (which drives the occlusion fade) — flat tiles keep elevation 0 and never
// fade. Water gets a smaller lip so it reads as sitting lower than the land.
export const EDGE_PX = 3;
export const WATER_EDGE_PX = 1;
export const EDGE_SHADE_SW = 0.58;
export const EDGE_SHADE_SE = 0.76;

export function shade(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}
