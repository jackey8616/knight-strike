import {
  type Application,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Polygon,
  Sprite,
} from "pixi.js";

import { derivedOwner, tileId } from "@/engine/state";
import type { FactionId, GameState, Terrain, TileId } from "@/engine/types";
import {
  DECOR,
  EDGE_PX,
  EDGE_SHADE_SE,
  EDGE_SHADE_SW,
  GROUND,
  shade,
  TERRAIN_TOP,
  TILE_OUTLINE_COLOR,
  WATER_EDGE_PX,
} from "@/render/terrain-theme";
import { createTerrainTextures } from "@/render/terrain-texture";

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

// PRD §5.1: 4 faction colours + neutral grey. Tokugawa is the player faction
// (PRD §3.1) — assigning it red keeps "the red corner is yours" obvious.
export const FACTION_COLORS: Readonly<Record<FactionId, number>> = {
  TOKUGAWA: 0xc94545,
  TAKEDA: 0x4575c9,
  ODA: 0x4fb55f,
  UESUGI: 0xd9c145,
  NEUTRAL: 0x6a6a6a,
};

export function isoX(x: number, y: number): number {
  return (x - y) * (TILE_WIDTH / 2);
}

export function isoY(x: number, y: number): number {
  return (x + y) * (TILE_HEIGHT / 2);
}

// PRD §3.9 (v1.6): mountains render as stacked unit-cubes. A mountain tile's
// height (in cube units) is its distance INTO the mountain mass — 1 at the edge
// of the cluster, +1 per step inward (4-conn distance transform, board border
// counts as edge). So a blob steps up toward its centre into a curved peak, and
// adjacent mountain tiles differ by ~one cube. Plains / water / forest stay
// flat and are told apart by colour.
const MOUNTAIN_UNIT_PX = 12; // screen height of one cube unit
const MOUNTAIN_MAX_UNITS = 5; // cap so a big mass doesn't tower off-screen

const NEIGHBOR4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Per-mountain-tile pixel height from the distance transform. Computed once at
// load (terrain never changes).
function computeMountainHeights(
  state: GameState,
  boardSize: number,
): Map<TileId, number> {
  const isMtn = (x: number, y: number): boolean =>
    x >= 0 &&
    x < boardSize &&
    y >= 0 &&
    y < boardSize &&
    state.provinces.get(tileId(x, y))?.terrain === "MOUNTAIN";

  const units = new Map<TileId, number>();
  const queue: [number, number][] = [];
  // Seed: mountain tiles touching a non-mountain tile or the board border = 1.
  for (const p of state.provinces.values()) {
    if (p.terrain !== "MOUNTAIN") continue;
    const edge = NEIGHBOR4.some(([dx, dy]) => !isMtn(p.x + dx, p.y + dy));
    if (edge) {
      units.set(p.id, 1);
      queue.push([p.x, p.y]);
    }
  }
  // BFS inward: deeper tiles get +1.
  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number];
    const d = units.get(tileId(x, y)) as number;
    for (const [dx, dy] of NEIGHBOR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isMtn(nx, ny)) continue;
      const nid = tileId(nx, ny);
      if (units.has(nid)) continue;
      units.set(nid, d + 1);
      queue.push([nx, ny]);
    }
  }

  const px = new Map<TileId, number>();
  for (const [id, u] of units) {
    px.set(id, Math.min(u, MOUNTAIN_MAX_UNITS) * MOUNTAIN_UNIT_PX);
  }
  return px;
}

// Deterministic per-tile PRNG (LCG seeded by tile coords) — so decorations are
// stable across redraws without storing them, and identical between runs.
function tileRng(x: number, y: number): () => number {
  let s = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) || 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// A random point inside the tile's (raised) top-face diamond, shrunk toward the
// centre by `shrink` so decorations don't spill over the tile edge.
function diamondPoint(
  rng: () => number,
  e: number,
  shrink: number,
): readonly [number, number] {
  const hw = (TILE_WIDTH / 2) * shrink;
  const hh = (TILE_HEIGHT / 2) * shrink;
  const dx = (rng() * 2 - 1) * hw;
  const maxDy = hh * (1 - Math.abs(dx) / hw);
  const dy = (rng() * 2 - 1) * maxDy;
  return [dx, -e + dy];
}

// Two silhouettes for a denser, more varied forest: a pointed conifer and a
// rounder bushy canopy. Both layer dark→lit greens so the cluster has depth.
function drawTree(
  g: Graphics,
  cx: number,
  cy: number,
  variant: number,
): void {
  g.rect(cx - 0.6, cy, 1.2, 3);
  g.fill({ color: DECOR.TRUNK });
  if (variant === 0) {
    g.moveTo(cx, cy - 7);
    g.lineTo(cx - 3.4, cy + 0.5);
    g.lineTo(cx + 3.4, cy + 0.5);
    g.closePath();
    g.fill({ color: DECOR.LEAF_DARK });
    g.moveTo(cx, cy - 6);
    g.lineTo(cx - 3, cy + 0.2);
    g.lineTo(cx + 3, cy + 0.2);
    g.closePath();
    g.fill({ color: DECOR.LEAF });
    g.moveTo(cx - 0.6, cy - 4.5);
    g.lineTo(cx - 2.4, cy + 0.2);
    g.lineTo(cx + 1.2, cy + 0.2);
    g.closePath();
    g.fill({ color: DECOR.LEAF_HI });
  } else {
    g.rect(cx - 3, cy - 4, 6, 4);
    g.fill({ color: DECOR.LEAF_DARK });
    g.rect(cx - 2.4, cy - 5.6, 4.8, 4);
    g.fill({ color: DECOR.LEAF });
    g.rect(cx - 1.6, cy - 6.6, 2.6, 2.6);
    g.fill({ color: DECOR.LEAF_HI });
  }
}

function drawGrass(g: Graphics, cx: number, cy: number, rng: () => number): void {
  for (let i = 0; i < 3; i++) {
    const h = 2 + Math.floor(rng() * 2);
    g.rect(cx + (i - 1) * 1.4, cy - h, 0.9, h);
    g.fill({ color: i === 1 ? DECOR.GRASS : DECOR.GRASS_DARK });
  }
}

function drawRipple(g: Graphics, cx: number, cy: number): void {
  g.rect(cx - 2.5, cy, 5, 0.9);
  g.fill({ color: DECOR.RIPPLE, alpha: 0.85 });
  g.rect(cx - 1.2, cy + 1.6, 3, 0.9);
  g.fill({ color: DECOR.RIPPLE, alpha: 0.6 });
}

// Per-terrain pixel decor scattered on the (lifted) top face. Denser than a
// flat colour fill alone — toward the lm_exp look — but still drawn once at
// load (terrain never changes), so it stays off the per-tick redraw path.
function drawTerrainDecor(
  g: Graphics,
  terrain: Terrain,
  lift: number,
  x: number,
  y: number,
): void {
  const rng = tileRng(x, y);
  if (terrain === "PLAINS") {
    const n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const [dx, dy] = diamondPoint(rng, lift, 0.7);
      drawGrass(g, dx, dy, rng);
    }
  } else if (terrain === "FOREST") {
    const n = 6 + Math.floor(rng() * 4);
    const pts: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < n; i++) {
      const [dx, dy] = diamondPoint(rng, lift, 0.7);
      pts.push([dx, dy, rng() < 0.5 ? 0 : 1]);
    }
    pts.sort((a, b) => a[1] - b[1]); // back-to-front so nearer trees overlap
    for (const [dx, dy, v] of pts) drawTree(g, dx, dy, v);
  } else if (terrain === "WATER") {
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const [dx, dy] = diamondPoint(rng, lift, 0.6);
      drawRipple(g, dx, dy);
    }
  }
  // MOUNTAIN has no flat-top decor — its snow cap and shaded rock faces are
  // drawn as part of the peak geometry in drawMountainPeak.
}

// A foam rim along the diamond edges of a WATER tile that face non-water (land
// or board border), so connected water reads as one open body with banks rather
// than a grid of identical blue squares. Each grid neighbour maps to one iso
// diamond edge. Drawn once at load into the static decor layer.
function drawWaterShoreline(
  g: Graphics,
  state: GameState,
  x: number,
  y: number,
  lift: number,
): void {
  const isWater = (nx: number, ny: number): boolean =>
    state.provinces.get(tileId(nx, ny))?.terrain === "WATER";
  const hw = TILE_WIDTH / 2;
  const hh = TILE_HEIGHT / 2;
  const top: readonly [number, number] = [0, -hh - lift];
  const right: readonly [number, number] = [hw, -lift];
  const bottom: readonly [number, number] = [0, hh - lift];
  const left: readonly [number, number] = [-hw, -lift];
  // edge ← grid neighbour direction (iso): NE=(x,y-1) SE=(x+1,y) SW=(x,y+1) NW=(x-1,y)
  const edges: ReadonlyArray<
    readonly [boolean, readonly [number, number], readonly [number, number]]
  > = [
    [isWater(x, y - 1), top, right],
    [isWater(x + 1, y), right, bottom],
    [isWater(x, y + 1), bottom, left],
    [isWater(x - 1, y), left, top],
  ];
  for (const [water, a, b] of edges) {
    if (water) continue;
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke({ color: GROUND.WATER_FOAM, width: 1, alpha: 0.7 });
  }
}

const HOVER_COLOR = 0xffffff;
const HOVER_ALPHA = 0.4;
const SELECTION_COLOR = 0xffd700;
const SELECTION_WIDTH = 2;
const CASTLE_MARKER_COLOR = 0xf4f1d6;
const CASTLE_MARKER_OUTLINE = 0x222222;

type TileGfx = {
  readonly id: TileId;
  readonly node: Container;
  readonly base: Graphics;
  readonly hover: Graphics;
  readonly selection: Graphics;
  readonly terrain: Terrain;
  readonly elevation: number;
  // Screen-space rise of the top face: mountain peak base, or the small cosmetic
  // lip on flat tiles. Distinct from `elevation` (which is 0 for flat tiles and
  // drives only the occlusion fade), so giving flat tiles a lip never makes them
  // fade.
  readonly lift: number;
  // Whether a textured top-face Sprite provides the fill (flat terrains); when
  // true drawTilePrism skips the flat colour fill. null for mountains.
  readonly hasTexture: boolean;
  // Last-painted inputs — terrain/elevation never change, so a tile only needs
  // its (expensive) prism geometry rebuilt when the ownership tint changes, and
  // its alpha re-set when the occlusion fade flips. Skipping the no-op redraws
  // keeps board.update near-free on the vast majority of steady-state ticks.
  painted: boolean;
  paintedColor: number | null;
  paintedAlpha: number;
};

export type BoardEvents = {
  readonly onPointerOver?: (id: TileId, e: FederatedPointerEvent) => void;
  readonly onPointerOut?: (id: TileId, e: FederatedPointerEvent) => void;
  readonly onPointerDown?: (id: TileId, e: FederatedPointerEvent) => void;
  readonly onPointerUp?: (id: TileId, e: FederatedPointerEvent) => void;
};

export type BoardRenderer = {
  readonly container: Container;
  update(state: GameState): void;
  setHover(id: TileId | null): void;
  setSelection(id: TileId | null): void;
  resize(width: number, height: number): void;
  panBy(dx: number, dy: number): void;
  zoomBy(factor: number, focalX: number, focalY: number): void;
  resetCamera(): void;
  destroy(): void;
};

// Diamond face shifted up the screen by `lift` px (the raised terrain top).
function diamondPathAt(g: Graphics, lift: number): void {
  g.moveTo(0, -TILE_HEIGHT / 2 - lift);
  g.lineTo(TILE_WIDTH / 2, -lift);
  g.lineTo(0, TILE_HEIGHT / 2 - lift);
  g.lineTo(-TILE_WIDTH / 2, -lift);
  g.closePath();
}

function quad(
  g: Graphics,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
): void {
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.closePath();
}

function tri(
  g: Graphics,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
): void {
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.lineTo(x2, y2);
  g.closePath();
}

// PRD §3.9: cap a mountain's cube tower with a pyramidal peak — two shaded
// front faces (left darker, right lit) meeting at an apex above the tile,
// topped with a snow cap — so mountains read as pointed peaks rather than
// flat-topped cubes. Taller (more interior) tiles get a higher apex, so the
// mass still rises into a curved ridge. The apex sits above the tile's back
// corner, folding the rear faces out of sight under the 45° camera.
function drawMountainPeak(
  g: Graphics,
  top: number,
  ownerColor: number | null,
  e: number,
): void {
  const hw = TILE_WIDTH / 2;
  const hh = TILE_HEIGHT / 2;
  const cap = MOUNTAIN_UNIT_PX * MOUNTAIN_MAX_UNITS;
  const peakH = TILE_HEIGHT * 0.7 + Math.min(e, cap) * 0.25;
  const ax = 0;
  const ay = -e - peakH;
  const wx = -hw, wy = -e; // left rim corner
  const ex = hw, ey = -e; // right rim corner
  const sx = 0, sy = hh - e; // front rim corner

  tri(g, wx, wy, ax, ay, sx, sy);
  g.fill({ color: shade(top, 0.62) });
  tri(g, ax, ay, ex, ey, sx, sy);
  g.fill({ color: shade(top, 0.85) });

  // Snow cap: the upper slice of each face, bounded by points a fraction of
  // the way down the left/right ridges and the centre seam.
  const t = 0.42;
  const lx = ax + (wx - ax) * t, ly = ay + (wy - ay) * t;
  const rx = ax + (ex - ax) * t, ry = ay + (ey - ay) * t;
  const mx = ax + (sx - ax) * t, my = ay + (sy - ay) * t;
  tri(g, ax, ay, lx, ly, mx, my);
  g.fill({ color: shade(DECOR.SNOW, 0.88) });
  tri(g, ax, ay, rx, ry, mx, my);
  g.fill({ color: DECOR.SNOW });

  if (ownerColor !== null) {
    g.moveTo(wx, wy);
    g.lineTo(ax, ay);
    g.lineTo(ex, ey);
    g.lineTo(sx, sy);
    g.closePath();
    g.fill({ color: ownerColor, alpha: 0.3 });
  }

  // Issue #7: outline only the upper silhouette ridges (left rim → apex → right
  // rim), not the base rim. The base line ran across the mountain where the peak
  // meets the cube tower, making taller peaks look like a block with a separate
  // pyramid stacked on top; dropping it lets the peak flow into the tower.
  g.moveTo(wx, wy);
  g.lineTo(ax, ay);
  g.lineTo(ex, ey);
  g.stroke({ color: TILE_OUTLINE_COLOR, width: 1, alpha: 1 });
  g.moveTo(ax, ay);
  g.lineTo(sx, sy);
  g.stroke({ color: shade(top, 0.42), width: 1, alpha: 0.7 });
}

// PRD §6.1: draw a tile as an iso prism — front-left/front-right side walls
// under a raised top face. `e` is the logical elevation (mountain cube height;
// flat tiles 0, so they never trip the occlusion fade); `lift` is the screen-
// space rise of the top face (mountain peak base, or the small cosmetic lip that
// makes flat tiles read as raised earth blocks). When `hasTexture`, the textured
// top-face Sprite (a sibling drawn below this Graphics) provides the fill, so we
// only paint walls, the owner wash, and a faction-tinted border here.
function drawTilePrism(
  g: Graphics,
  terrain: Terrain,
  ownerColor: number | null,
  e: number,
  lift: number,
  hasTexture: boolean,
): void {
  g.clear();
  const top = TERRAIN_TOP[terrain];
  const hw = TILE_WIDTH / 2;
  const hh = TILE_HEIGHT / 2;
  if (lift > 0) {
    const swF = terrain === "MOUNTAIN" ? 0.55 : EDGE_SHADE_SW;
    const seF = terrain === "MOUNTAIN" ? 0.72 : EDGE_SHADE_SE;
    quad(g, -hw, -lift, 0, hh - lift, 0, hh, -hw, 0);
    g.fill({ color: shade(top, swF), alpha: 1 });
    quad(g, 0, hh - lift, hw, -lift, hw, 0, 0, hh);
    g.fill({ color: shade(top, seF), alpha: 1 });
    // Cube-layer seams across the front faces so the stack reads as units
    // (mountains only — flat lips are too short for an interior seam).
    for (let h = MOUNTAIN_UNIT_PX; h < e; h += MOUNTAIN_UNIT_PX) {
      g.moveTo(-hw, -h);
      g.lineTo(0, hh - h);
      g.lineTo(hw, -h);
      g.stroke({ color: shade(top, 0.38), width: 1, alpha: 0.85 });
    }
  }
  if (terrain === "MOUNTAIN" && e > 0) {
    drawMountainPeak(g, top, ownerColor, e);
    return;
  }
  if (!hasTexture) {
    diamondPathAt(g, lift);
    g.fill({ color: top, alpha: 1 });
  }
  if (ownerColor !== null) {
    diamondPathAt(g, lift);
    g.fill({ color: ownerColor, alpha: 0.3 });
  }
  diamondPathAt(g, lift);
  g.stroke({
    color: ownerColor !== null ? shade(ownerColor, 0.7) : TILE_OUTLINE_COLOR,
    width: 1,
    alpha: 1,
  });
}

// Castle marker is rendered as a stylised keep silhouette inset within the
// tile diamond — three crenellations and a wider base — so the four corner
// castles read at a glance even at 1x zoom without dedicated sprite art.
function drawCastleMarker(g: Graphics): void {
  const baseY = TILE_HEIGHT / 4;
  const halfW = TILE_WIDTH / 5;
  const bodyTop = -TILE_HEIGHT / 4;
  const merlonStep = halfW / 1.5;
  const merlonH = 3;

  g.moveTo(-halfW, baseY);
  g.lineTo(-halfW, bodyTop);
  g.lineTo(-halfW + merlonStep, bodyTop);
  g.lineTo(-halfW + merlonStep, bodyTop - merlonH);
  g.lineTo(-halfW + 2 * merlonStep, bodyTop - merlonH);
  g.lineTo(-halfW + 2 * merlonStep, bodyTop);
  g.lineTo(halfW - 2 * merlonStep, bodyTop);
  g.lineTo(halfW - 2 * merlonStep, bodyTop - merlonH);
  g.lineTo(halfW - merlonStep, bodyTop - merlonH);
  g.lineTo(halfW - merlonStep, bodyTop);
  g.lineTo(halfW, bodyTop);
  g.lineTo(halfW, baseY);
  g.closePath();
  g.fill({ color: CASTLE_MARKER_COLOR, alpha: 0.9 });
  g.stroke({ color: CASTLE_MARKER_OUTLINE, width: 1, alpha: 1 });
}

function createDiamondHitArea(): Polygon {
  return new Polygon([
    0,
    -TILE_HEIGHT / 2,
    TILE_WIDTH / 2,
    0,
    0,
    TILE_HEIGHT / 2,
    -TILE_WIDTH / 2,
    0,
  ]);
}

function hasUnit(state: GameState, x: number, y: number): boolean {
  const p = state.provinces.get(tileId(x, y));
  return p !== undefined && p.occupants.some((o) => o.amount > 0);
}

export function createBoardRenderer(
  app: Application,
  initial: GameState,
  events: BoardEvents = {},
): BoardRenderer {
  const container = new Container();
  container.sortableChildren = true;

  const board = new Container();
  board.sortableChildren = true;
  container.addChild(board);

  const tiles = new Map<TileId, TileGfx>();
  const boardSize = initial.boardSize;
  const mountainPx = computeMountainHeights(initial, boardSize);
  // PRD §6.1: shared textured top-face Sprites, one set built once and reused
  // across every tile of a terrain — off the per-tick redraw path.
  const terrainTextures = createTerrainTextures(app);

  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const id = tileId(x, y);
      const node = new Container();
      node.position.set(isoX(x, y), isoY(x, y));
      node.zIndex = x + y;
      node.eventMode = "static";
      node.cursor = "pointer";
      node.hitArea = createDiamondHitArea();

      // Terrain is generated once at load and never changes, so the elevation
      // (and the raised hover/selection overlays) can be fixed at creation.
      const province = initial.provinces.get(id);
      const terrain = province?.terrain ?? "PLAINS";
      const elevation =
        terrain === "MOUNTAIN" ? (mountainPx.get(id) ?? MOUNTAIN_UNIT_PX) : 0;
      // Screen-space lift of the top face. Mountains use their real elevation;
      // flat tiles get a small cosmetic lip (water sits lower, so it reads as a
      // basin below the surrounding land).
      const lift =
        terrain === "MOUNTAIN"
          ? elevation
          : terrain === "WATER"
            ? WATER_EDGE_PX
            : EDGE_PX;

      // Textured top-face Sprite for flat terrains, drawn BELOW `base` so the
      // walls/owner-wash/border painted into `base` composite over it. Static —
      // never touched again after creation. Mountains skip it (their shaded peak
      // is the top face).
      const variants =
        terrain !== "MOUNTAIN" ? terrainTextures[terrain] : undefined;
      let hasTexture = false;
      if (variants !== undefined && variants.length > 0) {
        const pick = Math.floor(tileRng(x, y)() * variants.length);
        const tex = variants[pick] ?? variants[0];
        if (tex !== undefined) {
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5, 0.5);
          sprite.position.set(0, -lift);
          node.addChild(sprite);
          hasTexture = true;
        }
      }

      const base = new Graphics();
      node.addChild(base);

      // Decorations live as a child of `base`: they survive base.clear() on
      // every redraw, render above the terrain + owner tint, and inherit
      // base.alpha so they fade with a peak that occludes a unit. Skipped on
      // castle tiles so the keep marker stays clean.
      if (province?.isCastle !== true) {
        const decor = new Graphics();
        if (terrain === "WATER") {
          drawWaterShoreline(decor, initial, x, y, lift);
        }
        drawTerrainDecor(decor, terrain, lift, x, y);
        base.addChild(decor);
      }

      const hover = new Graphics();
      diamondPathAt(hover, lift);
      hover.fill({ color: HOVER_COLOR, alpha: HOVER_ALPHA });
      hover.visible = false;
      node.addChild(hover);

      const selection = new Graphics();
      diamondPathAt(selection, lift);
      selection.stroke({
        color: SELECTION_COLOR,
        width: SELECTION_WIDTH,
        alpha: 1,
      });
      selection.visible = false;
      node.addChild(selection);

      const { onPointerOver, onPointerOut, onPointerDown, onPointerUp } =
        events;
      if (onPointerOver !== undefined) {
        node.on("pointerover", (e) => {
          onPointerOver(id, e);
        });
      }
      if (onPointerOut !== undefined) {
        node.on("pointerout", (e) => {
          onPointerOut(id, e);
        });
      }
      if (onPointerDown !== undefined) {
        node.on("pointerdown", (e) => {
          onPointerDown(id, e);
        });
      }
      if (onPointerUp !== undefined) {
        node.on("pointerup", (e) => {
          onPointerUp(id, e);
        });
      }

      board.addChild(node);
      tiles.set(id, {
        id,
        node,
        base,
        hover,
        selection,
        terrain,
        elevation,
        lift,
        hasTexture,
        painted: false,
        paintedColor: null,
        paintedAlpha: 1,
      });
    }
  }

  let hoverId: TileId | null = null;
  let selectionId: TileId | null = null;

  function update(state: GameState): void {
    for (const province of state.provinces.values()) {
      const t = tiles.get(province.id);
      if (t === undefined) continue;
      // PRD §3.4 v1.2 multi-occupant: derived owner = single-occupant faction
      // or null. Empty tiles get the neutral colour. Contested (multi-faction)
      // tiles fall back to the castle's original owner colour if it's a castle,
      // else the neutral tile colour so the player has *some* coherent cue.
      // Owner colour is tinted over the terrain top face; unclaimed non-castle
      // tiles get no tint so the raw terrain shows.
      const owner = derivedOwner(province);
      let ownerColor: number | null = null;
      if (owner !== null) {
        ownerColor = FACTION_COLORS[owner];
      } else if (province.isCastle && province.castleOwner !== null) {
        ownerColor = FACTION_COLORS[province.castleOwner];
      }
      if (!t.painted || t.paintedColor !== ownerColor) {
        drawTilePrism(
          t.base,
          t.terrain,
          ownerColor,
          t.elevation,
          t.lift,
          t.hasTexture,
        );
        if (province.isCastle) {
          drawCastleMarker(t.base);
        }
        t.painted = true;
        t.paintedColor = ownerColor;
      }
      // PRD §3.9: a raised tile fades when a unit sits on a tile it occludes
      // (the row behind/above it under the 45° camera), so vision isn't blocked.
      const alpha =
        t.elevation > 0 &&
        (hasUnit(state, province.x - 1, province.y - 1) ||
          hasUnit(state, province.x - 1, province.y) ||
          hasUnit(state, province.x, province.y - 1))
          ? 0.4
          : 1;
      if (t.paintedAlpha !== alpha) {
        t.base.alpha = alpha;
        t.paintedAlpha = alpha;
      }
    }
  }

  function setHover(id: TileId | null): void {
    if (hoverId !== null && hoverId !== id) {
      const prev = tiles.get(hoverId);
      if (prev !== undefined) prev.hover.visible = false;
    }
    hoverId = id;
    if (id !== null) {
      const next = tiles.get(id);
      if (next !== undefined) next.hover.visible = true;
    }
  }

  function setSelection(id: TileId | null): void {
    if (selectionId !== null && selectionId !== id) {
      const prev = tiles.get(selectionId);
      if (prev !== undefined) prev.selection.visible = false;
    }
    selectionId = id;
    if (id !== null) {
      const next = tiles.get(id);
      if (next !== undefined) next.selection.visible = true;
    }
  }

  // Camera = fit-to-viewport scale × user zoom, plus a screen-space pan.
  // userZoom 1 = "whole board fits" (the resting state); MAX_ZOOM lets the
  // player lean into a single fight.
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 5;
  let viewW = 0;
  let viewH = 0;
  let fitScale = 1;
  let userZoom = 1;
  let panX = 0;
  let panY = 0;

  function effectiveScale(): number {
    return fitScale * userZoom;
  }

  // Screen position of the iso origin (tile 0,0) when un-panned. iso x is
  // symmetric around 0 → centre on width/2; iso y spans [0,(n-1)*TH] → shift up
  // by half the (scaled) span.
  function baseCenterY(s: number): number {
    return viewH / 2 - (s * (boardSize - 1) * TILE_HEIGHT) / 2;
  }

  function clampPan(): void {
    // Let any tile — edges and corners included — reach the centre of the
    // viewport. The board's iso span is symmetric in x and (after baseCenterY
    // recentres it) in y, so the pan needed to bring an extreme tile to centre
    // is half the *scaled* board span per axis. Bounding by half the viewport
    // instead pinned the origin near the middle, so once zoomed in the board's
    // edges sat off to the side and could never be centred. At max pan an edge
    // tile sits exactly at centre, so the board still can't fly fully off-screen.
    const s = effectiveScale();
    const maxX = (s * (boardSize - 1) * TILE_WIDTH) / 2;
    const maxY = (s * (boardSize - 1) * TILE_HEIGHT) / 2;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function applyTransform(): void {
    const s = effectiveScale();
    container.scale.set(s);
    container.position.set(
      Math.round(viewW / 2 + panX),
      Math.round(baseCenterY(s) + panY),
    );
  }

  function resize(width: number, height: number): void {
    // Fit the whole iso board within the canvas (it spans ~boardSize*TILE_WIDTH
    // wide, which overflows a phone). Cap at 1 so desktop keeps native crisp
    // pixels; a small margin keeps the corners off the edges.
    viewW = width;
    viewH = height;
    const contentW = boardSize * TILE_WIDTH;
    const contentH = boardSize * TILE_HEIGHT;
    fitScale = Math.min(
      Math.min(width / contentW, height / contentH) * 0.94,
      1,
    );
    applyTransform();
  }

  function panBy(dx: number, dy: number): void {
    panX += dx;
    panY += dy;
    clampPan();
    applyTransform();
  }

  // Zoom by `factor` while keeping the world point under (focalX, focalY) — the
  // cursor or pinch centroid, in canvas CSS px — fixed on screen. Snaps pan
  // back to centre when zoomed all the way out so the fit view is the resting
  // state.
  function zoomBy(factor: number, focalX: number, focalY: number): void {
    const sOld = effectiveScale();
    const px = viewW / 2 + panX;
    const py = baseCenterY(sOld) + panY;
    const worldX = (focalX - px) / sOld;
    const worldY = (focalY - py) / sOld;

    userZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, userZoom * factor));
    if (userZoom === MIN_ZOOM) {
      panX = 0;
      panY = 0;
      applyTransform();
      return;
    }
    const sNew = effectiveScale();
    panX = focalX - sNew * worldX - viewW / 2;
    panY = focalY - sNew * worldY - baseCenterY(sNew);
    clampPan();
    applyTransform();
  }

  function resetCamera(): void {
    userZoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  }

  function destroy(): void {
    container.destroy({ children: true });
  }

  update(initial);

  return {
    container,
    update,
    setHover,
    setSelection,
    resize,
    panBy,
    zoomBy,
    resetCamera,
    destroy,
  };
}
