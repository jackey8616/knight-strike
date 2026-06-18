// PRD §6.1: a rolling height field quantised into discrete UNITS (one unit = a
// quarter tile width), so the terrain steps through hills and valleys rather
// than a smooth wash. Units may go negative — low valleys below the baseline.
// Deterministic by tile coordinates (pure value noise), so board.ts and the
// unit / marching / path renderers all agree on where the ground sits. No
// Pixi/DOM.

export const UNIT_PX = 16; // one height unit = TILE_WIDTH / 4 (a gentle step)

// Per-session seed so each game's hills differ. Set once at startup (main.ts)
// before any rendering; all of board / units / marching / paths then agree.
let heightSeed = 0;
export function setHeightSeed(seed: number): void {
  heightSeed = seed >>> 0;
}

// Two octaves of value noise blended into a single [0,1) field, then banded into
// integer unit heights. A mid cell size keeps hills coherent while varying often
// enough — with small (quarter-width) units — to read as rolling slopes.
const OCT = [
  { cell: 2.8, w: 0.72 },
  { cell: 1.3, w: 0.28 },
] as const;

function hash2(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function octave(x: number, y: number, cell: number, salt: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = smooth(gx - ix);
  const fy = smooth(gy - iy);
  const v00 = hash2(ix, iy, salt);
  const v10 = hash2(ix + 1, iy, salt);
  const v01 = hash2(ix, iy + 1, salt);
  const v11 = hash2(ix + 1, iy + 1, salt);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy; // [0,1)
}

function noise01(x: number, y: number): number {
  let v = 0;
  let tw = 0;
  for (let i = 0; i < OCT.length; i++) {
    const o = OCT[i] as (typeof OCT)[number];
    v += octave(x, y, o.cell, ((i + 1) * 0x9e37) ^ heightSeed) * o.w;
    tw += o.w;
  }
  return v / tw; // [0,1)
}

// Integer height in units; negative = a low valley. Several small bands so the
// surface rolls through many gentle steps (valley → lowland → hills → highland)
// rather than a few big mesas.
export function groundUnits(x: number, y: number): number {
  const n = noise01(x, y);
  if (n < 0.14) return -1; // low valley
  if (n < 0.4) return 0;
  if (n < 0.66) return 1;
  if (n < 0.86) return 2;
  return 3;
}

// Screen-space lift (px) of the ground surface at tile (x, y); may be negative.
export function groundLiftPx(x: number, y: number): number {
  return groundUnits(x, y) * UNIT_PX;
}
