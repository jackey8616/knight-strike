import { ev, type GameEvent, type StepResult } from "./events";
import { parseTileId, vonNeumannNeighbors } from "./state";
import { isPassable } from "./terrain";
import type { FactionId, GameState, MonsterNest, TileId, Unit } from "./types";

// PRD §4.9 / monster-system-spec §2 — nests accumulate +10 every 4 days (8
// ticks) and spawn a 100-strong monster unit at 100. Integer accumulation only.
export const NEST_INTERVAL_TICKS = 8;
export const NEST_ACCUM_AMOUNT = 10;
export const MONSTER_SPAWN_THRESHOLD = 100;
export const MONSTER_SPAWN_SIZE = 100;

function spawnTile(state: GameState, nest: MonsterNest): TileId {
  const { x, y } = parseTileId(nest.tile);
  for (const t of vonNeumannNeighbors(x, y, state.boardSize)) {
    if (isPassable(state, t)) return t;
  }
  return nest.tile;
}

export function accumulateNests(state: GameState): StepResult {
  if (state.nests.length === 0) return { state, events: [] };

  const events: GameEvent[] = [];
  const newUnits: Unit[] = [];
  let nextEntityId = state.nextEntityId;
  let changed = false;

  const nests = state.nests.map((nest) => {
    const elapsed = state.tick - nest.createdTick;
    if (elapsed <= 0 || elapsed % NEST_INTERVAL_TICKS !== 0) return nest;
    changed = true;
    let accumulated = nest.accumulated + NEST_ACCUM_AMOUNT;
    if (accumulated >= MONSTER_SPAWN_THRESHOLD) {
      const unitId = `unit:${nextEntityId}`;
      nextEntityId += 1;
      newUnits.push({
        id: unitId,
        owner: "MONSTER",
        tile: spawnTile(state, nest),
        population: MONSTER_SPAWN_SIZE,
        isMonster: true,
        isElite: false,
        task: null,
        combatLock: null,
      });
      events.push(ev.monsterSpawned(unitId, nest.id));
      accumulated -= MONSTER_SPAWN_THRESHOLD;
    }
    events.push(ev.nestAccumulated(nest.id, accumulated));
    return { ...nest, accumulated };
  });

  if (!changed) return { state, events: [] };
  return {
    state: { ...state, nests, units: [...state.units, ...newUnits], nextEntityId },
    events,
  };
}

// PRD §7.1 / monster-system-spec §4 — when a monster fells a king the outcome
// diverges from a human conquest: the victim's armies BECOME monsters, its
// houses and fields revert to bare land, its treasury vanishes. Nests are
// untouched. (Wired by victory in M10.)
export function applyMonsterKingKill(state: GameState, victim: FactionId): StepResult {
  const units: Unit[] = state.units.map((u) =>
    u.owner === victim
      ? { ...u, owner: "MONSTER" as FactionId, isMonster: true, isElite: false, combatLock: null }
      : u,
  );
  const houses = state.houses.filter((h) => h.owner !== victim);
  const fields = state.fields.filter((f) => f.owner !== victim);
  const factions = {
    ...state.factions,
    [victim]: { ...state.factions[victim], gold: 0 },
  };
  return {
    state: { ...state, units, houses, fields, factions },
    events: [ev.nationConsumedByMonster(victim)],
  };
}
