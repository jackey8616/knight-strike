import type { GameEvent } from "@/engine/v2/events";
import { createGameState, defaultFactions, makeFaction, tileId } from "@/engine/v2/state";
import { step } from "@/engine/v2/tick";
import type {
  Faction,
  FactionId,
  Field,
  GameState,
  House,
  MonsterNest,
  Province,
  Terrain,
  Unit,
} from "@/engine/v2/types";
import { evaluateOutcome, type GameOutcome } from "@/engine/v2/victory";

// v2 headless playtest scenario — a flat, JSON-friendly description of an
// opening that buildScenarioState expands into a v2 GameState.
export type ScenarioFactionCfg = {
  readonly gold?: number;
  readonly taxRate?: number;
  readonly isPlayer?: boolean;
};
export type ScenarioUnit = {
  readonly id?: string;
  readonly owner: FactionId;
  readonly x: number;
  readonly y: number;
  readonly population: number;
  readonly isMonster?: boolean;
};
export type ScenarioHouse = { readonly owner: FactionId; readonly x: number; readonly y: number; readonly population: number };
export type ScenarioField = { readonly owner: FactionId; readonly x: number; readonly y: number };
export type ScenarioNest = { readonly x: number; readonly y: number; readonly accumulated?: number };
export type ScenarioCastle = { readonly owner: FactionId; readonly x: number; readonly y: number; readonly durability?: number };
export type ScenarioTerrain = { readonly x: number; readonly y: number; readonly terrain: Terrain };

export type ScenarioInput = {
  readonly name?: string;
  readonly boardSize: number;
  readonly rngSeed: number;
  readonly remainingDays?: number;
  readonly factions?: Partial<Record<FactionId, ScenarioFactionCfg>>;
  readonly units?: readonly ScenarioUnit[];
  readonly houses?: readonly ScenarioHouse[];
  readonly fields?: readonly ScenarioField[];
  readonly nests?: readonly ScenarioNest[];
  readonly castles?: readonly ScenarioCastle[];
  readonly terrain?: readonly ScenarioTerrain[];
};

export type RunOptions = { readonly maxTicks: number; readonly emitEvents?: boolean };
export type RunResult = {
  readonly outcome: GameOutcome;
  readonly ticks: number;
  readonly events?: readonly GameEvent[];
};

export function buildScenarioState(input: ScenarioInput): GameState {
  const factions = defaultFactions();
  for (const id of Object.keys(input.factions ?? {}) as FactionId[]) {
    const cfg = input.factions?.[id] ?? {};
    factions[id] = makeFaction(id, {
      isPlayer: cfg.isPlayer ?? factions[id].isPlayer,
      gold: cfg.gold ?? 0,
      taxRate: cfg.taxRate ?? 0,
    }) satisfies Faction;
  }

  const provinces = new Map<string, Province>();
  const patchProvince = (x: number, y: number, patch: Partial<Province>): void => {
    const id = tileId(x, y);
    const base: Province = provinces.get(id) ?? {
      id,
      x,
      y,
      terrain: "PLAINS",
      isCastle: false,
      castleOwner: null,
    };
    provinces.set(id, { ...base, ...patch });
  };
  for (const t of input.terrain ?? []) patchProvince(t.x, t.y, { terrain: t.terrain });
  for (const c of input.castles ?? []) {
    patchProvince(c.x, c.y, { isCastle: true, castleOwner: c.owner, castleDurability: c.durability ?? 300 });
  }

  let n = 0;
  const units: Unit[] = (input.units ?? []).map((u) => ({
    id: u.id ?? `unit:${(n += 1)}`,
    owner: u.owner,
    tile: tileId(u.x, u.y),
    population: u.population,
    isMonster: u.isMonster ?? false,
    isElite: false,
    task: null,
    combatLock: null,
  }));
  const houses: House[] = (input.houses ?? []).map((h, i) => ({
    id: `house:${i + 1}`,
    owner: h.owner,
    tile: tileId(h.x, h.y),
    population: h.population,
    connectedToCastle: false,
    lastGrowthDay: 0,
    lastExpansionDay: 0,
  }));
  const fields: Field[] = (input.fields ?? []).map((f) => ({ owner: f.owner, tile: tileId(f.x, f.y) }));
  const nests: MonsterNest[] = (input.nests ?? []).map((nst, i) => ({
    id: `nest:${i + 1}`,
    tile: tileId(nst.x, nst.y),
    accumulated: nst.accumulated ?? 0,
    createdTick: 0,
    durability: 100,
  }));

  return createGameState({
    boardSize: input.boardSize,
    rngSeed: input.rngSeed,
    remainingDays: input.remainingDays ?? 3000,
    factions,
    provinces,
    units,
    houses,
    fields,
    nests,
    // start engine-generated ids past every scenario-assigned number
    nextEntityId: units.length + houses.length + nests.length + 1,
  });
}

// Run a scenario to a terminal outcome or maxTicks, optionally collecting the
// full event log (the AI Spectator stream; deterministic by seed, PRD §4.2).
export function runScenario(input: ScenarioInput, opts: RunOptions): RunResult {
  let s = buildScenarioState(input);
  const events: GameEvent[] = [];
  for (let i = 0; i < opts.maxTicks; i += 1) {
    const outcome = evaluateOutcome(s);
    if (outcome.kind !== "ongoing") {
      return opts.emitEvents ? { outcome, ticks: s.tick, events } : { outcome, ticks: s.tick };
    }
    const r = step(s);
    s = r.state;
    if (opts.emitEvents) for (const e of r.events) events.push(e);
  }
  const outcome = evaluateOutcome(s);
  return opts.emitEvents ? { outcome, ticks: s.tick, events } : { outcome, ticks: s.tick };
}
