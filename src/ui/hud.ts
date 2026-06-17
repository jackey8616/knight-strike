import { installResponsiveStyles } from "./responsive";

export type HudSpeed = 1 | 2 | 3 | 4;

const SPEEDS: readonly HudSpeed[] = [1, 2, 3, 4];

export type HudStatus = {
  readonly tick: number;
  readonly paused: boolean;
  readonly speed: HudSpeed;
  readonly intervalMs: number;
};

export type HudDeps = {
  onTogglePause(): void;
  onSpeed(speed: HudSpeed): void;
};

export type Hud = {
  setStatus(status: HudStatus): void;
  markTick(): void;
  destroy(): void;
};

const ROOT_STYLE = [
  "position: fixed",
  "top: 8px",
  "left: 50%",
  "transform: translateX(-50%)",
  "padding: 8px 14px",
  "background: rgba(0, 0, 0, 0.65)",
  "border: 1px solid #444",
  "border-radius: 6px",
  "display: flex",
  "gap: 12px",
  "align-items: center",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "font-size: 13px",
  "color: #eee",
  "z-index: 30",
  "user-select: none",
].join(";");

const BTN_BASE = [
  "padding: 2px 8px",
  "background: #222",
  "color: #ddd",
  "border: 1px solid #555",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
].join(";");

const BTN_ACTIVE = [
  "padding: 2px 8px",
  "background: #c94545",
  "color: #fff",
  "border: 1px solid #c94545",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
].join(";");

const BAR_OUTER = [
  "width: 120px",
  "height: 6px",
  "background: #333",
  "border: 1px solid #555",
  "border-radius: 3px",
  "overflow: hidden",
].join(";");

const BAR_INNER = [
  "height: 100%",
  "background: #f0a020",
  "width: 0%",
].join(";");

export function createHud(parent: HTMLElement, deps: HudDeps): Hud {
  installResponsiveStyles();
  const root = document.createElement("div");
  root.style.cssText = ROOT_STYLE;
  root.classList.add("ks-hud");
  parent.appendChild(root);

  const tickLabel = document.createElement("span");
  tickLabel.textContent = "Tick 0";
  root.appendChild(tickLabel);

  const barOuter = document.createElement("div");
  barOuter.style.cssText = BAR_OUTER;
  barOuter.classList.add("ks-bar");
  const barInner = document.createElement("div");
  barInner.style.cssText = BAR_INNER;
  barOuter.appendChild(barInner);
  root.appendChild(barOuter);

  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.style.cssText = BTN_BASE;
  pauseBtn.textContent = "Pause";
  pauseBtn.addEventListener("click", () => deps.onTogglePause());
  root.appendChild(pauseBtn);

  const speedBtns: { readonly speed: HudSpeed; readonly el: HTMLButtonElement }[] = [];
  for (const s of SPEEDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = BTN_BASE;
    btn.textContent = `${s}x`;
    btn.addEventListener("click", () => deps.onSpeed(s));
    root.appendChild(btn);
    speedBtns.push({ speed: s, el: btn });
  }

  let cur: HudStatus = { tick: 0, paused: false, speed: 1, intervalMs: 2000 };
  let lastTickAt = performance.now();
  let pausedAccum = 0;
  let pausedAt: number | null = null;
  let raf: number | null = null;

  function paintControls(): void {
    pauseBtn.textContent = cur.paused ? "Resume" : "Pause";
    pauseBtn.style.cssText = cur.paused ? BTN_ACTIVE : BTN_BASE;
    for (const { speed, el } of speedBtns) {
      el.style.cssText = cur.speed === speed ? BTN_ACTIVE : BTN_BASE;
    }
    tickLabel.textContent = `Tick ${cur.tick}`;
  }

  function tickLoop(): void {
    raf = window.requestAnimationFrame(tickLoop);
    const now = performance.now();
    let elapsed = now - lastTickAt - pausedAccum;
    if (cur.paused && pausedAt !== null) {
      elapsed = pausedAt - lastTickAt - pausedAccum;
    }
    const frac = Math.min(1, Math.max(0, elapsed / cur.intervalMs));
    barInner.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  function setStatus(status: HudStatus): void {
    const wasPaused = cur.paused;
    cur = status;
    if (cur.paused && !wasPaused) {
      pausedAt = performance.now();
    } else if (!cur.paused && wasPaused && pausedAt !== null) {
      pausedAccum += performance.now() - pausedAt;
      pausedAt = null;
    }
    paintControls();
  }

  function markTick(): void {
    lastTickAt = performance.now();
    pausedAccum = 0;
    pausedAt = cur.paused ? lastTickAt : null;
    barInner.style.width = "0%";
  }

  paintControls();
  raf = window.requestAnimationFrame(tickLoop);

  function destroy(): void {
    if (raf !== null) {
      window.cancelAnimationFrame(raf);
      raf = null;
    }
    root.remove();
  }

  return { setStatus, markTick, destroy };
}
