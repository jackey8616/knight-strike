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
import type { FactionId, GameState, TileId } from "@/engine/types";
import { deriveTier } from "@/engine/upgrade";

import { FACTION_COLORS, isoX, isoY, TILE_HEIGHT, TILE_WIDTH } from "./board";
import type { TierTextures } from "./sprites";

// PRD §5.1: marching sprite is the regular tile sprite shrunk to 0.7× so it
// reads as in-transit vs. garrisoned.
const MARCHING_TILE_FRACTION = 0.225;
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

// The marching layer renders above the units layer, so a column sharing a tile
// with a garrison would sit right on top of it (two sprites + two count labels
// overlapping). Only when a garrison actually shares the tile do we nudge the
// column off-centre: lift it, and (for a besieger) lean toward its target so it
// reads as a separate force at the edge. With no garrison to avoid, the column
// stays centred on its tile like a normal unit.
const COLUMN_LIFT = 7;
const SIEGE_LEAN = 0.32;

function columnPos(
  curTile: TileId,
  leanToward: TileId | undefined,
  offset: boolean,
): { x: number; y: number } {
  const c = tileCenter(curTile);
  if (!offset) return { x: c.x, y: c.y };
  let x = c.x;
  let y = c.y - COLUMN_LIFT;
  if (leanToward !== undefined) {
    const t = tileCenter(leanToward);
    x += (t.x - c.x) * SIEGE_LEAN;
    y += (t.y - c.y) * SIEGE_LEAN;
  }
  return { x, y };
}

// A garrison (any occupant with troops) shares the given tile — the only case
// where a column would visually overlap a stationary unit.
function tileHasGarrison(state: GameState, id: TileId): boolean {
  const p = state.provinces.get(id);
  if (p === undefined) return false;
  for (const o of p.occupants) if (o.amount > 0) return true;
  return false;
}

export function createMarchingRenderer(
  textures: TierTextures,
  events: MarchingRendererEvents = {},
): MarchingRenderer {
  const container = new Container();
  container.sortableChildren = true;

  const gfxById = new Map<string, MarchGfx>();

  // A renderable column — either a moving marching stack or a static besieging
  // AttackOrder. Both draw the same 0.7× sprite + count label.
  type ColumnView = {
    readonly id: string;
    readonly faction: FactionId;
    readonly count: number;
    readonly curTile: TileId;
    // Where a freshly-created sprite is seeded so it tweens in from the right
    // place (the path step we came from, or the staging tile for a siege).
    readonly prevForNew: TileId;
    readonly animate: boolean; // false = static (a besieging siege column)
    readonly cancelId?: string; // only marching stacks are right-click cancellable
    readonly leanToward?: TileId; // besieging target — lean toward it
    readonly offset: boolean; // nudge off-centre (a garrison shares the tile)
  };

  function createColumnGfx(v: ColumnView): MarchGfx {
    const node = new Container();
    const c = columnPos(v.prevForNew, v.leanToward, v.offset);
    node.position.set(c.x, c.y);
    const { x: ix, y: iy } = parseTileId(v.prevForNew);
    node.zIndex = ix + iy + 0.25;

    const tier = deriveTier(v.count);
    const texture = textures[tier];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.85);
    sprite.tint = FACTION_COLORS[v.faction];
    sprite.scale.set(spriteScale(texture));
    node.addChild(sprite);

    const text = new Text({ text: String(v.count), style: COUNT_TEXT_STYLE });
    text.anchor.set(0.5, 1);
    text.position.set(0, TILE_HEIGHT / 2);
    node.addChild(text);

    // Right-click cancel hit area. Pixi v8 emits `rightdown` for the secondary
    // pointer button; the controller catches the event before our window-level
    // pointer listener so the press doesn't auto-pause via the canvas DOM
    // pointerdown either.
    if (events.onCancel !== undefined && v.cancelId !== undefined) {
      const cancelId = v.cancelId;
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
        events.onCancel?.(cancelId);
      });
    }

    return { node, sprite, count: text, prevTile: v.prevForNew };
  }

  function renderColumn(v: ColumnView, tickIntervalMs: number): void {
    let gfx = gfxById.get(v.id);
    const isNew = gfx === undefined;
    if (gfx === undefined) {
      gfx = createColumnGfx(v);
      gfxById.set(v.id, gfx);
      container.addChild(gfx.node);
      gfx.prevTile = v.prevForNew;
    }

    gfx.count.text = String(v.count);
    gfx.sprite.tint = FACTION_COLORS[v.faction];
    const tier = deriveTier(v.count);
    const tierTex = textures[tier];
    if (gfx.sprite.texture !== tierTex) {
      gfx.sprite.texture = tierTex;
      gfx.sprite.scale.set(spriteScale(tierTex));
    }

    const target = columnPos(v.curTile, v.leanToward, v.offset);
    gsap.killTweensOf(gfx.node.position);
    if (!v.animate || gfx.prevTile === v.curTile) {
      gfx.node.position.set(target.x, target.y);
    } else {
      // Seed the start explicitly so a mid-flight tick-rate change doesn't
      // strand the sprite between tiles.
      if (isNew) {
        const startC = columnPos(gfx.prevTile, v.leanToward, v.offset);
        gfx.node.position.set(startC.x, startC.y);
      }
      gsap.to(gfx.node.position, {
        x: target.x,
        y: target.y,
        duration: tickIntervalMs / 1000,
        ease: "none",
      });
    }
    const { x: ix, y: iy } = parseTileId(v.curTile);
    gfx.node.zIndex = ix + iy + 0.25;
    gfx.prevTile = v.curTile;
  }

  function update(state: GameState, tickIntervalMs: number): void {
    const seen = new Set<string>();

    for (const stack of state.marchingStacks) {
      const curTile = stack.path[stack.idx] as TileId;
      const prevForNew =
        stack.idx > 0 ? (stack.path[stack.idx - 1] as TileId) : curTile;
      renderColumn(
        {
          id: stack.id,
          faction: stack.faction,
          count: stack.count,
          curTile,
          prevForNew,
          animate: true,
          cancelId: stack.id,
          offset: tileHasGarrison(state, curTile),
        },
        tickIntervalMs,
      );
      seen.add(stack.id);
    }

    // Besieging columns (AttackOrders) — draw them parked on their staging tile
    // so a unit doesn't vanish while it grinds / breaks / captures a target, and
    // reinforcements visibly grow the column's count. The march→siege and
    // siege→advance hand-offs both happen on `from`, so swapping sprites there
    // stays visually continuous.
    for (const o of state.attackOrders) {
      const id = `order:${o.from}|${o.to}|${o.faction}`;
      renderColumn(
        {
          id,
          faction: o.faction,
          count: o.count,
          curTile: o.from,
          prevForNew: o.from,
          animate: false,
          leanToward: o.to,
          offset: tileHasGarrison(state, o.from),
        },
        tickIntervalMs,
      );
      seen.add(id);
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
