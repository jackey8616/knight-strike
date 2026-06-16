import { Application, Graphics, type Texture } from "pixi.js";

import type { Tier } from "@/engine/types";

// PRD §5.1 / M4.1: per-tier sprite silhouettes. Without delivered pixel art we
// generate distinct white silhouettes via Pixi Graphics → renderer-generated
// textures. They stay tintable (faction colour) and visually escalate per tier
// (pawn → helm → crown → double crown), so SOLDIER/KNIGHT/QUEEN/KING read
// differently at a glance instead of relying on raw scale like the M2
// placeholder did.
//
// Each shape gets a black stroke after its fill. Pixi tint is multiplicative
// (texture × tint), so pure-black stroke pixels stay black no matter the
// faction colour, giving every unit a dark outline against the same-coloured
// tile background. Fill stays white so it tints cleanly to the faction hue.

const SIZE = 64;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTLINE_COLOR = 0x000000;
const OUTLINE_WIDTH = 2;

function pawnBody(g: Graphics): void {
  // base
  g.ellipse(CX, CY + 20, 16, 4);
  g.fill({ color: 0xffffff, alpha: 0.95 });
  g.stroke({ color: OUTLINE_COLOR, width: OUTLINE_WIDTH, alpha: 1 });
  // body
  g.roundRect(CX - 10, CY - 2, 20, 22, 4);
  g.fill({ color: 0xffffff, alpha: 1 });
  g.stroke({ color: OUTLINE_COLOR, width: OUTLINE_WIDTH, alpha: 1 });
  // head
  g.circle(CX, CY - 8, 8);
  g.fill({ color: 0xffffff, alpha: 1 });
  g.stroke({ color: OUTLINE_COLOR, width: OUTLINE_WIDTH, alpha: 1 });
}

function addHelm(g: Graphics): void {
  // chevron over the head
  g.moveTo(CX - 10, CY - 12);
  g.lineTo(CX, CY - 22);
  g.lineTo(CX + 10, CY - 12);
  g.closePath();
  g.fill({ color: 0xffffff, alpha: 1 });
  g.stroke({ color: OUTLINE_COLOR, width: OUTLINE_WIDTH, alpha: 1 });
}

function addCrown(g: Graphics): void {
  // jagged crown — three peaks
  g.moveTo(CX - 12, CY - 12);
  g.lineTo(CX - 12, CY - 20);
  g.lineTo(CX - 6, CY - 14);
  g.lineTo(CX, CY - 22);
  g.lineTo(CX + 6, CY - 14);
  g.lineTo(CX + 12, CY - 20);
  g.lineTo(CX + 12, CY - 12);
  g.closePath();
  g.fill({ color: 0xffffff, alpha: 1 });
  g.stroke({ color: OUTLINE_COLOR, width: OUTLINE_WIDTH, alpha: 1 });
  // jewel
  g.circle(CX, CY - 16, 2);
  g.fill({ color: 0xffffff, alpha: 0.7 });
  g.stroke({ color: OUTLINE_COLOR, width: 1, alpha: 1 });
}

function addBigCrown(g: Graphics): void {
  addCrown(g);
  // taller centre cross
  g.rect(CX - 1, CY - 30, 2, 6);
  g.fill({ color: 0xffffff, alpha: 1 });
  g.stroke({ color: OUTLINE_COLOR, width: 1, alpha: 1 });
  g.rect(CX - 3, CY - 28, 6, 2);
  g.fill({ color: 0xffffff, alpha: 1 });
  g.stroke({ color: OUTLINE_COLOR, width: 1, alpha: 1 });
}

function buildTexture(app: Application, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  // Generate a static texture so we can share it across many sprites without
  // re-rendering every frame. `resolution: 2` keeps the silhouette crisp under
  // zoom (board may scale us up further with deviceRatio).
  const tex = app.renderer.generateTexture({
    target: g,
    resolution: 2,
  });
  g.destroy();
  return tex;
}

export type TierTextures = Readonly<Record<Tier, Texture>>;

export function createTierTextures(app: Application): TierTextures {
  return {
    SOLDIER: buildTexture(app, (g) => {
      pawnBody(g);
    }),
    KNIGHT: buildTexture(app, (g) => {
      pawnBody(g);
      addHelm(g);
    }),
    QUEEN: buildTexture(app, (g) => {
      pawnBody(g);
      addCrown(g);
    }),
    KING: buildTexture(app, (g) => {
      pawnBody(g);
      addBigCrown(g);
    }),
  };
}
