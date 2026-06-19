import { type StepResult } from "./events";
import { parseTileId, vonNeumannNeighbors } from "./state";
import { isPassable } from "./terrain";
import type { GameState, MarchOrder, TileId, Unit } from "./types";

// BFS shortest path (4-connected) over passable tiles (bridge/fence-aware via
// terrain.isPassable). Returns the full tile list including both endpoints, or
// null if unreachable.
export function findPath(state: GameState, from: TileId, to: TileId): TileId[] | null {
  if (from === to) return [from];
  if (!isPassable(state, to)) return null;

  const visited = new Set<TileId>([from]);
  const prev = new Map<TileId, TileId>();
  const queue: TileId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const { x, y } = parseTileId(cur);
    for (const nbr of vonNeumannNeighbors(x, y, state.boardSize)) {
      if (visited.has(nbr) || !isPassable(state, nbr)) continue;
      visited.add(nbr);
      prev.set(nbr, cur);
      if (nbr === to) {
        const path: TileId[] = [to];
        let p: TileId = to;
        while (p !== from) {
          p = prev.get(p) as TileId;
          path.push(p);
        }
        path.reverse();
        return path;
      }
      queue.push(nbr);
    }
  }
  return null;
}

// PRD §4.7 — order a whole unit to march to a tile. No-op if the unit is gone,
// fighting, or the target is unreachable. Replaces any existing order.
export function issueMarch(state: GameState, unitId: string, to: TileId): GameState {
  const unit = state.units.find((u) => u.id === unitId);
  if (unit === undefined || unit.combatLock !== null) return state;
  const path = findPath(state, unit.tile, to);
  if (path === null || path.length < 2) return state;
  const others = state.marchOrders.filter((o) => o.unitId !== unitId);
  return { ...state, marchOrders: [...others, { unitId, path, idx: 0 }] };
}

// PRD §4.7 — co-located friendly units that are both idle (no task / lock /
// march) merge into one army (population summed, lowest id kept). This is how a
// nation builds a big army from 100-strong house spawns; it is NOT the combat
// "no headcount merge" rule (that only forbids combining vs. an enemy).
export function mergeFriendlyUnits(state: GameState): GameState {
  const marching = new Set(state.marchOrders.map((o) => o.unitId));
  const groups = new Map<string, Unit[]>();
  for (const u of state.units) {
    const key = `${u.owner}@${u.tile}`;
    const arr = groups.get(key);
    if (arr) arr.push(u);
    else groups.set(key, [u]);
  }

  let changed = false;
  const out: Unit[] = [];
  for (const group of groups.values()) {
    const free = group.filter((u) => u.task === null && u.combatLock === null && !marching.has(u.id));
    const busy = group.filter((u) => u.task !== null || u.combatLock !== null || marching.has(u.id));
    out.push(...busy);
    if (free.length <= 1) {
      out.push(...free);
      continue;
    }
    free.sort((a, b) => (a.id < b.id ? -1 : 1));
    const base = free[0] as Unit;
    out.push({ ...base, population: free.reduce((sum, u) => sum + u.population, 0) });
    changed = true;
  }
  return changed ? { ...state, units: out } : state;
}

// PRD §4.7 — advance each marching unit one tile. A locked (fighting) unit holds
// its order; an order whose next tile is impassable or enemy-occupied is dropped
// (the unit stops and combat takes over); an order that reaches its end clears.
export function advanceMarch(state: GameState): StepResult {
  if (state.marchOrders.length === 0) return { state, events: [] };
  const byId = new Map(state.units.map((u) => [u.id, u]));
  const enemyAt = (tile: TileId, faction: string): boolean =>
    state.units.some((u) => u.tile === tile && u.owner !== faction);

  const moved = new Map<string, TileId>();
  const remaining: MarchOrder[] = [];
  for (const order of state.marchOrders) {
    const u = byId.get(order.unitId);
    if (u === undefined) continue; // unit gone → drop order
    if (u.combatLock !== null) {
      remaining.push(order); // hold while fighting
      continue;
    }
    const nextIdx = order.idx + 1;
    const nextTile = order.path[nextIdx];
    if (nextTile === undefined) continue; // already at the end → drop
    if (!isPassable(state, nextTile) || enemyAt(nextTile, u.owner)) continue; // blocked → stop
    moved.set(order.unitId, nextTile);
    if (nextIdx < order.path.length - 1) remaining.push({ ...order, idx: nextIdx });
  }

  if (moved.size === 0) {
    if (remaining.length === state.marchOrders.length) return { state, events: [] };
    return { state: { ...state, marchOrders: remaining }, events: [] };
  }
  const units: Unit[] = state.units.map((u) =>
    moved.has(u.id) ? { ...u, tile: moved.get(u.id) as TileId } : u,
  );
  return { state: { ...state, units, marchOrders: remaining }, events: [] };
}
