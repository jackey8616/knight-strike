import { parseTileId, tileId } from "./state";
import type { Terrain, TileId } from "./types";
import { createRng } from "./util/rng";

// PRD §4.7 (v1.6) terrain rules.
//   MOUNTAIN / WATER → impassable (can't enter, claim, or path through).
//   FOREST → the unit on it takes 75% incoming combat damage.
//   PLAINS → neutral.

export function isImpassableTerrain(t: Terrain | undefined): boolean {
  return t === "MOUNTAIN" || t === "WATER";
}

const DEFENSE_MULT: Readonly<Record<Terrain, number>> = {
  PLAINS: 1,
  FOREST: 0.75,
  MOUNTAIN: 1, // never holds a unit
  WATER: 1, // never holds a unit
};

// Reduce a raw combat hit by the defending tile's terrain. Uses ceil so a
// defended unit never becomes fully damage-immune (a hit of ≥1 always lands
// ≥1), which would otherwise stall combat.
export function applyTerrainDefense(dmg: number, t: Terrain | undefined): number {
  if (dmg <= 0) return 0;
  const mult = DEFENSE_MULT[t ?? "PLAINS"];
  return Math.ceil(dmg * mult);
}

// Weighted terrain palette for blob scattering — forest common, mountains form
// occasional ranges, water rarer so the board stays mostly traversable.
const BLOB_KINDS: readonly Terrain[] = [
  "FOREST",
  "FOREST",
  "FOREST",
  "MOUNTAIN",
  "MOUNTAIN",
  "WATER",
];

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// PRD §4.7 (v1.6): deterministic terrain layout from a seed. Castles + neutral
// points (passed as `fixedPlains`) stay PLAINS with a clear ring around them,
// and a connectivity pass guarantees every fixed tile is reachable from every
// other across passable terrain (so no castle is ever walled in).
export function generateTerrain(
  boardSize: number,
  seed: number,
  fixedPlains: ReadonlySet<TileId>,
  oceanMask?: ReadonlySet<TileId>,
): Map<TileId, Terrain> {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const grid = new Map<TileId, Terrain>();
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) grid.set(tileId(x, y), "PLAINS");
  }

  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && x < boardSize && y >= 0 && y < boardSize;

  // Scatter organic blobs of terrain.
  const blobCount = Math.max(4, Math.floor((boardSize * boardSize) / 7));
  for (let i = 0; i < blobCount; i++) {
    const kind = BLOB_KINDS[Math.floor(rng() * BLOB_KINDS.length)] as Terrain;
    const cx = Math.floor(rng() * boardSize);
    const cy = Math.floor(rng() * boardSize);
    const radius = 1 + Math.floor(rng() * 2);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(x, y)) continue;
        if (rng() < 0.7) grid.set(tileId(x, y), kind);
      }
    }
  }

  // PRD §4.7: the "coast" map shape carves a perimeter sea (passed as
  // `oceanMask`) into WATER here — before the fixed-tile and connectivity passes,
  // so castles still get a cleared deployment ring and stay mutually reachable.
  if (oceanMask !== undefined) {
    for (const id of oceanMask) grid.set(id, "WATER");
  }

  // Force fixed tiles to PLAINS and clear any impassable terrain ringing them
  // so castles / bandit camps always have room to deploy.
  for (const id of fixedPlains) {
    grid.set(id, "PLAINS");
    const { x, y } = parseTileId(id);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const nid = tileId(nx, ny);
      if (isImpassableTerrain(grid.get(nid))) grid.set(nid, "PLAINS");
    }
  }

  carveConnectivity(grid, fixedPlains, boardSize);
  return grid;
}

function passableSet(
  grid: ReadonlyMap<TileId, Terrain>,
  root: TileId,
  boardSize: number,
): Set<TileId> {
  const seen = new Set<TileId>([root]);
  const queue: TileId[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift() as TileId;
    const { x, y } = parseTileId(cur);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= boardSize || ny < 0 || ny >= boardSize) continue;
      const nid = tileId(nx, ny);
      if (seen.has(nid)) continue;
      if (isImpassableTerrain(grid.get(nid))) continue;
      seen.add(nid);
      queue.push(nid);
    }
  }
  return seen;
}

// Carve an L-shaped PLAINS corridor between two tiles (horizontal then
// vertical), guaranteeing a passable connection.
function carveLPath(grid: Map<TileId, Terrain>, from: TileId, to: TileId): void {
  const a = parseTileId(from);
  const b = parseTileId(to);
  const stepX = a.x < b.x ? 1 : -1;
  for (let x = a.x; x !== b.x; x += stepX) grid.set(tileId(x, a.y), "PLAINS");
  const stepY = a.y < b.y ? 1 : -1;
  for (let y = a.y; y !== b.y; y += stepY) grid.set(tileId(b.x, y), "PLAINS");
  grid.set(to, "PLAINS");
}

// PRD §4.7 / §6.1: the "coast" map shape. A deterministic, dihedral-symmetric
// set of perimeter tiles to force to WATER, so the island silhouette is
// irregular while every corner (and its castle) stays a land peninsula. The sea
// bites deepest at each edge midpoint and tapers to nothing toward the corners;
// the symmetry keeps the four factions' starts fair (so the AI-balance gate is
// unaffected). `protect` tiles (castles + camps) are never carved, and
// generateTerrain's connectivity pass still guarantees the map stays winnable.
export function coastOceanMask(
  boardSize: number,
  seed: number,
  protect: ReadonlySet<TileId> = new Set<TileId>(),
): Set<TileId> {
  const mask = new Set<TileId>();
  if (boardSize < 5) return mask;
  const max = boardSize - 1;
  const half = Math.floor(boardSize / 2);
  const rng = createRng((seed ^ 0x00c0a575) >>> 0);
  const maxDepth = Math.max(2, Math.floor(boardSize * 0.2));
  const cornerKeep = Math.max(1, Math.floor(boardSize * 0.18));

  // profile[k] = ocean depth at distance k from a corner along an edge: 0 inside
  // the corner-keep zone, ramping to ~maxDepth at the edge midpoint with a
  // seeded wobble for an organic coastline. Indexed by the symmetric coordinate
  // min(coord, max-coord), so the whole carve is dihedral-symmetric.
  const profile: number[] = [];
  for (let k = 0; k <= half; k++) {
    if (k < cornerKeep) {
      profile.push(0);
      continue;
    }
    const t = (k - cornerKeep) / Math.max(1, half - cornerKeep);
    const wobble = Math.floor(rng() * 2);
    profile.push(Math.min(maxDepth, Math.round(t * maxDepth) + wobble));
  }
  const depthAt = (k: number): number => profile[Math.min(k, half)] ?? 0;

  for (let y = 0; y <= max; y++) {
    for (let x = 0; x <= max; x++) {
      const sx = Math.min(x, max - x);
      const sy = Math.min(y, max - y);
      const ocean =
        y < depthAt(sx) || // top edge
        max - y < depthAt(sx) || // bottom edge
        x < depthAt(sy) || // left edge
        max - x < depthAt(sy); // right edge
      if (!ocean) continue;
      const id = tileId(x, y);
      if (protect.has(id)) continue;
      mask.add(id);
    }
  }
  return mask;
}

// Ensure every fixed tile is connected to the first one over passable terrain;
// carve a corridor to any that isn't, then re-check.
function carveConnectivity(
  grid: Map<TileId, Terrain>,
  fixedPlains: ReadonlySet<TileId>,
  boardSize: number,
): void {
  const fixed = [...fixedPlains];
  if (fixed.length <= 1) return;
  const root = fixed[0] as TileId;
  let reached = passableSet(grid, root, boardSize);
  for (let i = 1; i < fixed.length; i++) {
    const f = fixed[i] as TileId;
    if (reached.has(f)) continue;
    carveLPath(grid, f, root);
    reached = passableSet(grid, root, boardSize);
  }
}
