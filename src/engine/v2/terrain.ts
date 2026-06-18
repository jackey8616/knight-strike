import type { GameState, TileId } from "./types";

// PRD §4.7 / §4.11 — can a unit stand on / move onto this tile?
//   FENCE on the tile        → blocked (for everyone, §6 decision)
//   PLAINS / FOREST          → walkable
//   WATER / LAVA             → only with a BRIDGE on the tile
//   MOUNTAIN                 → never
// Unmapped tiles default to PLAINS. Faction-agnostic for now (fences block all).
export function isPassable(state: GameState, tile: TileId): boolean {
  for (const b of state.buildings) {
    if (b.tile === tile && b.kind === "FENCE") return false;
  }
  const terrain = state.provinces.get(tile)?.terrain ?? "PLAINS";
  if (terrain === "PLAINS" || terrain === "FOREST") return true;
  if (terrain === "WATER" || terrain === "LAVA") {
    return state.buildings.some((b) => b.tile === tile && b.kind === "BRIDGE");
  }
  return false; // MOUNTAIN
}
