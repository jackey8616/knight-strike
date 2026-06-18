import { Application, Graphics, type Texture } from "pixi.js";

import type { Tier } from "@/engine/types";
import { unitBitmapRows, unitCellOf, type UnitCell } from "./unit-bitmap";

// PRD §5.1: per-tier unit models drawn as pixel-art bitmaps (shared source in
// unit-bitmap.ts). Each cell is one texel; the texture is scaled up with NEAREST
// (set in app.ts) so it reads as crisp chunky pixels at any zoom. The body texel
// is white so Pixi's multiplicative tint colours it to the faction hue; the
// shade is mid-grey (→ darker faction tone); the outline is near-black and stays
// dark under any tint. So one bitmap serves all four factions.
const CELL_COLOR: Readonly<Record<Exclude<UnitCell, "empty">, number>> = {
  outline: 0x1b1b24,
  body: 0xffffff,
  shade: 0x8c8c8c,
};

function bitmapTexture(app: Application, rows: readonly string[]): Texture {
  const g = new Graphics();
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < row.length; x++) {
      const cell = unitCellOf(row[x] as string);
      if (cell === "empty") continue;
      g.rect(x, y, 1, 1);
      g.fill({ color: CELL_COLOR[cell] });
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
  const make = (tier: Tier): Texture => bitmapTexture(app, unitBitmapRows(tier));
  return {
    SOLDIER: make("SOLDIER"),
    KNIGHT: make("KNIGHT"),
    QUEEN: make("QUEEN"),
    KING: make("KING"),
  };
}
