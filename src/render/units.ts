import {
  Container,
  Sprite,
  Text,
  type TextStyleOptions,
  type Texture,
} from "pixi.js";
import { gsap } from "gsap";

import type { FactionId, GameState, Tier, TileId } from "@/engine/types";
import { deriveTier } from "@/engine/upgrade";

import { FACTION_COLORS, isoX, isoY, TILE_HEIGHT, TILE_WIDTH } from "./board";
import { playCombatBump } from "./combat";
import type { TierTextures } from "./sprites";

const TIER_RANK: Readonly<Record<Tier, number>> = {
  SOLDIER: 0,
  KNIGHT: 1,
  QUEEN: 2,
  KING: 3,
};

// PRD §5.1: per-tier silhouettes ship via `sprites.ts`; we keep a modest scale
// ramp so higher tiers also visually loom larger. Capped under 1.0 so even
// King sprites stay slightly smaller than the tile diamond — at 1.0 the
// crown extended high enough to overlap the row above, making the board
// feel crowded once production filled it with garrisons.
const TIER_TILE_FRACTION: Readonly<Record<Tier, number>> = {
  SOLDIER: 0.2,
  KNIGHT: 0.25,
  QUEEN: 0.3,
  KING: 0.35,
};

const UPGRADE_FLASH_COLOR = 0xffe480;
const UPGRADE_FLASH_DURATION_S = 0.3;
const UPGRADE_SCALE_PUNCH = 1.35;
const UPGRADE_PUNCH_DURATION_S = 0.18;

const COUNT_TEXT_STYLE: TextStyleOptions = {
  fontFamily: "monospace",
  fontSize: 12,
  fontWeight: "700",
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
  align: "center",
};

type UnitGfx = {
  readonly id: TileId;
  readonly node: Container;
  readonly sprite: Sprite;
  readonly count: Text;
  prevTier: Tier;
  prevCount: number;
  prevOwner: FactionId;
};

export type UnitsRenderer = {
  readonly container: Container;
  update(state: GameState): void;
  destroy(): void;
};

function tierScale(tier: Tier, texture: Texture): number {
  return (TILE_WIDTH * TIER_TILE_FRACTION[tier]) / texture.width;
}

function createUnitGfx(
  id: TileId,
  x: number,
  y: number,
  owner: FactionId,
  count: number,
  textures: TierTextures,
): UnitGfx {
  const tier = deriveTier(count);
  const texture = textures[tier];
  const node = new Container();
  node.position.set(isoX(x, y), isoY(x, y));
  // §3.1 iso back-to-front order: deeper rows (larger x+y) draw later. Adding
  // 0.5 keeps unit gfx above its tile base but below same-row neighbours.
  node.zIndex = x + y + 0.5;

  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 0.8);
  sprite.tint = FACTION_COLORS[owner];
  node.addChild(sprite);

  const text = new Text({ text: "", style: COUNT_TEXT_STYLE });
  // Pin the count's baseline to the tile's bottom edge so the glyph height +
  // stroke can never spill into the row below — the old top-anchored
  // (0, TILE_HEIGHT/4) placement let the descender pass y=16.
  text.anchor.set(0.5, 1);
  text.position.set(0, TILE_HEIGHT / 2);
  node.addChild(text);

  const s = tierScale(tier, texture);
  sprite.scale.set(s);

  return {
    id,
    node,
    sprite,
    count: text,
    prevTier: tier,
    prevCount: count,
    prevOwner: owner,
  };
}

function playUpgradeFx(sprite: Sprite, baseScale: number): void {
  gsap.killTweensOf(sprite.scale);
  gsap.fromTo(
    sprite.scale,
    { x: baseScale, y: baseScale },
    {
      x: baseScale * UPGRADE_SCALE_PUNCH,
      y: baseScale * UPGRADE_SCALE_PUNCH,
      duration: UPGRADE_PUNCH_DURATION_S,
      yoyo: true,
      repeat: 1,
      ease: "power2.out",
      onComplete: () => {
        sprite.scale.set(baseScale);
      },
    },
  );

  const baseTint = sprite.tint;
  sprite.tint = UPGRADE_FLASH_COLOR;
  gsap.delayedCall(UPGRADE_FLASH_DURATION_S, () => {
    sprite.tint = baseTint;
  });
}

export function createUnitsRenderer(
  initial: GameState,
  textures: TierTextures,
): UnitsRenderer {
  const container = new Container();
  container.sortableChildren = true;

  const units = new Map<TileId, UnitGfx>();

  function update(state: GameState): void {
    // §3.5.1 dispatch happens within the same tick as the resulting count
    // drop on the source tile, so we suppress combat fx for the slice of the
    // drop that's accounted for by freshly-dispatched stacks.
    // step() increments state.tick at the end, so stacks born this tick carry
    // dispatchedAtTick === state.tick - 1.
    const dispatchedThisTick = state.tick - 1;
    const dispatchOut = new Map<TileId, number>();
    for (const m of state.marchingStacks) {
      if (m.dispatchedAtTick !== dispatchedThisTick) continue;
      const src = m.path[0];
      if (src === undefined) continue;
      dispatchOut.set(src, (dispatchOut.get(src) ?? 0) + m.count);
    }

    for (const province of state.provinces.values()) {
      // PRD §3.4 v1.2: pick the dominant occupant for rendering. Contested
      // tiles will visually appear as the largest faction (with the actual
      // multi-occupant breakdown surfaced via tile-info hover instead).
      let display: { faction: FactionId; amount: number } | null = null;
      let totalAmount = 0;
      for (const o of province.occupants) {
        totalAmount += o.amount;
        if (display === null || o.amount > display.amount) {
          display = { faction: o.faction, amount: o.amount };
        }
      }
      const renderFaction = display?.faction ?? province.castleOwner ?? "NEUTRAL";
      const renderAmount = display?.amount ?? 0;
      const tier = deriveTier(renderAmount);
      let gfx = units.get(province.id);
      const isNew = gfx === undefined;
      if (gfx === undefined) {
        gfx = createUnitGfx(
          province.id,
          province.x,
          province.y,
          renderFaction,
          renderAmount,
          textures,
        );
        container.addChild(gfx.node);
        units.set(province.id, gfx);
      }

      const tierTexture = textures[tier];
      if (gfx.sprite.texture !== tierTexture) {
        gfx.sprite.texture = tierTexture;
      }
      const targetScale = tierScale(tier, tierTexture);
      gfx.sprite.tint = FACTION_COLORS[renderFaction];
      gfx.sprite.scale.set(targetScale);
      gfx.count.text = totalAmount > 0 ? String(totalAmount) : "";
      gfx.node.visible = totalAmount > 0;

      if (!isNew) {
        if (TIER_RANK[tier] > TIER_RANK[gfx.prevTier]) {
          playUpgradeFx(gfx.sprite, targetScale);
        }
        const drop = gfx.prevCount - totalAmount;
        const dispatched = dispatchOut.get(province.id) ?? 0;
        const combatLoss = drop - dispatched;
        const overtaken =
          renderFaction !== gfx.prevOwner &&
          gfx.prevOwner !== "NEUTRAL" &&
          renderFaction !== "NEUTRAL";
        if (combatLoss > 0 || overtaken) {
          playCombatBump(gfx.node, gfx.sprite);
        }
      }

      gfx.prevTier = tier;
      gfx.prevCount = totalAmount;
      gfx.prevOwner = renderFaction;
    }
  }

  function destroy(): void {
    for (const gfx of units.values()) {
      gsap.killTweensOf(gfx.sprite);
      gsap.killTweensOf(gfx.sprite.scale);
      gsap.killTweensOf(gfx.node.position);
    }
    units.clear();
    container.destroy({ children: true });
  }

  update(initial);

  return { container, update, destroy };
}
