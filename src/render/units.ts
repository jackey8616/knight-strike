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

const TIER_RANK: Readonly<Record<Tier, number>> = {
  SOLDIER: 0,
  KNIGHT: 1,
  QUEEN: 2,
  KING: 3,
};

// PRD §5.1 M2 placeholder: single sprite + scale-per-tier (full per-tier
// sprite art lands in M4). Values are fractions of TILE_WIDTH so they stay
// readable regardless of the source texture's pixel size (knight.png is
// 1024² — a raw 0.45 multiplier overflows the 64 px tile by ~7x).
const TIER_TILE_FRACTION: Readonly<Record<Tier, number>> = {
  SOLDIER: 0.5,
  KNIGHT: 0.65,
  QUEEN: 0.8,
  KING: 0.95,
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
  texture: Texture,
): UnitGfx {
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
  text.anchor.set(0.5, 0);
  text.position.set(0, TILE_HEIGHT / 4);
  node.addChild(text);

  const tier = deriveTier(count);
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
  knightTexture: Texture,
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
      const tier = deriveTier(province.count);
      let gfx = units.get(province.id);
      const isNew = gfx === undefined;
      if (gfx === undefined) {
        gfx = createUnitGfx(
          province.id,
          province.x,
          province.y,
          province.owner,
          province.count,
          knightTexture,
        );
        container.addChild(gfx.node);
        units.set(province.id, gfx);
      }

      const targetScale = tierScale(tier, knightTexture);
      gfx.sprite.tint = FACTION_COLORS[province.owner];
      gfx.sprite.scale.set(targetScale);
      gfx.count.text = province.count > 0 ? String(province.count) : "";
      gfx.node.visible = province.count > 0;

      if (!isNew) {
        if (TIER_RANK[tier] > TIER_RANK[gfx.prevTier]) {
          playUpgradeFx(gfx.sprite, targetScale);
        }
        const drop = gfx.prevCount - province.count;
        const dispatched = dispatchOut.get(province.id) ?? 0;
        const combatLoss = drop - dispatched;
        const overtaken =
          province.owner !== gfx.prevOwner &&
          gfx.prevOwner !== "NEUTRAL" &&
          province.owner !== "NEUTRAL";
        if (combatLoss > 0 || overtaken) {
          playCombatBump(gfx.node, gfx.sprite);
        }
      }

      gfx.prevTier = tier;
      gfx.prevCount = province.count;
      gfx.prevOwner = province.owner;
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
