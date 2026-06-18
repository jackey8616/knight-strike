import { ev, type GameEvent, type StepResult } from "./events";
import { mooreNeighbors, parseTileId } from "./state";
import type { Field, FactionId, GameState, House, TileId, Unit } from "./types";

export type BuildHouseCommand = {
  readonly faction: FactionId;
  readonly tile: TileId;
};

export type BuildReason =
  | "TILE_NOT_BUILDABLE"
  | "TILE_OCCUPIED"
  | "NEIGHBOR_HAS_OWN_HOUSE"
  | "INSUFFICIENT_GOLD"
  | "NO_UNIT_ON_TILE";

export type BuildValidation = { readonly ok: true } | { readonly ok: false; readonly reason: BuildReason };

export const HOUSE_COST = 100;

function isBuildableTerrain(state: GameState, tile: TileId): boolean {
  const terrain = state.provinces.get(tile)?.terrain ?? "PLAINS";
  return terrain === "PLAINS" || terrain === "FOREST";
}

function isTileOccupied(state: GameState, tile: TileId): boolean {
  if (state.provinces.get(tile)?.isCastle === true) return true;
  return (
    state.houses.some((h) => h.tile === tile) ||
    state.fields.some((f) => f.tile === tile) ||
    state.nests.some((n) => n.tile === tile) ||
    state.buildings.some((b) => b.tile === tile)
  );
}

function ownUnitsOnTile(state: GameState, faction: FactionId, tile: TileId): Unit[] {
  return state.units.filter((u) => u.owner === faction && u.tile === tile);
}

// PRD §4.4 / house-system-spec §1. Precedence: terrain → occupied → own-house
// neighbour → gold → builder unit (so a no-gold attempt reports gold even with
// no unit on the tile, matching the spec test list).
export function validateBuild(state: GameState, cmd: BuildHouseCommand): BuildValidation {
  if (!isBuildableTerrain(state, cmd.tile)) return { ok: false, reason: "TILE_NOT_BUILDABLE" };
  if (isTileOccupied(state, cmd.tile)) return { ok: false, reason: "TILE_OCCUPIED" };

  const { x, y } = parseTileId(cmd.tile);
  const moore = new Set(mooreNeighbors(x, y, state.boardSize));
  if (state.houses.some((h) => h.owner === cmd.faction && moore.has(h.tile))) {
    return { ok: false, reason: "NEIGHBOR_HAS_OWN_HOUSE" };
  }

  if ((state.factions[cmd.faction].gold ?? 0) < HOUSE_COST) {
    return { ok: false, reason: "INSUFFICIENT_GOLD" };
  }
  if (ownUnitsOnTile(state, cmd.faction, cmd.tile).length === 0) {
    return { ok: false, reason: "NO_UNIT_ON_TILE" };
  }
  return { ok: true };
}

// PRD §4.4 — split the builder's people into the new house: ≤200 → half to the
// house; >200 → 100 to the house. The rest stays with the unit.
export function splitForHouse(unitPop: number): { readonly house: number; readonly unit: number } {
  const house = unitPop <= 200 ? Math.floor(unitPop / 2) : 100;
  return { house, unit: unitPop - house };
}

export type BuildResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly houseId: string;
      readonly events: readonly GameEvent[];
    }
  | { readonly ok: false; readonly reason: BuildReason };

export function buildHouse(state: GameState, cmd: BuildHouseCommand): BuildResult {
  const v = validateBuild(state, cmd);
  if (!v.ok) return { ok: false, reason: v.reason };

  // Builder = the largest own unit on the tile (tie → smaller id), deterministic.
  const onTile = ownUnitsOnTile(state, cmd.faction, cmd.tile);
  let builder = onTile[0] as Unit;
  for (const u of onTile) {
    if (u.population > builder.population || (u.population === builder.population && u.id < builder.id)) {
      builder = u;
    }
  }

  const split = splitForHouse(builder.population);
  const houseId = `house:${state.nextEntityId}`;
  const newHouse: House = {
    id: houseId,
    owner: cmd.faction,
    tile: cmd.tile,
    population: split.house,
    connectedToCastle: false,
    lastGrowthDay: state.day,
    lastExpansionDay: state.day,
  };

  const units = state.units.flatMap((u) => {
    if (u.id !== builder.id) return [u];
    if (split.unit <= 0) return [];
    return [{ ...u, population: split.unit }];
  });

  const faction = state.factions[cmd.faction];
  const next: GameState = {
    ...state,
    factions: {
      ...state.factions,
      [cmd.faction]: { ...faction, gold: faction.gold - HOUSE_COST },
    },
    units,
    houses: [...state.houses, newHouse],
    nextEntityId: state.nextEntityId + 1,
  };

  return {
    ok: true,
    state: next,
    houseId,
    events: [ev.houseBuilt(houseId, cmd.faction, cmd.tile)],
  };
}

export const FIELD_COST = 10;
export const SPAWN_THRESHOLD = 100;
export const SPAWN_SIZE = 100;

function occupiedTiles(state: GameState): Set<TileId> {
  const occ = new Set<TileId>();
  for (const h of state.houses) occ.add(h.tile);
  for (const f of state.fields) occ.add(f.tile);
  for (const n of state.nests) occ.add(n.tile);
  for (const b of state.buildings) occ.add(b.tile);
  for (const [id, p] of state.provinces) if (p.isCastle) occ.add(id);
  return occ;
}

// PRD §4.4 — each house turns affordable Moore-8 empty-land neighbours into its
// own fields, 10 house-people per tile, skipping while pop < 10. Houses are
// processed in order so a tile claimed by one isn't re-claimed by the next.
export function expandFields(state: GameState): StepResult {
  const events: GameEvent[] = [];
  const occupied = occupiedTiles(state);
  const newFields: Field[] = [];
  const pops = new Map(state.houses.map((h) => [h.id, h.population]));

  for (const h of state.houses) {
    let pop = pops.get(h.id) ?? 0;
    const { x, y } = parseTileId(h.tile);
    for (const nbr of mooreNeighbors(x, y, state.boardSize)) {
      if (pop < FIELD_COST) break;
      if (occupied.has(nbr)) continue;
      const terrain = state.provinces.get(nbr)?.terrain ?? "PLAINS";
      if (terrain !== "PLAINS" && terrain !== "FOREST") continue;
      occupied.add(nbr);
      newFields.push({ owner: h.owner, tile: nbr });
      pop -= FIELD_COST;
      events.push(ev.houseExpandedField(h.id, nbr));
    }
    pops.set(h.id, pop);
  }

  if (newFields.length === 0) return { state, events: [] };
  const houses = state.houses.map((h) => ({ ...h, population: pops.get(h.id) ?? h.population }));
  return { state: { ...state, houses, fields: [...state.fields, ...newFields] }, events };
}

// PRD §4.4 — a house at/over 100 people spawns one 100-person unit and loses
// 100. The unit is placed on the house tile (own territory) — it marches out
// later. Field expansion and spawning share the same house-population pool.
export function spawnFromHouses(state: GameState): StepResult {
  const events: GameEvent[] = [];
  const newUnits: Unit[] = [];
  let nextEntityId = state.nextEntityId;

  const houses = state.houses.map((h) => {
    if (h.population < SPAWN_THRESHOLD) return h;
    const unitId = `unit:${nextEntityId}`;
    nextEntityId += 1;
    newUnits.push({
      id: unitId,
      owner: h.owner,
      tile: h.tile,
      population: SPAWN_SIZE,
      isMonster: false,
      isElite: false,
      task: null,
      combatLock: null,
    });
    events.push(ev.houseSpawnedUnit(h.id, unitId));
    return { ...h, population: h.population - SPAWN_SIZE };
  });

  if (newUnits.length === 0) return { state, events: [] };
  return {
    state: { ...state, houses, units: [...state.units, ...newUnits], nextEntityId },
    events,
  };
}
