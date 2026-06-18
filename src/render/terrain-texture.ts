import { type Application, Graphics, Rectangle, type Texture } from "pixi.js";

import type { Terrain } from "@/engine/types";
import { TILE_HEIGHT, TILE_WIDTH } from "@/render/board";
import { GROUND, TERRAIN_TOP } from "@/render/terrain-theme";

// PRD §6.1: textured terrain top-faces. Each non-mountain terrain gets a handful
// of pre-rasterised 64×32 diamond textures (authored the same way as the unit
// sprites in sprites.ts — draw chunky pixels into a Graphics, then
// `generateTexture`). One Sprite per tile reuses a shared texture, so the rich
// surface costs one GPU upload per variant instead of per-tile geometry, and it
// stays OFF the per-tick redraw path (terrain never changes).

// Terrains that get a textured Sprite (MOUNTAIN draws its own shaded peak).
export type FlatTerrain = Exclude<Terrain, "MOUNTAIN">;
export type TerrainTextures = Readonly<Record<FlatTerrain, readonly Texture[]>>;

// Chunky 2px dither blocks: they read as crisp pixels and survive the down-scale
// applied to large boards better than 1px speckle (which can shimmer).
const TEXEL = 2;
const VARIANTS = 3;

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function terrainSeed(t: FlatTerrain): number {
  return t === "PLAINS" ? 0x9e3779b9 : t === "WATER" ? 0x85ebca6b : 0xc2b2ae35;
}

// A texel's colour. PLAINS/FOREST are weighted speckle; WATER bands by row so it
// reads as horizontal water streaks with the odd foam sparkle.
function texelColor(
  terrain: FlatTerrain,
  gy: number,
  r: number,
): number {
  const base = TERRAIN_TOP[terrain];
  if (terrain === "WATER") {
    if (r < 0.06) return GROUND.WATER_FOAM;
    const band = (gy + (r < 0.18 ? 1 : 0)) % 3;
    return band === 0
      ? GROUND.WATER_DEEP
      : band === 1
        ? base
        : GROUND.WATER_SHALLOW;
  }
  if (terrain === "PLAINS") {
    if (r < 0.06) return GROUND.PLAINS_DIRT;
    if (r < 0.34) return GROUND.PLAINS_LIGHT;
    if (r < 0.5) return GROUND.PLAINS_DARK;
    return base;
  }
  // FOREST: mostly the darker ground (trees sit on top), with depth specks.
  if (r < 0.3) return base;
  if (r < 0.45) return GROUND.FOREST_DARK;
  return GROUND.FOREST_GROUND;
}

// Pixel-centre inside the tile diamond? Diamond centred at (TW/2, TH/2) with
// half-extents (TW/2, TH/2): |dx|/hw + |dy|/hh <= 1. Centre-test slightly
// overfills the diamond by ≤1px, which the tile outline (drawn over it in
// board.ts) covers — better than eroding it and leaving a dark gap.
function insideDiamond(cx: number, cy: number): boolean {
  const dx = Math.abs(cx - TILE_WIDTH / 2) / (TILE_WIDTH / 2);
  const dy = Math.abs(cy - TILE_HEIGHT / 2) / (TILE_HEIGHT / 2);
  return dx + dy <= 1;
}

function swatchTexture(
  app: Application,
  terrain: FlatTerrain,
  variant: number,
): Texture {
  const g = new Graphics();
  const rng = lcg(terrainSeed(terrain) ^ Math.imul(variant + 1, 0x27d4eb2f));
  for (let py = 0; py < TILE_HEIGHT; py += TEXEL) {
    for (let px = 0; px < TILE_WIDTH; px += TEXEL) {
      if (!insideDiamond(px + TEXEL / 2, py + TEXEL / 2)) continue;
      g.rect(px, py, TEXEL, TEXEL);
      g.fill({ color: texelColor(terrain, py / TEXEL, rng()) });
    }
  }
  // `frame` pins the texture to the full 64×32 footprint (transparent outside
  // the diamond), so a Sprite with anchor (0.5,0.5) lines the diamond up exactly
  // with diamondPathAt in board.ts. NEAREST is inherited from app.ts.
  const tex = app.renderer.generateTexture({
    target: g,
    resolution: 1,
    frame: new Rectangle(0, 0, TILE_WIDTH, TILE_HEIGHT),
  });
  g.destroy();
  return tex;
}

export function createTerrainTextures(app: Application): TerrainTextures {
  const make = (terrain: FlatTerrain): readonly Texture[] =>
    Array.from({ length: VARIANTS }, (_, v) => swatchTexture(app, terrain, v));
  return {
    PLAINS: make("PLAINS"),
    WATER: make("WATER"),
    FOREST: make("FOREST"),
  };
}
