import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tileId } from "@/engine/state";

import {
  createPointerController,
  DRAG_THRESHOLD_PX,
  type PointerHandlers,
} from "./pointer";

type EventStore = {
  readonly canvas: Map<string, Set<EventListener>>;
  readonly window: Map<string, Set<EventListener>>;
};

function makeCanvas(store: EventStore): HTMLCanvasElement {
  return {
    addEventListener: (type: string, fn: EventListener) => {
      const set = store.canvas.get(type) ?? new Set<EventListener>();
      set.add(fn);
      store.canvas.set(type, set);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      store.canvas.get(type)?.delete(fn);
    },
  } as unknown as HTMLCanvasElement;
}

function fire(
  store: EventStore,
  surface: "canvas" | "window",
  type: string,
  e: unknown,
): void {
  const map = surface === "canvas" ? store.canvas : store.window;
  for (const fn of map.get(type) ?? []) {
    fn(e as Event);
  }
}

const A = tileId(1, 0);
const B = tileId(2, 0);

describe("pointer controller", () => {
  let store: EventStore;
  let origWindow: typeof window | undefined;
  let originalAddEvent:
    | ((type: string, fn: EventListener) => void)
    | undefined;
  let originalRemoveEvent:
    | ((type: string, fn: EventListener) => void)
    | undefined;

  beforeEach(() => {
    store = {
      canvas: new Map<string, Set<EventListener>>(),
      window: new Map<string, Set<EventListener>>(),
    };
    origWindow = globalThis.window;
    const ev = {
      addEventListener: vi.fn((type: string, fn: EventListener) => {
        const set = store.window.get(type) ?? new Set<EventListener>();
        set.add(fn);
        store.window.set(type, set);
      }),
      removeEventListener: vi.fn((type: string, fn: EventListener) => {
        store.window.get(type)?.delete(fn);
      }),
    };
    originalAddEvent = ev.addEventListener as never;
    originalRemoveEvent = ev.removeEventListener as never;
    Object.defineProperty(globalThis, "window", {
      value: ev,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (origWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        value: origWindow,
        configurable: true,
        writable: true,
      });
    }
    void originalAddEvent;
    void originalRemoveEvent;
  });

  it("click without drag fires onTileClick with the source tile id", () => {
    const calls: { kind: string; args: unknown[] }[] = [];
    const handlers: PointerHandlers = {
      onTileClick: (id, btn) => calls.push({ kind: "click", args: [id, btn] }),
      onDragStart: (id, btn) => calls.push({ kind: "start", args: [id, btn] }),
      onDragEnd: (id, btn) => calls.push({ kind: "end", args: [id, btn] }),
    };
    const canvas = makeCanvas(store);
    const ctrl = createPointerController(canvas, handlers);

    ctrl.onTileOver(A);
    fire(store, "canvas", "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    // Small jitter (< 5 px) should NOT trigger drag.
    fire(store, "window", "pointermove", { clientX: 102, clientY: 102 });
    fire(store, "window", "pointerup", { button: 0 });

    expect(calls.map((c) => c.kind)).toEqual(["click"]);
    expect(calls[0]?.args).toEqual([A, "left"]);
    ctrl.destroy();
  });

  it("drag beyond threshold fires onDragStart then onDragEnd with current hover", () => {
    const calls: { kind: string; args: unknown[] }[] = [];
    const handlers: PointerHandlers = {
      onTileClick: (id, btn) => calls.push({ kind: "click", args: [id, btn] }),
      onDragStart: (id, btn) => calls.push({ kind: "start", args: [id, btn] }),
      onDragMove: (id, btn) => calls.push({ kind: "move", args: [id, btn] }),
      onDragEnd: (id, btn) => calls.push({ kind: "end", args: [id, btn] }),
    };
    const canvas = makeCanvas(store);
    const ctrl = createPointerController(canvas, handlers);

    ctrl.onTileOver(A);
    fire(store, "canvas", "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    // Move > threshold
    fire(store, "window", "pointermove", {
      clientX: 100 + DRAG_THRESHOLD_PX + 1,
      clientY: 100,
    });
    ctrl.onTileOut(A);
    ctrl.onTileOver(B);
    fire(store, "window", "pointerup", { button: 0 });

    const kinds = calls.map((c) => c.kind);
    expect(kinds[0]).toBe("start");
    expect(kinds[kinds.length - 1]).toBe("end");
    const endCall = calls[calls.length - 1];
    expect(endCall?.args).toEqual([B, "left"]);
    ctrl.destroy();
  });

  it("right-button press routes through with button=right", () => {
    const calls: { kind: string; args: unknown[] }[] = [];
    const handlers: PointerHandlers = {
      onDragStart: (id, btn) => calls.push({ kind: "start", args: [id, btn] }),
      onDragEnd: (id, btn) => calls.push({ kind: "end", args: [id, btn] }),
    };
    const canvas = makeCanvas(store);
    const ctrl = createPointerController(canvas, handlers);

    ctrl.onTileOver(A);
    fire(store, "canvas", "pointerdown", { button: 2, clientX: 100, clientY: 100 });
    fire(store, "window", "pointermove", { clientX: 200, clientY: 200 });
    fire(store, "window", "pointerup", { button: 2 });

    expect(calls.length).toBe(2);
    expect(calls[0]?.args[1]).toBe("right");
    expect(calls[1]?.args[1]).toBe("right");
    ctrl.destroy();
  });

  it("cancelActiveDrag aborts an in-flight drag", () => {
    const calls: string[] = [];
    const handlers: PointerHandlers = {
      onDragStart: () => calls.push("start"),
      onDragEnd: () => calls.push("end"),
      onDragCancel: () => calls.push("cancel"),
    };
    const canvas = makeCanvas(store);
    const ctrl = createPointerController(canvas, handlers);

    ctrl.onTileOver(A);
    fire(store, "canvas", "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    fire(store, "window", "pointermove", { clientX: 100, clientY: 100 });
    ctrl.cancelActiveDrag();
    fire(store, "window", "pointerup", { button: 0 });

    expect(calls).toEqual(["start", "cancel"]);
    ctrl.destroy();
  });
});
