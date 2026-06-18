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
import { createCameraGestures } from "@/input/camera";
import { createKeyboardController } from "@/input/keyboard";
import { createPointerController } from "@/input/pointer";
import { buildInitialState } from "@/playtest/runner";
import { createRenderApp } from "@/render/app";
import { createBoardRenderer } from "@/render/board";
import { createMarchingRenderer } from "@/render/marching";
import { createPathRenderer } from "@/render/paths";
import { createTierTextures } from "@/render/sprites";
import { createUnitsRenderer } from "@/render/units";
import {
  makeScenario,
  readDifficulty,
  readMapSize,
} from "@/scenarios/sized";
import { evaluateOutcome } from "@/engine/victory";
import { createFactionPanel } from "@/ui/faction-panel";
import { createHud } from "@/ui/hud";
import { createTileInfoPanel } from "@/ui/tile-info";
import { createEndScreen } from "@/ui/end-screen";
import { createStartMenu, type StartConfig } from "@/ui/start-menu";

const TICK_INTERVAL_MS = 2000;
const MOUNT_ID = "app";
const PLAYER_FACTION: FactionId = "TOKUGAWA";

type Speed = 1 | 2 | 3 | 4;

type RenderApp = Awaited<ReturnType<typeof createRenderApp>>;
type TierTextures = ReturnType<typeof createTierTextures>;

type GameHooks = {
  // Replay with the same config (End Screen "Restart", PRD §6.2.2).
  readonly onRestart: () => void;
  // Tear down and return to the Start Menu (End Screen "Main Menu", §6.2.2).
  readonly onMainMenu: () => void;
};

// Build one full playthrough — engine state, renderers, input, UI, ticker —
// over the persistent Pixi app, for the chosen size + difficulty. Returns a
// teardown so the shell can dispose it on Start / Restart / Main Menu without a
// page reload (PRD §6.2.1).
function createGame(
  render: RenderApp,
  tierTextures: TierTextures,
  config: StartConfig,
  hooks: GameHooks,
): () => void {
  const initialState = buildInitialState(
    makeScenario(config.size, config.difficulty),
  );
  let state: GameState = initialState;
  let ended = false;

  let speed: Speed = 1;
  // The clock runs only when nothing is holding it: not ended, not manually
  // paused, not mid-pointer-press (auto-pause, PRD §5.3), and no unit selected
  // (selection freezes the clock until you unselect / dispatch).
  let manualPaused = false;
  let pressFreeze = false;
  let selectionFreeze = false;
  // The player-owned tile currently selected for dispatch, with the max troops
  // it can send (castle keeps 1), plus the exact count chosen on the slider.
  let selectedUnit: { readonly id: TileId; readonly max: number } | null = null;
  let manualCount: number | null = null;
  // Currently hovered tile (issue #6): renderAll() re-reads it each tick so the
  // tile-info panel tracks live count changes, not just the value at hover time.
  let hoverId: TileId | null = null;
  // Clicked/tapped tile (issue #10): any tile is selectable to inspect it in the
  // tile-info box; the panel falls back to this when not hovering (e.g. touch).
  let selectedTileId: TileId | null = null;

  function isRunning(): boolean {
    return !ended && !manualPaused && !pressFreeze && !selectionFreeze;
  }

  function intervalForSpeed(s: Speed): number {
    return TICK_INTERVAL_MS / s;
  }

  const board = createBoardRenderer(render.app, state, {
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
    onTogglePause: () => {
      // Issue #11: a selected unit freezes the game and the pause button shows
      // "Resume"; clicking it then deselects to resume (manual pause toggles
      // normally otherwise).
      if (selectionFreeze) {
        deselect();
        if (manualPaused) setPaused(false);
      } else {
        setPaused(!manualPaused);
      }
    },
    onSpeed: (s) => setSpeed(s),
  });
  const factionPanel = createFactionPanel(document.body, PLAYER_FACTION);
  const tileInfo = createTileInfoPanel(document.body);

  function pushHudStatus(): void {
    hud.setStatus({
      tick: state.tick,
      // Issue #11: surface the selection freeze too, so selecting a unit shows
      // the game as paused (button + countdown), not just manual pause.
      paused: manualPaused || selectionFreeze,
      speed,
      intervalMs: intervalForSpeed(speed),
    });
  }

  // Start/stop the clock to match isRunning(); call after any flag changes.
  function syncRun(): void {
    if (isRunning()) startTicker();
    else stopTicker();
    pushHudStatus();
  }

  function renderAll(): void {
    board.update(state);
    units.update(state);
    marching.update(state, intervalForSpeed(speed));
    factionPanel.update(state);
    refreshTileInfo();
    pushHudStatus();
  }

  // Tile-info follows the hovered tile, falling back to the clicked/selected
  // tile — so tapping any unit (issue #10) pins its details even on touch, where
  // there is no hover.
  function refreshTileInfo(): void {
    tileInfo.setHover(state, hoverId ?? selectedTileId);
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
      deselect();
      renderAll();
    },
    getForceCount: (from) =>
      selectedUnit !== null && selectedUnit.id === from && manualCount !== null
        ? manualCount
        : undefined,
  });

  const pointer = createPointerController(render.app.canvas, {
    onTileHover: (id) => {
      hoverId = id;
      board.setHover(id);
      refreshTileInfo();
    },
    onTileClick: (id, button) => {
      if (button !== "left") return;
      selectTile(id);
    },
    onDragStart: (id, button) => dispatchCtrl.handleDragStart(id, button),
    onDragMove: (id, button) => dispatchCtrl.handleDragMove(id, button),
    onDragEnd: (id, button) => dispatchCtrl.handleDragEnd(id, button),
    onDragCancel: (button) => dispatchCtrl.handleDragCancel(button),
    onPressStart: () => {
      // PRD §5.3 v1.1 amendment: freeze the clock while the player is dragging.
      pressFreeze = true;
      syncRun();
    },
    onPressEnd: () => {
      pressFreeze = false;
      syncRun();
    },
  });

  const ratioPanel = createRatioPanel(document.body, dispatchCtrl.getRatio(), {
    onRatio: (r) => dispatchCtrl.setRatio(r),
    onCount: (n) => {
      manualCount = n;
    },
  });

  // PRD §5.3 (this revision): selecting your own unit freezes the clock and
  // opens the manual troop slider; selecting anything else (or deselecting)
  // resumes it. The selected tile drives forceCount on the next drag-dispatch.
  function unitMaxSend(id: TileId): number {
    const p = state.provinces.get(id);
    if (p === undefined || derivedOwner(p) !== PLAYER_FACTION) return 0;
    const occ = p.occupants[0];
    if (occ === undefined || occ.faction !== PLAYER_FACTION || occ.amount <= 0) {
      return 0;
    }
    return p.isCastle ? Math.max(0, occ.amount - 1) : occ.amount;
  }

  function selectTile(id: TileId): void {
    board.setSelection(id);
    selectedTileId = id;
    refreshTileInfo();
    const max = unitMaxSend(id);
    if (max >= 1) {
      const value = Math.max(1, Math.min(max, Math.floor(max * dispatchCtrl.getRatio())));
      selectedUnit = { id, max };
      manualCount = value;
      ratioPanel.showCount(max, value);
      selectionFreeze = true;
    } else {
      selectedUnit = null;
      manualCount = null;
      ratioPanel.hideCount();
      selectionFreeze = false;
    }
    syncRun();
  }

  function deselect(): void {
    board.setSelection(null);
    selectedTileId = null;
    selectedUnit = null;
    manualCount = null;
    ratioPanel.hideCount();
    selectionFreeze = false;
    refreshTileInfo();
    syncRun();
  }

  const endScreen = createEndScreen(document.body, {
    onRestart: hooks.onRestart,
    onMainMenu: hooks.onMainMenu,
  });

  const cameraGestures = createCameraGestures(render.app.canvas, {
    zoomBy: (factor, fx, fy) => board.zoomBy(factor, fx, fy),
    panBy: (dx, dy) => board.panBy(dx, dy),
    onGestureStart: () => pointer.suspend(),
    onGestureEnd: () => pointer.resume(),
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
    if (tickHandle !== null) return; // already running — don't reset the timer
    if (!isRunning()) return;
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
    if (v === manualPaused) return;
    manualPaused = v;
    syncRun();
  }

  function setSpeed(s: Speed): void {
    if (s === speed) return;
    speed = s;
    // Restart the interval so the new rate takes effect immediately.
    stopTicker();
    syncRun();
  }

  renderAll();
  syncRun();

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
      getTickInfo: () => ({ tick: state.tick, paused: manualPaused, speed }),
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
    isPaused: () => manualPaused,
    setPaused,
    getSpeed: () => speed,
    setSpeed,
    // Esc cancels an in-flight drag and clears any unit selection (unfreezing
    // the clock).
    cancelDrag: () => {
      pointer.cancelActiveDrag();
      deselect();
    },
    panBy: (dx, dy) => board.panBy(dx, dy),
    resetCamera: () => board.resetCamera(),
  });

  return function teardown(): void {
    stopTicker();
    window.removeEventListener("resize", onResize);
    keyboard.destroy();
    cameraGestures.destroy();
    pointer.destroy();
    ratioPanel.destroy();
    tileInfo.destroy();
    factionPanel.destroy();
    hud.destroy();
    endScreen.destroy();
    // Children before parent: destroying board with { children: true } would
    // double-destroy these, so dispose them first (they detach themselves).
    paths.destroy();
    marching.destroy();
    units.destroy();
    board.destroy();
    if (import.meta.env.DEV) {
      (window as unknown as { __ks?: unknown }).__ks = undefined;
    }
  };
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById(MOUNT_ID);
  if (container === null) {
    throw new Error(`missing #${MOUNT_ID} mount container`);
  }

  // Persistent shell: the Pixi app, tier textures and the Start Menu outlive
  // individual games so size / difficulty can change without a page reload.
  const render = await createRenderApp(container);
  const tierTextures = createTierTextures(render.app);

  let teardownGame: (() => void) | null = null;

  function startGame(config: StartConfig): void {
    teardownGame?.();
    teardownGame = createGame(render, tierTextures, config, {
      onRestart: () => startGame(config),
      onMainMenu: () => {
        teardownGame?.();
        teardownGame = null;
        startMenu.show();
      },
    });
  }

  const startMenu = createStartMenu(document.body, {
    initialSize: readMapSize(window.location.search),
    initialDifficulty: readDifficulty(window.location.search),
    onStart: (config) => {
      startMenu.hide();
      startGame(config);
    },
  });

  startMenu.show();

  window.addEventListener(
    "beforeunload",
    () => {
      teardownGame?.();
      startMenu.destroy();
      render.destroy();
    },
    { once: true },
  );
}

bootstrap().catch((err: unknown) => {
  console.error(err);
});
