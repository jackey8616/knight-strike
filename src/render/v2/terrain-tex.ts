import { type Application, Graphics, Rectangle, type Texture } from "pixi.js";
import type { Terrain } from "@/engine/v2/types";

// Self-contained pixel-art terrain textures for the v2 board (no dependency on
// the v1 render). Each terrain gets a few pre-rasterised 64×32 dithered diamond
// textures (chunky 2px texels → crisp under nearest-neighbour); one shared
// texture per tile keeps the rich surface off the per-tick redraw path.
export const TILE_W = 64;
export const TILE_H = 32;
const TEXEL = 2;
const VARIANTS = 3;

const BASE: Readonly<Record<Terrain, number>> = {
  PLAINS: 0x3f6b3a,
  FOREST: 0x2f5530,
  WATER: 0x2f5aa0,
  MOUNTAIN: 0x6f6f78,
  LAVA: 0x3a2420,
};

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const TERRAIN_SEED: Readonly<Record<Terrain, number>> = {
  PLAINS: 0x9e3779b9,
  FOREST: 0xc2b2ae35,
  WATER: 0x85ebca6b,
  MOUNTAIN: 0x27d4eb2f,
  LAVA: 0x165667b1,
};

function texelColor(terrain: Terrain, gy: number, r: number): number {
  const base = BASE[terrain];
  switch (terrain) {
    case "WATER": {
      if (r < 0.06) return 0x9cc0e8; // foam
      const band = (gy + (r < 0.18 ? 1 : 0)) % 3;
      return band === 0 ? 0x244a86 : band === 1 ? base : 0x3f6fbf;
    }
    case "PLAINS":
      if (r < 0.06) return 0x6f5d39; // dirt fleck
      if (r < 0.34) return 0x4d8048;
      if (r < 0.5) return 0x335a2f;
      return base;
    case "FOREST":
      if (r < 0.32) return 0x214b27;
      if (r < 0.6) return 0x365f37;
      return base;
    case "MOUNTAIN":
      if (r < 0.2) return 0x55555e;
      if (r < 0.5) return 0x83838c;
      return base;
    case "LAVA":
      if (r < 0.12) return 0xffae3a; // bright crack
      if (r < 0.24) return 0xff6a2a; // glowing lava
      if (r < 0.4) return 0x5a2f22;
      return base;
  }
}

function insideDiamond(cx: number, cy: number): boolean {
  const dx = Math.abs(cx - TILE_W / 2) / (TILE_W / 2);
  const dy = Math.abs(cy - TILE_H / 2) / (TILE_H / 2);
  return dx + dy <= 1;
}

function swatch(app: Application, terrain: Terrain, variant: number): Texture {
  const g = new Graphics();
  const rng = lcg(TERRAIN_SEED[terrain] ^ Math.imul(variant + 1, 0x27d4eb2f));
  for (let py = 0; py < TILE_H; py += TEXEL) {
    for (let px = 0; px < TILE_W; px += TEXEL) {
      if (!insideDiamond(px + TEXEL / 2, py + TEXEL / 2)) continue;
      g.rect(px, py, TEXEL, TEXEL).fill({ color: texelColor(terrain, py / TEXEL, rng()) });
    }
  }
  const tex = app.renderer.generateTexture({
    target: g,
    resolution: 1,
    frame: new Rectangle(0, 0, TILE_W, TILE_H),
  });
  g.destroy();
  return tex;
}

export type TerrainTextures = Readonly<Record<Terrain, readonly Texture[]>>;

export function createTerrainTextures(app: Application): TerrainTextures {
  const make = (t: Terrain): readonly Texture[] =>
    Array.from({ length: VARIANTS }, (_, v) => swatch(app, t, v));
  return {
    PLAINS: make("PLAINS"),
    FOREST: make("FOREST"),
    WATER: make("WATER"),
    MOUNTAIN: make("MOUNTAIN"),
    LAVA: make("LAVA"),
  };
}
