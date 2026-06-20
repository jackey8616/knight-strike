import {
  BitmapText,
  Container,
  Rectangle,
  Sprite,
  type FederatedPointerEvent,
  type TextStyleOptions,
  type Texture,
} from "pixi.js";
import { gsap } from "gsap";

import { parseTileId } from "@/engine/state";
import type {
  FactionId,
  GameState,
  MarchingStack,
  TileId,
} from "@/engine/types";
import { deriveTier } from "@/engine/upgrade";

import { isoX, isoY, TILE_HEIGHT, TILE_WIDTH } from "./board";
import type { FactionSprites } from "./faction-sprites";
import { groundLiftPx } from "./terrain-height";

// Marching sprite size as a multiple of TILE_WIDTH — a touch smaller than a
// garrison (units.ts) so a column reads as in-transit. One value for all tiers.
const MARCHING_TILE_FRACTION = 0.9;

// NEUTRAL has no authored art → reuse a faction sprite desaturated via tint;
// real factions render untinted (their art is full-colour).
const NEUTRAL_TINT = 0x8a8a9a;
function baseTint(faction: FactionId): number {
  return faction === "NEUTRAL" ? NEUTRAL_TINT : 0xffffff;
}
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
  readonly count: BitmapText;
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
  // Follow the rolling ground (PRD §6.1); interpolating between two tile centres
  // lerps the height too, so marching columns ride the hills.
  return { x: isoX(x, y), y: isoY(x, y) - groundLiftPx(x, y) };
}

function spriteScale(texture: Texture): number {
  return (TILE_WIDTH * MARCHING_TILE_FRACTION) / texture.width;
}

// PRD §5.1 one-unit-per-faction-per-tile: a column that shares a tile with a
// same-faction garrison is folded into that garrison's sprite by the units
// layer (its count added there), so the marching layer skips drawing it.
// Columns on a garrison-free tile are drawn here, centred like a normal unit,
// and multiple same-faction columns on one tile collapse into a single sprite.
function garrisonAmount(
  state: GameState,
  id: TileId,
  faction: FactionId,
): number {
  const p = state.provinces.get(id);
  if (p === undefined) return 0;
  for (const o of p.occupants) if (o.faction === faction) return o.amount;
  return 0;
}

export function createMarchingRenderer(
  sprites: FactionSprites,
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
    // Marching stacks merged into this sprite — right-click cancels them all.
    readonly cancelIds: readonly string[];
  };

  function createColumnGfx(v: ColumnView): MarchGfx {
    const node = new Container();
    const c = tileCenter(v.prevForNew);
    node.position.set(c.x, c.y);
    const { x: ix, y: iy } = parseTileId(v.prevForNew);
    node.zIndex = ix + iy + 0.25;

    const tier = deriveTier(v.count);
    const texture = sprites.get(v.faction, tier);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.85);
    sprite.tint = baseTint(v.faction);
    sprite.scale.set(spriteScale(texture));
    node.addChild(sprite);

    const text = new BitmapText({
      text: String(v.count),
      style: COUNT_TEXT_STYLE,
    });
    text.anchor.set(0.5, 1);
    text.position.set(0, TILE_HEIGHT / 2);
    node.addChild(text);

    // Right-click cancel hit area. Pixi v8 emits `rightdown` for the secondary
    // pointer button; the controller catches the event before our window-level
    // pointer listener so the press doesn't auto-pause via the canvas DOM
    // pointerdown either.
    if (events.onCancel !== undefined && v.cancelIds.length > 0) {
      const cancelIds = v.cancelIds;
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
        for (const id of cancelIds) events.onCancel?.(id);
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

    const label = String(v.count);
    if (gfx.count.text !== label) gfx.count.text = label;
    const tint = baseTint(v.faction);
    if (gfx.sprite.tint !== tint) gfx.sprite.tint = tint;
    const tier = deriveTier(v.count);
    const tierTex = sprites.get(v.faction, tier);
    if (gfx.sprite.texture !== tierTex) {
      gfx.sprite.texture = tierTex;
      gfx.sprite.scale.set(spriteScale(tierTex));
    }

    const target = tileCenter(v.curTile);
    gsap.killTweensOf(gfx.node.position);
    if (!v.animate || gfx.prevTile === v.curTile) {
      gfx.node.position.set(target.x, target.y);
    } else {
      // Seed the start explicitly so a mid-flight tick-rate change doesn't
      // strand the sprite between tiles.
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
    const { x: ix, y: iy } = parseTileId(v.curTile);
    gfx.node.zIndex = ix + iy + 0.25;
    gfx.prevTile = v.curTile;
  }

  // One renderable group per (tile, faction): the marching stacks currently on
  // that tile plus any besieging order staged there. Their counts sum so the
  // tile shows a single combined column.
  type Group = {
    readonly tile: TileId;
    readonly faction: FactionId;
    count: number;
    readonly stacks: MarchingStack[];
    hasOrder: boolean;
  };

  function update(state: GameState, tickIntervalMs: number): void {
    const seen = new Set<string>();

    const groups = new Map<string, Group>();
    const ensure = (tile: TileId, faction: FactionId): Group => {
      const key = `${tile}|${faction}`;
      let g = groups.get(key);
      if (g === undefined) {
        g = { tile, faction, count: 0, stacks: [], hasOrder: false };
        groups.set(key, g);
      }
      return g;
    };
    for (const stack of state.marchingStacks) {
      const g = ensure(stack.path[stack.idx] as TileId, stack.faction);
      g.count += stack.count;
      g.stacks.push(stack);
    }
    // Besieging columns (AttackOrders) stage on `from`. Parking them there keeps
    // a unit from vanishing while it grinds / breaks / captures a target, and
    // reinforcements visibly grow the count.
    for (const o of state.attackOrders) {
      const g = ensure(o.from, o.faction);
      g.count += o.count;
      g.hasOrder = true;
    }

    for (const [key, g] of groups) {
      // A same-faction garrison on this tile absorbs the column — the units
      // layer renders the combined count, so skip drawing a second sprite.
      if (garrisonAmount(state, g.tile, g.faction) > 0) continue;

      const cancelIds = g.stacks.map((s) => s.id);
      if (g.stacks.length === 1 && !g.hasOrder) {
        // Lone marching stack: keep its own id so it tweens smoothly tile→tile.
        const s = g.stacks[0] as MarchingStack;
        const prevForNew = s.idx > 0 ? (s.path[s.idx - 1] as TileId) : g.tile;
        renderColumn(
          {
            id: s.id,
            faction: g.faction,
            count: s.count,
            curTile: g.tile,
            prevForNew,
            animate: true,
            cancelIds,
          },
          tickIntervalMs,
        );
        seen.add(s.id);
      } else {
        // Multiple columns and/or a siege share the tile → one merged sprite,
        // keyed to the tile so it's stable while the mix changes underneath.
        const id = `grp:${key}`;
        renderColumn(
          {
            id,
            faction: g.faction,
            count: g.count,
            curTile: g.tile,
            prevForNew: g.tile,
            animate: false,
            cancelIds,
          },
          tickIntervalMs,
        );
        seen.add(id);
      }
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
