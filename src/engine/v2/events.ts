import type { FactionId, GameState, LevelEndResult, TileId } from "./types";

export type DefeatCause = "TERRITORY_LOST" | "KING_KILLED" | "TIME_OUT";

// PRD §5.2 — the cross-system AI Spectator event log. Append-only, NOT stored
// in GameState (keeps state hashable for the determinism golden-hash and avoids
// growing-array spreads in 100-game balance runs). Subsystems return their
// events; the caller (tick → runner → spectator) accumulates them.
//
// M5 only emits the time events; the rest of the union is declared up front so
// later milestones plug in factories without reshaping consumers.
export type GameEvent =
  | { readonly kind: "tick.elapsed"; readonly tick: number }
  | { readonly kind: "day.elapsed"; readonly day: number }
  | {
      readonly kind: "house.built";
      readonly houseId: string;
      readonly owner: FactionId;
      readonly tile: TileId;
    }
  | { readonly kind: "house.destroyed"; readonly houseId: string; readonly owner: FactionId }
  | { readonly kind: "house.expanded_field"; readonly houseId: string; readonly tile: TileId }
  | { readonly kind: "house.spawned_unit"; readonly houseId: string; readonly unitId: string }
  | {
      readonly kind: "connectivity.recomputed";
      readonly connected: readonly string[];
      readonly disconnected: readonly string[];
    }
  | { readonly kind: "combat.engaged"; readonly a: string; readonly b: string }
  | {
      readonly kind: "combat.damage_dealt";
      readonly unitId: string;
      readonly damage: number;
      readonly remaining: number;
    }
  | { readonly kind: "combat.unit_destroyed"; readonly unitId: string; readonly by: string | null }
  | { readonly kind: "unit.starvation"; readonly unitId: string; readonly shrunk: number }
  | {
      readonly kind: "unit.elite_changed";
      readonly faction: FactionId;
      readonly from: string | null;
      readonly to: string | null;
    }
  | { readonly kind: "construction.started"; readonly taskId: string }
  | { readonly kind: "construction.completed"; readonly taskId: string }
  | { readonly kind: "construction.aborted"; readonly taskId: string }
  | { readonly kind: "building.destroyed"; readonly buildingId: string }
  | { readonly kind: "nest.accumulated"; readonly nestId: string; readonly accumulated: number }
  | { readonly kind: "monster.spawned"; readonly unitId: string; readonly nestId: string }
  | { readonly kind: "nation.consumed_by_monster"; readonly nation: FactionId }
  | {
      readonly kind: "nation.defeated";
      readonly nation: FactionId;
      readonly cause: DefeatCause;
      readonly killer?: FactionId | "MONSTER";
    }
  | { readonly kind: "level.completed"; readonly result: LevelEndResult };

// The single return shape for step() and every per-tick subsystem (PRD §4.2 /
// §5.2). Mirrors the v1 combat `{state, events}` convention, generalized.
export type StepResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

// Factory helpers. More are added as their systems land (M6+).
export const ev = {
  tickElapsed: (tick: number): GameEvent => ({ kind: "tick.elapsed", tick }),
  dayElapsed: (day: number): GameEvent => ({ kind: "day.elapsed", day }),
  houseBuilt: (houseId: string, owner: FactionId, tile: TileId): GameEvent => ({
    kind: "house.built",
    houseId,
    owner,
    tile,
  }),
  houseExpandedField: (houseId: string, tile: TileId): GameEvent => ({
    kind: "house.expanded_field",
    houseId,
    tile,
  }),
  houseSpawnedUnit: (houseId: string, unitId: string): GameEvent => ({
    kind: "house.spawned_unit",
    houseId,
    unitId,
  }),
  connectivityRecomputed: (
    connected: readonly string[],
    disconnected: readonly string[],
  ): GameEvent => ({ kind: "connectivity.recomputed", connected, disconnected }),
  combatEngaged: (a: string, b: string): GameEvent => ({ kind: "combat.engaged", a, b }),
  combatDamageDealt: (unitId: string, damage: number, remaining: number): GameEvent => ({
    kind: "combat.damage_dealt",
    unitId,
    damage,
    remaining,
  }),
  combatUnitDestroyed: (unitId: string, by: string | null): GameEvent => ({
    kind: "combat.unit_destroyed",
    unitId,
    by,
  }),
  unitStarvation: (unitId: string, shrunk: number): GameEvent => ({
    kind: "unit.starvation",
    unitId,
    shrunk,
  }),
  unitEliteChanged: (faction: FactionId, from: string | null, to: string | null): GameEvent => ({
    kind: "unit.elite_changed",
    faction,
    from,
    to,
  }),
  houseDestroyed: (houseId: string, owner: FactionId): GameEvent => ({
    kind: "house.destroyed",
    houseId,
    owner,
  }),
  constructionStarted: (taskId: string): GameEvent => ({ kind: "construction.started", taskId }),
  constructionCompleted: (taskId: string): GameEvent => ({ kind: "construction.completed", taskId }),
  constructionAborted: (taskId: string): GameEvent => ({ kind: "construction.aborted", taskId }),
  buildingDestroyed: (buildingId: string): GameEvent => ({ kind: "building.destroyed", buildingId }),
};
