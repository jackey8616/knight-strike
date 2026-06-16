import { RULE_PROFILES, type RuleProfile } from "./ai-profile";
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

// PRD §4.3: Normal-tier cadence kept as the named module constant so older
// importers (tests, scenario tooling) still resolve it. Easy / Hard cadences
// live in `RULE_PROFILES` and reach the AI via `profile.evalInterval`.
export const AI_EVAL_INTERVAL = RULE_PROFILES.normal.evalInterval;

// PRD §4.3 staggered offsets: Tokugawa tick 1, Takeda 2, Oda 3, Uesugi 4.
const FACTION_OFFSETS: Readonly<Record<Exclude<FactionId, "NEUTRAL">, number>> = {
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

// PRD §4.1 rule #1: any non-self tile with count > 0 within `defenseRadius`
// manhattan of the castle counts as a threat — covers enemy garrisons and
// NEUTRAL bandits. Radius is tier-tunable so Easy reacts only to the immediate
// ring (radius 1) while Hard sees threats forming further out (radius 3).
function castleThreatened(
  state: GameState,
  faction: FactionId,
  castle: Province,
  defenseRadius: number,
): boolean {
  for (const p of state.provinces.values()) {
    if (p.owner === faction) continue;
    if (p.count <= 0) continue;
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

// PRD §3.4 tier thresholds — re-exported as named reserve constants so the
// castle-tier branching reads "reserve ≥ Knight floor" rather than magic 5.
export const KNIGHT_RESERVE = 5;
export const QUEEN_RESERVE = 15;
export const KING_THRESHOLD = 30;

// Returns the count to dispatch from `source` under PRD §4.1 rule #2, or null
// when the source is ineligible (tier-protection or insufficient surplus). The
// non-castle and Queen-band castle ratios come from the per-tier profile;
// Soldier-band (0.25 cap) and King-band (0.5 cap) stay static across tiers
// because they're about staying above the next tier floor, not aggression.
function expandSendCount(
  source: Province,
  profile: RuleProfile,
): number | null {
  if (!source.isCastle) {
    if (source.count < EXPAND_MIN_STACK) return null;
    return Math.max(1, Math.floor(source.count * profile.expandRatio));
  }
  // Castle: tiered reserve — count must exceed the tier floor before any
  // surplus can leave, otherwise the castle never climbs to the next tier.
  const c = source.count;
  if (c < KNIGHT_RESERVE) return null; // Soldier — frozen until ≥ 5
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
  // King — full siphon, no reserve. dispatch() still enforces castle-min-1.
  return Math.max(1, Math.floor(c * 0.5));
}

// PRD §4.1 rule #2 + §4.2: source = any own tile that passes expandSendCount
// (non-castle ≥ 5, castle gated by tier reserve). Target = any empty (count=0)
// non-own tile adjacent to faction territory. Source need not itself neighbour
// the target — BFS path through the own corridor is enough.
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
    const send = expandSendCount(own, profile);
    if (send === null) continue;
    sources.push({ tile: own, sendCount: send });
  }
  if (sources.length === 0) return null;

  const targetIds = new Set<TileId>();
  const targets: Province[] = [];
  for (const own of ownTiles) {
    for (const nb of neighborsOf(state, own.id)) {
      if (nb.owner === faction) continue;
      if (nb.count !== 0) continue;
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
  shuffleInPlace(rng, pairs);
  for (const pair of pairs) {
    const res = dispatch(state, {
      from: pair.source.tile.id,
      to: pair.target.id,
      ratio: 0.5 as DispatchRatio,
      forceCount: pair.source.sendCount,
    });
    if (res.ok) return res.state;
  }
  return null;
}

// PRD §4.1 rule #2.5 (rally, v0.11): pick the highest-count non-castle own
// frontline tile, then ship 50% (capped at count-1) from every adjacent own
// non-castle tile toward it. Castle is intentionally excluded from sources to
// preserve rule #2 castle-tier reserve purity (and to avoid fighting the
// §3.5.5 overflow which already pushes from castle outward).
function tryRally(
  state: GameState,
  faction: FactionId,
  rng: Rng,
  profile: RuleProfile,
): GameState | null {
  if (!profile.rallyEnabled) return null;
  const anchorCandidates: Province[] = [];
  for (const p of state.provinces.values()) {
    if (p.owner !== faction) continue;
    if (p.isCastle) continue;
    let hasNonOwnNeighbour = false;
    for (const nb of neighborsOf(state, p.id)) {
      if (nb.owner !== faction) {
        hasNonOwnNeighbour = true;
        break;
      }
    }
    if (!hasNonOwnNeighbour) continue;
    anchorCandidates.push(p);
  }
  if (anchorCandidates.length === 0) return null;

  let maxCount = -1;
  for (const c of anchorCandidates) if (c.count > maxCount) maxCount = c.count;
  const topAnchors = anchorCandidates
    .filter((c) => c.count === maxCount)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  shuffleInPlace(rng, topAnchors);
  const anchor = topAnchors[0] as Province;

  type Source = { readonly tile: Province; readonly sendCount: number };
  const sources: Source[] = [];
  for (const nb of neighborsOf(state, anchor.id)) {
    if (nb.owner !== faction) continue;
    if (nb.isCastle) continue;
    const sendCount = Math.min(Math.floor(nb.count * 0.5), nb.count - 1);
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
      ratio: 0.5 as DispatchRatio,
      forceCount: src.sendCount,
    });
    if (res.ok) {
      s = res.state;
      dispatchedAny = true;
    }
  }
  return dispatchedAny ? s : null;
}

// PRD §4.1 rule #3: hop budget and power ratio are tier-tunable. Normal-tier
// values are re-exported as module constants so older importers (tests, AC
// docs) keep their identifier-stable references.
export const ATTACK_RANGE_HOPS = RULE_PROFILES.normal.attackHops;

function tryAttack(
  state: GameState,
  faction: FactionId,
  rng: Rng,
  profile: RuleProfile,
): GameState | null {
  const targets = liveEnemyCastles(state, faction);
  if (targets.length === 0) return null;

  type Pair = { readonly source: Province; readonly target: Province };
  const pairs: Pair[] = [];
  for (const own of findOwnTiles(state, faction)) {
    if (own.count <= 1) continue;
    // PRD §3.5.1 (v0.8): rule #3 keeps 1 troop on source even for non-castle
    // tiles — power check has to mirror what will actually march out.
    const effectiveCount = own.count - 1;
    if (effectiveCount <= 0) continue;
    const ownPower = tilePower(effectiveCount);
    for (const target of targets) {
      if (ownPower < tilePower(target.count) * profile.attackPowerRatio) {
        continue;
      }
      const path = findPath(state, own.id, target.id, faction);
      if (path === null) continue;
      if (path.length - 1 > profile.attackHops) continue;
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
      forceCount: pair.source.count - 1,
    });
    if (res.ok) return res.state;
  }
  return null;
}

function evaluateFaction(
  state: GameState,
  faction: FactionId,
  profile: RuleProfile,
): GameState {
  const rng = createRng(mixSeed(state.rngSeed, faction, state.tick));
  const r1 = tryDefense(state, faction, rng, profile);
  if (r1 !== null) return r1;
  const r2 = tryExpand(state, faction, rng, profile);
  if (r2 !== null) return r2;
  const r25 = tryRally(state, faction, rng, profile);
  if (r25 !== null) return r25;
  const r3 = tryAttack(state, faction, rng, profile);
  if (r3 !== null) return r3;
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
