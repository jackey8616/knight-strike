import {
  cancelMarchingStack,
  dispatch as engineDispatch,
} from "@/engine/movement";
import { derivedOwner, tileId as makeTileId } from "@/engine/state";
import { step } from "@/engine/tick";
import type {
  DispatchRatio,
} from "@/engine/movement";
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
import { playNormalScenario } from "@/scenarios/play-normal";
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
  const initialState = buildInitialState(playNormalScenario);
  let state: GameState = initialState;
  let ended = false;

  let paused = false;
  let speed: Speed = 1;
  // True when the current pause was driven by an in-flight pointer interaction
  // (auto-pause-on-press, PRD §5.3 v1.1 amendment). Cleared whenever the user
  // manually toggles pause via Space / HUD / keyboard so a deliberate pause
  // isn't unpaused on pointer-up.
  let autoPausedByPress = false;

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

  const marching = createMarchingRenderer(tierTextures, {
    onCancel: (stackId) => {
      // Only the player faction can cancel its own marching stacks; AI / NEUTRAL
      // stacks are ignored at the engine layer too, but keep the UI honest.
      const target = state.marchingStacks.find((s) => s.id === stackId);
      if (target === undefined || target.faction !== PLAYER_FACTION) return;
      const result = cancelMarchingStack(state, stackId);
      if (result.ok) {
        state = result.state;
        renderAll();
      }
    },
  });
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
    onPressStart: () => {
      // PRD §5.3 v1.1 amendment: pause while the player is interacting. Skip
      // if the game has already ended (end screen up) or is paused manually.
      if (ended || paused) return;
      autoPausedByPress = true;
      paused = true;
      stopTicker();
      pushHudStatus();
    },
    onPressEnd: () => {
      if (!autoPausedByPress) return;
      autoPausedByPress = false;
      paused = false;
      startTicker();
      pushHudStatus();
    },
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
        if (derivedOwner(p) === PLAYER_FACTION) playerTiles += 1;
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
    // Manual toggle wins over the auto-pause latch: if the player explicitly
    // pauses or resumes mid-press, the auto-pause-on-release shouldn't
    // second-guess the next pointer-up.
    autoPausedByPress = false;
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

  // DEV-only hook so headless verification can drive the engine through its
  // public `dispatch` API without the synthetic-pointer-event-into-Pixi dance
  // (Pixi v8 batches federated events per render frame and synthetic DOM
  // PointerEvents don't reliably propagate tile.pointerover within a CDP
  // session). Stripped in production builds.
  if (import.meta.env.DEV) {
    const w = window as unknown as {
      __ks?: {
        getState: () => GameState;
        getTickInfo: () => { tick: number; paused: boolean; speed: Speed };
        playerDispatch: (
          fromX: number,
          fromY: number,
          toX: number,
          toY: number,
          ratio: DispatchRatio,
        ) => { ok: boolean; reason?: string };
        setPaused: (v: boolean) => void;
      };
    };
    w.__ks = {
      getState: () => state,
      getTickInfo: () => ({ tick: state.tick, paused, speed }),
      playerDispatch: (fromX, fromY, toX, toY, ratio) => {
        const res = engineDispatch(state, {
          from: makeTileId(fromX, fromY),
          to: makeTileId(toX, toY),
          ratio,
        });
        if (res.ok) {
          state = res.state;
          renderAll();
          return { ok: true };
        }
        return { ok: false, reason: res.reason };
      },
      setPaused,
    };
  }

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
