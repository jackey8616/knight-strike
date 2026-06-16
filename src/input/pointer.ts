import type { TileId } from "@/engine/types";

export type PointerButton = "left" | "right";

export const DRAG_THRESHOLD_PX = 5;

export type PointerHandlers = {
  onTileClick?(id: TileId, button: PointerButton): void;
  onTileHover?(id: TileId | null): void;
  onDragStart?(id: TileId, button: PointerButton): void;
  onDragMove?(currentId: TileId | null, button: PointerButton): void;
  onDragEnd?(currentId: TileId | null, button: PointerButton): void;
  onDragCancel?(button: PointerButton): void;
};

export type PointerController = {
  onTileOver(id: TileId): void;
  onTileOut(id: TileId): void;
  cancelActiveDrag(): void;
  destroy(): void;
};

type PressState = {
  readonly button: PointerButton;
  readonly startX: number;
  readonly startY: number;
  readonly sourceId: TileId;
  dragging: boolean;
};

function buttonToLogical(btn: number): PointerButton | null {
  if (btn === 0) return "left";
  if (btn === 2) return "right";
  return null;
}

function preventContextMenu(e: MouseEvent): void {
  e.preventDefault();
}

export function createPointerController(
  canvas: HTMLCanvasElement,
  handlers: PointerHandlers,
): PointerController {
  let hoverId: TileId | null = null;
  let press: PressState | null = null;

  function endPress(commit: "click" | "cancel"): void {
    if (press === null) return;
    const { button, dragging, sourceId } = press;
    press = null;
    if (dragging) {
      if (commit === "cancel") handlers.onDragCancel?.(button);
      else handlers.onDragEnd?.(hoverId, button);
    } else if (commit === "click") {
      handlers.onTileClick?.(sourceId, button);
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (press !== null) return;
    if (hoverId === null) return;
    const button = buttonToLogical(e.button);
    if (button === null) return;
    press = {
      button,
      startX: e.clientX,
      startY: e.clientY,
      sourceId: hoverId,
      dragging: false,
    };
  }

  function onPointerMove(e: PointerEvent): void {
    if (press === null) return;
    if (!press.dragging) {
      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;
      if (dx * dx + dy * dy <= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      handlers.onDragStart?.(press.sourceId, press.button);
    }
    handlers.onDragMove?.(hoverId, press.button);
  }

  function onPointerUp(e: PointerEvent): void {
    if (press === null) return;
    const released = buttonToLogical(e.button);
    if (released !== null && released !== press.button) return;
    endPress("click");
  }

  function onPointerCancel(): void {
    endPress("cancel");
  }

  function onTileOver(id: TileId): void {
    if (hoverId === id) return;
    hoverId = id;
    handlers.onTileHover?.(id);
    if (press !== null && press.dragging) {
      handlers.onDragMove?.(id, press.button);
    }
  }

  function onTileOut(id: TileId): void {
    if (hoverId !== id) return;
    hoverId = null;
    handlers.onTileHover?.(null);
    if (press !== null && press.dragging) {
      handlers.onDragMove?.(null, press.button);
    }
  }

  function cancelActiveDrag(): void {
    endPress("cancel");
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("contextmenu", preventContextMenu);

  function destroy(): void {
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("contextmenu", preventContextMenu);
  }

  return {
    onTileOver,
    onTileOut,
    cancelActiveDrag,
    destroy,
  };
}
