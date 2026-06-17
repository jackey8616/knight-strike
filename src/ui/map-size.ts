import { MAP_SIZES, type MapSize } from "@/scenarios/sized";
import { installResponsiveStyles } from "./responsive";

export type MapSizePanel = {
  destroy(): void;
};

const PANEL_STYLE = [
  "position: fixed",
  "top: 8px",
  "right: 12px",
  "padding: 6px",
  "background: rgba(0, 0, 0, 0.6)",
  "border: 1px solid #444",
  "border-radius: 6px",
  "display: flex",
  "align-items: center",
  "gap: 4px",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "font-size: 12px",
  "color: #eee",
  "z-index: 30",
  "user-select: none",
].join(";");

const BTN_BASE = [
  "padding: 2px 6px",
  "background: #222",
  "color: #ddd",
  "border: 1px solid #555",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
].join(";");

const BTN_ACTIVE = [
  "padding: 2px 6px",
  "background: #c94545",
  "color: #fff",
  "border: 1px solid #c94545",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
].join(";");

// Map-size picker. Switching size starts a fresh game at that board size
// (carried in the URL), so the choice survives the reload.
export function createMapSizePanel(
  parent: HTMLElement,
  current: MapSize,
  onSelect: (size: MapSize) => void,
): MapSizePanel {
  installResponsiveStyles();
  const root = document.createElement("div");
  root.style.cssText = PANEL_STYLE;
  root.classList.add("ks-mapsize");

  const label = document.createElement("span");
  label.textContent = "Map";
  label.style.cssText = "opacity: 0.8;";
  root.appendChild(label);

  for (const size of MAP_SIZES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(size);
    btn.style.cssText = size === current ? BTN_ACTIVE : BTN_BASE;
    btn.addEventListener("click", () => {
      if (size !== current) onSelect(size);
    });
    root.appendChild(btn);
  }
  parent.appendChild(root);

  function destroy(): void {
    root.remove();
  }

  return { destroy };
}
