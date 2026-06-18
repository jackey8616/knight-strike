import { ev, type GameEvent, type StepResult } from "./events";
import { parseTileId, vonNeumannNeighbors } from "./state";
import type { FactionId, GameState, TileId } from "./types";

// PRD §4.5 / house-system-spec §3.2 — a house pays tax only if it reaches its
// own castle along a path of own field/house tiles that crosses no fence. We
// BFS (4-connected) out from each castle over that faction's own field+house
// tiles; every own house tile reached is "connected". Disconnected houses are
// taxed at 0 (they grow fastest, §4.4).
//
// Caller gates this behind a dirty flag (territory / fence / castle change);
// the function itself is idempotent and only emits an event when the connected
// set actually changes (the before/after diff).
export function computeConnectivity(state: GameState): StepResult {
  const castleTile = new Map<FactionId, TileId>();
  for (const [id, p] of state.provinces) {
    if (p.isCastle && p.castleOwner !== null) castleTile.set(p.castleOwner, id);
  }

  const ownTiles = new Map<FactionId, Set<TileId>>();
  const addOwn = (f: FactionId, t: TileId): void => {
    let set = ownTiles.get(f);
    if (set === undefined) {
      set = new Set<TileId>();
      ownTiles.set(f, set);
    }
    set.add(t);
  };
  for (const f of state.fields) addOwn(f.owner, f.tile);
  for (const h of state.houses) addOwn(h.owner, h.tile);

  const fenceTiles = new Set<TileId>();
  for (const b of state.buildings) if (b.kind === "FENCE") fenceTiles.add(b.tile);

  const connected = new Set<string>(); // house ids
  const factions = new Set<FactionId>(state.houses.map((h) => h.owner));
  for (const faction of factions) {
    const start = castleTile.get(faction);
    if (start === undefined) continue; // no castle → all this faction's houses disconnected
    const own = ownTiles.get(faction) ?? new Set<TileId>();

    const visited = new Set<TileId>([start]);
    const queue: TileId[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      const { x, y } = parseTileId(cur);
      for (const nbr of vonNeumannNeighbors(x, y, state.boardSize)) {
        if (visited.has(nbr) || fenceTiles.has(nbr) || !own.has(nbr)) continue;
        visited.add(nbr);
        queue.push(nbr);
      }
    }
    for (const h of state.houses) {
      if (h.owner === faction && visited.has(h.tile)) connected.add(h.id);
    }
  }

  let flagsChanged = false;
  const houses = state.houses.map((h) => {
    const isConn = connected.has(h.id);
    if (isConn === h.connectedToCastle) return h;
    flagsChanged = true;
    return { ...h, connectedToCastle: isConn };
  });

  const setChanged =
    connected.size !== state.connectivity.size ||
    [...connected].some((id) => !state.connectivity.has(id));

  if (!setChanged && !flagsChanged) return { state, events: [] };

  const events: GameEvent[] = [];
  if (setChanged) {
    const connectedIds = [...connected].sort();
    const disconnectedIds = state.houses
      .map((h) => h.id)
      .filter((id) => !connected.has(id))
      .sort();
    events.push(ev.connectivityRecomputed(connectedIds, disconnectedIds));
  }

  return { state: { ...state, houses, connectivity: connected }, events };
}
