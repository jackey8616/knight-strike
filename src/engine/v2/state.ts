import {
  ALL_FACTIONS,
  type AiMode,
  type Faction,
  type FactionId,
  type Field,
  type GameState,
  type House,
  type MonsterNest,
  type Building,
  type Province,
  type Speed,
  type TileId,
  type Unit,
} from "./types";

export function tileId(x: number, y: number): TileId {
  return `tile:${x},${y}`;
}

const TILE_RE = /^tile:(-?\d+),(-?\d+)$/;

export function parseTileId(id: TileId): { readonly x: number; readonly y: number } {
  const m = TILE_RE.exec(id);
  if (m === null || m[1] === undefined || m[2] === undefined) {
    throw new Error(`invalid tile id: ${id}`);
  }
  return { x: Number(m[1]), y: Number(m[2]) };
}

// PRD §4.12 — Moore (8) neighbours drive build-exclusion + field expansion;
// von Neumann (4) neighbours drive paths / combat pairing / connectivity.
const MOORE_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

const VON_NEUMANN_OFFSETS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

function neighbors(
  x: number,
  y: number,
  boardSize: number,
  offsets: readonly (readonly [number, number])[],
): TileId[] {
  const out: TileId[] = [];
  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < boardSize && ny < boardSize) {
      out.push(tileId(nx, ny));
    }
  }
  return out;
}

export function mooreNeighbors(x: number, y: number, boardSize: number): TileId[] {
  return neighbors(x, y, boardSize, MOORE_OFFSETS);
}

export function vonNeumannNeighbors(x: number, y: number, boardSize: number): TileId[] {
  return neighbors(x, y, boardSize, VON_NEUMANN_OFFSETS);
}

export type TileEntities = {
  house?: House;
  field?: Field;
  nest?: MonsterNest;
  building?: Building;
  unitIds: string[];
};

// Derived tile → entities index. Not stored in GameState (it would have to be
// rebuilt on every spread); subsystems call this once per pass when they need
// spatial lookups.
export function tileIndex(state: GameState): Map<TileId, TileEntities> {
  const idx = new Map<TileId, TileEntities>();
  const ensure = (t: TileId): TileEntities => {
    let e = idx.get(t);
    if (e === undefined) {
      e = { unitIds: [] };
      idx.set(t, e);
    }
    return e;
  };
  for (const h of state.houses) ensure(h.tile).house = h;
  for (const f of state.fields) ensure(f.tile).field = f;
  for (const n of state.nests) ensure(n.tile).nest = n;
  for (const b of state.buildings) ensure(b.tile).building = b;
  for (const u of state.units) ensure(u.tile).unitIds.push(u.id);
  return idx;
}

export function unitsOf(state: GameState, faction: FactionId): Unit[] {
  return state.units.filter((u) => u.owner === faction);
}

// House + field tiles owned by `faction` (PRD §4.5 connectivity / §7 territory).
export function factionTerritory(state: GameState, faction: FactionId): TileId[] {
  const tiles: TileId[] = [];
  for (const h of state.houses) if (h.owner === faction) tiles.push(h.tile);
  for (const f of state.fields) if (f.owner === faction) tiles.push(f.tile);
  return tiles;
}

export function makeFaction(id: FactionId, o: Partial<Faction> = {}): Faction {
  return {
    id,
    gold: o.gold ?? 0,
    taxRate: o.taxRate ?? 0,
    isPlayer: o.isPlayer ?? false,
    unitsLostTotal: o.unitsLostTotal ?? 0,
    enemyLossesCredited: o.enemyLossesCredited ?? 0,
  };
}

export function defaultFactions(): Record<FactionId, Faction> {
  const rec = {} as Record<FactionId, Faction>;
  for (const id of ALL_FACTIONS) {
    rec[id] = makeFaction(id, { isPlayer: id === "TOKUGAWA" });
  }
  return rec;
}

export function defaultAiConfig(): Record<FactionId, AiMode> {
  const rec = {} as Record<FactionId, AiMode>;
  for (const id of ALL_FACTIONS) rec[id] = "idle";
  return rec;
}

export type GameStateInit = {
  readonly boardSize: number;
  readonly rngSeed: number;
  readonly speed?: Speed;
  readonly provinces?: ReadonlyMap<TileId, Province>;
  readonly factions?: Readonly<Record<FactionId, Faction>>;
  readonly aiConfig?: Readonly<Record<FactionId, AiMode>>;
  readonly units?: readonly Unit[];
  readonly houses?: readonly House[];
  readonly fields?: readonly Field[];
  readonly nests?: readonly MonsterNest[];
  readonly buildings?: readonly Building[];
  readonly remainingDays?: number;
  readonly nextEntityId?: number;
};

export function createGameState(init: GameStateInit): GameState {
  return {
    boardSize: init.boardSize,
    tick: 0,
    day: 0,
    speed: init.speed ?? "slow",
    provinces: init.provinces ?? new Map<TileId, Province>(),
    factions: init.factions ?? defaultFactions(),
    units: init.units ?? [],
    houses: init.houses ?? [],
    fields: init.fields ?? [],
    nests: init.nests ?? [],
    buildings: init.buildings ?? [],
    constructions: [],
    marchOrders: [],
    connectivity: new Set<string>(),
    aiConfig: init.aiConfig ?? defaultAiConfig(),
    defeated: new Set<FactionId>(),
    // PRD §7.3 — a level is granted 3000 days up front; this is the time-out
    // budget. Scenarios may override.
    remainingDays: init.remainingDays ?? 3000,
    elapsedDaysThisLevel: 0,
    rngSeed: init.rngSeed,
    nextEntityId: init.nextEntityId ?? 1,
  };
}

// Canonical, order-stable serialization for the determinism golden-hash
// (PRD §4.2 / AC-04). Object keys, Map entries and Set members are sorted
// (they carry no semantic order); arrays are preserved as-is (a march `path`
// and processing order ARE part of the state). The engine guarantees
// deterministic array order, so identical pipelines → identical strings.
function canonical(value: unknown): unknown {
  if (value instanceof Map) {
    const entries = [...value.entries()].map(
      ([k, v]) => [String(k), canonical(v)] as const,
    );
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { __map: entries };
  }
  if (value instanceof Set) {
    return { __set: [...value].map(String).sort() };
  }
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const rec = value as Record<string, unknown>;
    for (const k of Object.keys(rec).sort()) out[k] = canonical(rec[k]);
    return out;
  }
  return value;
}

export function serializeState(state: GameState): string {
  return JSON.stringify(canonical(state));
}
