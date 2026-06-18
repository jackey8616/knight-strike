import {
  AI_DIFFICULTIES,
  MAP_SIZES,
  type Difficulty,
  type MapSize,
} from "@/scenarios/sized";
import type { FactionId } from "@/engine/types";
import { FACTION_COLORS, TILE_HEIGHT, TILE_WIDTH } from "@/render/board";
import { unitBitmapRows, unitCellOf } from "@/render/unit-bitmap";
import { installResponsiveStyles } from "./responsive";

// PRD §6.2.1: the start-of-game settings chosen before the board appears.
export type StartConfig = {
  readonly size: MapSize;
  readonly difficulty: Difficulty;
};

export type StartMenu = {
  show(): void;
  hide(): void;
  destroy(): void;
};

const OVERLAY_STYLE = [
  "position: fixed",
  "inset: 0",
  "background: rgba(0, 0, 0, 0.82)",
  "display: none",
  "flex-direction: column",
  "align-items: center",
  "justify-content: center",
  "gap: 18px",
  "padding: 24px",
  "overflow-y: auto",
  "z-index: 120",
  "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
  "color: #eee",
].join(";");

const TITLE_STYLE = "font-size: 40px; font-weight: 700; color: #f4f1d6;";

const PANEL_STYLE = [
  "background: rgba(0, 0, 0, 0.5)",
  "border: 1px solid #444",
  "border-radius: 8px",
  "padding: 12px 16px",
  "max-width: 460px",
  "width: 100%",
  "box-sizing: border-box",
].join(";");

// Lighter than the demo box — the bottom how-to is supporting detail now that
// the core gesture lives up in the demo box.
const HOWTO_STYLE = [
  PANEL_STYLE,
  "font-size: 12px",
  "line-height: 1.6",
  "opacity: 0.5",
].join(";");

// The bordered "edge box" wrapping the two animations + their gesture line.
const DEMO_BOX_STYLE = [
  PANEL_STYLE,
  "display: flex",
  "flex-direction: column",
  "align-items: center",
  "gap: 10px",
].join(";");

const DEMO_HINT_STYLE =
  "font-size: 12px; line-height: 1.5; text-align: center; opacity: 0.85;";

const SECTION_LABEL_STYLE = [
  "font-size: 11px",
  "letter-spacing: 0.08em",
  "text-transform: uppercase",
  "opacity: 0.7",
  "margin-bottom: 6px",
].join(";");

const ROW_STYLE = "display: flex; gap: 6px; flex-wrap: wrap;";

const BTN_BASE = [
  "flex: 1 1 0",
  "min-width: 56px",
  "padding: 6px 10px",
  "background: #222",
  "color: #ddd",
  "border: 1px solid #555",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
  "font-size: 13px",
].join(";");

const BTN_ACTIVE = [
  "flex: 1 1 0",
  "min-width: 56px",
  "padding: 6px 10px",
  "background: #c94545",
  "color: #fff",
  "border: 1px solid #c94545",
  "border-radius: 4px",
  "cursor: pointer",
  "font: inherit",
  "font-size: 13px",
].join(";");

const START_BTN_STYLE = [
  "padding: 10px 36px",
  "background: #4a8f4a",
  "color: #fff",
  "border: 1px solid #4a8f4a",
  "border-radius: 6px",
  "cursor: pointer",
  "font: inherit",
  "font-size: 18px",
  "font-weight: 700",
].join(";");

// PRD §7 objective + §6.3 controls, condensed for the splash.
// Shown inside the demo box, pairing the Move / Attack animations with the
// gesture they demonstrate.
const DEMO_HINT =
  "Drag a unit from your tile onto another — your own land to move, an enemy tile to attack.";

const HOW_TO_PLAY: readonly string[] = [
  "Goal: capture every enemy castle to win; you lose if your own castle falls.",
  "Click a tile to inspect it; right-click a marching unit to cancel it (troops merge into the current tile).",
  "Space pause · 1–4 speed · right-drag / WASD pan · wheel zoom · R reset camera.",
];

const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

// Two looping 3×1 demos in the board's own 45° iso projection and pixel-art
// units (reusing TILE_WIDTH/HEIGHT + FACTION_COLORS from render/board and the
// shared unit bitmap). "Move": a friendly knight lifts off its tile, drags down
// the dashed path and garrisons the far tile. "Attack": it advances onto the
// adjacent tile and lunges twice at the enemy-held tile, which flashes on each
// hit (cross-edge combat). Both fade out before snapping back so the reset is
// never seen.
//
// Under prefers-reduced-motion the units don't slide: each cross-fades out at
// its source tile and fades back in at the destination (opacity only — no large
// translational motion that could trigger vestibular discomfort), so the demo
// still conveys the gesture. This matters on mobile, where iOS Low Power Mode
// and Android battery saver both report prefers-reduced-motion: reduce; the old
// `animation: none` fallback left a frozen knight that read as broken.
const DEMO_PLAYER: FactionId = "TOKUGAWA";
const DEMO_ENEMY: FactionId = "TAKEDA";

const HW = TILE_WIDTH / 2;
const HH = TILE_HEIGHT / 2;
// Headroom above the tiles so a standing sprite isn't clipped.
const HEAD = 18;
const STRIP_W = TILE_WIDTH * 2;
const STRIP_H = HEAD + TILE_HEIGHT * 2;

const SPR = 2; // texel scale for the SVG unit
const KNIGHT_ROWS = unitBitmapRows("KNIGHT");
const SPRITE_COLS = (KNIGHT_ROWS[0] ?? "").length;
const SPRITE_ROWS = KNIGHT_ROWS.length;
const SPRITE_W = SPRITE_COLS * SPR;
const SPRITE_H = SPRITE_ROWS * SPR;

// Tile centres along the iso axis (down-right). The sprite stands with its feet
// ~6px below the tile centre, so its top sits SPRITE_H above that.
const STAND = 6;
const PLAYER_LEFT = HW - SPRITE_W / 2;
const PLAYER_TOP = HEAD + HH + STAND - SPRITE_H;
const ENEMY_LEFT = HW * 3 - SPRITE_W / 2;
const ENEMY_TOP = HEAD + HH * 3 + STAND - SPRITE_H;
const MOVE_DX = HW * 2;
const MOVE_DY = HH * 2;
const ADJ_DX = HW;
const ADJ_DY = HH;
const LIFT = 3;
const LUNGE = 6;

const DEMO_STYLE_ID = "ks-menu-demo-styles";

const DEMO_CSS = `
.ks-demo-area { display: flex; gap: 22px; flex-wrap: wrap; justify-content: center; }
.ks-demo-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ks-demo-caption { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
.ks-demo-strip { position: relative; width: ${STRIP_W}px; height: ${STRIP_H}px; }
.ks-demo-scene { position: absolute; inset: 0; }
.ks-demo-unit { position: absolute; width: ${SPRITE_W}px; height: ${SPRITE_H}px; }
.ks-demo-unit > svg { display: block; image-rendering: pixelated; }
.ks-demo-unit-move { left: ${PLAYER_LEFT}px; top: ${PLAYER_TOP}px; animation: ks-demo-move 3.4s ease-in-out infinite; }
.ks-demo-unit-atk  { left: ${PLAYER_LEFT}px; top: ${PLAYER_TOP}px; animation: ks-demo-atk 3.4s ease-in-out infinite; }
.ks-demo-enemy { left: ${ENEMY_LEFT}px; top: ${ENEMY_TOP}px; animation: ks-demo-enemy 3.4s ease-in-out infinite; }
.ks-demo-cursor { position: absolute; left: 15px; top: 10px; width: 14px; height: 16px; }
.ks-demo-cursor > svg { display: block; }
.ks-demo-tap {
  /* Centred on the cursor's arrow tip (~16,11) so the click ripples from the
     pointer, not the unit centre. */
  position: absolute; left: 9px; top: 4px; width: 14px; height: 14px;
  box-sizing: border-box; border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%; opacity: 0;
  animation: ks-demo-tap 3.4s ease-out infinite;
}
@keyframes ks-demo-move {
  0%   { transform: translate(0, 0);                              opacity: 0; }
  7%   { transform: translate(0, 0);                              opacity: 1; }
  16%  { transform: translate(0, ${-LIFT}px);                     opacity: 1; }
  52%  { transform: translate(${MOVE_DX}px, ${MOVE_DY - LIFT}px); opacity: 1; }
  60%  { transform: translate(${MOVE_DX}px, ${MOVE_DY}px);        opacity: 1; }
  86%  { transform: translate(${MOVE_DX}px, ${MOVE_DY}px);        opacity: 1; }
  93%  { transform: translate(${MOVE_DX}px, ${MOVE_DY}px);        opacity: 0; }
  100% { transform: translate(0, 0);                              opacity: 0; }
}
@keyframes ks-demo-atk {
  0%   { transform: translate(0, 0);                                   opacity: 0; }
  7%   { transform: translate(0, 0);                                   opacity: 1; }
  16%  { transform: translate(0, ${-LIFT}px);                          opacity: 1; }
  40%  { transform: translate(${ADJ_DX}px, ${ADJ_DY - LIFT}px);        opacity: 1; }
  47%  { transform: translate(${ADJ_DX + LUNGE}px, ${ADJ_DY}px);       opacity: 1; }
  53%  { transform: translate(${ADJ_DX}px, ${ADJ_DY - LIFT}px);        opacity: 1; }
  60%  { transform: translate(${ADJ_DX + LUNGE}px, ${ADJ_DY}px);       opacity: 1; }
  66%  { transform: translate(${ADJ_DX}px, ${ADJ_DY}px);               opacity: 1; }
  86%  { transform: translate(${ADJ_DX}px, ${ADJ_DY}px);               opacity: 1; }
  93%  { transform: translate(${ADJ_DX}px, ${ADJ_DY}px);               opacity: 0; }
  100% { transform: translate(0, 0);                                   opacity: 0; }
}
@keyframes ks-demo-enemy {
  0%, 44% { transform: translate(0, 0);    filter: none; }
  48%     { transform: translate(3px, 1px); filter: brightness(2.4); }
  53%     { transform: translate(0, 0);    filter: none; }
  60%     { transform: translate(3px, 1px); filter: brightness(2.4); }
  65%     { transform: translate(0, 0);    filter: none; }
  100%    { transform: translate(0, 0);    filter: none; }
}
@keyframes ks-demo-tap {
  0%, 10% { transform: scale(0.4);  opacity: 0; }
  15%     { transform: scale(0.55); opacity: 0.85; }
  41%     { transform: scale(1.5);  opacity: 0; }
  100%    { transform: scale(1.5);  opacity: 0; }
}
/* Reduced-motion variants: teleport via opacity instead of sliding. The
   transform jump always happens while opacity is 0, so no motion is ever seen —
   only a cross-fade between the source and destination tiles. */
@keyframes ks-demo-move-rm {
  0%   { transform: translate(0, 0);                       opacity: 0; }
  8%   { transform: translate(0, 0);                       opacity: 1; }
  42%  { transform: translate(0, 0);                       opacity: 1; }
  48%  { transform: translate(0, 0);                       opacity: 0; }
  49%  { transform: translate(${MOVE_DX}px, ${MOVE_DY}px); opacity: 0; }
  55%  { transform: translate(${MOVE_DX}px, ${MOVE_DY}px); opacity: 1; }
  90%  { transform: translate(${MOVE_DX}px, ${MOVE_DY}px); opacity: 1; }
  96%  { transform: translate(${MOVE_DX}px, ${MOVE_DY}px); opacity: 0; }
  97%  { transform: translate(0, 0);                       opacity: 0; }
  100% { transform: translate(0, 0);                       opacity: 0; }
}
@keyframes ks-demo-atk-rm {
  0%   { transform: translate(0, 0);                     opacity: 0; }
  8%   { transform: translate(0, 0);                     opacity: 1; }
  38%  { transform: translate(0, 0);                     opacity: 1; }
  44%  { transform: translate(0, 0);                     opacity: 0; }
  45%  { transform: translate(${ADJ_DX}px, ${ADJ_DY}px); opacity: 0; }
  51%  { transform: translate(${ADJ_DX}px, ${ADJ_DY}px); opacity: 1; }
  90%  { transform: translate(${ADJ_DX}px, ${ADJ_DY}px); opacity: 1; }
  96%  { transform: translate(${ADJ_DX}px, ${ADJ_DY}px); opacity: 0; }
  97%  { transform: translate(0, 0);                     opacity: 0; }
  100% { transform: translate(0, 0);                     opacity: 0; }
}
@keyframes ks-demo-enemy-rm {
  0%, 52% { filter: none; }
  58%     { filter: brightness(2.4); }
  64%     { filter: none; }
  70%     { filter: brightness(2.4); }
  76%     { filter: none; }
  100%    { filter: none; }
}
@keyframes ks-demo-tap-rm {
  0%, 6% { opacity: 0; }
  10%    { opacity: 0.85; }
  30%    { opacity: 0; }
  100%   { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ks-demo-unit-move { animation: ks-demo-move-rm 3.4s ease-in-out infinite; }
  .ks-demo-unit-atk  { animation: ks-demo-atk-rm 3.4s ease-in-out infinite; }
  .ks-demo-enemy     { animation: ks-demo-enemy-rm 3.4s ease-in-out infinite; }
  .ks-demo-tap       { animation: ks-demo-tap-rm 3.4s ease-out infinite; }
}
`;

function injectDemoStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(DEMO_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = DEMO_STYLE_ID;
  style.textContent = DEMO_CSS;
  document.head.appendChild(style);
}

function toHex(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}

// Darker faction tone — mirrors the Pixi shade tint (texel 0x8c8c8c × faction).
function shadeHex(n: number): string {
  const k = 0x8c / 0xff;
  const r = Math.round(((n >> 16) & 0xff) * k);
  const g = Math.round(((n >> 8) & 0xff) * k);
  const b = Math.round((n & 0xff) * k);
  return toHex((r << 16) | (g << 8) | b);
}

// The shared unit bitmap as faction-tinted SVG rects (one rect per texel).
function knightSvgMarkup(faction: FactionId): string {
  const base = FACTION_COLORS[faction];
  const body = toHex(base);
  const shade = shadeHex(base);
  let rects = "";
  for (let y = 0; y < SPRITE_ROWS; y++) {
    const row = KNIGHT_ROWS[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const cell = unitCellOf(row[x] ?? ".");
      const fill =
        cell === "body"
          ? body
          : cell === "shade"
            ? shade
            : cell === "outline"
              ? "#1b1b24"
              : null;
      if (fill === null) continue;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
  }
  return `<svg width="${SPRITE_W}" height="${SPRITE_H}" viewBox="0 0 ${SPRITE_COLS} ${SPRITE_ROWS}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

type TileCentre = { readonly cx: number; readonly cy: number };

function diamond(t: TileCentre, fill: string, opacity?: number): string {
  const pts = `${t.cx},${t.cy - HH} ${t.cx + HW},${t.cy} ${t.cx},${t.cy + HH} ${t.cx - HW},${t.cy}`;
  return opacity === undefined
    ? `<polygon points="${pts}" fill="${fill}" stroke="#111111" stroke-width="1"/>`
    : `<polygon points="${pts}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

// Static iso scene: three plains diamonds, ownership tints, and the drag path.
function sceneSvg(kind: "move" | "attack"): string {
  const t0: TileCentre = { cx: HW, cy: HEAD + HH };
  const t1: TileCentre = { cx: HW * 2, cy: HEAD + HH * 2 };
  const t2: TileCentre = { cx: HW * 3, cy: HEAD + HH * 3 };
  // Mirrors board PLAINS terrain colour.
  const plains = "#3f6b3a";
  let s = `<svg width="${STRIP_W}" height="${STRIP_H}" viewBox="0 0 ${STRIP_W} ${STRIP_H}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">`;
  s += diamond(t0, plains) + diamond(t1, plains) + diamond(t2, plains);
  s += diamond(t0, toHex(FACTION_COLORS[DEMO_PLAYER]), 0.34);
  if (kind === "attack") s += diamond(t2, toHex(FACTION_COLORS[DEMO_ENEMY]), 0.34);
  s += `<line x1="${t0.cx}" y1="${t0.cy}" x2="${t2.cx}" y2="${t2.cy}" stroke="rgba(244, 241, 214, 0.5)" stroke-width="2" stroke-dasharray="3 3"/>`;
  s += `</svg>`;
  return s;
}

// A classic pointer cursor (white with a dark outline), tip at the top-left so
// it points into the unit it sits on.
const CURSOR_SVG = `<svg width="14" height="16" viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L1 15 L4.5 11.5 L7 17 L9.5 16 L7 10.7 L12.5 10.7 Z" fill="#ffffff" stroke="#1b1b24" stroke-width="1" stroke-linejoin="round"/></svg>`;

// withCursor overlays a pointer + a tap-ring pulse on the unit to read as
// "click and hold to drag" — only the player's unit, not the enemy.
function unitEl(
  faction: FactionId,
  motionClass: string,
  withCursor: boolean,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `ks-demo-unit ${motionClass}`;
  wrap.innerHTML = knightSvgMarkup(faction);
  if (withCursor) {
    const tap = document.createElement("div");
    tap.className = "ks-demo-tap";
    wrap.appendChild(tap);
    const cursor = document.createElement("div");
    cursor.className = "ks-demo-cursor";
    cursor.innerHTML = CURSOR_SVG;
    wrap.appendChild(cursor);
  }
  return wrap;
}

function buildStrip(kind: "move" | "attack"): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "ks-demo-strip";

  const scene = document.createElement("div");
  scene.className = "ks-demo-scene";
  scene.innerHTML = sceneSvg(kind);
  strip.appendChild(scene);

  if (kind === "attack") {
    strip.appendChild(unitEl(DEMO_ENEMY, "ks-demo-enemy", false));
  }
  strip.appendChild(
    unitEl(
      DEMO_PLAYER,
      kind === "move" ? "ks-demo-unit-move" : "ks-demo-unit-atk",
      true,
    ),
  );
  return strip;
}

function buildDemoColumn(caption: string, kind: "move" | "attack"): HTMLElement {
  const col = document.createElement("div");
  col.className = "ks-demo-col";
  const cap = document.createElement("div");
  cap.className = "ks-demo-caption";
  cap.textContent = caption;
  col.appendChild(cap);
  col.appendChild(buildStrip(kind));
  return col;
}

function buildDemo(): HTMLElement {
  const area = document.createElement("div");
  area.className = "ks-demo-area";
  area.appendChild(buildDemoColumn("Move", "move"));
  area.appendChild(buildDemoColumn("Attack", "attack"));
  return area;
}

// PRD §6.2.1: the splash shown on entry. The player picks AI difficulty + map
// size (seeded from the URL), reads the how-to-play, then Start launches a fresh
// game with that config (no page reload). Re-openable from the End Screen.
export function createStartMenu(
  parent: HTMLElement,
  opts: {
    readonly initialSize: MapSize;
    readonly initialDifficulty: Difficulty;
    readonly onStart: (config: StartConfig) => void;
  },
): StartMenu {
  installResponsiveStyles();

  let size: MapSize = opts.initialSize;
  let difficulty: Difficulty = opts.initialDifficulty;

  const root = document.createElement("div");
  root.style.cssText = OVERLAY_STYLE;
  root.classList.add("ks-menu");

  const title = document.createElement("div");
  title.textContent = "Knight Strike";
  title.style.cssText = TITLE_STYLE;
  root.appendChild(title);

  injectDemoStyles();
  const demoBox = document.createElement("div");
  demoBox.style.cssText = DEMO_BOX_STYLE;
  demoBox.appendChild(buildDemo());
  const demoHint = document.createElement("div");
  demoHint.style.cssText = DEMO_HINT_STYLE;
  demoHint.textContent = DEMO_HINT;
  demoBox.appendChild(demoHint);
  root.appendChild(demoBox);

  const howto = document.createElement("div");
  howto.style.cssText = HOWTO_STYLE;
  const howtoLabel = document.createElement("div");
  howtoLabel.textContent = "How to play";
  howtoLabel.style.cssText = SECTION_LABEL_STYLE;
  howto.appendChild(howtoLabel);
  for (const line of HOW_TO_PLAY) {
    const p = document.createElement("div");
    p.textContent = line;
    howto.appendChild(p);
  }
  root.appendChild(howto);

  // A segmented button group: clicking an option marks it active and stores its
  // value. restyle() repaints the group whenever the stored value changes.
  function segment<T>(
    labelText: string,
    options: readonly T[],
    labelOf: (v: T) => string,
    getValue: () => T,
    setValue: (v: T) => void,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = PANEL_STYLE;
    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.cssText = SECTION_LABEL_STYLE;
    wrap.appendChild(label);
    const row = document.createElement("div");
    row.style.cssText = ROW_STYLE;
    const buttons: Array<{ readonly value: T; readonly el: HTMLButtonElement }> =
      [];
    function restyle(): void {
      for (const b of buttons) {
        b.el.style.cssText = b.value === getValue() ? BTN_ACTIVE : BTN_BASE;
      }
    }
    for (const value of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = labelOf(value);
      btn.addEventListener("click", () => {
        setValue(value);
        restyle();
      });
      buttons.push({ value, el: btn });
      row.appendChild(btn);
    }
    wrap.appendChild(row);
    restyle();
    return wrap;
  }

  root.appendChild(
    segment<Difficulty>(
      "AI Difficulty",
      AI_DIFFICULTIES,
      (d) => DIFFICULTY_LABELS[d],
      () => difficulty,
      (d) => {
        difficulty = d;
      },
    ),
  );

  root.appendChild(
    segment<MapSize>(
      "Map Size",
      MAP_SIZES,
      (s) => String(s),
      () => size,
      (s) => {
        size = s;
      },
    ),
  );

  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Start";
  start.style.cssText = START_BTN_STYLE;
  start.addEventListener("click", () => {
    opts.onStart({ size, difficulty });
  });
  root.appendChild(start);

  parent.appendChild(root);

  function show(): void {
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
