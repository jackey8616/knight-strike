import { stepAi } from "@/engine/ai";
import { resolveAdjacentCombat } from "@/engine/combat";
import { advanceMarching, dispatch, type DispatchRatio } from "@/engine/movement";
import { applyCastleOverflow } from "@/engine/overflow";
import { produce } from "@/engine/production";
import { tileId } from "@/engine/state";
import { deriveTier } from "@/engine/upgrade";
import type {
  AiMode,
  FactionId,
  GameState,
  MarchingStack,
  PairKey,
  Province,
  RuleTier,
  Tier,
  TileId,
} from "@/engine/types";
import { applyDefeats, evaluateOutcome, NON_NEUTRAL_FACTIONS } from "@/engine/victory";

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
// PRD §4.4 (v1.1) shorthand string forms accepted by scenario JSON. `"default"`
// stays accepted as a back-compat alias for the v0.12 single-tier AI and is
// normalized to {kind: "rule", tier: "normal"}; a console.warn fires the first
// time it appears in any session so legacy fixtures keep loading while
// signalling the deprecation.
const VALID_RULE_TIERS = new Set<RuleTier>(["easy", "normal", "hard"]);
const VALID_SHORTHAND_AI_MODES = new Set<string>([
  "easy",
  "normal",
  "hard",
  "scripted",
  "idle",
  "default",
]);
const VALID_RATIOS: readonly DispatchRatio[] = [0.25, 0.5, 0.75, 1.0];

let warnedDefaultAlias = false;
function warnDefaultAlias(path: string): void {
  if (warnedDefaultAlias) return;
  warnedDefaultAlias = true;
  console.warn(
    `[knight-strike] ${path}: aiConfig "default" is deprecated; use "normal" (or {kind: "rule", tier: "normal"}). Continuing as Normal-tier.`,
  );
}

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
  if (typeof value === "string") {
    if (!VALID_SHORTHAND_AI_MODES.has(value)) {
      throw new Error(`${path}: invalid ai mode "${value}"`);
    }
    if (value === "idle") return { kind: "idle" };
    if (value === "scripted") return { kind: "scripted" };
    if (value === "default") {
      warnDefaultAlias(path);
      return { kind: "rule", tier: "normal" };
    }
    // Remaining strings are rule tiers per VALID_RULE_TIERS gate above.
    return { kind: "rule", tier: value as RuleTier };
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.kind === "idle") return { kind: "idle" };
    if (obj.kind === "scripted") return { kind: "scripted" };
    if (obj.kind === "rule") {
      const tier = obj.tier;
      if (typeof tier !== "string" || !VALID_RULE_TIERS.has(tier as RuleTier)) {
        throw new Error(`${path}.tier: invalid rule tier "${String(tier)}"`);
      }
      return { kind: "rule", tier: tier as RuleTier };
    }
    throw new Error(`${path}.kind: invalid ai mode kind "${String(obj.kind)}"`);
  }
  throw new Error(`${path}: invalid ai mode "${String(value)}"`);
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
    NEUTRAL: { kind: "idle" },
  };
  return {
    boardSize: scenario.boardSize,
    tick: 0,
    provinces,
    marchingStacks: [],
    engagements: new Map(),
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

// PRD §10.3 detail-mode events — typed sub-events emitted alongside the
// per-tick aggregate so log readers can grep for specific game transitions.
// Type names match the verbs in PRD §10.3 "產兵 / 派遣 / 戰鬥 / 佔領 / 升級
// / 敗北" plus march advance / arrival / engagement counters for coverage.
export type SubEvent =
  | {
      readonly type: "production";
      readonly tile: TileId;
      readonly faction: FactionId;
      readonly count: number;
    }
  | {
      readonly type: "ai_rule_fire";
      readonly faction: FactionId;
      readonly rule: 1 | 2 | 2.5 | 3;
      readonly source: TileId;
      readonly target: TileId;
      readonly count: number;
    }
  | {
      readonly type: "march_dispatch";
      readonly stack: string;
      readonly faction: FactionId;
      readonly source: TileId;
      readonly target: TileId;
      readonly count: number;
      readonly origin: "ai" | "scripted" | "overflow";
    }
  | {
      readonly type: "march_arrival";
      readonly stack: string;
      readonly faction: FactionId;
      readonly tile: TileId;
      readonly count: number;
    }
  | {
      readonly type: "combat";
      readonly a: TileId;
      readonly b: TileId;
      readonly damage: number;
      readonly engagementTicks: number;
    }
  | {
      readonly type: "engagement_inc";
      readonly pair: PairKey;
      readonly ticks: number;
    }
  | {
      readonly type: "tier_upgrade";
      readonly tile: TileId;
      readonly from: Tier;
      readonly to: Tier;
    }
  | {
      readonly type: "defeat";
      readonly faction: FactionId;
    };

export type TickEvent = {
  readonly tick: number;
  readonly factions: readonly FactionSnapshot[];
  readonly newlyDefeated: readonly FactionId[];
  readonly scriptedDispatched: number;
  readonly scriptedRejected: number;
  readonly events: readonly SubEvent[];
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

// Classify a freshly-introduced marching stack by inspecting its source and
// terminus characteristics. AI rule order (v0.11): defense (#1) → expand (#2)
// → rally (#2.5) → attack (#3). Defense / expand / attack each fire at most
// one stack per evaluation, so target-tile shape is a unique fingerprint;
// rally fires one stack per qualifying adjacent source so multiple stacks per
// faction per tick can share the rule: 2.5 tag.
function classifyAiFire(
  before: GameState,
  stack: MarchingStack,
): { readonly rule: 1 | 2 | 2.5 | 3 } | null {
  const target = before.provinces.get(stack.path[stack.path.length - 1] as TileId);
  if (target === undefined) return null;
  if (target.isCastle && target.owner === stack.faction) return { rule: 1 };
  if (target.isCastle) return { rule: 3 };
  if (
    target.owner === stack.faction &&
    !target.isCastle &&
    target.count > 0
  ) {
    return { rule: 2.5 };
  }
  if (target.count === 0 && target.owner !== stack.faction) return { rule: 2 };
  return null;
}

// New stacks introduced between two states keyed by stack id (path-stable).
function diffNewStacks(
  before: GameState,
  after: GameState,
): MarchingStack[] {
  const known = new Set<string>();
  for (const s of before.marchingStacks) known.add(s.id);
  const out: MarchingStack[] = [];
  for (const s of after.marchingStacks) if (!known.has(s.id)) out.push(s);
  return out;
}

// Replicates engine/tick.step() while collecting sub-events between phases.
// Engine purity preserved (step() in tick.ts unchanged); diffs derived here.
function stepWithEvents(state: GameState): {
  readonly state: GameState;
  readonly events: readonly SubEvent[];
} {
  const events: SubEvent[] = [];
  const preTier = new Map<TileId, Tier>();
  for (const p of state.provinces.values()) preTier.set(p.id, deriveTier(p.count));

  // §3.2 step 1 part A: AI evaluation (introduces new marching stacks).
  const beforeAi = state;
  let s = stepAi(beforeAi);
  for (const stk of diffNewStacks(beforeAi, s)) {
    const cls = classifyAiFire(beforeAi, stk);
    const source = stk.path[0] as TileId;
    const target = stk.path[stk.path.length - 1] as TileId;
    if (cls !== null) {
      events.push({
        type: "ai_rule_fire",
        faction: stk.faction,
        rule: cls.rule,
        source,
        target,
        count: stk.count,
      });
    }
    events.push({
      type: "march_dispatch",
      stack: stk.id,
      faction: stk.faction,
      source,
      target,
      count: stk.count,
      origin: "ai",
    });
  }

  // §3.2 step 1 part B: advance + arrivals.
  const beforeMove = s;
  s = advanceMarching(s);
  const afterMoveIds = new Set(s.marchingStacks.map((m) => m.id));
  for (const stk of beforeMove.marchingStacks) {
    if (afterMoveIds.has(stk.id)) continue;
    // Arrived (consumed by terminus / merged / lost to combat). Best guess
    // terminus is the path's last tile; that's right for non-collision
    // arrivals and good-enough for the log otherwise.
    const term = stk.path[stk.path.length - 1] as TileId;
    events.push({
      type: "march_arrival",
      stack: stk.id,
      faction: stk.faction,
      tile: term,
      count: stk.count,
    });
  }

  // §3.2 step 2 (v1.1): combat damage + engagement counter advance, single pass.
  const beforeEngagements = s.engagements;
  const cr = resolveAdjacentCombat(s);
  s = cr.state;
  for (const p of cr.pairs) {
    if (p.damage === 0) continue;
    events.push({
      type: "combat",
      a: p.a,
      b: p.b,
      damage: p.damage,
      engagementTicks: p.engagementTicks,
    });
  }
  for (const [key, ticks] of s.engagements) {
    if (ticks > (beforeEngagements.get(key) ?? 0)) {
      events.push({ type: "engagement_inc", pair: key, ticks });
    }
  }

  // §3.2 step 3: defeats. (§3.6.1 adjacent-empty claim phase removed in
  // v0.12 — owner now flips only via §3.5.4 marching arrival, already logged
  // by the upstream marching-arrival diff.)
  const beforeDefeats = s.defeated;
  s = applyDefeats(s);
  for (const f of s.defeated) {
    if (!beforeDefeats.has(f)) events.push({ type: "defeat", faction: f });
  }

  // §3.2 step 4: production. Castle counts that ticked up by ≥ 1 against
  // the immediately-preceding state are productions.
  const beforeProd = s;
  s = produce(s);
  for (const after of s.provinces.values()) {
    if (!after.isCastle) continue;
    if (after.owner === "NEUTRAL") continue;
    const prev = beforeProd.provinces.get(after.id);
    if (prev === undefined) continue;
    if (after.count > prev.count) {
      events.push({
        type: "production",
        tile: after.id,
        faction: after.owner,
        count: after.count,
      });
    }
  }

  // PRD §3.2 v0.11: castle overflow. New marching stacks emitted as
  // march_dispatch with origin "overflow" so the event log distinguishes them
  // from AI / scripted dispatches.
  const beforeOverflow = s;
  s = applyCastleOverflow(s);
  for (const stk of diffNewStacks(beforeOverflow, s)) {
    const source = stk.path[0] as TileId;
    const target = stk.path[stk.path.length - 1] as TileId;
    events.push({
      type: "march_dispatch",
      stack: stk.id,
      faction: stk.faction,
      source,
      target,
      count: stk.count,
      origin: "overflow",
    });
  }

  // §3.2 step 5: tier upgrade — derived from any province whose tier flipped
  // across the whole step. Combat-induced downgrades are emitted too so
  // readers see when a stack drops below a threshold.
  for (const after of s.provinces.values()) {
    const prev = preTier.get(after.id);
    if (prev === undefined) continue;
    const curr = deriveTier(after.count);
    if (prev !== curr) {
      events.push({ type: "tier_upgrade", tile: after.id, from: prev, to: curr });
    }
  }

  return { state: { ...s, tick: s.tick + 1 }, events };
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
    const scriptedEvents: SubEvent[] = [];
    // PRD §4 AC-38 convention: scripted `atTick: N` is observed in the event
    // tick N — i.e., it fires during the step that produces tick N. Since
    // state.tick here is the pre-step value (N−1), look up commands keyed by
    // the resulting tick number.
    const cmds = scriptedByTick.get(state.tick + 1);
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
          if (emit) {
            scriptedEvents.push({
              type: "march_dispatch",
              stack: result.stack.id,
              faction: result.stack.faction,
              source: result.stack.path[0] as TileId,
              target: result.stack.path[result.stack.path.length - 1] as TileId,
              count: result.stack.count,
              origin: "scripted",
            });
          }
        } else {
          scriptedRejected += 1;
        }
      }
    }

    const prevDefeated = state.defeated;
    const stepped = stepWithEvents(state);
    state = stepped.state;

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
        events: [...scriptedEvents, ...stepped.events],
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
