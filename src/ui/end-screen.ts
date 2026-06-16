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

export function createEndScreen(
  parent: HTMLElement,
  onRestart: () => void,
): EndScreen {
  const root = document.createElement("div");
  root.style.cssText = OVERLAY_STYLE;

  const title = document.createElement("div");
  root.appendChild(title);

  const stats = document.createElement("div");
  stats.style.cssText = STATS_STYLE;
  root.appendChild(stats);

  const button = document.createElement("button");
  button.type = "button";
  button.style.cssText = BTN_STYLE;
  button.textContent = "Restart";
  button.addEventListener("click", () => onRestart());
  root.appendChild(button);

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
