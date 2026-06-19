import { installResponsiveStyles } from "./responsive";

// PRD §4.3 (v2.6): the player's economy HUD — a gold readout plus a tax-rate
// slider (0..maxTaxPct). Raising tax yields more gold per economy day but slows
// House population growth; the player dials the trade-off here. AI factions set
// their own rate from difficulty (§5.3), so this only drives the player.
export type EconomyPanel = {
  // Refresh the readouts each render. `taxPct` re-syncs the slider when it
  // changes outside the panel (e.g. a fresh game on Restart).
  update(gold: number, taxPct: number): void;
  destroy(): void;
};

export type EconomyPanelDeps = {
  readonly initialTaxPct: number;
  readonly maxTaxPct: number;
  readonly onTax: (pct: number) => void;
};

const ROOT_STYLE = [
  "position: fixed",
  "top: 8px",
  "left: 12px",
  "padding: 6px 10px",
  "background: rgba(0, 0, 0, 0.65)",
  "border: 1px solid #444",
  "border-radius: 6px",
  "display: flex",
  "gap: 10px",
  "align-items: center",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "font-size: 12px",
  "color: #eee",
  "z-index: 25",
  "user-select: none",
].join(";");

export function createEconomyPanel(
  parent: HTMLElement,
  deps: EconomyPanelDeps,
): EconomyPanel {
  installResponsiveStyles();
  const root = document.createElement("div");
  root.style.cssText = ROOT_STYLE;
  root.classList.add("ks-economy");

  const gold = document.createElement("span");
  gold.style.cssText = "font-weight: 700; color: #f0c850;";
  gold.textContent = "⛁ 0";
  root.appendChild(gold);

  const taxWrap = document.createElement("label");
  taxWrap.style.cssText = "display: flex; gap: 6px; align-items: center;";
  const taxLabel = document.createElement("span");
  taxLabel.style.cssText = "opacity: 0.9;";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(deps.maxTaxPct);
  slider.step = "1";
  slider.value = String(deps.initialTaxPct);
  slider.style.cssText = "width: 84px; accent-color: #4fb55f; margin: 0;";
  function setTaxLabel(v: number): void {
    taxLabel.textContent = `Tax ${v}%`;
  }
  setTaxLabel(deps.initialTaxPct);
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    setTaxLabel(v);
    deps.onTax(v);
  });
  taxWrap.appendChild(taxLabel);
  taxWrap.appendChild(slider);
  root.appendChild(taxWrap);

  parent.appendChild(root);

  function update(goldAmount: number, taxPct: number): void {
    gold.textContent = `⛁ ${goldAmount}`;
    // Re-sync the slider only when the engine value diverges from the control
    // (e.g. a new game), never mid-drag — the input event already pushed those.
    if (Number(slider.value) !== taxPct) {
      slider.value = String(taxPct);
      setTaxLabel(taxPct);
    }
  }

  function destroy(): void {
    root.remove();
  }

  return { update, destroy };
}
