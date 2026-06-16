import { step } from "@/engine/tick";
import type { FactionId, GameState, TileId } from "@/engine/types";
import {
  createDispatchController,
  createRatioPanel,
} from "@/input/dispatch";
import { createKeyboardController } from "@/input/keyboard";
import { createPointerController } from "@/input/pointer";
import { buildInitialState } from "@/playtest/runner";
import { createRenderApp } from "@/render/app";
import { createBoardRenderer } from "@/render/board";
import { createMarchingRenderer } from "@/render/marching";
import { createPathRenderer } from "@/render/paths";
import { createTierTextures } from "@/render/sprites";
import { createUnitsRenderer } from "@/render/units";
import { idleTargetScenario } from "@/scenarios/idle-target";
import { evaluateOutcome } from "@/engine/victory";
import { createFactionPanel } from "@/ui/faction-panel";
import { createHud } from "@/ui/hud";
import { createTileInfoPanel } from "@/ui/tile-info";
import { createEndScreen } from "@/ui/end-screen";

const TICK_INTERVAL_MS = 2000;
const MOUNT_ID = "app";
const PLAYER_FACTION: FactionId = "TOKUGAWA";

type Speed = 1 | 2;

async function bootstrap(): Promise<void> {
  const container = document.getElementById(MOUNT_ID);
  if (container === null) {
    throw new Error(`missing #${MOUNT_ID} mount container`);
  }

  const render = await createRenderApp(container);
  const tierTextures = createTierTextures(render.app);
  const initialState = buildInitialState(idleTargetScenario);
  let state: GameState = initialState;
  let ended = false;

  let paused = false;
  let speed: Speed = 1;

  function intervalForSpeed(s: Speed): number {
    return TICK_INTERVAL_MS / s;
  }

  const board = createBoardRenderer(state, {
    onPointerOver: (id: TileId) => {
      pointer.onTileOver(id);
    },
    onPointerOut: (id: TileId) => {
      pointer.onTileOut(id);
    },
  });
  render.app.stage.addChild(board.container);

  const units = createUnitsRenderer(state, tierTextures);
  board.container.addChild(units.container);

  const marching = createMarchingRenderer(tierTextures);
  board.container.addChild(marching.container);

  const paths = createPathRenderer();
  board.container.addChild(paths.container);

  const hud = createHud(document.body, {
    onTogglePause: () => setPaused(!paused),
    onSpeed: (s) => setSpeed(s),
  });
  const factionPanel = createFactionPanel(document.body, PLAYER_FACTION);
  const tileInfo = createTileInfoPanel(document.body);

  function pushHudStatus(): void {
    hud.setStatus({
      tick: state.tick,
      paused,
      speed,
      intervalMs: intervalForSpeed(speed),
    });
  }

  function renderAll(): void {
    board.update(state);
    units.update(state);
    marching.update(state, intervalForSpeed(speed));
    factionPanel.update(state);
    pushHudStatus();
  }

  const dispatchCtrl = createDispatchController({
    getState: () => state,
    playerFaction: PLAYER_FACTION,
    onShowValidPath: (path, faction) => paths.setValidPath(path, faction),
    onShowInvalidPath: (from, to) => paths.setInvalidPath(from, to),
    onClearPath: () => paths.clear(),
    onCommit: (_cmd, result) => {
      if (!result.ok) return;
      state = result.state;
      board.setSelection(null);
      renderAll();
    },
  });

  const pointer = createPointerController(render.app.canvas, {
    onTileHover: (id) => {
      board.setHover(id);
      tileInfo.setHover(state, id);
    },
    onTileClick: (id, button) => {
      if (button !== "left") return;
      board.setSelection(id);
    },
    onDragStart: (id, button) => dispatchCtrl.handleDragStart(id, button),
    onDragMove: (id, button) => dispatchCtrl.handleDragMove(id, button),
    onDragEnd: (id, button) => dispatchCtrl.handleDragEnd(id, button),
    onDragCancel: (button) => dispatchCtrl.handleDragCancel(button),
  });

  const ratioPanel = createRatioPanel(
    document.body,
    dispatchCtrl.getRatio(),
    (r) => {
      dispatchCtrl.setRatio(r);
      ratioPanel.setRatio(r);
    },
  );

  const endScreen = createEndScreen(document.body, () => {
    state = initialState;
    ended = false;
    endScreen.hide();
    renderAll();
    if (!paused) startTicker();
  });

  board.resize(render.app.screen.width, render.app.screen.height);

  const onResize = (): void => {
    board.resize(render.app.screen.width, render.app.screen.height);
  };
  window.addEventListener("resize", onResize);

  let tickHandle: number | null = null;

  function stopTicker(): void {
    if (tickHandle !== null) {
      window.clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function startTicker(): void {
    stopTicker();
    if (ended) return;
    tickHandle = window.setInterval(tickOnce, intervalForSpeed(speed));
  }

  function tickOnce(): void {
    state = step(state);
    hud.markTick();
    renderAll();
    const outcome = evaluateOutcome(state);
    if (outcome.status === "ended") {
      ended = true;
      stopTicker();
      let playerTiles = 0;
      for (const p of state.provinces.values()) {
        if (p.owner === PLAYER_FACTION) playerTiles += 1;
      }
      const playerWon = outcome.winner === PLAYER_FACTION;
      endScreen.show({
        playerWon,
        playerTiles,
        ticks: state.tick,
      });
    }
  }

  function setPaused(v: boolean): void {
    if (v === paused) return;
    paused = v;
    if (paused) stopTicker();
    else startTicker();
    pushHudStatus();
  }

  function setSpeed(s: Speed): void {
    if (s === speed) return;
    speed = s;
    if (!paused) startTicker();
    pushHudStatus();
  }

  renderAll();
  startTicker();

  const keyboard = createKeyboardController({
    isPaused: () => paused,
    setPaused,
    getSpeed: () => speed,
    setSpeed,
    cancelDrag: () => pointer.cancelActiveDrag(),
    panBy: (dx, dy) => board.panBy(dx, dy),
    resetCamera: () => board.resetCamera(),
  });

  window.addEventListener(
    "beforeunload",
    () => {
      stopTicker();
      window.removeEventListener("resize", onResize);
      keyboard.destroy();
      pointer.destroy();
      ratioPanel.destroy();
      tileInfo.destroy();
      factionPanel.destroy();
      hud.destroy();
      endScreen.destroy();
      paths.destroy();
      marching.destroy();
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
