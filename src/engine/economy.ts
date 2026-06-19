import { garrison } from "./movement";
import { derivedOwner, findOccupant, tileId } from "./state";
import { isImpassableTerrain } from "./terrain";
import type {
  FactionEconomy,
  FactionId,
  GameState,
  Occupant,
  Province,
  TileId,
} from "./types";

// PRD §4.3 (v2.6) House economy constants. Adapted from the v2 reference spec's
// shape (build cost / population threshold / 0–30% tax) but RESCALED to v1's
// troop economy (garrisons 3–30, tiers at 5/15/30 — not v2's hundreds): growth
// is driven by surrounding owned territory (no fields), tax has no castle-
// connectivity gate, and there is no maintenance. All numbers live here as the
// single tuning point (balanced against `pnpm balance`).
export const HOUSE_COST = 50;
export const SPAWN_THRESHOLD = 16;
export const SPAWN_SIZE = 12;
export const MAX_TAX_PCT = 30;
export const DEFAULT_TAX_PCT = 15;
export const STARTING_GOLD = 150;
export const HOUSE_SEED_POP = 12;
export const GROWTH_BASE = 3;
// The economy runs on a "day" cadence rather than every 2s tick, so growth /
// tax / spawn numbers stay readable and the economy moves at a strategic pace.
export const ECONOMY_INTERVAL_TICKS = 3;

// Ticks on which the economy (growth / tax / spawn) settles. Tick 0 is the
// initial render-only frame, so the first economy day lands at tick
// ECONOMY_INTERVAL_TICKS.
export function isEconomyTick(tick: number): boolean {
  return tick > 0 && tick % ECONOMY_INTERVAL_TICKS === 0;
}

// Per-faction economy seed. Non-neutral factions share (gold, taxPct); NEUTRAL
// never earns or spends. Used by scenario load and test fixtures.
export function makeEconomy(
  gold = 0,
  taxPct = 0,
): Record<FactionId, FactionEconomy> {
  return {
    TOKUGAWA: { gold, taxPct },
    TAKEDA: { gold, taxPct },
    ODA: { gold, taxPct },
    UESUGI: { gold, taxPct },
    NEUTRAL: { gold: 0, taxPct: 0 },
  };
}

const NEIGHBOR4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const MOORE8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function houseOwnerOf(p: Province): FactionId | null {
  if (p.isHouse !== true) return null;
  return p.houseOwner ?? null;
}

// A house is "live" (grows / taxes / spawns) iff its owner is a non-neutral,
// non-defeated faction. Defeated factions' houses go inert (never razed by the
// defeat itself — only by capture).
function liveHouseOwner(state: GameState, p: Province): FactionId | null {
  const owner = houseOwnerOf(p);
  if (owner === null || owner === "NEUTRAL") return null;
  if (state.defeated.has(owner)) return null;
  return owner;
}

// ---- Build ----------------------------------------------------------------

export type BuildHouseCommand = {
  readonly faction: FactionId;
  readonly tile: TileId;
};

export type BuildReason =
  | "wrong-owner"
  | "no-builder"
  | "is-castle"
  | "already-house"
  | "not-buildable"
  | "house-too-close"
  | "insufficient-gold";

export type BuildResult =
  | { readonly ok: true; readonly state: GameState; readonly tile: TileId }
  | { readonly ok: false; readonly state: GameState; readonly reason: BuildReason };

// PRD §4.3 build precondition, as a reason (null = buildable). Shared by
// buildHouse and the UI's `canBuildHouse` so the engine rule and the player's
// "Build House" affordance never drift.
export function buildBlockReason(
  state: GameState,
  cmd: BuildHouseCommand,
): BuildReason | null {
  const p = state.provinces.get(cmd.tile);
  if (
    p === undefined ||
    cmd.faction === "NEUTRAL" ||
    derivedOwner(p) !== cmd.faction
  ) {
    return "wrong-owner";
  }
  const builder = findOccupant(p, cmd.faction);
  if (builder === undefined || builder.amount <= 0) return "no-builder";
  if (p.isCastle) return "is-castle";
  if (p.isHouse === true) return "already-house";
  if (isImpassableTerrain(p.terrain)) return "not-buildable";
  // PRD §4.3: keep Houses ≥2 tiles apart — no own House in the 8 surrounding
  // tiles — so a faction can't carpet an area with Houses.
  if (hasOwnHouseInMoore8(state, p.x, p.y, cmd.faction)) return "house-too-close";
  if (state.economy[cmd.faction].gold < HOUSE_COST) return "insufficient-gold";
  return null;
}

export function canBuildHouse(state: GameState, cmd: BuildHouseCommand): boolean {
  return buildBlockReason(state, cmd) === null;
}

// PRD §4.3: a faction spends HOUSE_COST gold to raise a House on an owned tile
// it has a garrison on. The builder seeds the House with half its troops (the
// founding population), keeping the rest as the tile's garrison. Castles and
// impassable terrain can't host a House, and a tile holds at most one.
export function buildHouse(
  state: GameState,
  cmd: BuildHouseCommand,
): BuildResult {
  const reason = buildBlockReason(state, cmd);
  if (reason !== null) return { ok: false, state, reason };
  const p = state.provinces.get(cmd.tile) as Province;
  const builder = findOccupant(p, cmd.faction) as Occupant;
  const econ = state.economy[cmd.faction];

  // Half the builder seeds the founding population; the other half (always ≥ 1,
  // since this is ceil) stays as the tile's garrison so a new House keeps a
  // defender.
  const seedPop = Math.floor(builder.amount / 2);
  const remaining = builder.amount - seedPop;
  const occupants: Occupant[] = p.occupants.map((o) =>
    o.faction === cmd.faction ? { ...o, amount: remaining } : o,
  );

  const provinces = new Map<TileId, Province>(state.provinces);
  provinces.set(cmd.tile, {
    ...p,
    isHouse: true,
    houseOwner: cmd.faction,
    housePopulation: seedPop,
    occupants,
    lastClaimedFaction: cmd.faction,
  });
  const economy: Record<FactionId, FactionEconomy> = {
    ...state.economy,
    [cmd.faction]: { ...econ, gold: econ.gold - HOUSE_COST },
  };
  return { ok: true, state: { ...state, provinces, economy }, tile: cmd.tile };
}

// ---- Population growth -----------------------------------------------------

// PRD §4.3: daily growth scales with surrounding owned territory and shrinks
// with tax. At 0% tax a house with `ownedNeighbours` adjacent owned tiles grows
// GROWTH_BASE + ownedNeighbours; growth scales down with tax but never below
// MIN_GROWTH — so even at max tax a live House still creeps toward the spawn
// threshold instead of stalling forever (a max-tax house would otherwise pile up
// gold but never produce a single troop). Integer math keeps it deterministic.
export const MIN_GROWTH = 1;

export function growthAmount(ownedNeighbours: number, taxPct: number): number {
  const base = GROWTH_BASE + ownedNeighbours;
  const factor = Math.max(0, MAX_TAX_PCT - taxPct);
  return Math.max(MIN_GROWTH, Math.floor((base * factor) / MAX_TAX_PCT));
}

// PRD §4.3 build spacing: does `faction` already own a House on any of the 8
// tiles surrounding (x, y)? Keeps Houses ≥2 tiles apart. Shared by the build
// predicate and the AI's builder selection so neither drifts.
export function hasOwnHouseInMoore8(
  state: GameState,
  x: number,
  y: number,
  faction: FactionId,
): boolean {
  for (const [dx, dy] of MOORE8) {
    const nb = state.provinces.get(tileId(x + dx, y + dy));
    if (nb !== undefined && nb.isHouse === true && nb.houseOwner === faction) {
      return true;
    }
  }
  return false;
}

function countOwnedMooreNeighbours(
  state: GameState,
  p: Province,
  owner: FactionId,
): number {
  let n = 0;
  for (const [dx, dy] of MOORE8) {
    const nb = state.provinces.get(tileId(p.x + dx, p.y + dy));
    if (nb !== undefined && derivedOwner(nb) === owner) n += 1;
  }
  return n;
}

export function growPopulation(state: GameState): GameState {
  let provincesNext: Map<TileId, Province> | null = null;
  for (const [id, p] of state.provinces) {
    const owner = liveHouseOwner(state, p);
    if (owner === null) continue;
    const growth = growthAmount(
      countOwnedMooreNeighbours(state, p, owner),
      state.economy[owner].taxPct,
    );
    if (growth <= 0) continue;
    if (provincesNext === null) provincesNext = new Map(state.provinces);
    provincesNext.set(id, {
      ...p,
      housePopulation: (p.housePopulation ?? 0) + growth,
    });
  }
  if (provincesNext === null) return state;
  return { ...state, provinces: provincesNext };
}

// ---- Tax -------------------------------------------------------------------

// PRD §4.3: each live house pays floor(population × taxPct / 100) gold into its
// owner's treasury. No castle-connectivity gate (v1 simplification).
export function collectTax(state: GameState): GameState {
  const income = new Map<FactionId, number>();
  for (const p of state.provinces.values()) {
    const owner = liveHouseOwner(state, p);
    if (owner === null) continue;
    const gold = Math.floor(
      ((p.housePopulation ?? 0) * state.economy[owner].taxPct) / 100,
    );
    if (gold > 0) income.set(owner, (income.get(owner) ?? 0) + gold);
  }
  if (income.size === 0) return state;
  const economy: Record<FactionId, FactionEconomy> = { ...state.economy };
  for (const [f, g] of income) {
    economy[f] = { ...economy[f], gold: economy[f].gold + g };
  }
  return { ...state, economy };
}

// ---- Troop spawn -----------------------------------------------------------

// Deterministic-but-unbiased index into a tile's candidate neighbours, hashed
// from (rngSeed, tile, tick). Picking `candidates.sort()[0]` (lexical tile-id)
// made every house spawn toward the same compass direction, which compounded
// into a board-position win bias (a corner snowballing) — the same positional-
// bias trap the assault AI avoids with a seeded shuffle. This keeps the pick
// deterministic (replay-safe) without the bias.
function spawnPickIndex(
  seed: number,
  x: number,
  y: number,
  tick: number,
  n: number,
): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (tick | 0), 0x27d4eb2f) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) % n;
}

// The own-claimed 4-neighbour a house spawns its stack onto (deterministic but
// position-unbiased); null → none, so the caller falls back to the house tile.
function pickSpawnTile(
  state: GameState,
  house: Province,
  owner: FactionId,
): TileId | null {
  const candidates: TileId[] = [];
  for (const [dx, dy] of NEIGHBOR4) {
    const nid = tileId(house.x + dx, house.y + dy);
    const nb = state.provinces.get(nid);
    if (nb !== undefined && derivedOwner(nb) === owner) candidates.push(nid);
  }
  if (candidates.length === 0) return null;
  const idx = spawnPickIndex(state.rngSeed, house.x, house.y, state.tick, candidates.length);
  return candidates[idx] as TileId;
}

// PRD §4.3: a house at/over SPAWN_THRESHOLD population spawns one SPAWN_SIZE
// troop stack on an adjacent owned tile (fallback: the house tile) and loses
// SPAWN_SIZE population. Growth and spawning share the one population pool.
export function spawnFromHouses(state: GameState): GameState {
  let provinces: Map<TileId, Province> | null = null;
  for (const [id, p] of state.provinces) {
    const owner = liveHouseOwner(state, p);
    if (owner === null) continue;
    if ((p.housePopulation ?? 0) < SPAWN_THRESHOLD) continue;
    if (provinces === null) provinces = new Map(state.provinces);
    const house = provinces.get(id) as Province;
    const targetId = pickSpawnTile(state, house, owner) ?? id;
    const target = provinces.get(targetId) as Province;
    provinces.set(targetId, garrison(target, owner, SPAWN_SIZE, state.tick));
    const houseAfter = provinces.get(id) as Province;
    provinces.set(id, {
      ...houseAfter,
      housePopulation: (houseAfter.housePopulation ?? 0) - SPAWN_SIZE,
    });
  }
  if (provinces === null) return state;
  return { ...state, provinces };
}

// ---- Tax rate + raze -------------------------------------------------------

export function setTaxPct(
  state: GameState,
  faction: FactionId,
  pct: number,
): GameState {
  const clamped = Math.max(0, Math.min(MAX_TAX_PCT, Math.floor(pct)));
  const cur = state.economy[faction];
  if (cur.taxPct === clamped) return state;
  return {
    ...state,
    economy: { ...state.economy, [faction]: { ...cur, taxPct: clamped } },
  };
}

// PRD §4.3: an enemy capturing a House tile razes it — the building and its
// population are lost. Called from combat at break / capture. No-op on a tile
// without a house.
export function razeHouseAt(p: Province): Province {
  if (p.isHouse !== true) return p;
  return { ...p, isHouse: false, houseOwner: null, housePopulation: 0 };
}
