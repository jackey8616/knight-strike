import { RULE_PROFILES, type RuleProfile } from "./ai-profile";
import { dispatch } from "./movement";
import {
  derivedOwner,
  findOccupant,
  hasHostileOccupant,
  isOwnClaimed,
  parseTileId,
  tileId,
  totalAmount,
} from "./state";
import { isImpassableTerrain } from "./terrain";
import type { FactionId, GameState, Province, TileId } from "./types";
import { KING_THRESHOLD, KNIGHT_THRESHOLD, QUEEN_THRESHOLD } from "./upgrade";
import { createRng, type Rng } from "./util/rng";
import { NON_NEUTRAL_FACTIONS } from "./victory";

// Rule-tier AI, spec archived at git tag `archive/prd-v0.12` §4 (the AI design
// was moved out of the live PRD in v1.0). Ported onto the v1.2/v1.3
// multi-occupant schema, where the v1.1 fields the old AI relied on no longer
// exist. Schema translation:
//   - "tile owned by f" → derivedOwner(p) === f (single own occupant, or an
//     empty tile this faction last walked through).
//   - "f's troop count on a tile" → that occupant's amount (ownAmount).
//   - tilePower(count) → raw count: §3.6 combat is now a count-only ramp, so
//     "power" collapses to the stack size.
// stepAi only acts for factions whose aiConfig is a "rule" mode; idle /
// scripted factions are driven elsewhere, so the engine pipeline (tick.ts /
// runner.ts) can keep calling stepAi unconditionally.

export const AI_EVAL_INTERVAL = RULE_PROFILES.normal.evalInterval;

// §4.3 staggered offsets: Tokugawa tick 1, Takeda 2, Oda 3, Uesugi 4 — so the
// four factions never collide on the same evaluation tick at a shared interval.
const FACTION_OFFSETS: Readonly<Record<Exclude<FactionId, "NEUTRAL">, number>> =
  {
    TOKUGAWA: 1,
    TAKEDA: 2,
    ODA: 3,
    UESUGI: 4,
  };

export function shouldEvaluate(
  faction: FactionId,
  tick: number,
  evalInterval: number = AI_EVAL_INTERVAL,
): boolean {
  if (faction === "NEUTRAL") return false;
  const offset = FACTION_OFFSETS[faction];
  if (tick < offset) return false;
  return (tick - offset) % evalInterval === 0;
}

// Distinct per-faction salts so mixSeed never collides across factions when
// rngSeed and tick line up — keeps §4.2 determinism without aliasing.
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

// Single BFS from `source`, returning the shortest hop-distance to every
// reachable tile while only routing through tiles that pass `canTraverse`.
// findPath is an undirected BFS over the same graph, so for any tile `t`,
// dist.get(t) here equals findPath(t → source).length - 1. The AI previously
// called findPath once per (source, target) pair; reading all distances from
// ONE BFS turns that O(targets × ownTiles × board) blowup — the cause of the
// multi-second freeze on AI-evaluation ticks once a faction owns many tiles —
// into O(targets × board). A tile is recorded the moment it's discovered
// (matching findPath's visited set) but only expanded when traversable, so a
// non-traversable tile is a reachable endpoint that's never routed through.
function bfsDistances(
  state: GameState,
  source: TileId,
  canTraverse: (np: Province) => boolean,
): Map<TileId, number> {
  const dist = new Map<TileId, number>([[source, 0]]);
  const queue: TileId[] = [source];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++] as TileId;
    const cd = dist.get(cur) as number;
    const { x, y } = parseTileId(cur);
    for (const offset of NEIGHBOR_OFFSETS) {
      const nid = tileId(x + (offset[0] as number), y + (offset[1] as number));
      if (dist.has(nid)) continue;
      const np = state.provinces.get(nid);
      if (np === undefined) continue;
      dist.set(nid, cd + 1);
      if (canTraverse(np)) queue.push(nid);
    }
  }
  return dist;
}

function manhattan(a: TileId, b: TileId): number {
  const pa = parseTileId(a);
  const pb = parseTileId(b);
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
}

function ownAmount(province: Province, faction: FactionId): number {
  const o = findOccupant(province, faction);
  return o === undefined ? 0 : o.amount;
}

// The faction's home castle, even when contested. Defense must still recognise
// and reinforce a castle an enemy has stepped onto (derivedOwner would read
// null there), so this keys on the stable castleOwner plus "we still have an
// occupant on it" rather than on derivedOwner.
function findOwnCastle(
  state: GameState,
  faction: FactionId,
): Province | undefined {
  for (const p of state.provinces.values()) {
    if (!p.isCastle) continue;
    if (p.castleOwner !== faction) continue;
    if (findOccupant(p, faction) === undefined) continue;
    return p;
  }
  return undefined;
}

function findOwnTiles(state: GameState, faction: FactionId): Province[] {
  const out: Province[] = [];
  for (const p of state.provinces.values()) {
    if (derivedOwner(p) === faction) out.push(p);
  }
  return out;
}

function liveEnemyCastles(state: GameState, faction: FactionId): Province[] {
  const out: Province[] = [];
  for (const p of state.provinces.values()) {
    if (!p.isCastle) continue;
    if (p.castleOwner === null) continue;
    if (p.castleOwner === faction) continue;
    if (p.castleOwner === "NEUTRAL") continue;
    if (state.defeated.has(p.castleOwner)) continue;
    out.push(p);
  }
  return out;
}

// §4.1 rule #1: any tile within `defenseRadius` manhattan of the castle that
// holds a hostile occupant (enemy garrison or NEUTRAL bandit) counts as a
// threat. manhattan 0 is included, so an enemy standing on the castle itself
// (contested) is detected too.
function castleThreatened(
  state: GameState,
  faction: FactionId,
  castle: Province,
  defenseRadius: number,
): boolean {
  for (const p of state.provinces.values()) {
    if (!hasHostileOccupant(p, faction)) continue;
    if (manhattan(castle.id, p.id) <= defenseRadius) return true;
  }
  return false;
}

function tryDefense(
  state: GameState,
  faction: FactionId,
  rng: Rng,
  profile: RuleProfile,
): GameState | null {
  const castle = findOwnCastle(state, faction);
  if (castle === undefined) return null;
  if (!castleThreatened(state, faction, castle, profile.defenseRadius)) {
    return null;
  }

  // §3.5.2: a defense march reinforces an own tile, so the route stays on own
  // claim — one BFS from the castle over own-claimed tiles yields every source's
  // distance (== findPath(source → castle).length - 1).
  const dist = bfsDistances(state, castle.id, (np) => isOwnClaimed(np, faction));
  type Cand = { readonly source: Province; readonly dist: number };
  const candidates: Cand[] = [];
  for (const own of findOwnTiles(state, faction)) {
    if (own.isCastle) continue;
    if (ownAmount(own, faction) <= 0) continue;
    const d = dist.get(own.id);
    if (d === undefined) continue;
    candidates.push({ source: own, dist: d });
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
      ratio: 0.5,
    });
    if (res.ok) return res.state;
  }
  return null;
}

const EXPAND_MIN_STACK = KNIGHT_THRESHOLD;
const KNIGHT_RESERVE = KNIGHT_THRESHOLD;
const QUEEN_RESERVE = QUEEN_THRESHOLD;

// §4.1 rule #2: count to dispatch from `source`, or null when the source is
// ineligible (tier-protection or insufficient surplus). The castle reserve
// gating keeps a castle from being drained below the next tier floor — Soldier
// and King bands stay static, only the Queen band scales with the profile.
function expandSendCount(
  source: Province,
  faction: FactionId,
  profile: RuleProfile,
): number | null {
  const c = ownAmount(source, faction);
  if (!source.isCastle) {
    if (c < EXPAND_MIN_STACK) return null;
    return Math.max(1, Math.floor(c * profile.expandRatio));
  }
  if (c < KNIGHT_RESERVE) return null;
  if (c < QUEEN_RESERVE) {
    const send = Math.min(Math.floor(c * 0.25), c - KNIGHT_RESERVE);
    return send >= 1 ? send : null;
  }
  if (c < KING_THRESHOLD) {
    const send = Math.min(
      Math.floor(c * profile.castleQueenSendRatio),
      c - QUEEN_RESERVE,
    );
    return send >= 1 ? send : null;
  }
  return Math.max(1, Math.floor(c * 0.5));
}

// §4.1 rule #2: source = any own tile passing expandSendCount; target = any
// empty tile adjacent to own territory. Source need not neighbour the target —
// a BFS path through the own corridor is enough.
function tryExpand(
  state: GameState,
  faction: FactionId,
  rng: Rng,
  profile: RuleProfile,
): GameState | null {
  const ownTiles = findOwnTiles(state, faction);
  type Source = { readonly tile: Province; readonly sendCount: number };
  const sources: Source[] = [];
  for (const own of ownTiles) {
    const send = expandSendCount(own, faction, profile);
    if (send === null) continue;
    sources.push({ tile: own, sendCount: send });
  }
  if (sources.length === 0) return null;

  const targetIds = new Set<TileId>();
  const targets: Province[] = [];
  for (const own of ownTiles) {
    for (const nb of neighborsOf(state, own.id)) {
      if (derivedOwner(nb) === faction) continue;
      if (totalAmount(nb) !== 0) continue;
      if (targetIds.has(nb.id)) continue;
      targetIds.add(nb.id);
      targets.push(nb);
    }
  }
  if (targets.length === 0) return null;

  type Pair = { readonly source: Source; readonly target: Province };
  const pairs: Pair[] = [];
  for (const source of sources) {
    for (const target of targets) {
      pairs.push({ source, target });
    }
  }
  // Directional expand (§5.2): shuffle first so equal-distance targets keep
  // seed-driven variety, then bias the frontier toward the nearest enemy castle
  // (stable sort) so territory pushes at the enemy instead of blobbing outward.
  // No live enemy castle → pure shuffle (explore).
  const enemyCastles = liveEnemyCastles(state, faction);
  shuffleInPlace(rng, pairs);
  if (enemyCastles.length > 0) {
    pairs.sort(
      (a, b) =>
        nearestEnemyCastleDist(a.target.id, enemyCastles) -
        nearestEnemyCastleDist(b.target.id, enemyCastles),
    );
  }
  for (const pair of pairs) {
    const res = dispatch(state, {
      from: pair.source.tile.id,
      to: pair.target.id,
      ratio: 0.5,
      forceCount: pair.source.sendCount,
    });
    if (res.ok) return res.state;
  }
  return null;
}

// §4.1 rule #2.5 (rally): pick the strongest non-castle frontline tile, then
// ship 50% (capped at count-1) from every adjacent own non-castle tile toward
// it. Castle excluded as a source to preserve rule #2's castle-tier reserve.
function tryRally(
  state: GameState,
  faction: FactionId,
  rng: Rng,
  profile: RuleProfile,
): GameState | null {
  if (!profile.rallyEnabled) return null;
  const anchorCandidates: Province[] = [];
  for (const p of state.provinces.values()) {
    if (derivedOwner(p) !== faction) continue;
    if (p.isCastle) continue;
    let hasNonOwnNeighbour = false;
    for (const nb of neighborsOf(state, p.id)) {
      if (derivedOwner(nb) !== faction) {
        hasNonOwnNeighbour = true;
        break;
      }
    }
    if (!hasNonOwnNeighbour) continue;
    anchorCandidates.push(p);
  }
  if (anchorCandidates.length === 0) return null;

  let maxCount = -1;
  for (const c of anchorCandidates) {
    const a = ownAmount(c, faction);
    if (a > maxCount) maxCount = a;
  }
  const topAnchors = anchorCandidates
    .filter((c) => ownAmount(c, faction) === maxCount)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  shuffleInPlace(rng, topAnchors);
  const anchor = topAnchors[0] as Province;

  type Source = { readonly tile: Province; readonly sendCount: number };
  const sources: Source[] = [];
  for (const nb of neighborsOf(state, anchor.id)) {
    if (derivedOwner(nb) !== faction) continue;
    if (nb.isCastle) continue;
    const c = ownAmount(nb, faction);
    const sendCount = Math.min(Math.floor(c * 0.5), c - 1);
    if (sendCount <= 0) continue;
    sources.push({ tile: nb, sendCount });
  }
  if (sources.length === 0) return null;

  // Deterministic source ordering for mstack id assignment regardless of
  // neighborsOf iteration order.
  sources.sort((a, b) => (a.tile.id < b.tile.id ? -1 : 1));

  let s = state;
  let dispatchedAny = false;
  for (const src of sources) {
    const res = dispatch(s, {
      from: src.tile.id,
      to: anchor.id,
      ratio: 0.5,
      forceCount: src.sendCount,
    });
    if (res.ok) {
      s = res.state;
      dispatchedAny = true;
    }
  }
  return dispatchedAny ? s : null;
}

const ASSAULT_MIN_SOURCE = KNIGHT_THRESHOLD;

function nearestEnemyCastleDist(
  id: TileId,
  enemyCastles: readonly Province[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const c of enemyCastles) {
    const d = manhattan(id, c.id);
    if (d < best) best = d;
  }
  return best;
}

// §4.1 rule #3 (v1.3 assault rewrite): the offensive. The old single-tile gate
// (count - 1 ≥ defender × ratio) was unreachable — tiles cap at PRODUCTION_CAP
// (100) yet a healthy castle self-replicates to ~100, so ratio 1.5 × 100 = 150
// can never be met by one tile. Worse, an enemy castle deep in enemy land is
// unroutable: findPath (§3.5.2) walks through empty / own tiles but treats any
// hostile occupant as a wall, so the only hostile tiles a faction can reach are
// its own frontier. Both together meant the AI never attacked anything and
// every game stalemated.
//
// Fix: pick a reachable hostile *boundary* tile and converge MULTIPLE source
// tiles' surplus on it. Power is raw count (§3.6 count-only). A contested tile
// stops self-replicating (§3.3) and the AI only defends tiles near its castle,
// so undefended frontier tiles fall to enough aggregate force; same-faction
// stacks merge on arrival (§3.5.4). Targets are ranked: capture an enemy castle
// outright if one is reachable, else push the frontier tile closest to an enemy
// castle so the advance heads toward a win condition. Deterministic (no RNG) →
// §4.2 determinism holds. Each striker keeps 1 troop home (§3.5.1).
function tryAssault(
  state: GameState,
  faction: FactionId,
  profile: RuleProfile,
): GameState | null {
  const enemyCastles = liveEnemyCastles(state, faction);
  if (enemyCastles.length === 0) return null;

  const ownTiles = findOwnTiles(state, faction);
  if (ownTiles.length === 0) return null;
  // §5.3 attackReach: scan enemies within a board-relative hop budget.
  const maxReach = Math.round(state.boardSize * profile.attackReach);

  type Src = { readonly tile: Province; readonly send: number };
  type Cand = {
    readonly target: Province;
    readonly srcs: readonly Src[];
    readonly defender: number;
    readonly isEnemyCastle: boolean;
    readonly castleDist: number;
  };
  const cands: Cand[] = [];

  for (const target of state.provinces.values()) {
    if (!hasHostileOccupant(target, faction)) continue;
    // Boundary check: a hostile tile fully ringed by other hostile tiles is
    // unreachable (findPath can't cross them); skip the cheap-rejectable ones
    // before paying for BFS.
    let approachable = false;
    for (const nb of neighborsOf(state, target.id)) {
      if (!hasHostileOccupant(nb, faction)) {
        approachable = true;
        break;
      }
    }
    if (!approachable) continue;

    const defender = totalAmount(target);
    // §3.5.2 conquer-march: a non-own target routes by shortest path ignoring
    // ownership (only impassable terrain blocks). One BFS from the target gives
    // every source's hop-distance (== findPath(source → target).length - 1).
    const dist = bfsDistances(
      state,
      target.id,
      (np) => !isImpassableTerrain(np.terrain),
    );
    const srcs: Src[] = [];
    for (const own of ownTiles) {
      if (own.isCastle) continue; // keep the home castle garrisoned
      const count = ownAmount(own, faction);
      if (count < ASSAULT_MIN_SOURCE) continue;
      const d = dist.get(own.id);
      if (d === undefined) continue;
      if (d > maxReach) continue;
      srcs.push({ tile: own, send: count - 1 });
    }
    if (srcs.length === 0) continue;

    let aggregate = 0;
    for (const s of srcs) aggregate += s.send;
    if (aggregate < defender * profile.attackPowerRatio) continue;

    cands.push({
      target,
      srcs,
      defender,
      isEnemyCastle:
        target.isCastle &&
        target.castleOwner !== null &&
        target.castleOwner !== faction &&
        target.castleOwner !== "NEUTRAL",
      castleDist: nearestEnemyCastleDist(target.id, enemyCastles),
    });
  }
  if (cands.length === 0) return null;

  cands.sort((a, b) => {
    if (a.isEnemyCastle !== b.isEnemyCastle) return a.isEnemyCastle ? -1 : 1;
    if (a.castleDist !== b.castleDist) return a.castleDist - b.castleDist;
    if (a.defender !== b.defender) return a.defender - b.defender;
    return a.target.id < b.target.id ? -1 : 1;
  });

  const chosen = cands[0] as Cand;
  const srcs = chosen.srcs
    .slice()
    .sort((a, b) => (a.tile.id < b.tile.id ? -1 : 1));
  let s = state;
  let dispatchedAny = false;
  for (const src of srcs) {
    const res = dispatch(s, {
      from: src.tile.id,
      to: chosen.target.id,
      ratio: 1.0,
      forceCount: src.send,
    });
    if (res.ok) {
      s = res.state;
      dispatchedAny = true;
    }
  }
  if (dispatchedAny) return s;
  return null;
}

// §4.1 priority order: threat → assault → expand → rally. Assault sits above
// expand so a faction strong enough to break an enemy castle commits to it
// instead of expanding into empty tiles forever (the v1.3 stalemate cause).
// Assault self-gates on aggregate force, so early game it declines and the
// faction grows via expand until it can mount a decisive convergence.
function evaluateFaction(
  state: GameState,
  faction: FactionId,
  profile: RuleProfile,
): GameState {
  const rng = createRng(mixSeed(state.rngSeed, faction, state.tick));
  const r1 = tryDefense(state, faction, rng, profile);
  if (r1 !== null) return r1;
  const ra = tryAssault(state, faction, profile);
  if (ra !== null) return ra;
  const r2 = tryExpand(state, faction, rng, profile);
  if (r2 !== null) return r2;
  const r25 = tryRally(state, faction, rng, profile);
  if (r25 !== null) return r25;
  return state;
}

export function stepAi(state: GameState): GameState {
  let s = state;
  for (const faction of NON_NEUTRAL_FACTIONS) {
    if (s.defeated.has(faction)) continue;
    const mode = s.aiConfig[faction];
    if (mode.kind !== "rule") continue;
    const profile = RULE_PROFILES[mode.tier];
    if (!shouldEvaluate(faction, s.tick, profile.evalInterval)) continue;
    s = evaluateFaction(s, faction, profile);
  }
  return s;
}
