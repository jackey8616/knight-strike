export type Speed = 1 | 2;

export type KeyboardDeps = {
  isPaused(): boolean;
  setPaused(v: boolean): void;
  getSpeed(): Speed;
  setSpeed(s: Speed): void;
  cancelDrag(): void;
  panBy(dx: number, dy: number): void;
  resetCamera(): void;
};

export type KeyboardController = {
  destroy(): void;
};

const PAN_SPEED_PX_PER_S = 320;

const PAN_KEYS = new Map<string, readonly [number, number]>([
  ["w", [0, -1]],
  ["W", [0, -1]],
  ["ArrowUp", [0, -1]],
  ["s", [0, 1]],
  ["S", [0, 1]],
  ["ArrowDown", [0, 1]],
  ["a", [-1, 0]],
  ["A", [-1, 0]],
  ["ArrowLeft", [-1, 0]],
  ["d", [1, 0]],
  ["D", [1, 0]],
  ["ArrowRight", [1, 0]],
]);

export function createKeyboardController(
  deps: KeyboardDeps,
): KeyboardController {
  const held = new Set<string>();
  let rafHandle: number | null = null;
  let lastFrame = 0;

  function step(now: number): void {
    rafHandle = window.requestAnimationFrame(step);
    const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;
    if (held.size === 0 || dt === 0) return;
    let vx = 0;
    let vy = 0;
    for (const key of held) {
      const offset = PAN_KEYS.get(key);
      if (offset === undefined) continue;
      vx += offset[0];
      vy += offset[1];
    }
    if (vx === 0 && vy === 0) return;
    deps.panBy(-vx * PAN_SPEED_PX_PER_S * dt, -vy * PAN_SPEED_PX_PER_S * dt);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    switch (e.key) {
      case " ":
      case "Spacebar": {
        e.preventDefault();
        deps.setPaused(!deps.isPaused());
        return;
      }
      case "1":
        deps.setSpeed(1);
        return;
      case "2":
        deps.setSpeed(2);
        return;
      case "Escape":
        deps.cancelDrag();
        return;
      case "r":
      case "R":
        deps.resetCamera();
        return;
      default:
        break;
    }
    if (PAN_KEYS.has(e.key)) {
      held.add(e.key);
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (PAN_KEYS.has(e.key)) held.delete(e.key);
  }

  function onBlur(): void {
    held.clear();
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  rafHandle = window.requestAnimationFrame(step);

  function destroy(): void {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    if (rafHandle !== null) {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  return { destroy };
}
