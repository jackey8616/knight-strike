import { Container, type Sprite } from "pixi.js";
import { gsap } from "gsap";

// PRD §5.1: combat hit feedback = brief positional bump + red tint flash on
// the affected tile's sprite. Kept module-scoped so other renderers (units,
// marching) can trigger the same effect without re-deriving timings.
const BUMP_OFFSET_PX = 4;
const BUMP_DURATION_S = 0.2;
const TINT_FLASH_COLOR = 0xff5050;
const TINT_FLASH_DURATION_S = 0.1;

export function playCombatBump(node: Container, sprite: Sprite): void {
  // dx/dy small inward jolt — direction randomised so adjacent pairs don't
  // bump in lockstep when both lose to each other in the same tick.
  const angle = Math.random() * Math.PI * 2;
  const dx = Math.cos(angle) * BUMP_OFFSET_PX;
  const dy = Math.sin(angle) * BUMP_OFFSET_PX;
  const baseX = node.position.x;
  const baseY = node.position.y;
  gsap.killTweensOf(node.position);
  gsap.fromTo(
    node.position,
    { x: baseX + dx, y: baseY + dy },
    { x: baseX, y: baseY, duration: BUMP_DURATION_S, ease: "power2.out" },
  );

  const baseTint = sprite.tint;
  sprite.tint = TINT_FLASH_COLOR;
  gsap.delayedCall(TINT_FLASH_DURATION_S, () => {
    sprite.tint = baseTint;
  });
}

export function cancelCombatFx(node: Container, sprite: Sprite): void {
  gsap.killTweensOf(node.position);
  gsap.killTweensOf(sprite);
}
