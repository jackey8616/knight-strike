import type { GameState, Speed } from "@/engine/v2/types";
import { PLAYER_FACTIONS } from "@/engine/v2/types";

const FACTION_CSS: Readonly<Record<string, string>> = {
  TOKUGAWA: "#e06464",
  TAKEDA: "#6492e0",
  ODA: "#6fcf7f",
  UESUGI: "#e0d264",
};

export type HudInfo = { readonly paused: boolean; readonly speed: Speed };

export type V2Hud = {
  update(state: GameState, info: HudInfo): void;
  destroy(): void;
};

// Minimal DOM HUD: day / tick / speed + per-faction gold (PRD §8 AC-39). Tax
// slider + build-mode controls land in a later M13 slice.
export function createV2Hud(container: HTMLElement): V2Hud {
  const el = document.createElement("div");
  el.className = "ks-hud";
  el.style.cssText =
    "position:absolute;left:8px;top:8px;padding:8px 10px;background:rgba(20,20,20,.78);" +
    "color:#eee;font:12px/1.5 monospace;border-radius:6px;pointer-events:none;z-index:5";
  container.appendChild(el);

  return {
    update(state: GameState, info: HudInfo): void {
      const clock = `Day ${state.day} · tick ${state.tick} · ${info.paused ? "⏸" : "▶"} ${info.speed}`;
      const gold = PLAYER_FACTIONS.map((f) => {
        const dead = state.defeated.has(f) ? ";text-decoration:line-through;opacity:.5" : "";
        return `<span class="ks-gold-${f}" style="color:${FACTION_CSS[f]}${dead}">${f.slice(0, 3)}:${state.factions[f].gold}g</span>`;
      }).join("  ");
      el.innerHTML = `<div class="ks-clock">${clock}</div><div>${gold}</div>`;
    },
    destroy(): void {
      el.remove();
    },
  };
}
