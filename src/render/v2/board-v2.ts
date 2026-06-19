import { type Application, Container, Graphics, Sprite, Text } from "pixi.js";
import { parseTileId } from "@/engine/v2/state";
import type { FactionId, GameState } from "@/engine/v2/types";
import { createTerrainTextures, TILE_H, TILE_W, type TerrainTextures } from "./terrain-tex";

// Self-contained iso projection, 64×32 diamonds, depth-sorted by x+y.
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

const label = (text: string, size: number, color: number): Text =>
  new Text({ text, style: { fontFamily: "monospace", fontSize: size, fill: color, fontWeight: "bold" } });

export type V2BoardRenderer = {
  render(state: GameState): void;
  recenter(viewW: number, viewH: number, boardSize: number): void;
  screenToTile(globalX: number, globalY: number): { x: number; y: number } | null;
  destroy(): void;
};

export function createV2BoardRenderer(app: Application): V2BoardRenderer {
  const textures: TerrainTextures = createTerrainTextures(app);
  const world = new Container();
  const terrain = new Container(); // static textured tiles, built once
  const tints = new Graphics(); // dynamic field-ownership wash
  const entities = new Container(); // dynamic castles/houses/units/…
  entities.sortableChildren = true;
  world.addChild(terrain, tints, entities);
  app.stage.addChild(world);
  let boardSize = 0;
  let built = false;

  const diamond = (cx: number, cy: number): number[] => [
    cx, cy - TILE_H / 2, cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx - TILE_W / 2, cy,
  ];

  const buildTerrain = (state: GameState): void => {
    terrain.removeChildren().forEach((c) => c.destroy());
    const outline = new Graphics();
    for (let x = 0; x < state.boardSize; x += 1) {
      for (let y = 0; y < state.boardSize; y += 1) {
        const t = state.provinces.get(`tile:${x},${y}`)?.terrain ?? "PLAINS";
        const variants = textures[t];
        const tex = variants[((x * 7 + y * 13) >>> 0) % variants.length];
        if (tex !== undefined) {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5, 0.5);
          sp.x = isoX(x, y);
          sp.y = isoY(x, y);
          terrain.addChild(sp);
        }
        outline.poly(diamond(isoX(x, y), isoY(x, y))).stroke({ width: 1, color: 0x1a1a1a, alpha: 0.3 });
      }
    }
    terrain.addChild(outline);
    built = true;
  };

  const marker = (
    x: number,
    y: number,
    draw: (g: Graphics) => void,
    text?: { s: string; color: number },
  ): void => {
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
      if (!built) buildTerrain(state);

      tints.clear();
      for (const f of state.fields) {
        const { x, y } = parseTileId(f.tile);
        tints.poly(diamond(isoX(x, y), isoY(x, y))).fill({ color: FACTION_COLOR[f.owner], alpha: 0.3 });
      }

      entities.removeChildren().forEach((c) => c.destroy({ children: true }));

      for (const [id, p] of state.provinces) {
        if (!p.isCastle || p.castleOwner === null) continue;
        const { x, y } = parseTileId(id);
        const color = FACTION_COLOR[p.castleOwner];
        marker(x, y, (g) => {
          g.rect(-12, -22, 24, 22).fill(color).stroke({ width: 2, color: 0x1a1a1a });
          g.rect(-12, -28, 6, 8).fill(color);
          g.rect(-3, -28, 6, 8).fill(color);
          g.rect(6, -28, 6, 8).fill(color);
          if ((p.castleDurability ?? 1) <= 0) g.rect(-12, -8, 24, 8).fill({ color: 0x000000, alpha: 0.5 });
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
        const color = b.kind === "BRIDGE" ? 0x9a6a3a : 0xc8c8c8;
        marker(x, y, (g) => g.rect(-14, -5, 28, 9).fill(color).stroke({ width: 1, color: 0x1a1a1a }));
      }

      for (const n of state.nests) {
        const { x, y } = parseTileId(n.tile);
        marker(x, y, (g) => g.circle(0, -6, 9).fill(0x5a2a5a).stroke({ width: 2, color: 0xb145d9 }));
      }

      for (const u of state.units) {
        const { x, y } = parseTileId(u.tile);
        const color = u.isMonster ? FACTION_COLOR.MONSTER : FACTION_COLOR[u.owner];
        // bigger armies read bigger
        const radius = u.population >= 10000 ? 13 : u.population >= 1000 ? 11 : 9;
        marker(
          x,
          y,
          (g) => {
            g.ellipse(0, 2, radius, radius * 0.5).fill({ color: 0x000000, alpha: 0.25 }); // shadow
            g.circle(0, -8, radius).fill(color).stroke({ width: 1.5, color: 0x1a1a1a });
            if (u.isElite) g.star(0, -8 - radius - 6, 5, 5, 2.5).fill(0xffe066);
          },
          { s: String(u.population), color: 0xffffff },
        );
      }
    },

    recenter(viewW: number, viewH: number, size: number): void {
      world.x = viewW / 2;
      world.y = viewH / 2 - (size * TILE_H) / 2;
      const scale = Math.min(1, viewW / ((size + 1) * TILE_W), viewH / ((size + 1) * TILE_H));
      world.scale.set(scale);
    },

    screenToTile(globalX: number, globalY: number): { x: number; y: number } | null {
      const lp = world.toLocal({ x: globalX, y: globalY });
      const a = lp.x / (TILE_W / 2);
      const b = lp.y / (TILE_H / 2);
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
