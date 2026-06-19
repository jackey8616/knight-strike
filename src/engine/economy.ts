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
  | "insufficient-gold";

export type BuildResult =
  | { readonly ok: true; readonly state: GameState; readonly tile: TileId }
  | { readonly ok: false; readonly state: GameState; readonly reason: BuildReason };

// PRD §4.3: a faction spends HOUSE_COST gold to raise a House on an owned tile
// it has a garrison on. The builder seeds the House with half its troops (the
// founding population), keeping the rest as the tile's garrison. Castles and
// impassable terrain can't host a House, and a tile holds at most one.
export function buildHouse(
  state: GameState,
  cmd: BuildHouseCommand,
): BuildResult {
  const p = state.provinces.get(cmd.tile);
  if (
    p === undefined ||
    cmd.faction === "NEUTRAL" ||
    derivedOwner(p) !== cmd.faction
  ) {
    return { ok: false, state, reason: "wrong-owner" };
  }
  const builder = findOccupant(p, cmd.faction);
  if (builder === undefined || builder.amount <= 0) {
    return { ok: false, state, reason: "no-builder" };
  }
  if (p.isCastle) return { ok: false, state, reason: "is-castle" };
  if (p.isHouse === true) return { ok: false, state, reason: "already-house" };
  if (isImpassableTerrain(p.terrain)) {
    return { ok: false, state, reason: "not-buildable" };
  }
  const econ = state.economy[cmd.faction];
  if (econ.gold < HOUSE_COST) {
    return { ok: false, state, reason: "insufficient-gold" };
  }

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
// GROWTH_BASE + ownedNeighbours; growth scales linearly to 0 at MAX_TAX_PCT.
// Integer math keeps it deterministic.
export function growthAmount(ownedNeighbours: number, taxPct: number): number {
  const base = GROWTH_BASE + ownedNeighbours;
  const factor = Math.max(0, MAX_TAX_PCT - taxPct);
  return Math.floor((base * factor) / MAX_TAX_PCT);
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

// The own-claimed 4-neighbour a house spawns its stack onto (deterministic by
// tile id); null → none, so the caller falls back to the house tile itself.
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
  candidates.sort();
  return candidates[0] as TileId;
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
