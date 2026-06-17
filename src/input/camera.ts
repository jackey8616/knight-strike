// Camera input: mouse wheel zoom (desktop) + two-finger pinch-zoom & pan
// (touch). Single-finger touch is left to the pointer controller for tile
// select / drag-dispatch; while two fingers are down we suspend it so a pinch
// never fires a stray dispatch.
//
// Focal points are in canvas CSS px (matching the board's screen-space camera).

export type CameraGestureDeps = {
  zoomBy(factor: number, focalX: number, focalY: number): void;
  panBy(dx: number, dy: number): void;
  onGestureStart(): void; // a 2-finger gesture began → suspend pointer dispatch
  onGestureEnd(): void; // fingers lifted → resume pointer dispatch
};

export type CameraGestures = {
  destroy(): void;
};

// Per wheel delta unit; ~16% zoom per 100px of wheel / trackpad travel.
const WHEEL_ZOOM_BASE = 1.0015;

export function createCameraGestures(
  canvas: HTMLCanvasElement,
  deps: CameraGestureDeps,
): CameraGestures {
  function rect(): DOMRect {
    return canvas.getBoundingClientRect();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = rect();
    const factor = WHEEL_ZOOM_BASE ** -e.deltaY;
    deps.zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
  }

  let pinching = false;
  let lastDist = 0;
  let lastCx = 0;
  let lastCy = 0;

  function twoFingerInfo(touches: TouchList): {
    cx: number;
    cy: number;
    dist: number;
  } {
    const r = rect();
    const a = touches[0] as Touch;
    const b = touches[1] as Touch;
    const ax = a.clientX - r.left;
    const ay = a.clientY - r.top;
    const bx = b.clientX - r.left;
    const by = b.clientY - r.top;
    return {
      cx: (ax + bx) / 2,
      cy: (ay + by) / 2,
      dist: Math.hypot(bx - ax, by - ay),
    };
  }

  function onTouchStart(e: TouchEvent): void {
    if (e.touches.length < 2) return;
    e.preventDefault();
    if (!pinching) {
      pinching = true;
      deps.onGestureStart();
    }
    const info = twoFingerInfo(e.touches);
    lastDist = info.dist;
    lastCx = info.cx;
    lastCy = info.cy;
  }

  function onTouchMove(e: TouchEvent): void {
    if (!pinching || e.touches.length < 2) return;
    e.preventDefault();
    const info = twoFingerInfo(e.touches);
    if (lastDist > 0) deps.zoomBy(info.dist / lastDist, info.cx, info.cy);
    deps.panBy(info.cx - lastCx, info.cy - lastCy);
    lastDist = info.dist;
    lastCx = info.cx;
    lastCy = info.cy;
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!pinching) return;
    if (e.touches.length >= 2) {
      // Still pinching with a different finger pair — re-seed the baseline.
      const info = twoFingerInfo(e.touches);
      lastDist = info.dist;
      lastCx = info.cx;
      lastCy = info.cy;
      return;
    }
    pinching = false;
    lastDist = 0;
    deps.onGestureEnd();
  }

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchEnd);

  function destroy(): void {
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
  }

  return { destroy };
}
