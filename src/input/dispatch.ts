import {
  dispatch,
  findPath,
  type DispatchCommand,
  type DispatchRatio,
  type DispatchResult,
} from "@/engine/movement";
import { derivedOwner } from "@/engine/state";
import type { FactionId, GameState, TileId } from "@/engine/types";
import { installResponsiveStyles } from "@/ui/responsive";

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
  // When the drag's source tile is the currently-selected unit, return the
  // exact troop count chosen on the manual slider; otherwise undefined (fall
  // back to the ratio). Lets the player dispatch a precise number.
  readonly getForceCount?: (from: TileId) => number | undefined;
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
    // PRD §4.5.1 v1.2: dispatch must originate from a tile uniquely owned by
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
    const forceCount = deps.getForceCount?.(from);
    const cmd: DispatchCommand =
      forceCount !== undefined
        ? { from, to: currentId, ratio, forceCount }
        : { from, to: currentId, ratio };
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

export type RatioPanelHandlers = {
  readonly onRatio: (r: DispatchRatio) => void;
  readonly onCount: (n: number) => void;
};

export type RatioPanel = {
  readonly element: HTMLElement;
  setRatio(r: DispatchRatio): void;
  // Reveal the manual troop slider for a selected unit (1..max), seeded at
  // `value`. The ratio buttons then act as quick presets on this range.
  showCount(max: number, value: number): void;
  hideCount(): void;
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
  "flex-direction: column",
  "align-items: stretch",
  "gap: 4px",
  "min-width: 96px",
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
  handlers: RatioPanelHandlers,
): RatioPanel {
  installResponsiveStyles();
  const root = document.createElement("div");
  root.style.cssText = PANEL_STYLE;
  root.classList.add("ks-dispatch");

  const label = document.createElement("span");
  label.textContent = "Dispatch";
  label.style.cssText = "font-weight: 700; text-align: center;";
  root.appendChild(label);

  // Manual troop selector — hidden until a unit is selected.
  let maxSend = 1;
  const countWrap = document.createElement("div");
  countWrap.style.cssText =
    "display: none; flex-direction: column; gap: 2px; padding: 2px 0;";
  const countLabel = document.createElement("span");
  countLabel.style.cssText = "text-align: center; opacity: 0.9;";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "1";
  slider.max = "1";
  slider.value = "1";
  slider.style.cssText = "width: 100%; accent-color: #c94545; margin: 0;";
  function setCountLabel(v: number): void {
    countLabel.textContent = `Send ${v} / ${maxSend}`;
  }
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    setCountLabel(v);
    handlers.onCount(v);
  });
  countWrap.appendChild(countLabel);
  countWrap.appendChild(slider);
  root.appendChild(countWrap);

  const buttons = new Map<DispatchRatio, HTMLButtonElement>();
  function setRatio(r: DispatchRatio): void {
    for (const [k, btn] of buttons) {
      btn.style.cssText = k === r ? BTN_ACTIVE_STYLE : BTN_BASE_STYLE;
    }
  }
  for (const r of RATIOS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${Math.round(r * 100)}%`;
    btn.style.cssText = BTN_BASE_STYLE;
    btn.addEventListener("click", () => {
      setRatio(r);
      handlers.onRatio(r);
      // When a unit is selected, presets snap the manual slider too.
      if (countWrap.style.display !== "none") {
        const v = Math.max(1, Math.min(maxSend, Math.floor(maxSend * r)));
        slider.value = String(v);
        setCountLabel(v);
        handlers.onCount(v);
      }
    });
    buttons.set(r, btn);
    root.appendChild(btn);
  }
  parent.appendChild(root);
  setRatio(initial);

  function showCount(max: number, value: number): void {
    maxSend = Math.max(1, Math.floor(max));
    slider.max = String(maxSend);
    const v = Math.max(1, Math.min(maxSend, Math.floor(value)));
    slider.value = String(v);
    setCountLabel(v);
    countWrap.style.display = "flex";
  }
  function hideCount(): void {
    countWrap.style.display = "none";
  }

  function destroy(): void {
    root.remove();
  }

  return { element: root, setRatio, showCount, hideCount, destroy };
}
