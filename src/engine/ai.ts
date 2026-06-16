import { RULE_PROFILES, type RuleProfile } from "./ai-profile";
import { dispatch, findPath } from "./movement";
import {
  derivedOwner,
  findOccupant,
  hasHostileOccupant,
  parseTileId,
  tileId,
  totalAmount,
} from "./state";
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

  type Cand = { readonly source: Province; readonly dist: number };
  const candidates: Cand[] = [];
  for (const own of findOwnTiles(state, faction)) {
    if (own.isCastle) continue;
    if (ownAmount(own, faction) <= 0) continue;
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
  shuffleInPlace(rng, pairs);
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

// §4.1 rule #3: march on a reachable enemy castle when strong enough. Power is
// raw count (count-only combat ramp); the striker keeps 1 troop home per
// §3.5.1, so the comparison uses count-1 to mirror what actually marches out.
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
    const count = ownAmount(own, faction);
    if (count <= 1) continue;
    const effectiveCount = count - 1;
    for (const target of targets) {
      const targetStrength = totalAmount(target);
      if (effectiveCount < targetStrength * profile.attackPowerRatio) continue;
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
      ratio: 1.0,
      forceCount: ownAmount(pair.source, faction) - 1,
    });
    if (res.ok) return res.state;
  }
  return null;
}

// §4.1 priority order: threat → expand → rally → attack. First rule to produce
// a dispatch wins this evaluation; the faction acts at most once per tick.
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
