import { parseTileId, tileId } from "./state";
import type {
  FactionId,
  GameState,
  MarchingStack,
  Province,
  TileId,
} from "./types";
import { createRng } from "./util/rng";

export const CASTLE_OVERFLOW_THRESHOLD = 30;
export const CASTLE_OVERFLOW_MAX_PER_TICK = 2;

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Distinct salt so an RNG tiebreak in the overflow phase can never align with
// the claim phase (CLAIM_SALT) or AI mixSeed for the same (rngSeed, tick).
const OVERFLOW_SALT = 0x7c3b9aa5;

function mixOverflowSeed(rngSeed: number, tick: number, id: TileId): number {
  let h = ((rngSeed >>> 0) ^ OVERFLOW_SALT) >>> 0;
  h = Math.imul(h ^ (tick | 0), 0x85ebca6b) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0xc2b2ae35) >>> 0;
  }
  h ^= h >>> 16;
  return h >>> 0;
}

// PRD §3.5.2 passable rule for the overflow BFS path: own faction OR empty
// neutral. Target tile is exempt (resolved separately via reconstructPath).
function isPassableIntermediate(
  p: Province | undefined,
  faction: FactionId,
): boolean {
  if (p === undefined) return false;
  if (p.owner === faction) return true;
  return p.owner === "NEUTRAL" && p.count === 0;
}

function hasNonOwnNeighbour(state: GameState, p: Province): boolean {
  const { x, y } = parseTileId(p.id);
  for (const offset of NEIGHBOR_OFFSETS) {
    const dx = offset[0] as number;
    const dy = offset[1] as number;
    const np = state.provinces.get(tileId(x + dx, y + dy));
    if (np === undefined) continue;
    if (np.owner !== p.owner) return true;
  }
  return false;
}

type BfsResult = {
  readonly distances: Map<TileId, number>;
  readonly parent: Map<TileId, TileId>;
};

function bfsFromCastle(state: GameState, castle: Province): BfsResult {
  const faction = castle.owner;
  const distances = new Map<TileId, number>();
  const parent = new Map<TileId, TileId>();
  const queue: TileId[] = [castle.id];
  distances.set(castle.id, 0);
  while (queue.length > 0) {
    const cur = queue.shift() as TileId;
    const curDist = distances.get(cur) as number;
    const { x, y } = parseTileId(cur);
    for (const offset of NEIGHBOR_OFFSETS) {
      const dx = offset[0] as number;
      const dy = offset[1] as number;
      const nid = tileId(x + dx, y + dy);
      if (distances.has(nid)) continue;
      const np = state.provinces.get(nid);
      if (np === undefined) continue;
      distances.set(nid, curDist + 1);
      parent.set(nid, cur);
      if (isPassableIntermediate(np, faction)) {
        queue.push(nid);
      }
    }
  }
  return { distances, parent };
}

function reconstructPath(
  parent: Map<TileId, TileId>,
  from: TileId,
  to: TileId,
): readonly TileId[] | null {
  const path: TileId[] = [to];
  let cur: TileId = to;
  while (cur !== from) {
    const par = parent.get(cur);
    if (par === undefined) return null;
    path.push(par);
    cur = par;
  }
  path.reverse();
  return path;
}

// PRD §3.5.5 target selection: nearest frontline own tile (own + ≥ 1 non-own
// neighbour); castle itself excluded. Returns the chosen tile id and a valid
// BFS path from the castle. null when no candidate exists.
function pickOverflowTarget(
  state: GameState,
  castle: Province,
): { readonly path: readonly TileId[]; readonly target: TileId } | null {
  const { distances, parent } = bfsFromCastle(state, castle);
  type Cand = { readonly id: TileId; readonly dist: number };
  const frontline: Cand[] = [];
  for (const [id, dist] of distances) {
    if (id === castle.id) continue;
    const p = state.provinces.get(id);
    if (p === undefined) continue;
    if (p.owner !== castle.owner) continue;
    if (!hasNonOwnNeighbour(state, p)) continue;
    frontline.push({ id, dist });
  }
  if (frontline.length === 0) return null;

  let minDist = Number.POSITIVE_INFINITY;
  for (const c of frontline) if (c.dist < minDist) minDist = c.dist;
  const closestIds = frontline
    .filter((c) => c.dist === minDist)
    .map((c) => c.id)
    .sort();

  let chosen: TileId;
  if (closestIds.length === 1) {
    chosen = closestIds[0] as TileId;
  } else {
    // PRD §3.5.5: tiebreak via §4.2 same RNG family seeded on
    // (rngSeed, tick, castle.id). Sort first so the shuffle input order is
    // input-independent — keeps determinism even if Map iteration order changes.
    const rng = createRng(mixOverflowSeed(state.rngSeed, state.tick, castle.id));
    for (let i = closestIds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const a = closestIds[i] as TileId;
      const b = closestIds[j] as TileId;
      closestIds[i] = b;
      closestIds[j] = a;
    }
    chosen = closestIds[0] as TileId;
  }

  const path = reconstructPath(parent, castle.id, chosen);
  if (path === null || path.length < 2) return null;
  return { path, target: chosen };
}

export type CastleOverflowResult = {
  readonly newMarchingStacks: readonly MarchingStack[];
  readonly castleCountChanges: ReadonlyMap<TileId, number>;
};

// PRD §3.5.5 pure planner: returns the marching stacks to add + the new count
// on each affected castle, without mutating state. Use applyCastleOverflow for
// the state-returning variant the tick orchestrator wires in.
export function castleOverflow(state: GameState): CastleOverflowResult {
  const newMarchingStacks: MarchingStack[] = [];
  const castleCountChanges = new Map<TileId, number>();
  let nextId = state.nextMarchingId;

  const castles: Province[] = [];
  for (const p of state.provinces.values()) {
    if (!p.isCastle) continue;
    if (p.owner === "NEUTRAL") continue;
    if (state.defeated.has(p.owner)) continue;
    if (p.count <= CASTLE_OVERFLOW_THRESHOLD) continue;
    castles.push(p);
  }
  // Stable order keeps mstack id assignment deterministic regardless of
  // provinces Map insertion order.
  castles.sort((a, b) => (a.id < b.id ? -1 : 1));

  for (const castle of castles) {
    const overflow = Math.min(
      CASTLE_OVERFLOW_MAX_PER_TICK,
      castle.count - CASTLE_OVERFLOW_THRESHOLD,
    );
    if (overflow <= 0) continue;
    const pick = pickOverflowTarget(state, castle);
    if (pick === null) continue;
    newMarchingStacks.push({
      id: `mstack:${nextId}`,
      faction: castle.owner,
      count: overflow,
      path: pick.path,
      idx: 0,
      dispatchedAtTick: state.tick,
    });
    nextId++;
    castleCountChanges.set(castle.id, castle.count - overflow);
  }

  return { newMarchingStacks, castleCountChanges };
}

export function applyCastleOverflow(state: GameState): GameState {
  const { newMarchingStacks, castleCountChanges } = castleOverflow(state);
  if (newMarchingStacks.length === 0) return state;
  const newProvinces = new Map<TileId, Province>(state.provinces);
  for (const [id, newCount] of castleCountChanges) {
    const p = newProvinces.get(id);
    if (p === undefined) continue;
    newProvinces.set(id, { ...p, count: newCount });
  }
  return {
    ...state,
    provinces: newProvinces,
    marchingStacks: [...state.marchingStacks, ...newMarchingStacks],
    nextMarchingId: state.nextMarchingId + newMarchingStacks.length,
  };
}
