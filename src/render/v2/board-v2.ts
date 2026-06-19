import { type Application, Container, Graphics, Text } from "pixi.js";
import { parseTileId } from "@/engine/v2/state";
import type { FactionId, GameState, Terrain } from "@/engine/v2/types";

// Self-contained iso projection so the v2 renderer doesn't depend on the v1
// board (deleted at the M13 cutover). 64×32 diamonds, depth-sorted by x+y.
const TILE_W = 64;
const TILE_H = 32;
const isoX = (x: number, y: number): number => (x - y) * (TILE_W / 2);
const isoY = (x: number, y: number): number => (x + y) * (TILE_H / 2);

const FACTION_COLOR: Readonly<Record<FactionId, number>> = {
  TOKUGAWA: 0xc94545,
  TAKEDA: 0x4575c9,
  ODA: 0x4fb55f,
  UESUGI: 0xd9c145,
  NEUTRAL: 0x6a6a6a,
  MONSTER: 0xb145d9,
};

const TERRAIN_COLOR: Readonly<Record<Terrain, number>> = {
  PLAINS: 0x6b8f3a,
  FOREST: 0x3f6b2f,
  WATER: 0x2f5f8f,
  MOUNTAIN: 0x7a7368,
  LAVA: 0xc04a23,
};

const label = (text: string, size: number, color: number): Text =>
  new Text({ text, style: { fontFamily: "monospace", fontSize: size, fill: color, fontWeight: "bold" } });

export type V2BoardRenderer = {
  render(state: GameState): void;
  recenter(viewW: number, viewH: number, boardSize: number): void;
  screenToTile(globalX: number, globalY: number): { x: number; y: number } | null;
  destroy(): void;
};

// A deliberately simple Graphics+Text renderer (clear-and-redraw each tick;
// boards are ≤27²). Visual polish (sprites, rolling terrain) is a later slice.
export function createV2BoardRenderer(app: Application): V2BoardRenderer {
  const world = new Container();
  const tiles = new Graphics();
  const entities = new Container();
  world.addChild(tiles, entities);
  app.stage.addChild(world);
  let boardSize = 0;

  const diamond = (g: Graphics, x: number, y: number, color: number): void => {
    const cx = isoX(x, y);
    const cy = isoY(x, y);
    g.poly([cx, cy - TILE_H / 2, cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx - TILE_W / 2, cy]).fill(color);
    g.poly([cx, cy - TILE_H / 2, cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx - TILE_W / 2, cy]).stroke({
      width: 1,
      color: 0x000000,
      alpha: 0.25,
    });
  };

  const marker = (x: number, y: number, draw: (g: Graphics) => void, text?: { s: string; color: number }): void => {
    const c = new Container();
    c.x = isoX(x, y);
    c.y = isoY(x, y);
    const g = new Graphics();
    draw(g);
    c.addChild(g);
    if (text) {
      const t = label(text.s, 10, text.color);
      t.anchor.set(0.5, 0.5);
      t.y = -2;
      c.addChild(t);
    }
    c.zIndex = x + y;
    entities.addChild(c);
  };

  return {
    render(state: GameState): void {
      boardSize = state.boardSize;
      tiles.clear();
      entities.removeChildren().forEach((c) => c.destroy({ children: true }));
      entities.sortableChildren = true;

      const fieldByTile = new Map(state.fields.map((f) => [f.tile, f.owner]));
      for (let x = 0; x < state.boardSize; x += 1) {
        for (let y = 0; y < state.boardSize; y += 1) {
          const id = `tile:${x},${y}`;
          const terrain = state.provinces.get(id)?.terrain ?? "PLAINS";
          diamond(tiles, x, y, TERRAIN_COLOR[terrain]);
          const owner = fieldByTile.get(id);
          if (owner !== undefined) {
            const cx = isoX(x, y);
            const cy = isoY(x, y);
            tiles
              .poly([cx, cy - TILE_H / 2, cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx - TILE_W / 2, cy])
              .fill({ color: FACTION_COLOR[owner], alpha: 0.35 });
          }
        }
      }

      for (const [id, p] of state.provinces) {
        if (!p.isCastle || p.castleOwner === null) continue;
        const { x, y } = parseTileId(id);
        const color = FACTION_COLOR[p.castleOwner];
        marker(x, y, (g) => {
          g.rect(-12, -22, 24, 22).fill(color).stroke({ width: 2, color: 0x1a1a1a });
          g.rect(-12, -28, 6, 8).fill(color);
          g.rect(-3, -28, 6, 8).fill(color);
          g.rect(6, -28, 6, 8).fill(color);
        });
      }

      for (const h of state.houses) {
        const { x, y } = parseTileId(h.tile);
        marker(
          x,
          y,
          (g) => {
            g.rect(-7, -10, 14, 10).fill(FACTION_COLOR[h.owner]).stroke({ width: 1, color: 0x1a1a1a });
            g.poly([-9, -10, 0, -18, 9, -10]).fill(0x8a5a2a);
          },
          { s: String(h.population), color: 0xffffff },
        );
      }

      for (const b of state.buildings) {
        const { x, y } = parseTileId(b.tile);
        const color = b.kind === "BRIDGE" ? 0x9a6a3a : 0xb0b0b0;
        marker(x, y, (g) => g.rect(-14, -4, 28, 8).fill(color).stroke({ width: 1, color: 0x1a1a1a }));
      }

      for (const n of state.nests) {
        const { x, y } = parseTileId(n.tile);
        marker(x, y, (g) => g.circle(0, -6, 9).fill(0x5a2a5a).stroke({ width: 2, color: 0xb145d9 }));
      }

      for (const u of state.units) {
        const { x, y } = parseTileId(u.tile);
        const color = u.isMonster ? FACTION_COLOR.MONSTER : FACTION_COLOR[u.owner];
        marker(
          x,
          y,
          (g) => {
            g.circle(0, -8, 9).fill(color).stroke({ width: 1.5, color: 0x1a1a1a });
            if (u.isElite) g.star(0, -20, 5, 5, 2.5).fill(0xffe066);
          },
          { s: String(u.population), color: 0xffffff },
        );
      }
    },

    recenter(viewW: number, viewH: number, size: number): void {
      // center the diamond board in the viewport
      world.x = viewW / 2;
      world.y = viewH / 2 - (size * TILE_H) / 2;
      const scale = Math.min(1, viewW / ((size + 1) * TILE_W), viewH / ((size + 1) * TILE_H));
      world.scale.set(scale);
    },

    // Inverse iso pick: global pointer coords → tile (or null if off-board).
    screenToTile(globalX: number, globalY: number): { x: number; y: number } | null {
      const lp = world.toLocal({ x: globalX, y: globalY });
      const a = lp.x / (TILE_W / 2); // x − y
      const b = lp.y / (TILE_H / 2); // x + y
      const x = Math.round((a + b) / 2);
      const y = Math.round((b - a) / 2);
      if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) return null;
      return { x, y };
    },

    destroy(): void {
      world.destroy({ children: true });
    },
  };
}
