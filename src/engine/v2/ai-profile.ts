// PRD §5.3 (v2) — difficulty knobs for the rule AI. All flagged playtest-tunable
// (docs/AI-DESIGN.md §4). easy = slow/conservative; hard = frequent/aggressive.
export type RuleTier = "easy" | "normal" | "hard";

export type AiProfile = {
  readonly evalInterval: number; // evaluate every N ticks
  readonly defenseRadius: number; // Manhattan threat radius around the castle
  readonly attackRangeFactor: number; // attack scan radius = round(boardSize × this)
  readonly attackThreshold: number; // min army population to commit to an attack
  readonly taxRate: number; // fixed tax rate for this difficulty
};

export const RULE_PROFILES: Readonly<Record<RuleTier, AiProfile>> = {
  easy: { evalInterval: 8, defenseRadius: 1, attackRangeFactor: 0.5, attackThreshold: 400, taxRate: 0 },
  normal: { evalInterval: 5, defenseRadius: 2, attackRangeFactor: 1.0, attackThreshold: 250, taxRate: 0.15 },
  hard: { evalInterval: 3, defenseRadius: 3, attackRangeFactor: 1.75, attackThreshold: 150, taxRate: 0.25 },
};
