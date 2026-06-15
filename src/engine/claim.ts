import { tilePower } from "./combat";
import { parseTileId, tileId } from "./state";
import type { FactionId, GameState, Province, TileId } from "./types";
import { createRng } from "./util/rng";

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Per-tile salt mirrors ai.ts mixSeed: distinct constant so tick-aligned RNG
// across AI and claim phases never collides on the same tile output.
const CLAIM_SALT = 0x5dade2a7;

function mixClaimSeed(rngSeed: number, tick: number, id: TileId): number {
  let h = ((rngSeed >>> 0) ^ CLAIM_SALT) >>> 0;
  h = Math.imul(h ^ (tick | 0), 0x85ebca6b) >>> 0;
  // FNV-ish fold of the tile id chars keeps the seed dependent on the tile
  // coordinates without imposing a numeric parse.
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0xc2b2ae35) >>> 0;
  }
  h ^= h >>> 16;
  return h >>> 0;
}

function neighbours(
  state: GameState,
  id: TileId,
): readonly Province[] {
  const { x, y } = parseTileId(id);
  const out: Province[] = [];
  for (const offset of NEIGHBOR_OFFSETS) {
    const dx = offset[0] as number;
    const dy = offset[1] as number;
    const np = state.provinces.get(tileId(x + dx, y + dy));
    if (np !== undefined) out.push(np);
  }
  return out;
}

// PRD §3.6.1 hysteresis window: a freshly-claimed tile is frozen for this
// many ticks to prevent power-fluctuation-induced ownership oscillation.
export const CLAIM_PROTECTION_TICKS = 3;

// PRD §3.6.1 — runs after combat + drain, before defeats. Pure function:
// returns a new state when at least one tile flips, same reference otherwise.
export function applyClaimPhase(state: GameState): GameState {
  let next: Map<TileId, Province> | null = null;

  for (const tile of state.provinces.values()) {
    if (tile.count !== 0) continue;

    // PRD §3.6.1 hysteresis: skip tiles still inside the protection window.
    // tick semantics match the rest of the engine (`state.tick` at the time
    // of the action is the timestamp value stored — same convention as
    // MarchingStack.dispatchedAtTick).
    if (
      tile.lastClaimedAtTick !== null &&
      state.tick - tile.lastClaimedAtTick < CLAIM_PROTECTION_TICKS
    ) {
      continue;
    }

    // Gather claimants and their summed power. §3.6.1 excludes NEUTRAL,
    // defeated factions, and the tile's own owner from claiming.
    const powerByFaction = new Map<FactionId, number>();
    for (const n of neighbours(state, tile.id)) {
      if (n.count <= 0) continue;
      if (n.owner === "NEUTRAL") continue;
      if (state.defeated.has(n.owner)) continue;
      if (n.owner === tile.owner) continue;
      powerByFaction.set(
        n.owner,
        (powerByFaction.get(n.owner) ?? 0) + tilePower(n.count),
      );
    }
    if (powerByFaction.size === 0) continue;

    let winner: FactionId;
    if (powerByFaction.size === 1) {
      winner = powerByFaction.keys().next().value as FactionId;
    } else {
      // Multi-claimant tiebreak: highest summed power wins; equal-power ties
      // resolved by §4.2-style deterministic RNG seeded on (rngSeed, tick,
      // tile id). Shuffle the max-power set first, then pick index 0 — same
      // deterministic pattern AI uses for candidate selection.
      let maxPower = -1;
      for (const p of powerByFaction.values()) if (p > maxPower) maxPower = p;
      const topCandidates: FactionId[] = [];
      for (const [f, p] of powerByFaction) {
        if (p === maxPower) topCandidates.push(f);
      }
      if (topCandidates.length === 1) {
        winner = topCandidates[0] as FactionId;
      } else {
        const rng = createRng(mixClaimSeed(state.rngSeed, state.tick, tile.id));
        for (let i = topCandidates.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const a = topCandidates[i] as FactionId;
          const b = topCandidates[j] as FactionId;
          topCandidates[i] = b;
          topCandidates[j] = a;
        }
        winner = topCandidates[0] as FactionId;
      }
    }

    if (winner === tile.owner) continue;

    if (next === null) next = new Map<TileId, Province>(state.provinces);
    next.set(tile.id, {
      ...tile,
      owner: winner,
      lastClaimedAtTick: state.tick,
    });
  }

  if (next === null) return state;
  return { ...state, provinces: next };
}
