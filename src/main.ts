import { step } from "@/engine/tick";
import type { GameState, TileId } from "@/engine/types";
import { buildInitialState } from "@/playtest/runner";
import { createRenderApp } from "@/render/app";
import { createBoardRenderer } from "@/render/board";
import { defaultScenario } from "@/scenarios/default";

const TICK_INTERVAL_MS = 2000;
const MOUNT_ID = "app";

async function bootstrap(): Promise<void> {
  const container = document.getElementById(MOUNT_ID);
  if (container === null) {
    throw new Error(`missing #${MOUNT_ID} mount container`);
  }

  const render = await createRenderApp(container);
  let state: GameState = buildInitialState(defaultScenario);

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
  board.resize(render.app.screen.width, render.app.screen.height);

  const onResize = (): void => {
    board.resize(render.app.screen.width, render.app.screen.height);
  };
  window.addEventListener("resize", onResize);

  const tickHandle = window.setInterval(() => {
    state = step(state);
    board.update(state);
  }, TICK_INTERVAL_MS);

  window.addEventListener(
    "beforeunload",
    () => {
      window.clearInterval(tickHandle);
      window.removeEventListener("resize", onResize);
      board.destroy();
      render.destroy();
    },
    { once: true },
  );
}

bootstrap().catch((err: unknown) => {
  console.error(err);
});
