// Mobile-friendly overrides for the DOM HUD panels. Each panel sets its base
// look via inline `style.cssText` (desktop), and tags its root with a `ks-*`
// class. On narrow screens this injected stylesheet repositions + shrinks them
// so they stop overlapping (inline styles win specificity, hence !important).
//
// Desktop layout packs three panels along the bottom edge (faction left,
// HUD centre, dispatch right) which collides on a phone. Mobile layout:
//   HUD        → top-centre (shrunk)
//   tile-info  → top-left, under the HUD
//   faction    → bottom-left, compact (off the board; top-right covered it)
//   dispatch   → bottom-right (in thumb reach, clear of the faction panel)
// This keeps the top-right corner clear so the whole board stays visible.

const STYLE_ID = "ks-responsive";

const CSS = `
@media (max-width: 640px) {
  .ks-hud {
    top: 6px !important;
    /* HUD's desktop inline style now anchors to bottom; keep it top-pinned on
       mobile so it doesn't stretch between both edges. */
    bottom: auto !important;
    padding: 4px 8px !important;
    gap: 6px !important;
    font-size: 11px !important;
    max-width: 96vw !important;
  }
  .ks-hud .ks-bar { width: 48px !important; }
  .ks-hud button { padding: 2px 6px !important; }

  .ks-tile-info {
    top: 44px !important;
    bottom: auto !important;
    left: 8px !important;
    right: auto !important;
    transform: none !important;
    padding: 5px 7px !important;
    font-size: 10px !important;
    min-width: 0 !important;
    max-width: 46vw !important;
  }

  .ks-faction {
    top: auto !important;
    bottom: 10px !important;
    left: 8px !important;
    right: auto !important;
    padding: 4px 6px !important;
    font-size: 9px !important;
    max-width: 46vw !important;
    line-height: 1.3 !important;
  }

  .ks-mapsize {
    top: 44px !important;
    right: 8px !important;
    padding: 3px 5px !important;
    gap: 3px !important;
    font-size: 10px !important;
  }
  .ks-mapsize button { padding: 2px 5px !important; }

  .ks-dispatch {
    bottom: 10px !important;
    left: auto !important;
    right: 8px !important;
    transform: none !important;
    padding: 5px !important;
    gap: 4px !important;
    font-size: 11px !important;
  }
  .ks-dispatch button { padding: 6px 9px !important; }

  .ks-end { font-size: 13px !important; }
}
`;

// Idempotent — every panel calls this on creation; only the first injects.
export function installResponsiveStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
