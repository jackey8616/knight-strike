import {
  Container,
  type FederatedPointerEvent,
  Graphics,
  Polygon,
} from "pixi.js";

import { derivedOwner, tileId } from "@/engine/state";
import type { FactionId, GameState, Terrain, TileId } from "@/engine/types";

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

const TILE_OUTLINE_COLOR = 0x111111;

// PRD §3.9 (v1.6): terrain top-face colours + screen-space elevation (px). The
// faction/ownership colour is laid over the top face as a translucent tint, so
// territory still reads while the terrain stays visible underneath.
const TERRAIN_TOP: Readonly<Record<Terrain, number>> = {
  PLAINS: 0x3f6b3a,
  MOUNTAIN: 0x6f6f78,
  WATER: 0x2f5aa0,
  FOREST: 0x2f5530,
};

// PRD §3.9 (v1.6): only mountains have height — a continuous "wave" (a smooth
// function of position) so adjacent mountain tiles form a rolling ridge rather
// than uniform blocks. Plains / water / forest are flat and told apart by
// colour. Since all passable terrain is now flat, units never need lifting.
const MOUNTAIN_BASE = 22;
const MOUNTAIN_WAVE = 16;

function mountainHeight(x: number, y: number): number {
  const w =
    Math.sin(x * 0.8 + y * 0.5) * 0.5 + Math.sin(x * 0.35 - y * 0.9) * 0.5;
  return Math.round(MOUNTAIN_BASE + ((w + 1) / 2) * MOUNTAIN_WAVE);
}

function tileElevation(terrain: Terrain, x: number, y: number): number {
  return terrain === "MOUNTAIN" ? mountainHeight(x, y) : 0;
}

function shade(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
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

// PRD §3.9 (v1.6): draw a tile as an iso prism — front-left/front-right side
// walls under a raised top face — coloured by terrain, with the owner colour
// tinted over the top. PLAINS/WATER have zero elevation (flat diamond).
function drawTilePrism(
  g: Graphics,
  terrain: Terrain,
  ownerColor: number | null,
  e: number,
): void {
  g.clear();
  const top = TERRAIN_TOP[terrain];
  const hw = TILE_WIDTH / 2;
  const hh = TILE_HEIGHT / 2;
  if (e > 0) {
    quad(g, -hw, -e, 0, hh - e, 0, hh, -hw, 0);
    g.fill({ color: shade(top, 0.55), alpha: 1 });
    quad(g, 0, hh - e, hw, -e, hw, 0, 0, hh);
    g.fill({ color: shade(top, 0.72), alpha: 1 });
  }
  diamondPathAt(g, e);
  g.fill({ color: top, alpha: 1 });
  diamondPathAt(g, e);
  g.stroke({ color: TILE_OUTLINE_COLOR, width: 1, alpha: 1 });
  if (ownerColor !== null) {
    diamondPathAt(g, e);
    g.fill({ color: ownerColor, alpha: 0.45 });
  }
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
      const terrain = initial.provinces.get(id)?.terrain ?? "PLAINS";
      const elevation = tileElevation(terrain, x, y);

      const base = new Graphics();
      node.addChild(base);

      const hover = new Graphics();
      diamondPathAt(hover, elevation);
      hover.fill({ color: HOVER_COLOR, alpha: HOVER_ALPHA });
      hover.visible = false;
      node.addChild(hover);

      const selection = new Graphics();
      diamondPathAt(selection, elevation);
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
      tiles.set(id, { id, node, base, hover, selection, terrain, elevation });
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
      drawTilePrism(t.base, t.terrain, ownerColor, t.elevation);
      if (province.isCastle) {
        drawCastleMarker(t.base);
      }
      // PRD §3.9: a raised tile fades when a unit sits on a tile it occludes
      // (the row behind/above it under the 45° camera), so vision isn't blocked.
      t.base.alpha =
        t.elevation > 0 &&
        (hasUnit(state, province.x - 1, province.y - 1) ||
          hasUnit(state, province.x - 1, province.y) ||
          hasUnit(state, province.x, province.y - 1))
          ? 0.4
          : 1;
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
    // Keep the board reachable — never let the pan fling the origin more than
    // half a viewport from its centred spot.
    const maxX = viewW / 2;
    const maxY = viewH / 2;
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
