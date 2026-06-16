import type { RuleTier } from "./types";

// PRD §4.1 (v1.1): single knob bag shared by all three rule tiers. Easy = blind
// & slow (player can flank trivially). Normal = the v0.12 orphan AI baseline
// bit-for-bit so existing AC-15 tests stay valid. Hard = tighter cadence,
// longer attack reach, more aggressive castle siphon.
export type RuleProfile = {
  readonly evalInterval: number;
  // Manhattan radius around own castle counted as a threat trigger.
  readonly defenseRadius: number;
  // Maximum BFS hops the attack rule will consider when scanning enemy castles.
  readonly attackHops: number;
  // Power multiplier the source must exceed over the target to attack.
  readonly attackPowerRatio: number;
  // Whether the rally rule fires at all. Disabled on Easy.
  readonly rallyEnabled: boolean;
  // Fraction of a non-castle source's stack to ship out on expand.
  readonly expandRatio: number;
  // Fraction of a Queen-band castle (count 15..29) to siphon on expand. Only
  // the Queen band — Soldier and King bands stay static per §4.1.
  readonly castleQueenSendRatio: number;
};

export const RULE_PROFILES: Readonly<Record<RuleTier, RuleProfile>> = {
  easy: {
    evalInterval: 8,
    defenseRadius: 1,
    attackHops: 4,
    attackPowerRatio: 2.0,
    rallyEnabled: false,
    expandRatio: 0.5,
    castleQueenSendRatio: 0.2,
  },
  normal: {
    evalInterval: 5,
    defenseRadius: 2,
    attackHops: 8,
    attackPowerRatio: 1.5,
    rallyEnabled: true,
    expandRatio: 0.5,
    castleQueenSendRatio: 0.33,
  },
  hard: {
    evalInterval: 3,
    defenseRadius: 3,
    attackHops: 10,
    attackPowerRatio: 1.25,
    rallyEnabled: true,
    expandRatio: 0.66,
    castleQueenSendRatio: 0.4,
  },
};
