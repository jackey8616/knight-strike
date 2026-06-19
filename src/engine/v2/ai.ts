import { startDestruction } from "./construction";
import { buildHouse, HOUSE_COST, validateBuild } from "./house";
import { issueMarch } from "./movement";
import { makeFaction, mooreNeighbors, parseTileId, tileId, vonNeumannNeighbors } from "./state";
import { isPassable } from "./terrain";
import { RULE_PROFILES, type AiProfile } from "./ai-profile";
import { PLAYER_FACTIONS, type FactionId, type GameState, type TileId, type Unit } from "./types";

// Per-faction salts so mixSeed never aliases across factions (PRD §5.1).
const FACTION_SALT: Readonly<Record<FactionId, number>> = {
  TOKUGAWA: 0x1d4e1bd1,
  TAKEDA: 0x2b1a3f4e,
  ODA: 0x3c9d5e7f,
  UESUGI: 0x4e0f7a2b,
  NEUTRAL: 0,
  MONSTER: 0x5a6b7c8d,
};

export function mixSeed(rngSeed: number, faction: FactionId, tick: number): number {
  let h = ((rngSeed >>> 0) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ FACTION_SALT[faction], 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (tick | 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const manhattan = (a: TileId, b: TileId): number => {
  const pa = parseTileId(a);
  const pb = parseTileId(b);
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
};

const isEnemy = (faction: FactionId, owner: FactionId): boolean =>
  owner !== faction && owner !== "NEUTRAL";

function castleTileOf(state: GameState, faction: FactionId): TileId | null {
  for (const [id, p] of state.provinces) {
    if (p.isCastle && p.castleOwner === faction && (p.castleDurability ?? 1) > 0) return id;
  }
  return null;
}

function idleUnits(state: GameState, faction: FactionId): Unit[] {
  const marching = new Set(state.marchOrders.map((o) => o.unitId));
  return state.units
    .filter((u) => u.owner === faction && u.combatLock === null && u.task === null && !marching.has(u.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// Nearest tile, ties broken by `seed` (per-faction mixSeed) so symmetric boards
// don't make every faction pile onto the same target.
function nearestTile(tiles: readonly TileId[], from: TileId, seed = 0): TileId | null {
  let bestD = Number.POSITIVE_INFINITY;
  const ties: TileId[] = [];
  for (const t of tiles) {
    const d = manhattan(t, from);
    if (d < bestD) {
      bestD = d;
      ties.length = 0;
      ties.push(t);
    } else if (d === bestD) {
      ties.push(t);
    }
  }
  if (ties.length === 0) return null;
  ties.sort();
  return ties[(seed >>> 0) % ties.length] ?? null;
}

const ownHouseCount = (state: GameState, faction: FactionId): number =>
  state.houses.filter((h) => h.owner === faction).length;

// Nearest empty buildable tile outside any own house's Moore-8 — where the AI
// relocates an idle army to found a new house and scale its economy.
function nearestBuildSpot(state: GameState, faction: FactionId, from: TileId, boardSize: number): TileId | null {
  const excl = new Set<TileId>();
  for (const h of state.houses) {
    if (h.owner !== faction) continue;
    const { x, y } = parseTileId(h.tile);
    excl.add(h.tile);
    for (const n of mooreNeighbors(x, y, boardSize)) excl.add(n);
  }
  const occ = new Set<TileId>([
    ...state.houses.map((h) => h.tile),
    ...state.fields.map((f) => f.tile),
    ...state.nests.map((n) => n.tile),
    ...state.buildings.map((b) => b.tile),
  ]);
  let best: TileId | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let x = 0; x < boardSize; x += 1) {
    for (let y = 0; y < boardSize; y += 1) {
      const t = tileId(x, y);
      if (excl.has(t) || occ.has(t) || !isPassable(state, t) || state.provinces.get(t)?.isCastle) continue;
      const d = manhattan(t, from);
      if (d < bestD || (d === bestD && best !== null && t < best)) {
        best = t;
        bestD = d;
      }
    }
  }
  return best;
}

function enemyCastleTiles(state: GameState, faction: FactionId): TileId[] {
  const out: TileId[] = [];
  for (const [id, p] of state.provinces) {
    if (p.isCastle && p.castleOwner !== null && isEnemy(faction, p.castleOwner) && (p.castleDurability ?? 1) > 0) {
      out.push(id);
    }
  }
  return out;
}

function adjacentEnemyCastle(state: GameState, tile: TileId, faction: FactionId, boardSize: number): TileId | null {
  const { x, y } = parseTileId(tile);
  for (const t of [tile, ...vonNeumannNeighbors(x, y, boardSize)]) {
    const p = state.provinces.get(t);
    if (p?.isCastle && p.castleOwner !== null && isEnemy(faction, p.castleOwner) && (p.castleDurability ?? 1) > 0) {
      return t;
    }
  }
  return null;
}

function adjacentEnemyHouse(state: GameState, tile: TileId, faction: FactionId, boardSize: number): string | null {
  const { x, y } = parseTileId(tile);
  const here = new Set([tile, ...vonNeumannNeighbors(x, y, boardSize)]);
  return state.houses.find((h) => isEnemy(faction, h.owner) && here.has(h.tile))?.id ?? null;
}

function setTax(state: GameState, faction: FactionId, rate: number): GameState {
  if (state.factions[faction].taxRate === rate) return state;
  return {
    ...state,
    factions: {
      ...state.factions,
      [faction]: makeFaction(faction, { ...state.factions[faction], taxRate: rate }),
    },
  };
}

// PRD §5.2 — one army's turn. A strong-enough army attacks (siege if adjacent,
// else march to the nearest enemy castle, then enemy house). A weak army grows
// the economy where it stands, else rallies to its own castle to merge with
// future house spawns into a real army (mergeFriendlyUnits, §4.7).
function actArmy(
  state: GameState,
  faction: FactionId,
  army: Unit,
  profile: AiProfile,
  castle: TileId | null,
  boardSize: number,
  seed: number,
): GameState {
  if (army.population >= profile.attackThreshold) {
    const sgCastle = adjacentEnemyCastle(state, army.tile, faction, boardSize);
    if (sgCastle !== null) {
      const r = startDestruction(state, { faction, unitId: army.id, targetKind: "CASTLE", targetId: sgCastle });
      if (r.ok) return r.state;
    }
    const sgHouse = adjacentEnemyHouse(state, army.tile, faction, boardSize);
    if (sgHouse !== null) {
      const r = startDestruction(state, { faction, unitId: army.id, targetKind: "HOUSE", targetId: sgHouse });
      if (r.ok) return r.state;
    }
    const castleTarget = nearestTile(enemyCastleTiles(state, faction), army.tile, seed);
    if (castleTarget !== null) {
      const m = issueMarch(state, army.id, castleTarget);
      if (m !== state) return m;
    }
    const houseTarget = nearestTile(
      state.houses.filter((h) => isEnemy(faction, h.owner)).map((h) => h.tile),
      army.tile,
      seed,
    );
    if (houseTarget !== null) {
      const m = issueMarch(state, army.id, houseTarget);
      if (m !== state) return m;
    }
    return state;
  }

  // weak army → grow the economy (build up to houseTarget while gold allows),
  // else rally to the castle to merge into an attack force.
  if (state.factions[faction].gold >= HOUSE_COST && ownHouseCount(state, faction) < profile.houseTarget) {
    if (validateBuild(state, { faction, tile: army.tile }).ok) {
      const b = buildHouse(state, { faction, tile: army.tile });
      if (b.ok) return b.state;
    }
    const spot = nearestBuildSpot(state, faction, army.tile, boardSize);
    if (spot !== null) {
      const m = issueMarch(state, army.id, spot);
      if (m !== state) return m;
    }
  }
  if (castle !== null && army.tile !== castle) {
    const m = issueMarch(state, army.id, castle);
    if (m !== state) return m;
  }
  return state;
}

// PRD §5.1 — synchronous, deterministic per (seed, faction, tick). Each rule
// faction whose eval interval lands this tick acts on the tick-start snapshot.
export function stepAi(state: GameState): GameState {
  let s = state;
  for (const faction of PLAYER_FACTIONS) {
    if (state.defeated.has(faction)) continue;
    const mode = state.aiConfig[faction];
    if (mode !== "easy" && mode !== "normal" && mode !== "hard") continue;
    const profile = RULE_PROFILES[mode];
    if (state.tick % profile.evalInterval !== 0) continue;

    s = setTax(s, faction, profile.taxRate);
    const castle = castleTileOf(s, faction);
    const seed = mixSeed(state.rngSeed, faction, state.tick);
    for (const army of idleUnits(s, faction)) {
      s = actArmy(s, faction, army, profile, castle, state.boardSize, seed);
    }
  }
  return s;
}
