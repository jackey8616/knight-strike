import type { GameState } from "./types";

// PRD v1.2 §9.1: AI logic deferred. v0.12 / v1.0 / v1.1 implementations of
// rule #1 (defense) / #2 (expand) / #2.5 (rally) / #3 (attack) read
// `province.owner` and `province.count`, both removed in the v1.2 schema —
// the old code would not even typecheck. Until next AI PRD pass, stepAi is a
// no-op so engine pipeline calls remain stable. Full v1.1 implementation
// preserved at git tag `archive/prd-v1.1`.
export function stepAi(state: GameState): GameState {
  return state;
}
