import { Assets, type Texture } from "pixi.js";

import { step } from "@/engine/tick";
import type { GameState, TileId } from "@/engine/types";
import { buildInitialState } from "@/playtest/runner";
import { createRenderApp } from "@/render/app";
import { createBoardRenderer } from "@/render/board";
import { createUnitsRenderer } from "@/render/units";
import { spectator4aiScenario } from "@/scenarios/spectator-4ai";
import { createMinimalHud } from "@/ui/minimal-hud";

const KNIGHT_TEXTURE_URL = "knight.png";

const TICK_INTERVAL_MS = 2000;
const MOUNT_ID = "app";

type Speed = 1 | 2;

async function bootstrap(): Promise<void> {
  const container = document.getElementById(MOUNT_ID);
  if (container === null) {
    throw new Error(`missing #${MOUNT_ID} mount container`);
  }

  const render = await createRenderApp(container);
  const knightTexture = (await Assets.load(KNIGHT_TEXTURE_URL)) as Texture;
  let state: GameState = buildInitialState(spectator4aiScenario);

  const board = createBoardRenderer(state, {
    onPointerOver: (id: TileId) => {
      board.setHover(id);
    },
    onPointerOut: () => {
      board.setHover(null);
    },
    onPointerDown: (id: TileId) => {
      board.setSelection(id);
    },
  });
  render.app.stage.addChild(board.container);

  const units = createUnitsRenderer(state, knightTexture);
  board.container.addChild(units.container);

  const hud = createMinimalHud(document.body);

  board.resize(render.app.screen.width, render.app.screen.height);

  const onResize = (): void => {
    board.resize(render.app.screen.width, render.app.screen.height);
  };
  window.addEventListener("resize", onResize);

  let paused = false;
  let speed: Speed = 1;
  let tickHandle: number | null = null;

  function intervalForSpeed(s: Speed): number {
    return TICK_INTERVAL_MS / s;
  }

  function tickOnce(): void {
    state = step(state);
    board.update(state);
    units.update(state);
    hud.update(state, { paused, speed });
  }

  function stopTicker(): void {
    if (tickHandle !== null) {
      window.clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function startTicker(): void {
    stopTicker();
    tickHandle = window.setInterval(tickOnce, intervalForSpeed(speed));
  }

  hud.update(state, { paused, speed });
  startTicker();

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    switch (e.key) {
      case " ":
      case "Spacebar": {
        e.preventDefault();
        paused = !paused;
        if (paused) stopTicker();
        else startTicker();
        hud.update(state, { paused, speed });
        break;
      }
      case "1": {
        speed = 1;
        if (!paused) startTicker();
        hud.update(state, { paused, speed });
        break;
      }
      case "2": {
        speed = 2;
        if (!paused) startTicker();
        hud.update(state, { paused, speed });
        break;
      }
      default:
        break;
    }
  };
  window.addEventListener("keydown", onKeyDown);

  window.addEventListener(
    "beforeunload",
    () => {
      stopTicker();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      hud.destroy();
      units.destroy();
      board.destroy();
      render.destroy();
    },
    { once: true },
  );
}

bootstrap().catch((err: unknown) => {
  console.error(err);
});
