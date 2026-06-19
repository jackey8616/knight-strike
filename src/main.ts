import { advanceClock } from "@/engine/v2/clock";
import { step } from "@/engine/v2/tick";
import type { GameState, Speed } from "@/engine/v2/types";
import { evaluateOutcome } from "@/engine/v2/victory";
import { createRenderApp } from "@/render/app";
import { createV2BoardRenderer } from "@/render/v2/board-v2";
import { createV2Hud } from "@/ui/v2/hud-v2";
import { buildScenarioState } from "@/playtest/v2/runner";
import { SPECTATOR_4AI } from "@/playtest/v2/scenarios";

const MOUNT_ID = "app";

// M13 slice 1: a minimal but live v2 renderer. Boots a 4-AI demo board (player
// build-mode input is a later slice), runs the engine tick loop over the Pixi
// app, and draws state each frame. Visual polish / full UI / smoke follow.
async function main(): Promise<void> {
  const mount = document.getElementById(MOUNT_ID);
  if (mount === null) throw new Error(`missing #${MOUNT_ID}`);
  mount.style.position = "relative";

  const render = await createRenderApp(mount);
  const board = createV2BoardRenderer(render.app);
  const hud = createV2Hud(mount);

  let state: GameState = buildScenarioState(SPECTATOR_4AI);
  let speed: Speed = "medium";
  let paused = true;
  let acc = 0;
  let ended = false;

  const fit = (): void => board.recenter(render.app.screen.width, render.app.screen.height, state.boardSize);
  fit();
  window.addEventListener("resize", fit);

  const menu = overlay("ks-menu", "Knight Strike — v2", "Start", () => {
    paused = false;
    menu.remove();
  });
  mount.appendChild(menu);

  const draw = (): void => hud.update(state, { paused, speed });
  board.render(state);
  draw();

  render.app.ticker.add((ticker) => {
    if (paused || ended) return;
    const out = advanceClock(acc, ticker.deltaMS, speed);
    acc = out.acc;
    for (let i = 0; i < Math.min(out.ticks, 8); i += 1) state = step(state).state;
    if (out.ticks > 0) {
      board.render(state);
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
