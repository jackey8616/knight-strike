import type { GameState } from "./types";

// PRD v1.2 §9.1: castle overflow (v0.11 §3.5.5) was an AI convergence patch;
// deferred along with the rest of §4. Stubbed as no-op for the v1.2 schema
// (which doesn't even expose `province.count` for the old threshold check).
// Full v1.1 implementation preserved at git tag `archive/prd-v1.1`.
export function applyCastleOverflow(state: GameState): GameState {
  return state;
}
