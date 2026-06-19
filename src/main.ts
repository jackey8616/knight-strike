import { advanceClock } from "@/engine/v2/clock";
import { startConstruction } from "@/engine/v2/construction";
import { buildHouse } from "@/engine/v2/house";
import { issueMarch } from "@/engine/v2/movement";
import { makeFaction, parseTileId, tileId, vonNeumannNeighbors } from "@/engine/v2/state";
import { step } from "@/engine/v2/tick";
import type { FactionId, GameState, Speed, Unit } from "@/engine/v2/types";
import { evaluateOutcome } from "@/engine/v2/victory";
import { createRenderApp } from "@/render/app";
import { createV2BoardRenderer } from "@/render/v2/board-v2";
import { createControls } from "@/ui/v2/controls";
import { createV2Hud } from "@/ui/v2/hud-v2";
import { buildScenarioState } from "@/playtest/v2/runner";
import { PLAYER_GAME } from "@/playtest/v2/scenarios";

const MOUNT_ID = "app";
const PLAYER: FactionId = "TOKUGAWA";
const SPEEDS: readonly Speed[] = ["slow", "medium", "fast"];

// M13 — the v2 game. You are TOKUGAWA against three AIs; build houses / bridges
// / fences, set tax, move units. Player build-mode + tax + move land here; full
// art polish, level-result screen, and the v1 deletion-vs-easter-egg are tracked
// follow-ups. (?v1 boots the original prototype.)
async function main(): Promise<void> {
  if (new URLSearchParams(window.location.search).has("v1")) {
    await import("./main-v1"); // easter egg: the original prototype, kept & hidden
    return;
  }

  const mount = document.getElementById(MOUNT_ID);
  if (mount === null) throw new Error(`missing #${MOUNT_ID}`);
  mount.style.position = "relative";

  const render = await createRenderApp(mount);
  const board = createV2BoardRenderer(render.app);
  const hud = createV2Hud(mount);

  let state: GameState = buildScenarioState(PLAYER_GAME);
  let speed: Speed = "medium";
  let paused = true;
  let acc = 0;
  let ended = false;
  let selected: string | null = null;

  const draw = (): void => {
    board.render(state);
    hud.update(state, { paused, speed });
  };
  const fit = (): void => board.recenter(render.app.screen.width, render.app.screen.height, state.boardSize);

  const applyTax = (rate: number): void => {
    state = {
      ...state,
      factions: { ...state.factions, [PLAYER]: makeFaction(PLAYER, { ...state.factions[PLAYER], taxRate: rate }) },
    };
  };

  const ownUnitOn = (t: string): Unit | undefined =>
    state.units.find((u) => u.owner === PLAYER && u.tile === t);
  const ownUnitNear = (t: string): Unit | undefined => {
    const { x, y } = parseTileId(t);
    const reach = new Set([t, ...vonNeumannNeighbors(x, y, state.boardSize)]);
    return state.units.find((u) => u.owner === PLAYER && reach.has(u.tile));
  };

  const controls = createControls(mount, {
    onPauseToggle: () => {
      paused = !paused;
      draw();
    },
    onCycleSpeed: () => {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] as Speed;
      draw();
    },
    onTax: (rate) => {
      applyTax(rate);
      draw();
    },
    onBuildMode: () => {
      selected = null;
    },
  });

  const handleClick = (tx: number, ty: number): void => {
    const t = tileId(tx, ty);
    const mode = controls.getBuildMode();
    if (mode === "HOUSE") {
      const r = buildHouse(state, { faction: PLAYER, tile: t });
      if (r.ok) state = r.state;
      controls.setStatus(r.ok ? "house built" : `can't build: ${r.reason}`);
    } else if (mode === "BRIDGE" || mode === "FENCE") {
      const u = ownUnitNear(t);
      if (u === undefined) controls.setStatus("need a unit next to that tile");
      else {
        const r = startConstruction(state, { faction: PLAYER, unitId: u.id, kind: mode, tile: t });
        if (r.ok) state = r.state;
        controls.setStatus(r.ok ? `${mode.toLowerCase()} started` : `can't build: ${r.reason}`);
      }
    } else {
      const u = ownUnitOn(t);
      if (u !== undefined) {
        selected = u.id;
        controls.setStatus(`selected ${u.population} — click a tile to move`);
      } else if (selected !== null) {
        state = issueMarch(state, selected, t);
        selected = null;
        controls.setStatus("marching");
      }
    }
    draw();
  };

  render.app.stage.eventMode = "static";
  render.app.stage.hitArea = render.app.screen;
  render.app.stage.on("pointertap", (e) => {
    if (ended) return;
    const tile = board.screenToTile(e.global.x, e.global.y);
    if (tile !== null) handleClick(tile.x, tile.y);
  });

  fit();
  window.addEventListener("resize", fit);

  const menu = overlay("ks-menu", "Knight Strike — v2", "Start", () => {
    paused = false;
    menu.remove();
  });
  mount.appendChild(menu);
  draw();

  render.app.ticker.add((ticker) => {
    if (paused || ended) return;
    const out = advanceClock(acc, ticker.deltaMS, speed);
    acc = out.acc;
    for (let i = 0; i < Math.min(out.ticks, 8); i += 1) state = step(state).state;
    if (out.ticks > 0) {
      draw();
      const outcome = evaluateOutcome(state);
      if (outcome.kind !== "ongoing") {
        ended = true;
        const winner = outcome.kind === "win" ? outcome.winner : outcome.kind;
        mount.appendChild(overlay("ks-end", `Result: ${winner}`, "Restart", () => location.reload()));
      }
    }
  });

  if (import.meta.env.DEV) {
    (window as unknown as { __ks: unknown }).__ks = {
      getState: () => state,
      getTickInfo: () => ({ tick: state.tick, day: state.day, paused, speed }),
      setPaused: (v: boolean) => {
        paused = v;
      },
      setSpeed: (s: Speed) => {
        speed = s;
      },
      buildHouse: (x: number, y: number): boolean => {
        const r = buildHouse(state, { faction: PLAYER, tile: tileId(x, y) });
        if (r.ok) {
          state = r.state;
          draw();
        }
        return r.ok;
      },
      setTax: (rate: number) => {
        applyTax(rate);
        draw();
      },
      move: (unitId: string, x: number, y: number) => {
        state = issueMarch(state, unitId, tileId(x, y));
        draw();
      },
    };
  }
}

function overlay(className: string, title: string, button: string, onClick: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
    "gap:16px;background:rgba(12,12,12,.82);color:#eee;font:600 18px/1.4 monospace;z-index:10";
  const h = document.createElement("div");
  h.textContent = title;
  const b = document.createElement("button");
  b.textContent = button;
  b.style.cssText = "padding:10px 24px;font:600 16px monospace;cursor:pointer;border-radius:6px;border:0";
  b.addEventListener("click", onClick);
  el.append(h, b);
  return el;
}

void main();
