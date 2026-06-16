import {
  dispatch,
  findPath,
  type DispatchCommand,
  type DispatchRatio,
  type DispatchResult,
} from "@/engine/movement";
import { derivedOwner } from "@/engine/state";
import type { FactionId, GameState, TileId } from "@/engine/types";

import type { PointerButton } from "./pointer";

export const RATIOS: readonly DispatchRatio[] = [0.25, 0.5, 0.75, 1.0];

export type DispatchControllerDeps = {
  readonly getState: () => GameState;
  readonly playerFaction: FactionId;
  readonly onShowValidPath: (
    path: readonly TileId[],
    faction: FactionId,
  ) => void;
  readonly onShowInvalidPath: (from: TileId, to: TileId) => void;
  readonly onClearPath: () => void;
  readonly onCommit: (cmd: DispatchCommand, result: DispatchResult) => void;
  readonly onRatioChange?: (ratio: DispatchRatio) => void;
};

export type DispatchController = {
  handleDragStart(id: TileId, button: PointerButton): void;
  handleDragMove(currentId: TileId | null, button: PointerButton): void;
  handleDragEnd(currentId: TileId | null, button: PointerButton): void;
  handleDragCancel(button: PointerButton): void;
  setRatio(r: DispatchRatio): void;
  getRatio(): DispatchRatio;
  isDragging(): boolean;
};

export function createDispatchController(
  deps: DispatchControllerDeps,
): DispatchController {
  // PRD §5.2: ratio slider remembers last value, defaults to 100% at start.
  let ratio: DispatchRatio = 1.0;
  let activeFrom: TileId | null = null;

  function reset(): void {
    activeFrom = null;
    deps.onClearPath();
  }

  function handleDragStart(id: TileId, button: PointerButton): void {
    if (button !== "left") return;
    const state = deps.getState();
    const src = state.provinces.get(id);
    // PRD §3.5.1 v1.2: dispatch must originate from a tile uniquely owned by
    // the player (single own-faction occupant). UI rejects non-player /
    // contested origins early; engine `dispatch()` double-checks.
    if (src === undefined) return;
    if (derivedOwner(src) !== deps.playerFaction) return;
    const ownerOccupant = src.occupants[0];
    if (ownerOccupant === undefined || ownerOccupant.amount <= 0) return;
    activeFrom = id;
  }

  function paint(currentId: TileId | null): void {
    if (activeFrom === null) return;
    if (currentId === null || currentId === activeFrom) {
      deps.onClearPath();
      return;
    }
    const state = deps.getState();
    const path = findPath(state, activeFrom, currentId, deps.playerFaction);
    if (path === null) {
      deps.onShowInvalidPath(activeFrom, currentId);
    } else {
      deps.onShowValidPath(path, deps.playerFaction);
    }
  }

  function handleDragMove(currentId: TileId | null, button: PointerButton): void {
    if (button !== "left") return;
    paint(currentId);
  }

  function handleDragEnd(currentId: TileId | null, button: PointerButton): void {
    if (button !== "left") return;
    if (activeFrom === null) return;
    const from = activeFrom;
    activeFrom = null;
    deps.onClearPath();
    if (currentId === null || currentId === from) return;
    const cmd: DispatchCommand = { from, to: currentId, ratio };
    const state = deps.getState();
    const result = dispatch(state, cmd);
    deps.onCommit(cmd, result);
  }

  function handleDragCancel(button: PointerButton): void {
    if (button !== "left") return;
    if (activeFrom === null) return;
    reset();
  }

  function setRatio(r: DispatchRatio): void {
    if (ratio === r) return;
    ratio = r;
    deps.onRatioChange?.(r);
  }

  return {
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    setRatio,
    getRatio: () => ratio,
    isDragging: () => activeFrom !== null,
  };
}

export type RatioPanel = {
  readonly element: HTMLElement;
  setRatio(r: DispatchRatio): void;
  destroy(): void;
};

const PANEL_STYLE = [
  "position: fixed",
  "bottom: 12px",
  "right: 12px",
  "padding: 6px",
  "background: rgba(0, 0, 0, 0.6)",
  "border: 1px solid #444",
  "border-radius: 6px",
  "display: flex",
  "gap: 4px",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "font-size: 12px",
  "color: #eee",
  "z-index: 20",
].join(";");

const BTN_BASE_STYLE = [
  "padding: 4px 8px",
  "background: #222",
  "color: #ddd",
  "border: 1px solid #555",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
].join(";");

const BTN_ACTIVE_STYLE = [
  "padding: 4px 8px",
  "background: #c94545",
  "color: #fff",
  "border: 1px solid #c94545",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
].join(";");

export function createRatioPanel(
  parent: HTMLElement,
  initial: DispatchRatio,
  onChange: (r: DispatchRatio) => void,
): RatioPanel {
  const root = document.createElement("div");
  root.style.cssText = PANEL_STYLE;

  const label = document.createElement("span");
  label.textContent = "Dispatch:";
  label.style.cssText = "padding: 4px 4px; align-self: center;";
  root.appendChild(label);

  const buttons = new Map<DispatchRatio, HTMLButtonElement>();
  for (const r of RATIOS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${Math.round(r * 100)}%`;
    btn.style.cssText = BTN_BASE_STYLE;
    btn.addEventListener("click", () => onChange(r));
    buttons.set(r, btn);
    root.appendChild(btn);
  }
  parent.appendChild(root);

  function setRatio(r: DispatchRatio): void {
    for (const [k, btn] of buttons) {
      btn.style.cssText = k === r ? BTN_ACTIVE_STYLE : BTN_BASE_STYLE;
    }
  }
  setRatio(initial);

  function destroy(): void {
    root.remove();
  }

  return { element: root, setRatio, destroy };
}
