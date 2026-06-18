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
import { makeScenario, readMapSize } from "@/scenarios/sized";
import { evaluateOutcome } from "@/engine/victory";
import { createFactionPanel } from "@/ui/faction-panel";
import { createHud } from "@/ui/hud";
import { createMapSizePanel } from "@/ui/map-size";
import { createTileInfoPanel } from "@/ui/tile-info";
import { createEndScreen } from "@/ui/end-screen";

const TICK_INTERVAL_MS = 2000;
const MOUNT_ID = "app";
const PLAYER_FACTION: FactionId = "TOKUGAWA";

type Speed = 1 | 2 | 3 | 4;

async function bootstrap(): Promise<void> {
  const container = document.getElementById(MOUNT_ID);
  if (container === null) {
    throw new Error(`missing #${MOUNT_ID} mount container`);
  }

  const render = await createRenderApp(container);
  const tierTextures = createTierTextures(render.app);
  const mapSize = readMapSize(window.location.search);
  const initialState = buildInitialState(makeScenario(mapSize));
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

  function isRunning(): boolean {
    return !ended && !manualPaused && !pressFreeze && !selectionFreeze;
  }

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
    onTogglePause: () => setPaused(!manualPaused),
    onSpeed: (s) => setSpeed(s),
  });
  const factionPanel = createFactionPanel(document.body, PLAYER_FACTION);
  const tileInfo = createTileInfoPanel(document.body);
  // Switching size starts a fresh game at that board size, carried in the URL.
  const mapSizePanel = createMapSizePanel(document.body, mapSize, (size) => {
    const url = new URL(window.location.href);
    url.searchParams.set("size", String(size));
    window.location.assign(url.toString());
  });

  function pushHudStatus(): void {
    hud.setStatus({
      tick: state.tick,
      paused: manualPaused,
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
    tileInfo.setHover(state, hoverId);
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
      tileInfo.setHover(state, id);
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
    selectedUnit = null;
    manualCount = null;
    ratioPanel.hideCount();
    selectionFreeze = false;
    syncRun();
  }

  const endScreen = createEndScreen(document.body, () => {
    state = initialState;
    ended = false;
    deselect();
    endScreen.hide();
    renderAll();
    syncRun();
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

  window.addEventListener(
    "beforeunload",
    () => {
      stopTicker();
      window.removeEventListener("resize", onResize);
      keyboard.destroy();
      cameraGestures.destroy();
      pointer.destroy();
      ratioPanel.destroy();
      tileInfo.destroy();
      mapSizePanel.destroy();
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
