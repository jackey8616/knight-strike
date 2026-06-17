import type { GameState, TileId } from "@/engine/types";
import { deriveTier } from "@/engine/upgrade";
import { installResponsiveStyles } from "./responsive";

const ROOT_STYLE = [
  "position: fixed",
  // Bottom-centre, clear of the bottom-left faction panel and the bottom-right
  // dispatch ratio bar (which previously shared this corner and overlapped).
  "bottom: 12px",
  "left: 50%",
  "transform: translateX(-50%)",
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

const TERRAIN_LABEL: Readonly<Record<string, string>> = {
  PLAINS: "Plains",
  FOREST: "Forest · −25% dmg",
  MOUNTAIN: "Mountain · impassable",
  WATER: "Water · impassable",
};

export function createTileInfoPanel(parent: HTMLElement): TileInfoPanel {
  installResponsiveStyles();
  const root = document.createElement("div");
  root.style.cssText = ROOT_STYLE;
  root.classList.add("ks-tile-info");
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
    const lines: string[] = [];
    lines.push(
      `<div style='font-weight:700'>(${p.x}, ${p.y})${p.isCastle ? " ★ Castle" : ""}</div>`,
    );
    const terrain = p.terrain ?? "PLAINS";
    if (terrain !== "PLAINS") {
      lines.push(
        `<div style='opacity:0.7'>${TERRAIN_LABEL[terrain] ?? terrain}</div>`,
      );
    }
    if (p.isCastle && p.castleOwner !== null) {
      lines.push(`<div>Castle of: ${FACTION_LABEL[p.castleOwner] ?? p.castleOwner}</div>`);
    }
    if (p.occupants.length === 0) {
      if (p.lastClaimedFaction !== null) {
        const claimed =
          FACTION_LABEL[p.lastClaimedFaction] ?? p.lastClaimedFaction;
        lines.push(`<div style='opacity:0.6'>Empty · claimed by ${claimed}</div>`);
      } else {
        lines.push(`<div style='opacity:0.6'>Empty</div>`);
      }
    } else if (p.occupants.length === 1) {
      const o = p.occupants[0];
      if (o !== undefined) {
        const tier = deriveTier(o.amount);
        lines.push(`<div>Owner: ${FACTION_LABEL[o.faction] ?? o.faction}</div>`);
        lines.push(`<div>Tier: ${TIER_LABEL[tier]}</div>`);
        lines.push(`<div>Count: ${o.amount}</div>`);
      }
    } else {
      lines.push(`<div style='color:#ff8'>⚔ Contested</div>`);
      for (const o of p.occupants) {
        const tier = deriveTier(o.amount);
        const tag = o.isDefender ? " (def)" : "";
        lines.push(
          `<div>${FACTION_LABEL[o.faction] ?? o.faction}${tag}: ${o.amount} (${TIER_LABEL[tier]})</div>`,
        );
      }
    }
    // PRD §3.6' (v1.4): surface cross-edge sieges touching this tile.
    for (const o of state.attackOrders) {
      if (o.from === id) {
        lines.push(
          `<div style='color:#ff8'>⚔ Besieging ${o.to} (${FACTION_LABEL[o.faction] ?? o.faction})</div>`,
        );
      } else if (o.to === id) {
        lines.push(
          `<div style='color:#f88'>⚔ Under siege by ${FACTION_LABEL[o.faction] ?? o.faction}</div>`,
        );
      }
    }
    root.innerHTML = lines.join("");
  }

  renderEmpty();

  function destroy(): void {
    root.remove();
  }

  return { setHover, destroy };
}
