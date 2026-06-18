import { derivedOwner } from "@/engine/state";
import type { FactionId, GameState } from "@/engine/types";
import { installResponsiveStyles } from "./responsive";

const FACTIONS: readonly Exclude<FactionId, "NEUTRAL">[] = [
  "TOKUGAWA",
  "TAKEDA",
  "ODA",
  "UESUGI",
];

const SHORT: Readonly<Record<Exclude<FactionId, "NEUTRAL">, string>> = {
  TOKUGAWA: "Tokugawa",
  TAKEDA: "Takeda",
  ODA: "Oda",
  UESUGI: "Uesugi",
};

const COLOR_BAR: Readonly<Record<Exclude<FactionId, "NEUTRAL">, string>> = {
  TOKUGAWA: "#c94545",
  TAKEDA: "#4575c9",
  ODA: "#4fb55f",
  UESUGI: "#d9c145",
};

export type FactionPanel = {
  update(state: GameState): void;
  destroy(): void;
};

const ROOT_STYLE = [
  "position: fixed",
  "bottom: 12px",
  "left: 12px",
  "padding: 8px",
  "background: rgba(0, 0, 0, 0.65)",
  "border: 1px solid #444",
  "border-radius: 6px",
  "display: flex",
  "flex-direction: column",
  "gap: 6px",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "font-size: 12px",
  "color: #eee",
  "z-index: 20",
  "user-select: none",
  "min-width: 150px",
].join(";");

const ROW_BASE = [
  "display: grid",
  "grid-template-columns: 12px auto 1fr auto",
  "gap: 6px",
  "align-items: center",
  "padding: 1px 4px",
  "border-radius: 3px",
  "white-space: nowrap",
].join(";");

const ROW_PLAYER = ROW_BASE + ";background: rgba(255,255,255,0.08);";
const ROW_DEFEATED = ROW_BASE + ";opacity: 0.4;";

function rowStyle(isPlayer: boolean, defeated: boolean): string {
  if (defeated) return ROW_DEFEATED;
  return isPlayer ? ROW_PLAYER : ROW_BASE;
}

type FactionStats = {
  tiles: number;
  total: number;
  hasCastle: boolean;
};

function computeStats(
  state: GameState,
): ReadonlyMap<Exclude<FactionId, "NEUTRAL">, FactionStats> {
  const out = new Map<Exclude<FactionId, "NEUTRAL">, FactionStats>();
  for (const f of FACTIONS) {
    out.set(f, { tiles: 0, total: 0, hasCastle: false });
  }
  for (const p of state.provinces.values()) {
    // §3 v1.2: tile "owned" by a faction = exactly one occupant of that
    // faction. Counts (panel "total" column) are per-faction occupant sum
    // even on contested tiles. Castle ownership tracks the castleOwner only
    // when they have an occupant there.
    const owner = derivedOwner(p);
    if (owner !== null && owner !== "NEUTRAL") {
      const s = out.get(owner as Exclude<FactionId, "NEUTRAL">);
      if (s !== undefined) s.tiles += 1;
    }
    for (const o of p.occupants) {
      if (o.faction === "NEUTRAL") continue;
      const s = out.get(o.faction as Exclude<FactionId, "NEUTRAL">);
      if (s !== undefined) s.total += o.amount;
    }
    if (p.isCastle && p.castleOwner !== null && p.castleOwner !== "NEUTRAL") {
      for (const o of p.occupants) {
        if (o.faction === p.castleOwner) {
          const s = out.get(p.castleOwner as Exclude<FactionId, "NEUTRAL">);
          if (s !== undefined) s.hasCastle = true;
          break;
        }
      }
    }
  }
  for (const m of state.marchingStacks) {
    if (m.faction === "NEUTRAL") continue;
    const s = out.get(m.faction as Exclude<FactionId, "NEUTRAL">);
    if (s === undefined) continue;
    s.total += m.count;
  }
  return out;
}

export function createFactionPanel(
  parent: HTMLElement,
  playerFaction: FactionId,
): FactionPanel {
  installResponsiveStyles();
  const root = document.createElement("div");
  root.style.cssText = ROOT_STYLE;
  root.classList.add("ks-faction");
  parent.appendChild(root);

  const title = document.createElement("div");
  title.textContent = "Factions";
  title.style.cssText = "font-weight: 700; padding: 0 4px;";
  root.appendChild(title);

  const rows = new Map<Exclude<FactionId, "NEUTRAL">, HTMLElement>();
  for (const f of FACTIONS) {
    const row = document.createElement("div");
    row.style.cssText = rowStyle(f === playerFaction, false);
    const swatch = document.createElement("span");
    swatch.style.cssText = `width: 12px; height: 12px; background: ${COLOR_BAR[f]}; border-radius: 2px;`;
    row.appendChild(swatch);
    const name = document.createElement("span");
    name.textContent = SHORT[f] + (f === playerFaction ? " (You)" : "");
    row.appendChild(name);
    const stats = document.createElement("span");
    stats.textContent = "0t · 0";
    stats.style.cssText = "text-align: right; opacity: 0.85;";
    row.appendChild(stats);
    const castle = document.createElement("span");
    castle.textContent = "✓";
    castle.style.cssText = "text-align: right;";
    row.appendChild(castle);
    rows.set(f, row);
    root.appendChild(row);
  }

  function update(state: GameState): void {
    const stats = computeStats(state);
    for (const f of FACTIONS) {
      const row = rows.get(f);
      if (row === undefined) continue;
      const s = stats.get(f) ?? { tiles: 0, total: 0, hasCastle: false };
      const defeated = state.defeated.has(f);
      row.style.cssText = rowStyle(f === playerFaction, defeated);
      const statsEl = row.children[2];
      if (statsEl !== undefined) {
        // tiles · troops, abbreviated so each faction stays on one line.
        statsEl.textContent = `${s.tiles}t · ${s.total}`;
      }
      const castleEl = row.children[3];
      if (castleEl !== undefined) {
        if (defeated) castleEl.textContent = "☠";
        else castleEl.textContent = s.hasCastle ? "✓" : "✗";
      }
    }
  }

  function destroy(): void {
    root.remove();
  }

  return { update, destroy };
}
