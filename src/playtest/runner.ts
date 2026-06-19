import { stepAi } from "@/engine/ai";
import { RULE_PROFILES } from "@/engine/ai-profile";
import { resolveOrders } from "@/engine/combat";
import {
  collectTax,
  DEFAULT_TAX_PCT,
  growPopulation,
  HOUSE_SEED_POP,
  isEconomyTick,
  makeEconomy,
  spawnFromHouses,
  SPAWN_SIZE,
  STARTING_GOLD,
} from "@/engine/economy";
import { advanceMarching, dispatch, type DispatchRatio } from "@/engine/movement";
import { derivedOwner, tileId } from "@/engine/state";
import { coastOceanMask, generateTerrain } from "@/engine/terrain";
import { deriveTier } from "@/engine/upgrade";
import type {
  AiMode,
  FactionId,
  GameState,
  MarchingStack,
  Occupant,
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
  // PRD §4.3 (v2.6): a seed House owned by `owner` (claimed even with count 0),
  // populated at HOUSE_SEED_POP. Bootstraps the economy from tick 0.
  readonly isHouse?: boolean;
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

// PRD §6.1: the whole-map silhouette. "plateau" (default) = full square land as
// a raised slab; "island" = the same land ringed by a decorative sea (render
// only); "coast" = a seeded symmetric perimeter sea carved into WATER (engine).
export type MapShape = "plateau" | "island" | "coast";
export const MAP_SHAPES: readonly MapShape[] = ["plateau", "island", "coast"];
export const DEFAULT_MAP_SHAPE: MapShape = "plateau";

export type ScenarioInput = {
  readonly name?: string;
  readonly boardSize: number;
  readonly initialState: readonly ScenarioTile[];
  readonly aiConfig: ScenarioAiConfig;
  readonly scriptedCommands?: readonly ScriptedCommand[];
  readonly rngSeed: number;
  readonly mapShape?: MapShape;
};

const FACTION_IDS: readonly FactionId[] = [
  "TOKUGAWA",
  "TAKEDA",
  "ODA",
  "UESUGI",
  "NEUTRAL",
];
const VALID_FACTIONS = new Set<string>(FACTION_IDS);
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
      if (t.isHouse !== undefined && typeof t.isHouse !== "boolean") {
        throw new Error(`scenario.initialState[${i}].isHouse: expected boolean`);
      }
      const tile: ScenarioTile = {
        x,
        y,
        owner,
        count,
        isCastle: t.isCastle,
        ...(t.isHouse === true ? { isHouse: true } : {}),
      };
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

  let mapShape: MapShape | undefined;
  if (root.mapShape !== undefined) {
    if (
      typeof root.mapShape !== "string" ||
      !(MAP_SHAPES as readonly string[]).includes(root.mapShape)
    ) {
      throw new Error(
        `scenario.mapShape: invalid shape "${String(root.mapShape)}"`,
      );
    }
    mapShape = root.mapShape as MapShape;
  }

  return {
    ...(name !== undefined ? { name } : {}),
    boardSize,
    initialState: tiles,
    aiConfig,
    ...(scripted !== undefined ? { scriptedCommands: scripted } : {}),
    rngSeed,
    ...(mapShape !== undefined ? { mapShape } : {}),
  };
}

// PRD §3.4 v1.2: scenario JSON keeps the legacy (owner, count) per-tile
// shorthand. Each non-empty entry becomes a single starting occupant
// (`arrivalTick: 0`, `isDefender: true`). Castles carry `castleOwner` so
// v1.2 victory checks have the stable original-faction reference even after
// the tile changes hands.
export function buildInitialState(scenario: ScenarioInput): GameState {
  const provinces = new Map<TileId, Province>();
  for (let y = 0; y < scenario.boardSize; y++) {
    for (let x = 0; x < scenario.boardSize; x++) {
      const id = tileId(x, y);
      provinces.set(id, {
        id,
        x,
        y,
        isCastle: false,
        castleOwner: null,
        occupants: [],
        lastClaimedFaction: null,
      });
    }
  }
  for (const t of scenario.initialState) {
    const id = tileId(t.x, t.y);
    const occupants: Occupant[] =
      t.count > 0
        ? [
            {
              faction: t.owner,
              amount: t.count,
              arrivalTick: 0,
              isDefender: true,
            },
          ]
        : [];
    provinces.set(id, {
      id,
      x: t.x,
      y: t.y,
      isCastle: t.isCastle,
      castleOwner: t.isCastle ? t.owner : null,
      // PRD §4.3 (v2.6): seed House, claimed by its owner and pre-populated.
      ...(t.isHouse === true
        ? {
            isHouse: true,
            houseOwner: t.owner,
            housePopulation: HOUSE_SEED_POP,
          }
        : {}),
      occupants,
      // Initial garrison's faction stamps the tile so derivedOwner reflects
      // colour even if the occupant later dies before someone else claims
      // (and so a wiped enemy castle still needs break→capture, §3.6'). A seed
      // House is claimed by its owner even with no starting garrison.
      lastClaimedFaction: t.count > 0 || t.isHouse === true ? t.owner : null,
    });
  }
  // PRD §3.9 (v1.6): generate seeded terrain. Castles + neutral camps + seed
  // Houses stay on flat ground (and get a clear ring), and connectivity is
  // guaranteed.
  const fixedPlains = new Set<TileId>();
  for (const [id, p] of provinces) {
    if (
      p.isCastle ||
      p.isHouse === true ||
      p.occupants.some((o) => o.faction === "NEUTRAL")
    ) {
      fixedPlains.add(id);
    }
  }
  // PRD §4.7: the "coast" shape carves a seeded symmetric perimeter sea; other
  // shapes (plateau/island) leave terrain generation unchanged.
  const oceanMask =
    scenario.mapShape === "coast"
      ? coastOceanMask(scenario.boardSize, scenario.rngSeed >>> 0, fixedPlains)
      : undefined;
  const terrain = generateTerrain(
    scenario.boardSize,
    scenario.rngSeed >>> 0,
    fixedPlains,
    oceanMask,
  );
  for (const [id, p] of provinces) {
    provinces.set(id, { ...p, terrain: terrain.get(id) ?? "PLAINS" });
  }

  const aiConfig: Record<FactionId, AiMode> = {
    TOKUGAWA: scenario.aiConfig.TOKUGAWA,
    TAKEDA: scenario.aiConfig.TAKEDA,
    ODA: scenario.aiConfig.ODA,
    UESUGI: scenario.aiConfig.UESUGI,
    NEUTRAL: { kind: "idle" },
  };
  // PRD §4.3 (v2.6): each faction starts solvent (enough gold for a couple of
  // Houses) at the default tax rate; rule-AI factions take their fixed tax rate
  // from their difficulty profile (the human keeps the default until they adjust
  // it in the HUD).
  const economy = makeEconomy(STARTING_GOLD, DEFAULT_TAX_PCT);
  for (const faction of NON_NEUTRAL_FACTIONS) {
    const mode = aiConfig[faction];
    if (mode.kind === "rule") {
      economy[faction] = {
        ...economy[faction],
        taxPct: RULE_PROFILES[mode.tier].taxPct,
      };
    }
  }
  return {
    boardSize: scenario.boardSize,
    tick: 0,
    provinces,
    marchingStacks: [],
    attackOrders: [],
    aiConfig,
    economy,
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
  // PRD §4.3 (v2.6): economy readouts for balance analysis.
  readonly gold: number;
  readonly houses: number;
};

export type SubEvent =
  | {
      readonly type: "house_built";
      readonly tile: TileId;
      readonly faction: FactionId;
    }
  | {
      readonly type: "house_spawn";
      readonly tile: TileId;
      readonly faction: FactionId;
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
      readonly tile: TileId;
      readonly combatTick: number;
      readonly baseDamage: number;
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

function provinceTotal(p: Province): number {
  let n = 0;
  for (const o of p.occupants) n += o.amount;
  return n;
}

function snapshotFactions(state: GameState): FactionSnapshot[] {
  const tiles = new Map<FactionId, number>();
  const counts = new Map<FactionId, number>();
  const houses = new Map<FactionId, number>();
  const castles = new Set<FactionId>();
  for (const p of state.provinces.values()) {
    const owner = derivedOwner(p);
    if (owner !== null) {
      tiles.set(owner, (tiles.get(owner) ?? 0) + 1);
    }
    for (const o of p.occupants) {
      counts.set(o.faction, (counts.get(o.faction) ?? 0) + o.amount);
    }
    if (p.isHouse === true && p.houseOwner !== null && p.houseOwner !== undefined) {
      houses.set(p.houseOwner, (houses.get(p.houseOwner) ?? 0) + 1);
    }
    if (p.isCastle && p.castleOwner !== null && p.castleOwner !== "NEUTRAL") {
      for (const o of p.occupants) {
        if (o.faction === p.castleOwner) {
          castles.add(p.castleOwner);
          break;
        }
      }
    }
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
      gold: state.economy[faction].gold,
      houses: houses.get(faction) ?? 0,
    });
  }
  return out;
}

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

// Event-log tier picks the largest-amount occupant — sufficient for an
// observational log even though the multi-occupant tile has no single tier
// per the engine model.
function dominantTier(p: Province): Tier {
  let max = 0;
  for (const o of p.occupants) if (o.amount > max) max = o.amount;
  return deriveTier(max);
}

function stepWithEvents(state: GameState): {
  readonly state: GameState;
  readonly events: readonly SubEvent[];
} {
  const events: SubEvent[] = [];
  const preTier = new Map<TileId, Tier>();
  for (const p of state.provinces.values()) preTier.set(p.id, dominantTier(p));

  const beforeAi = state;
  let s = stepAi(beforeAi);
  for (const stk of diffNewStacks(beforeAi, s)) {
    const source = stk.path[0] as TileId;
    const target = stk.path[stk.path.length - 1] as TileId;
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
  // PRD §4.3: an AI that built a House this tick (a tile that gained a house).
  for (const [id, after] of s.provinces) {
    if (after.isHouse !== true || after.houseOwner == null) continue;
    if (beforeAi.provinces.get(id)?.isHouse === true) continue;
    events.push({ type: "house_built", tile: id, faction: after.houseOwner });
  }

  const beforeMove = s;
  s = advanceMarching(s);
  const afterMoveIds = new Set(s.marchingStacks.map((m) => m.id));
  for (const stk of beforeMove.marchingStacks) {
    if (afterMoveIds.has(stk.id)) continue;
    const term = stk.path[stk.path.length - 1] as TileId;
    events.push({
      type: "march_arrival",
      stack: stk.id,
      faction: stk.faction,
      tile: term,
      count: stk.count,
    });
  }

  // PRD §4.3: economy day — houses grow, pay tax, then spawn troop stacks. A
  // house whose population dropped is one that spawned this tick.
  if (isEconomyTick(s.tick)) {
    s = growPopulation(s);
    s = collectTax(s);
    const beforeSpawn = s;
    s = spawnFromHouses(s);
    for (const [id, after] of s.provinces) {
      if (after.isHouse !== true || after.houseOwner == null) continue;
      const before = beforeSpawn.provinces.get(id);
      if (before === undefined) continue;
      const dropped = (before.housePopulation ?? 0) - (after.housePopulation ?? 0);
      if (dropped > 0) {
        events.push({
          type: "house_spawn",
          tile: id,
          faction: after.houseOwner,
          count: SPAWN_SIZE,
        });
      }
    }
  }

  const cr = resolveOrders(s);
  s = cr.state;
  for (const e of cr.events) {
    events.push({
      type: "combat",
      tile: e.to,
      combatTick: e.combatTick,
      baseDamage: e.baseDamage,
    });
  }

  const beforeDefeats = s.defeated;
  s = applyDefeats(s);
  for (const f of s.defeated) {
    if (!beforeDefeats.has(f)) events.push({ type: "defeat", faction: f });
  }

  for (const after of s.provinces.values()) {
    const prev = preTier.get(after.id);
    if (prev === undefined) continue;
    const curr = dominantTier(after);
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

function validateTerminalState(state: GameState): void {
  for (const p of state.provinces.values()) {
    const total = provinceTotal(p);
    if (!Number.isFinite(total) || total < 0) {
      throw new Error(`invariant: tile ${p.id} has invalid total ${total}`);
    }
    for (const o of p.occupants) {
      if (!Number.isFinite(o.amount) || o.amount <= 0) {
        throw new Error(
          `invariant: tile ${p.id} occupant ${o.faction} has invalid amount ${o.amount}`,
        );
      }
    }
  }
  for (const s of state.marchingStacks) {
    if (!Number.isFinite(s.count) || s.count <= 0) {
      throw new Error(`invariant: stack ${s.id} has invalid count ${s.count}`);
    }
  }
}
