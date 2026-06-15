import { dispatch, type DispatchRatio } from "@/engine/movement";
import { tileId } from "@/engine/state";
import { step } from "@/engine/tick";
import type {
  AiMode,
  FactionId,
  GameState,
  Province,
  TileId,
} from "@/engine/types";
import { evaluateOutcome, NON_NEUTRAL_FACTIONS } from "@/engine/victory";

export type ScenarioTile = {
  readonly x: number;
  readonly y: number;
  readonly owner: FactionId;
  readonly count: number;
  readonly isCastle: boolean;
};

export type ScriptedCommand = {
  readonly atTick: number;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly ratio: DispatchRatio;
};

export type ScenarioAiConfig = Readonly<
  Record<Exclude<FactionId, "NEUTRAL">, AiMode>
>;

export type ScenarioInput = {
  readonly name?: string;
  readonly boardSize: number;
  readonly initialState: readonly ScenarioTile[];
  readonly aiConfig: ScenarioAiConfig;
  readonly scriptedCommands?: readonly ScriptedCommand[];
  readonly rngSeed: number;
};

const FACTION_IDS: readonly FactionId[] = [
  "TOKUGAWA",
  "TAKEDA",
  "ODA",
  "UESUGI",
  "NEUTRAL",
];
const VALID_FACTIONS = new Set<string>(FACTION_IDS);
const VALID_AI_MODES = new Set<string>(["default", "scripted", "idle"]);
const VALID_RATIOS: readonly DispatchRatio[] = [0.25, 0.5, 0.75, 1.0];

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: expected object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected array`);
  return value;
}

function asFaction(value: unknown, path: string): FactionId {
  if (typeof value !== "string" || !VALID_FACTIONS.has(value)) {
    throw new Error(`${path}: invalid faction "${String(value)}"`);
  }
  return value as FactionId;
}

function asAiMode(value: unknown, path: string): AiMode {
  if (typeof value !== "string" || !VALID_AI_MODES.has(value)) {
    throw new Error(`${path}: invalid ai mode "${String(value)}"`);
  }
  return value as AiMode;
}

function asInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${path}: expected integer`);
  }
  return value;
}

function asRatio(value: unknown, path: string): DispatchRatio {
  if (
    typeof value !== "number" ||
    !VALID_RATIOS.includes(value as DispatchRatio)
  ) {
    throw new Error(`${path}: ratio must be one of 0.25 / 0.5 / 0.75 / 1.0`);
  }
  return value as DispatchRatio;
}

function asCoord(value: unknown, path: string): readonly [number, number] {
  const arr = asArray(value, path);
  if (arr.length !== 2) throw new Error(`${path}: expected [x, y]`);
  const x = asInteger(arr[0], `${path}[0]`);
  const y = asInteger(arr[1], `${path}[1]`);
  return [x, y];
}

export function parseScenario(raw: unknown): ScenarioInput {
  const root = asObject(raw, "scenario");

  const boardSize = asInteger(root.boardSize, "scenario.boardSize");
  if (boardSize <= 0) {
    throw new Error("scenario.boardSize: must be positive");
  }

  const tiles = asArray(root.initialState, "scenario.initialState").map(
    (item, i) => {
      const t = asObject(item, `scenario.initialState[${i}]`);
      const x = asInteger(t.x, `scenario.initialState[${i}].x`);
      const y = asInteger(t.y, `scenario.initialState[${i}].y`);
      if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) {
        throw new Error(
          `scenario.initialState[${i}]: tile (${x},${y}) out of bounds`,
        );
      }
      const owner = asFaction(t.owner, `scenario.initialState[${i}].owner`);
      const count = asInteger(t.count, `scenario.initialState[${i}].count`);
      if (count < 0) {
        throw new Error(`scenario.initialState[${i}].count: must be >= 0`);
      }
      if (typeof t.isCastle !== "boolean") {
        throw new Error(`scenario.initialState[${i}].isCastle: expected boolean`);
      }
      const tile: ScenarioTile = { x, y, owner, count, isCastle: t.isCastle };
      return tile;
    },
  );

  const aiRaw = asObject(root.aiConfig, "scenario.aiConfig");
  const aiConfig: Record<Exclude<FactionId, "NEUTRAL">, AiMode> = {
    TOKUGAWA: asAiMode(aiRaw.TOKUGAWA, "scenario.aiConfig.TOKUGAWA"),
    TAKEDA: asAiMode(aiRaw.TAKEDA, "scenario.aiConfig.TAKEDA"),
    ODA: asAiMode(aiRaw.ODA, "scenario.aiConfig.ODA"),
    UESUGI: asAiMode(aiRaw.UESUGI, "scenario.aiConfig.UESUGI"),
  };

  const rngSeed = asInteger(root.rngSeed, "scenario.rngSeed");

  let scripted: ScriptedCommand[] | undefined;
  if (root.scriptedCommands !== undefined) {
    const arr = asArray(root.scriptedCommands, "scenario.scriptedCommands");
    scripted = arr.map((item, i) => {
      const c = asObject(item, `scenario.scriptedCommands[${i}]`);
      const atTick = asInteger(c.atTick, `scenario.scriptedCommands[${i}].atTick`);
      if (atTick < 0) {
        throw new Error(`scenario.scriptedCommands[${i}].atTick: must be >= 0`);
      }
      return {
        atTick,
        from: asCoord(c.from, `scenario.scriptedCommands[${i}].from`),
        to: asCoord(c.to, `scenario.scriptedCommands[${i}].to`),
        ratio: asRatio(c.ratio, `scenario.scriptedCommands[${i}].ratio`),
      };
    });
  }

  const name = typeof root.name === "string" ? root.name : undefined;

  const scenario: ScenarioInput = {
    ...(name !== undefined ? { name } : {}),
    boardSize,
    initialState: tiles,
    aiConfig,
    ...(scripted !== undefined ? { scriptedCommands: scripted } : {}),
    rngSeed,
  };
  return scenario;
}

export function buildInitialState(scenario: ScenarioInput): GameState {
  const provinces = new Map<TileId, Province>();
  for (let y = 0; y < scenario.boardSize; y++) {
    for (let x = 0; x < scenario.boardSize; x++) {
      const id = tileId(x, y);
      provinces.set(id, {
        id,
        x,
        y,
        owner: "NEUTRAL",
        count: 0,
        isCastle: false,
      });
    }
  }
  for (const t of scenario.initialState) {
    const id = tileId(t.x, t.y);
    provinces.set(id, {
      id,
      x: t.x,
      y: t.y,
      owner: t.owner,
      count: t.count,
      isCastle: t.isCastle,
    });
  }
  const aiConfig: Record<FactionId, AiMode> = {
    TOKUGAWA: scenario.aiConfig.TOKUGAWA,
    TAKEDA: scenario.aiConfig.TAKEDA,
    ODA: scenario.aiConfig.ODA,
    UESUGI: scenario.aiConfig.UESUGI,
    NEUTRAL: "idle",
  };
  return {
    boardSize: scenario.boardSize,
    tick: 0,
    provinces,
    marchingStacks: [],
    stalemates: new Map(),
    aiConfig,
    defeated: new Set<FactionId>(),
    rngSeed: scenario.rngSeed >>> 0,
    nextMarchingId: 1,
  };
}

export type FactionSnapshot = {
  readonly faction: FactionId;
  readonly tiles: number;
  readonly totalCount: number;
  readonly hasCastle: boolean;
  readonly marchingStacks: number;
  readonly marchingCount: number;
};

export type TickEvent = {
  readonly tick: number;
  readonly factions: readonly FactionSnapshot[];
  readonly newlyDefeated: readonly FactionId[];
  readonly scriptedDispatched: number;
  readonly scriptedRejected: number;
};

export type RunOptions = {
  readonly maxTicks: number;
  readonly emitEvents?: boolean;
};

export type RunOutcome = "win" | "elimination" | "stalemate";

export type RunResult = {
  readonly winner: FactionId | null;
  readonly outcome: RunOutcome;
  readonly ticks: number;
  readonly events?: readonly TickEvent[];
};

function snapshotFactions(state: GameState): FactionSnapshot[] {
  const tiles = new Map<FactionId, number>();
  const counts = new Map<FactionId, number>();
  const castles = new Set<FactionId>();
  for (const p of state.provinces.values()) {
    tiles.set(p.owner, (tiles.get(p.owner) ?? 0) + 1);
    counts.set(p.owner, (counts.get(p.owner) ?? 0) + p.count);
    if (p.isCastle && p.owner !== "NEUTRAL") castles.add(p.owner);
  }
  const marchTiles = new Map<FactionId, number>();
  const marchCounts = new Map<FactionId, number>();
  for (const s of state.marchingStacks) {
    marchTiles.set(s.faction, (marchTiles.get(s.faction) ?? 0) + 1);
    marchCounts.set(s.faction, (marchCounts.get(s.faction) ?? 0) + s.count);
  }
  const out: FactionSnapshot[] = [];
  for (const faction of NON_NEUTRAL_FACTIONS) {
    out.push({
      faction,
      tiles: tiles.get(faction) ?? 0,
      totalCount: counts.get(faction) ?? 0,
      hasCastle: castles.has(faction),
      marchingStacks: marchTiles.get(faction) ?? 0,
      marchingCount: marchCounts.get(faction) ?? 0,
    });
  }
  return out;
}

export function runScenario(
  scenario: ScenarioInput,
  options: RunOptions,
): RunResult {
  if (options.maxTicks <= 0) {
    throw new Error("runScenario: maxTicks must be positive");
  }
  let state = buildInitialState(scenario);
  const scriptedByTick = new Map<number, ScriptedCommand[]>();
  for (const cmd of scenario.scriptedCommands ?? []) {
    const list = scriptedByTick.get(cmd.atTick) ?? [];
    list.push(cmd);
    scriptedByTick.set(cmd.atTick, list);
  }
  const events: TickEvent[] = [];
  const emit = options.emitEvents === true;

  while (state.tick < options.maxTicks) {
    let scriptedDispatched = 0;
    let scriptedRejected = 0;
    const cmds = scriptedByTick.get(state.tick);
    if (cmds !== undefined) {
      for (const cmd of cmds) {
        const result = dispatch(state, {
          from: tileId(cmd.from[0], cmd.from[1]),
          to: tileId(cmd.to[0], cmd.to[1]),
          ratio: cmd.ratio,
        });
        if (result.ok) {
          state = result.state;
          scriptedDispatched += 1;
        } else {
          scriptedRejected += 1;
        }
      }
    }

    const prevDefeated = state.defeated;
    state = step(state);

    if (emit) {
      const newlyDefeated: FactionId[] = [];
      for (const faction of NON_NEUTRAL_FACTIONS) {
        if (!prevDefeated.has(faction) && state.defeated.has(faction)) {
          newlyDefeated.push(faction);
        }
      }
      events.push({
        tick: state.tick,
        factions: snapshotFactions(state),
        newlyDefeated,
        scriptedDispatched,
        scriptedRejected,
      });
    }

    const outcome = evaluateOutcome(state);
    if (outcome.status === "ended") {
      validateTerminalState(state);
      return {
        winner: outcome.winner,
        outcome: outcome.winner === null ? "elimination" : "win",
        ticks: state.tick,
        ...(emit ? { events } : {}),
      };
    }
  }

  validateTerminalState(state);
  return {
    winner: null,
    outcome: "stalemate",
    ticks: state.tick,
    ...(emit ? { events } : {}),
  };
}

// Cheap invariant guard — surfaces NaN / negative counts as a runner-level
// error so CLI smoke and integration tests catch silent engine corruption.
function validateTerminalState(state: GameState): void {
  for (const p of state.provinces.values()) {
    if (!Number.isFinite(p.count) || p.count < 0) {
      throw new Error(`invariant: tile ${p.id} has invalid count ${p.count}`);
    }
  }
  for (const s of state.marchingStacks) {
    if (!Number.isFinite(s.count) || s.count <= 0) {
      throw new Error(`invariant: stack ${s.id} has invalid count ${s.count}`);
    }
  }
}
