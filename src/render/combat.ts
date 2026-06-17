import { Container, type Sprite } from "pixi.js";
import { gsap } from "gsap";

// PRD §5.1: combat hit feedback = a brief positional jolt that eases back to
// rest plus a red tint flash on the struck tile's sprite. Every active bump is
// advanced by ONE shared ticker callback rather than a per-hit GSAP tween +
// delayedCall, so a battle with hundreds of simultaneous hits costs a single
// loop over a compact map instead of hundreds of freshly-allocated tween
// objects torn down each tick. A repeated hit on a sprite already bumping
// reuses its record (resets the timer, picks a fresh jolt direction), so a
// sustained fight — e.g. reinforcements streaming into it — allocates nothing
// after the first hit.
const BUMP_OFFSET_PX = 4;
const BUMP_DURATION_MS = 200;
const TINT_FLASH_COLOR = 0xff5050;
const TINT_FLASH_DURATION_MS = 100;

type Bump = {
  readonly node: Container;
  readonly sprite: Sprite;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseTint: number;
  dx: number;
  dy: number;
  elapsed: number;
};

const active = new Map<Sprite, Bump>();
let tickerFn: ((time: number, deltaMs: number) => void) | null = null;

// Direction randomised so adjacent pairs don't bump in lockstep when both lose
// to each other in the same tick.
function jolt(): { dx: number; dy: number } {
  const angle = Math.random() * Math.PI * 2;
  return {
    dx: Math.cos(angle) * BUMP_OFFSET_PX,
    dy: Math.sin(angle) * BUMP_OFFSET_PX,
  };
}

function advance(_time: number, deltaMs: number): void {
  for (const [sprite, b] of active) {
    if (b.node.destroyed || sprite.destroyed) {
      active.delete(sprite);
      continue;
    }
    b.elapsed += deltaMs;
    const t = b.elapsed / BUMP_DURATION_MS;
    if (t >= 1) {
      b.node.position.set(b.baseX, b.baseY);
      if (sprite.tint !== b.baseTint) sprite.tint = b.baseTint;
      active.delete(sprite);
      continue;
    }
    // power2.out (cubic) ease of the offset back to rest — matches the tween
    // the per-hit version used.
    const u = 1 - t;
    const k = u * u * u;
    b.node.position.set(b.baseX + b.dx * k, b.baseY + b.dy * k);
    const desired =
      b.elapsed < TINT_FLASH_DURATION_MS ? TINT_FLASH_COLOR : b.baseTint;
    if (sprite.tint !== desired) sprite.tint = desired;
  }
  if (active.size === 0 && tickerFn !== null) {
    gsap.ticker.remove(tickerFn);
    tickerFn = null;
  }
}

export function playCombatBump(node: Container, sprite: Sprite): void {
  const existing = active.get(sprite);
  if (existing !== undefined) {
    const { dx, dy } = jolt();
    existing.dx = dx;
    existing.dy = dy;
    existing.elapsed = 0;
    return;
  }
  const { dx, dy } = jolt();
  active.set(sprite, {
    node,
    sprite,
    // Capture the resting transform/tint now; the driver restores to it. Reused
    // across re-hits so a mid-bump offset/flash is never mistaken for the base.
    baseX: node.position.x,
    baseY: node.position.y,
    baseTint: sprite.tint,
    dx,
    dy,
    elapsed: 0,
  });
  if (tickerFn === null) {
    tickerFn = advance;
    gsap.ticker.add(tickerFn);
  }
}
