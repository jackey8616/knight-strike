import { step } from "@/engine/tick";
import { buildInitialState } from "@/playtest/runner";
import { createRenderApp } from "@/render/app";
import { defaultScenario } from "@/scenarios/default";
import type { GameState } from "@/engine/types";

const TICK_INTERVAL_MS = 2000;
const MOUNT_ID = "app";

async function bootstrap(): Promise<void> {
  const container = document.getElementById(MOUNT_ID);
  if (container === null) {
    throw new Error(`missing #${MOUNT_ID} mount container`);
  }

  const render = await createRenderApp(container);
  let state: GameState = buildInitialState(defaultScenario);

  const tickHandle = window.setInterval(() => {
    state = step(state);
  }, TICK_INTERVAL_MS);

  window.addEventListener(
    "beforeunload",
    () => {
      window.clearInterval(tickHandle);
      render.destroy();
    },
    { once: true },
  );
}

bootstrap().catch((err: unknown) => {
  console.error(err);
});
