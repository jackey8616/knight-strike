export type BuildMode = "OFF" | "HOUSE" | "BRIDGE" | "FENCE";

export type ControlsHandlers = {
  onPauseToggle(): void;
  onCycleSpeed(): void;
  onTax(rate: number): void;
  onBuildMode(mode: BuildMode): void;
};

export type Controls = {
  getBuildMode(): BuildMode;
  setStatus(text: string): void;
  destroy(): void;
};

const BUILD_HINT: Readonly<Record<BuildMode, string>> = {
  OFF: "select mode: click a unit, then a tile to move it",
  HOUSE: "build house: click a tile where your unit stands",
  BRIDGE: "build bridge: click a river/lava tile next to your unit",
  FENCE: "build fence: click a land tile next to your unit",
};

// Player control bar (PRD §8 AC-39/41): pause / speed, tax slider, build-mode
// toggle. DOM, bottom-center.
export function createControls(container: HTMLElement, handlers: ControlsHandlers): Controls {
  let buildMode: BuildMode = "OFF";

  const bar = document.createElement("div");
  bar.className = "ks-controls";
  bar.style.cssText =
    "position:absolute;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);" +
    "display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;max-width:96vw;" +
    "padding:6px 10px;background:rgba(20,20,20,.82);color:#eee;font:12px monospace;border-radius:8px;z-index:6";

  const button = (text: string, onClick: () => void, cls = ""): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = text;
    if (cls) b.className = cls;
    b.style.cssText = "padding:4px 8px;font:12px monospace;cursor:pointer;border-radius:5px;border:1px solid #555;background:#333;color:#eee";
    b.addEventListener("click", onClick);
    return b;
  };

  bar.appendChild(button("⏯", handlers.onPauseToggle, "ks-pause"));
  bar.appendChild(button("»", handlers.onCycleSpeed, "ks-speed"));

  const taxWrap = document.createElement("label");
  taxWrap.style.cssText = "display:flex;align-items:center;gap:4px";
  const taxVal = document.createElement("span");
  taxVal.className = "ks-tax-val";
  taxVal.textContent = "0%";
  const tax = document.createElement("input");
  tax.type = "range";
  tax.min = "0";
  tax.max = "30";
  tax.value = "0";
  tax.step = "5";
  tax.className = "ks-tax";
  tax.style.width = "70px";
  tax.addEventListener("input", () => {
    const pct = Number(tax.value);
    taxVal.textContent = `${pct}%`;
    handlers.onTax(pct / 100);
  });
  taxWrap.append("tax", tax, taxVal);
  bar.appendChild(taxWrap);

  const modeButtons = new Map<BuildMode, HTMLButtonElement>();
  const setMode = (m: BuildMode): void => {
    buildMode = m;
    for (const [bm, b] of modeButtons) b.style.background = bm === m ? "#5a7d3a" : "#333";
    status.textContent = BUILD_HINT[m];
    handlers.onBuildMode(m);
  };
  for (const m of ["OFF", "HOUSE", "BRIDGE", "FENCE"] as const) {
    const b = button(m === "OFF" ? "Select" : m[0] + m.slice(1).toLowerCase(), () => setMode(m), `ks-build-${m}`);
    modeButtons.set(m, b);
    bar.appendChild(b);
  }

  // full-width row inside the bar (order:-1 → renders on top), so it flows with
  // the wrapped buttons instead of overlapping them on a narrow phone.
  const status = document.createElement("div");
  status.className = "ks-status";
  status.style.cssText =
    "order:-1;flex-basis:100%;text-align:center;color:#ccc;font:11px monospace;pointer-events:none";
  status.textContent = BUILD_HINT.OFF;
  bar.appendChild(status);

  container.appendChild(bar);
  setMode("OFF");

  return {
    getBuildMode: () => buildMode,
    setStatus: (text: string) => {
      status.textContent = text;
    },
    destroy: () => {
      bar.remove();
    },
  };
}
