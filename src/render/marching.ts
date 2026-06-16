import {
  Container,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type TextStyleOptions,
  type Texture,
} from "pixi.js";
import { gsap } from "gsap";

import { parseTileId } from "@/engine/state";
import type { GameState, MarchingStack, TileId } from "@/engine/types";
import { deriveTier } from "@/engine/upgrade";

import { FACTION_COLORS, isoX, isoY, TILE_HEIGHT, TILE_WIDTH } from "./board";
import type { TierTextures } from "./sprites";

// PRD §5.1: marching sprite is the regular tile sprite shrunk to 0.7× so it
// reads as in-transit vs. garrisoned.
const MARCHING_TILE_FRACTION = 0.45;
const COUNT_TEXT_STYLE: TextStyleOptions = {
  fontFamily: "monospace",
  fontSize: 11,
  fontWeight: "700",
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
  align: "center",
};

type MarchGfx = {
  readonly node: Container;
  readonly sprite: Sprite;
  readonly count: Text;
  prevTile: TileId;
};

export type MarchingRendererEvents = {
  readonly onCancel?: (stackId: string) => void;
};

export type MarchingRenderer = {
  readonly container: Container;
  update(state: GameState, tickIntervalMs: number): void;
  destroy(): void;
};

// Hit-test box around the sprite. Generous enough that the player doesn't need
// pixel-perfect aim on a moving target, snug enough that adjacent stacks don't
// overlap. Drawn in node-local coords centred on (0,0).
const HIT_HALF_W = 18;
const HIT_HALF_H = 22;

function tileCenter(id: TileId): { x: number; y: number } {
  const { x, y } = parseTileId(id);
  return { x: isoX(x, y), y: isoY(x, y) };
}

function spriteScale(texture: Texture): number {
  return (TILE_WIDTH * MARCHING_TILE_FRACTION) / texture.width;
}

export function createMarchingRenderer(
  textures: TierTextures,
  events: MarchingRendererEvents = {},
): MarchingRenderer {
  const container = new Container();
  container.sortableChildren = true;

  const gfxById = new Map<string, MarchGfx>();

  function createGfx(stack: MarchingStack): MarchGfx {
    const node = new Container();
    // Marching stacks live one z-step above the tile face but below garrisoned
    // units (board.ts puts units at x+y+0.5). Use x+y+0.25 so a marcher
    // doesn't occlude a same-tile defender during the head-on render frame.
    const start = stack.path[stack.idx] as TileId;
    const c = tileCenter(start);
    node.position.set(c.x, c.y);
    const { x: ix, y: iy } = parseTileId(start);
    node.zIndex = ix + iy + 0.25;

    const tier = deriveTier(stack.count);
    const texture = textures[tier];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.85);
    sprite.tint = FACTION_COLORS[stack.faction];
    sprite.scale.set(spriteScale(texture));
    node.addChild(sprite);

    const text = new Text({ text: String(stack.count), style: COUNT_TEXT_STYLE });
    text.anchor.set(0.5, 1);
    text.position.set(0, TILE_HEIGHT / 2);
    node.addChild(text);

    // Right-click cancel hit area. Pixi v8 emits `rightdown` for the secondary
    // pointer button; the controller catches the event before our window-level
    // pointer listener so the press doesn't auto-pause via the canvas DOM
    // pointerdown either.
    if (events.onCancel !== undefined) {
      const stackId = stack.id;
      node.eventMode = "static";
      node.cursor = "pointer";
      node.hitArea = new Rectangle(
        -HIT_HALF_W,
        -HIT_HALF_H,
        HIT_HALF_W * 2,
        HIT_HALF_H * 2,
      );
      node.on("rightdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        events.onCancel?.(stackId);
      });
    }

    return { node, sprite, count: text, prevTile: start };
  }

  function update(state: GameState, tickIntervalMs: number): void {
    const seen = new Set<string>();
    for (const stack of state.marchingStacks) {
      seen.add(stack.id);
      const curTile = stack.path[stack.idx] as TileId;
      let gfx = gfxById.get(stack.id);
      const isNew = gfx === undefined;
      if (gfx === undefined) {
        // New stack: place at the previous path step (path[idx-1]) so it
        // visually enters the new tile. For a freshly dispatched stack born
        // at idx=0 (no prior step), use path[0] as both prev and current.
        const prevTile =
          stack.idx > 0 ? (stack.path[stack.idx - 1] as TileId) : curTile;
        const seed: MarchingStack = { ...stack };
        gfx = createGfx({ ...seed, idx: 0, path: [prevTile] });
        gfxById.set(stack.id, gfx);
        container.addChild(gfx.node);
        gfx.prevTile = prevTile;
      }

      gfx.count.text = String(stack.count);
      gfx.sprite.tint = FACTION_COLORS[stack.faction];
      const tier = deriveTier(stack.count);
      const tierTex = textures[tier];
      if (gfx.sprite.texture !== tierTex) {
        gfx.sprite.texture = tierTex;
        gfx.sprite.scale.set(spriteScale(tierTex));
      }

      const target = tileCenter(curTile);
      gsap.killTweensOf(gfx.node.position);
      if (gfx.prevTile === curTile) {
        gfx.node.position.set(target.x, target.y);
      } else {
        // Set the starting point explicitly so a tick-rate change mid-flight
        // doesn't leave the sprite stranded between tiles.
        if (isNew) {
          const startC = tileCenter(gfx.prevTile);
          gfx.node.position.set(startC.x, startC.y);
        }
        gsap.to(gfx.node.position, {
          x: target.x,
          y: target.y,
          duration: tickIntervalMs / 1000,
          ease: "none",
        });
      }
      const { x: ix, y: iy } = parseTileId(curTile);
      gfx.node.zIndex = ix + iy + 0.25;
      gfx.prevTile = curTile;
    }

    for (const [id, gfx] of gfxById) {
      if (seen.has(id)) continue;
      gsap.killTweensOf(gfx.node.position);
      gfx.node.destroy({ children: true });
      gfxById.delete(id);
    }
  }

  function destroy(): void {
    for (const gfx of gfxById.values()) {
      gsap.killTweensOf(gfx.node.position);
    }
    gfxById.clear();
    container.destroy({ children: true });
  }

  return { container, update, destroy };
}
