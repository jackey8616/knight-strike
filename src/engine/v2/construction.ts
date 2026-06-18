import { getTier } from "./combat-tier";
import { ev, type GameEvent, type StepResult } from "./events";
import { parseTileId, vonNeumannNeighbors } from "./state";
import type {
  Building,
  BuildingKind,
  ConstructionTask,
  DestructionTargetKind,
  FactionId,
  GameState,
  Province,
  TileId,
  Unit,
} from "./types";

// PRD §4.9 / construction-spec — costs, durations, per-tick losses, durabilities (§6).
export const BRIDGE_COST = 2000;
export const FENCE_COST = 500;
export const BRIDGE_TICKS = 2;
export const FENCE_TICKS = 5;
export const BUILD_UNIT_LOSS = 10;
export const DESTROY_UNIT_LOSS = 10;
export const CASTLE_DURABILITY = 300;
export const BUILDING_DURABILITY: Record<BuildingKind, number> = { BRIDGE: 10, FENCE: 10 };

export type BuildKind = "BRIDGE" | "FENCE";
export type ConstructCommand = {
  readonly faction: FactionId;
  readonly unitId: string;
  readonly kind: BuildKind;
  readonly tile: TileId;
};

export type ConstructReason =
  | "NO_UNIT"
  | "UNIT_BUSY"
  | "BAD_TERRAIN"
  | "TILE_OCCUPIED"
  | "NOT_ADJACENT"
  | "INSUFFICIENT_GOLD";

export type ConstructValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ConstructReason };

const costOf = (kind: BuildKind): number => (kind === "BRIDGE" ? BRIDGE_COST : FENCE_COST);
const ticksOf = (kind: BuildKind): number => (kind === "BRIDGE" ? BRIDGE_TICKS : FENCE_TICKS);

// A bridge/fence may overlay an own field (that's how a fence cuts a tax route),
// but not a house / nest / castle / another building.
function tileOccupied(state: GameState, tile: TileId): boolean {
  if (state.provinces.get(tile)?.isCastle === true) return true;
  return (
    state.houses.some((h) => h.tile === tile) ||
    state.nests.some((n) => n.tile === tile) ||
    state.buildings.some((b) => b.tile === tile)
  );
}

// PRD §4.9 — a unit builds on its own tile or a 4-adjacent one: bridges go on
// WATER/LAVA (the unit stands on the shore), fences on PLAINS/FOREST.
export function validateConstruction(state: GameState, cmd: ConstructCommand): ConstructValidation {
  const unit = state.units.find((u) => u.id === cmd.unitId && u.owner === cmd.faction);
  if (unit === undefined) return { ok: false, reason: "NO_UNIT" };
  if (unit.task !== null || unit.combatLock !== null) return { ok: false, reason: "UNIT_BUSY" };

  const { x, y } = parseTileId(unit.tile);
  const reachable = new Set<TileId>([unit.tile, ...vonNeumannNeighbors(x, y, state.boardSize)]);
  if (!reachable.has(cmd.tile)) return { ok: false, reason: "NOT_ADJACENT" };

  const terrain = state.provinces.get(cmd.tile)?.terrain ?? "PLAINS";
  const terrainOk =
    cmd.kind === "BRIDGE"
      ? terrain === "WATER" || terrain === "LAVA"
      : terrain === "PLAINS" || terrain === "FOREST";
  if (!terrainOk) return { ok: false, reason: "BAD_TERRAIN" };

  if (tileOccupied(state, cmd.tile)) return { ok: false, reason: "TILE_OCCUPIED" };
  if (state.factions[cmd.faction].gold < costOf(cmd.kind)) {
    return { ok: false, reason: "INSUFFICIENT_GOLD" };
  }
  return { ok: true };
}

export type ConstructResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly taskId: string;
      readonly events: readonly GameEvent[];
    }
  | { readonly ok: false; readonly reason: ConstructReason };

export function startConstruction(state: GameState, cmd: ConstructCommand): ConstructResult {
  const v = validateConstruction(state, cmd);
  if (!v.ok) return { ok: false, reason: v.reason };

  const taskId = `task:${state.nextEntityId}`;
  const total = ticksOf(cmd.kind);
  const task: ConstructionTask = {
    id: taskId,
    kind: cmd.kind,
    unitId: cmd.unitId,
    tile: cmd.tile,
    startTick: state.tick,
    totalTicks: total,
    ticksRemaining: total,
  };
  const faction = state.factions[cmd.faction];
  const next: GameState = {
    ...state,
    factions: {
      ...state.factions,
      [cmd.faction]: { ...faction, gold: faction.gold - costOf(cmd.kind) },
    },
    units: state.units.map((u) =>
      u.id === cmd.unitId ? { ...u, task: { kind: "construct", taskId } } : u,
    ),
    constructions: [...state.constructions, task],
    nextEntityId: state.nextEntityId + 1,
  };
  return { ok: true, state: next, taskId, events: [ev.constructionStarted(taskId)] };
}

// PRD §4.9 — advance every build: the builder loses 10/tick; reaching 0 aborts
// (unit dies, no refund, §6); the last tick completes and the building appears.
export function advanceConstruction(state: GameState): StepResult {
  if (state.constructions.length === 0) return { state, events: [] };

  const byId = new Map(state.units.map((u) => [u.id, u]));
  const events: GameEvent[] = [];
  const dead = new Set<string>();
  const updated = new Map<string, Unit>();
  const keptTasks: ConstructionTask[] = [];
  const newBuildings: Building[] = [];
  let nextEntityId = state.nextEntityId;

  for (const task of state.constructions) {
    const u = byId.get(task.unitId);
    if (u === undefined || task.kind === "HOUSE") {
      events.push(ev.constructionAborted(task.id));
      continue;
    }
    const newPop = u.population - BUILD_UNIT_LOSS;
    if (newPop <= 0) {
      dead.add(u.id);
      events.push(ev.constructionAborted(task.id));
      continue;
    }
    if (task.ticksRemaining - 1 <= 0) {
      updated.set(u.id, { ...u, population: newPop, task: null });
      const kind: BuildingKind = task.kind === "BRIDGE" ? "BRIDGE" : "FENCE";
      newBuildings.push({
        id: `building:${nextEntityId}`,
        kind,
        owner: u.owner,
        tile: task.tile,
        durability: BUILDING_DURABILITY[kind],
        maxDurability: BUILDING_DURABILITY[kind],
      });
      nextEntityId += 1;
      events.push(ev.constructionCompleted(task.id));
    } else {
      updated.set(u.id, { ...u, population: newPop });
      keptTasks.push({ ...task, ticksRemaining: task.ticksRemaining - 1 });
    }
  }

  const units = state.units.flatMap((u) => (dead.has(u.id) ? [] : [updated.get(u.id) ?? u]));
  return {
    state: {
      ...state,
      units,
      constructions: keptTasks,
      buildings: [...state.buildings, ...newBuildings],
      nextEntityId,
    },
    events,
  };
}

// --- destruction ---------------------------------------------------------

export type DestructCommand = {
  readonly faction: FactionId;
  readonly unitId: string;
  readonly targetKind: DestructionTargetKind;
  readonly targetId: string; // entity id, or tileId for FIELD/CASTLE
};

// PRD §4.9 / §6 — per-tick damage to a building: S/M floor(sqrt(pop/100)),
// L floor(sqrt(pop/10)) (L wrecks bridges/fences almost instantly).
export function destructionPower(population: number): number {
  return getTier(population) === "L"
    ? Math.floor(Math.sqrt(population / 10))
    : Math.floor(Math.sqrt(population / 100));
}

export function startDestruction(
  state: GameState,
  cmd: DestructCommand,
): { readonly ok: boolean; readonly state: GameState } {
  const unit = state.units.find((u) => u.id === cmd.unitId && u.owner === cmd.faction);
  if (unit === undefined || unit.task !== null || unit.combatLock !== null) {
    return { ok: false, state };
  }
  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((u) =>
        u.id === cmd.unitId
          ? {
              ...u,
              task: {
                kind: "destruct",
                target: { unitId: cmd.unitId, targetKind: cmd.targetKind, targetId: cmd.targetId },
              },
            }
          : u,
      ),
    },
  };
}

function castleDurability(p: Province): number {
  return p.castleDurability ?? CASTLE_DURABILITY;
}

// PRD §4.9 — each destroying unit chips its target's durability and loses 10. A
// finished target is removed (a castle hitting 0 leaves a king-down marker —
// castleDurability 0 — for M10 to act on, AC-25).
export function advanceDestruction(state: GameState): StepResult {
  const destroyers = state.units.filter((u) => u.task?.kind === "destruct");
  if (destroyers.length === 0) return { state, events: [] };

  const events: GameEvent[] = [];
  let houses = state.houses;
  let fields = state.fields;
  let buildings = state.buildings;
  let provinces = state.provinces;
  const dead = new Set<string>();
  const clearedTask = new Set<string>();

  for (const u of destroyers) {
    const task = u.task;
    if (task === undefined || task === null || task.kind !== "destruct") continue;
    const t = task.target;
    const power = destructionPower(u.population);

    let destroyed = false;
    switch (t.targetKind) {
      case "HOUSE": {
        const h = houses.find((x) => x.id === t.targetId);
        if (h !== undefined) {
          const dur = h.population - power;
          if (dur <= 0) {
            houses = houses.filter((x) => x.id !== h.id);
            events.push(ev.houseDestroyed(h.id, h.owner));
            destroyed = true;
          } else {
            houses = houses.map((x) => (x.id === h.id ? { ...x, population: dur } : x));
          }
        } else destroyed = true;
        break;
      }
      case "FIELD": {
        if (power > 0) {
          const before = fields.length;
          fields = fields.filter((x) => x.tile !== t.targetId);
          if (fields.length !== before) events.push(ev.buildingDestroyed(`field:${t.targetId}`));
          destroyed = true;
        }
        break;
      }
      case "BRIDGE":
      case "FENCE": {
        const b = buildings.find((x) => x.id === t.targetId);
        if (b !== undefined) {
          const dur = b.durability - power;
          if (dur <= 0) {
            buildings = buildings.filter((x) => x.id !== b.id);
            events.push(ev.buildingDestroyed(b.id));
            destroyed = true;
          } else {
            buildings = buildings.map((x) => (x.id === b.id ? { ...x, durability: dur } : x));
          }
        } else destroyed = true;
        break;
      }
      case "CASTLE": {
        const p = provinces.get(t.targetId);
        if (p !== undefined && p.isCastle) {
          const dur = castleDurability(p) - power;
          const nextProv = new Map(provinces);
          if (dur <= 0) {
            nextProv.set(t.targetId, { ...p, castleDurability: 0 });
            events.push(ev.buildingDestroyed(t.targetId));
            destroyed = true;
          } else {
            nextProv.set(t.targetId, { ...p, castleDurability: dur });
          }
          provinces = nextProv;
        } else destroyed = true;
        break;
      }
      case "NEST":
        destroyed = true; // monster nests arrive in M9
        break;
    }

    if (u.population - DESTROY_UNIT_LOSS <= 0) dead.add(u.id);
    else if (destroyed) clearedTask.add(u.id);
  }

  const units = state.units.flatMap((u) => {
    if (dead.has(u.id)) return [];
    if (u.task?.kind === "destruct") {
      const np = u.population - DESTROY_UNIT_LOSS;
      const task = clearedTask.has(u.id) ? null : u.task;
      return [{ ...u, population: np, task }];
    }
    return [u];
  });

  return { state: { ...state, units, houses, fields, buildings, provinces }, events };
}
