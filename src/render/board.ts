import {
  Container,
  type FederatedPointerEvent,
  Graphics,
  Polygon,
} from "pixi.js";

import { tileId } from "@/engine/state";
import type { FactionId, GameState, TileId } from "@/engine/types";

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

const EMPTY_TILE_COLOR = 0x2e2e2e;
const TILE_OUTLINE_COLOR = 0x111111;
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
  resetCamera(): void;
  destroy(): void;
};

function diamondPath(g: Graphics): void {
  g.moveTo(0, -TILE_HEIGHT / 2);
  g.lineTo(TILE_WIDTH / 2, 0);
  g.lineTo(0, TILE_HEIGHT / 2);
  g.lineTo(-TILE_WIDTH / 2, 0);
  g.closePath();
}

function drawTileBase(g: Graphics, fill: number): void {
  g.clear();
  diamondPath(g);
  g.fill({ color: fill, alpha: 1 });
  diamondPath(g);
  g.stroke({ color: TILE_OUTLINE_COLOR, width: 1, alpha: 1 });
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

      const base = new Graphics();
      node.addChild(base);

      const hover = new Graphics();
      diamondPath(hover);
      hover.fill({ color: HOVER_COLOR, alpha: HOVER_ALPHA });
      hover.visible = false;
      node.addChild(hover);

      const selection = new Graphics();
      diamondPath(selection);
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
      tiles.set(id, { id, node, base, hover, selection });
    }
  }

  let hoverId: TileId | null = null;
  let selectionId: TileId | null = null;

  function update(state: GameState): void {
    for (const province of state.provinces.values()) {
      const t = tiles.get(province.id);
      if (t === undefined) continue;
      const isEmptyNeutral =
        province.owner === "NEUTRAL" && province.count === 0;
      const fill = isEmptyNeutral
        ? EMPTY_TILE_COLOR
        : FACTION_COLORS[province.owner];
      drawTileBase(t.base, fill);
      if (province.isCastle) {
        drawCastleMarker(t.base);
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

  let centerX = 0;
  let centerY = 0;
  let camOffsetX = 0;
  let camOffsetY = 0;

  function applyTransform(): void {
    container.position.set(
      Math.round(centerX + camOffsetX),
      Math.round(centerY + camOffsetY),
    );
  }

  function resize(width: number, height: number): void {
    // Centre the iso block within the canvas. iso x spans
    // [-(n-1)*TW/2, (n-1)*TW/2] (already symmetric around 0) and iso y spans
    // [0, (n-1)*TH], so vertical centring needs the upper-half offset.
    centerX = width / 2;
    centerY = height / 2 - ((boardSize - 1) * TILE_HEIGHT) / 2;
    applyTransform();
  }

  function panBy(dx: number, dy: number): void {
    camOffsetX += dx;
    camOffsetY += dy;
    applyTransform();
  }

  function resetCamera(): void {
    camOffsetX = 0;
    camOffsetY = 0;
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
    resetCamera,
    destroy,
  };
}
