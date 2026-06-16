import { Container, Graphics } from "pixi.js";

import { parseTileId } from "@/engine/state";
import type { FactionId, TileId } from "@/engine/types";

import { FACTION_COLORS, isoX, isoY } from "./board";

const VALID_ALPHA = 0.85;
const INVALID_COLOR = 0xff4040;
const INVALID_ALPHA = 0.9;
const DASH_LEN = 8;
const GAP_LEN = 5;
const LINE_WIDTH = 3;
const ARROW_HALF = 7;

export type PathRenderer = {
  readonly container: Container;
  setValidPath(path: readonly TileId[] | null, faction: FactionId): void;
  setInvalidPath(from: TileId, to: TileId): void;
  clear(): void;
  destroy(): void;
};

function tileCenter(id: TileId): { x: number; y: number } {
  const { x, y } = parseTileId(id);
  return { x: isoX(x, y), y: isoY(x, y) };
}

function drawDashedSegment(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;
  while (pos < len) {
    const end = Math.min(pos + DASH_LEN, len);
    g.moveTo(ax + ux * pos, ay + uy * pos);
    g.lineTo(ax + ux * end, ay + uy * end);
    pos = end + GAP_LEN;
  }
}

function drawArrowHead(
  g: Graphics,
  px: number,
  py: number,
  fromX: number,
  fromY: number,
): void {
  const dx = px - fromX;
  const dy = py - fromY;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const baseX = px - ux * ARROW_HALF * 1.6;
  const baseY = py - uy * ARROW_HALF * 1.6;
  // perpendicular unit
  const nx = -uy;
  const ny = ux;
  g.moveTo(px, py);
  g.lineTo(baseX + nx * ARROW_HALF, baseY + ny * ARROW_HALF);
  g.lineTo(baseX - nx * ARROW_HALF, baseY - ny * ARROW_HALF);
  g.closePath();
}

export function createPathRenderer(): PathRenderer {
  const container = new Container();
  // Sits above board.update overlays but below floating UI. Iso z-order is
  // tile-based; the path graphic is a single 2D overlay so it just rides on a
  // high zIndex.
  container.zIndex = 999;
  const g = new Graphics();
  container.addChild(g);
  const arrow = new Graphics();
  container.addChild(arrow);

  function clear(): void {
    g.clear();
    arrow.clear();
  }

  function setValidPath(
    path: readonly TileId[] | null,
    faction: FactionId,
  ): void {
    clear();
    if (path === null || path.length < 2) return;
    const color = FACTION_COLORS[faction];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = tileCenter(path[i] as TileId);
      const b = tileCenter(path[i + 1] as TileId);
      drawDashedSegment(g, a.x, a.y, b.x, b.y);
    }
    g.stroke({ color, width: LINE_WIDTH, alpha: VALID_ALPHA });
    const last = path[path.length - 1] as TileId;
    const prev = path[path.length - 2] as TileId;
    const lc = tileCenter(last);
    const pc = tileCenter(prev);
    drawArrowHead(arrow, lc.x, lc.y, pc.x, pc.y);
    arrow.fill({ color, alpha: VALID_ALPHA });
  }

  function setInvalidPath(from: TileId, to: TileId): void {
    clear();
    const a = tileCenter(from);
    const b = tileCenter(to);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke({ color: INVALID_COLOR, width: LINE_WIDTH, alpha: INVALID_ALPHA });
  }

  function destroy(): void {
    container.destroy({ children: true });
  }

  return { container, setValidPath, setInvalidPath, clear, destroy };
}
