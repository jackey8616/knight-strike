import { installResponsiveStyles } from "./responsive";

export type EndScreenStats = {
  readonly playerWon: boolean;
  readonly playerTiles: number;
  readonly ticks: number;
};

export type EndScreen = {
  show(stats: EndScreenStats): void;
  hide(): void;
  destroy(): void;
};

export type EndScreenActions = {
  // Replay with the same map size + difficulty (PRD §6.2.2).
  readonly onRestart: () => void;
  // Return to the Start Menu to re-pick size + difficulty (PRD §6.2.2).
  readonly onMainMenu: () => void;
};

const OVERLAY_STYLE = [
  "position: fixed",
  "inset: 0",
  "background: rgba(0, 0, 0, 0.78)",
  "display: none",
  "flex-direction: column",
  "align-items: center",
  "justify-content: center",
  "gap: 16px",
  "z-index: 100",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "color: #eee",
].join(";");

const TITLE_STYLE_WIN = "font-size: 48px; font-weight: 700; color: #f4f1d6;";
const TITLE_STYLE_LOSS = "font-size: 48px; font-weight: 700; color: #c94545;";

const STATS_STYLE = "font-size: 14px; opacity: 0.85; text-align: center;";

const BTN_STYLE = [
  "padding: 8px 24px",
  "background: #c94545",
  "color: #fff",
  "border: 1px solid #c94545",
  "border-radius: 6px",
  "cursor: pointer",
  "font: inherit",
  "font-size: 16px",
].join(";");

const BTN_SECONDARY_STYLE = [
  "padding: 8px 24px",
  "background: #222",
  "color: #ddd",
  "border: 1px solid #555",
  "border-radius: 6px",
  "cursor: pointer",
  "font: inherit",
  "font-size: 16px",
].join(";");

const BTN_ROW_STYLE = "display: flex; gap: 12px; flex-wrap: wrap;";

export function createEndScreen(
  parent: HTMLElement,
  actions: EndScreenActions,
): EndScreen {
  installResponsiveStyles();
  const root = document.createElement("div");
  root.style.cssText = OVERLAY_STYLE;
  root.classList.add("ks-end");

  const title = document.createElement("div");
  root.appendChild(title);

  const stats = document.createElement("div");
  stats.style.cssText = STATS_STYLE;
  root.appendChild(stats);

  const buttonRow = document.createElement("div");
  buttonRow.style.cssText = BTN_ROW_STYLE;

  const restartButton = document.createElement("button");
  restartButton.type = "button";
  restartButton.style.cssText = BTN_STYLE;
  restartButton.textContent = "Restart";
  restartButton.addEventListener("click", () => actions.onRestart());
  buttonRow.appendChild(restartButton);

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.style.cssText = BTN_SECONDARY_STYLE;
  menuButton.textContent = "Main Menu";
  menuButton.addEventListener("click", () => actions.onMainMenu());
  buttonRow.appendChild(menuButton);

  root.appendChild(buttonRow);

  parent.appendChild(root);

  function show(s: EndScreenStats): void {
    title.textContent = s.playerWon ? "Victory" : "Defeat";
    title.setAttribute(
      "style",
      s.playerWon ? TITLE_STYLE_WIN : TITLE_STYLE_LOSS,
    );
    stats.textContent = `Ticks: ${s.ticks}    ·    Tiles: ${s.playerTiles}`;
    root.style.display = "flex";
  }

  function hide(): void {
    root.style.display = "none";
  }

  function destroy(): void {
    root.remove();
  }

  return { show, hide, destroy };
}
