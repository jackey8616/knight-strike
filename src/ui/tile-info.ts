import type { GameState, TileId } from "@/engine/types";
import { deriveTier } from "@/engine/upgrade";

const ROOT_STYLE = [
  "position: fixed",
  "bottom: 12px",
  "right: 12px",
  "padding: 8px 12px",
  "background: rgba(0, 0, 0, 0.65)",
  "border: 1px solid #444",
  "border-radius: 6px",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "font-size: 12px",
  "color: #eee",
  "min-width: 180px",
  "z-index: 20",
  "user-select: none",
].join(";");

export type TileInfoPanel = {
  setHover(state: GameState, id: TileId | null): void;
  destroy(): void;
};

const FACTION_LABEL: Readonly<Record<string, string>> = {
  TOKUGAWA: "Tokugawa",
  TAKEDA: "Takeda",
  ODA: "Oda",
  UESUGI: "Uesugi",
  NEUTRAL: "Neutral",
};

const TIER_LABEL = {
  SOLDIER: "Soldier",
  KNIGHT: "Knight",
  QUEEN: "Queen",
  KING: "King",
} as const;

export function createTileInfoPanel(parent: HTMLElement): TileInfoPanel {
  const root = document.createElement("div");
  root.style.cssText = ROOT_STYLE;
  parent.appendChild(root);

  function renderEmpty(): void {
    root.innerHTML = "<div style='opacity:0.6'>Hover a tile</div>";
  }

  function setHover(state: GameState, id: TileId | null): void {
    if (id === null) {
      renderEmpty();
      return;
    }
    const p = state.provinces.get(id);
    if (p === undefined) {
      renderEmpty();
      return;
    }
    const tier = deriveTier(p.count);
    const ownerLabel = FACTION_LABEL[p.owner] ?? p.owner;
    const lines: string[] = [];
    lines.push(`<div style='font-weight:700'>(${p.x}, ${p.y})${p.isCastle ? " ★ Castle" : ""}</div>`);
    lines.push(`<div>Owner: ${ownerLabel}</div>`);
    if (p.count > 0) {
      lines.push(`<div>Tier: ${TIER_LABEL[tier]}</div>`);
      lines.push(`<div>Count: ${p.count}</div>`);
    } else {
      lines.push(`<div style='opacity:0.6'>Empty</div>`);
    }
    root.innerHTML = lines.join("");
  }

  renderEmpty();

  function destroy(): void {
    root.remove();
  }

  return { setHover, destroy };
}
