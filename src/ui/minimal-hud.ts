import type { FactionId, GameState } from "@/engine/types";

const TRACKED: readonly Exclude<FactionId, "NEUTRAL">[] = [
  "TOKUGAWA",
  "TAKEDA",
  "ODA",
  "UESUGI",
];

const SHORT: Readonly<Record<Exclude<FactionId, "NEUTRAL">, string>> = {
  TOKUGAWA: "TOK",
  TAKEDA: "TAK",
  ODA: "ODA",
  UESUGI: "UES",
};

export type MinimalHudStatus = {
  readonly paused: boolean;
  readonly speed: 1 | 2;
};

export type MinimalHud = {
  update(state: GameState, status: MinimalHudStatus): void;
  destroy(): void;
};

// Throwaway HUD for M2.2.5 spectator mode — superseded by full HUD in M2.7.
// DOM (not Pixi) chosen to keep this trivial to delete later.
export function createMinimalHud(parent: HTMLElement): MinimalHud {
  const root = document.createElement("div");
  root.style.cssText = [
    "position: fixed",
    "top: 8px",
    "right: 8px",
    "padding: 6px 10px",
    "background: rgba(0, 0, 0, 0.55)",
    "color: #eee",
    "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
    "font-size: 13px",
    "border: 1px solid #444",
    "border-radius: 4px",
    "pointer-events: none",
    "z-index: 10",
    "white-space: nowrap",
  ].join(";");
  parent.appendChild(root);

  function update(state: GameState, status: MinimalHudStatus): void {
    const tiles = new Map<FactionId, number>();
    for (const p of state.provinces.values()) {
      tiles.set(p.owner, (tiles.get(p.owner) ?? 0) + 1);
    }
    const tally = TRACKED.map(
      (f) => `${SHORT[f]}:${tiles.get(f) ?? 0}`,
    ).join(" ");
    const speedLabel = status.paused ? "PAUSED" : `${status.speed}x`;
    root.textContent = `Tick: ${state.tick} | ${tally} | ${speedLabel}`;
  }

  function destroy(): void {
    root.remove();
  }

  return { update, destroy };
}
