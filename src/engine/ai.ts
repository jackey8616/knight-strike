import { tilePower } from "./combat";
import {
  dispatch,
  findPath,
  type DispatchRatio,
} from "./movement";
import { parseTileId, tileId } from "./state";
import type { FactionId, GameState, Province, TileId } from "./types";
import { createRng, type Rng } from "./util/rng";
import { NON_NEUTRAL_FACTIONS } from "./victory";

export const AI_EVAL_INTERVAL = 5;

// PRD §4.3 staggered offsets: Tokugawa tick 1, Takeda 2, Oda 3, Uesugi 4.
const FACTION_OFFSETS: Readonly<Record<Exclude<FactionId, "NEUTRAL">, number>> = {
  TOKUGAWA: 1,
  TAKEDA: 2,
  ODA: 3,
  UESUGI: 4,
};

export function shouldEvaluate(faction: FactionId, tick: number): boolean {
  if (faction === "NEUTRAL") return false;
  const offset = FACTION_OFFSETS[faction];
  if (tick < offset) return false;
  return (tick - offset) % AI_EVAL_INTERVAL === 0;
}

// Distinct per-faction salts so mixSeed never collides across factions when
// rngSeed and tick line up — keeps PRD §4.2 determinism without aliasing.
const FACTION_SEED_KEY: Readonly<Record<FactionId, number>> = {
  TOKUGAWA: 0x1d4e1bd1,
  TAKEDA: 0x2b1a3f4e,
  ODA: 0x3c9d5e7f,
  UESUGI: 0x4e0f7a2b,
  NEUTRAL: 0,
};

function mixSeed(rngSeed: number, faction: FactionId, tick: number): number {
  let h = ((rngSeed >>> 0) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ FACTION_SEED_KEY[faction], 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (tick | 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function shuffleInPlace<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i] as T;
    const b = arr[j] as T;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function neighborsOf(state: GameState, id: TileId): Province[] {
  const { x, y } = parseTileId(id);
  const list: Province[] = [];
  for (const offset of NEIGHBOR_OFFSETS) {
    const dx = offset[0] as number;
    const dy = offset[1] as number;
    const np = state.provinces.get(tileId(x + dx, y + dy));
    if (np !== undefined) list.push(np);
  }
  return list;
}

function manhattan(a: TileId, b: TileId): number {
  const pa = parseTileId(a);
  const pb = parseTileId(b);
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
}

function findOwnCastle(state: GameState, faction: FactionId): Province | undefined {
  for (const p of state.provinces.values()) {
    if (p.isCastle && p.owner === faction) return p;
  }
  return undefined;
}

function findOwnTiles(state: GameState, faction: FactionId): Province[] {
  const out: Province[] = [];
  for (const p of state.provinces.values()) {
    if (p.owner === faction) out.push(p);
  }
  return out;
}

function liveEnemyCastles(state: GameState, faction: FactionId): Province[] {
  const out: Province[] = [];
  for (const p of state.provinces.values()) {
    if (!p.isCastle) continue;
    if (p.owner === faction) continue;
    if (p.owner === "NEUTRAL") continue;
    if (state.defeated.has(p.owner)) continue;
    out.push(p);
  }
  return out;
}

// PRD §4.1 rule #1: any non-self tile with count > 0 within manhattan 2 of the
// castle counts as a threat — covers enemy garrisons and NEUTRAL bandits.
function castleThreatened(
  state: GameState,
  faction: FactionId,
  castle: Province,
): boolean {
  for (const p of state.provinces.values()) {
    if (p.owner === faction) continue;
    if (p.count <= 0) continue;
    if (manhattan(castle.id, p.id) <= 2) return true;
  }
  return false;
}

function tryDefense(
  state: GameState,
  faction: FactionId,
  rng: Rng,
): GameState | null {
  const castle = findOwnCastle(state, faction);
  if (castle === undefined) return null;
  if (!castleThreatened(state, faction, castle)) return null;

  type Cand = { readonly source: Province; readonly dist: number };
  const candidates: Cand[] = [];
  for (const own of findOwnTiles(state, faction)) {
    if (own.isCastle) continue;
    if (own.count <= 0) continue;
    const path = findPath(state, own.id, castle.id, faction);
    if (path === null) continue;
    candidates.push({ source: own, dist: path.length - 1 });
  }
  if (candidates.length === 0) return null;

  let minDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) if (c.dist < minDist) minDist = c.dist;
  const closest = candidates.filter((c) => c.dist === minDist);
  shuffleInPlace(rng, closest);

  for (const cand of closest) {
    const res = dispatch(state, {
      from: cand.source.id,
      to: castle.id,
      ratio: 0.5 as DispatchRatio,
    });
    if (res.ok) return res.state;
  }
  return null;
}

const EXPAND_MIN_STACK = 5;

function tryExpand(
  state: GameState,
  faction: FactionId,
  rng: Rng,
): GameState | null {
  type Pair = { readonly source: Province; readonly target: Province };
  const pairs: Pair[] = [];
  for (const own of findOwnTiles(state, faction)) {
    if (own.count < EXPAND_MIN_STACK) continue;
    if (own.isCastle && own.count <= 1) continue;
    for (const nb of neighborsOf(state, own.id)) {
      if (nb.owner === faction) continue;
      if (nb.count !== 0) continue;
      pairs.push({ source: own, target: nb });
    }
  }
  if (pairs.length === 0) return null;
  shuffleInPlace(rng, pairs);
  for (const pair of pairs) {
    const res = dispatch(state, {
      from: pair.source.id,
      to: pair.target.id,
      ratio: 0.5 as DispatchRatio,
    });
    if (res.ok) return res.state;
  }
  return null;
}

const ATTACK_RANGE_HOPS = 4;
const ATTACK_POWER_RATIO = 1.5;

function tryAttack(
  state: GameState,
  faction: FactionId,
  rng: Rng,
): GameState | null {
  const targets = liveEnemyCastles(state, faction);
  if (targets.length === 0) return null;

  type Pair = { readonly source: Province; readonly target: Province };
  const pairs: Pair[] = [];
  for (const own of findOwnTiles(state, faction)) {
    if (own.count <= 1) continue;
    const effectiveCount = own.isCastle ? own.count - 1 : own.count;
    if (effectiveCount <= 0) continue;
    const ownPower = tilePower(effectiveCount);
    for (const target of targets) {
      if (ownPower < tilePower(target.count) * ATTACK_POWER_RATIO) continue;
      const path = findPath(state, own.id, target.id, faction);
      if (path === null) continue;
      if (path.length - 1 > ATTACK_RANGE_HOPS) continue;
      pairs.push({ source: own, target });
    }
  }
  if (pairs.length === 0) return null;
  shuffleInPlace(rng, pairs);
  for (const pair of pairs) {
    const res = dispatch(state, {
      from: pair.source.id,
      to: pair.target.id,
      ratio: 1.0 as DispatchRatio,
    });
    if (res.ok) return res.state;
  }
  return null;
}

function evaluateFaction(state: GameState, faction: FactionId): GameState {
  const rng = createRng(mixSeed(state.rngSeed, faction, state.tick));
  const r1 = tryDefense(state, faction, rng);
  if (r1 !== null) return r1;
  const r2 = tryExpand(state, faction, rng);
  if (r2 !== null) return r2;
  const r3 = tryAttack(state, faction, rng);
  if (r3 !== null) return r3;
  return state;
}

export function stepAi(state: GameState): GameState {
  let s = state;
  for (const faction of NON_NEUTRAL_FACTIONS) {
    if (s.defeated.has(faction)) continue;
    if (s.aiConfig[faction] !== "default") continue;
    if (!shouldEvaluate(faction, s.tick)) continue;
    s = evaluateFaction(s, faction);
  }
  return s;
}
