import type { RuleTier } from "./types";

// archive/prd-v0.12 §4.1: single knob bag shared by all three rule tiers. Easy
// = blind & slow (player can flank trivially). Normal = the v0.12 orphan AI
// baseline bit-for-bit. Hard = tighter cadence, longer attack reach, more
// aggressive castle siphon. The AI spec was moved out of the live PRD in v1.0
// (see PRD changelog); this profile bag is the canonical knob source for the
// rule-tier AI restored onto the v1.2/v1.3 schema.
export type RuleProfile = {
  readonly evalInterval: number;
  // Manhattan radius around own castle counted as a threat trigger.
  readonly defenseRadius: number;
  // Attack reach as a multiple of board size — the attack rule scans enemies
  // within round(boardSize * attackReach) BFS hops. Board-relative (no fixed
  // cap) so the AI still reaches enemies on large maps.
  readonly attackReach: number;
  // Power multiplier the source must exceed over the target to attack.
  readonly attackPowerRatio: number;
  // Whether the rally rule fires at all. Disabled on Easy.
  readonly rallyEnabled: boolean;
  // Fraction of a non-castle source's stack to ship out on expand.
  readonly expandRatio: number;
  // Fraction of a Queen-band castle (count 15..29) to siphon on expand. Only
  // the Queen band — Soldier and King bands stay static per §4.1.
  readonly castleQueenSendRatio: number;
  // PRD §4.3 (v2.6) economy knobs. taxPct = the faction's fixed tax rate (0..30):
  // higher = more gold now but slower House growth. housePerTiles = build roughly
  // one House per this many owned tiles (the AI stops building once it hits that
  // ratio and expands instead); 0 disables building.
  readonly taxPct: number;
  readonly housePerTiles: number;
};

export const RULE_PROFILES: Readonly<Record<RuleTier, RuleProfile>> = {
  easy: {
    evalInterval: 8,
    defenseRadius: 1,
    attackReach: 0.75,
    attackPowerRatio: 1.5,
    rallyEnabled: false,
    expandRatio: 0.5,
    castleQueenSendRatio: 0.2,
    taxPct: 12,
    housePerTiles: 5,
  },
  normal: {
    evalInterval: 5,
    defenseRadius: 2,
    attackReach: 1.25,
    attackPowerRatio: 1.15,
    rallyEnabled: true,
    expandRatio: 0.5,
    castleQueenSendRatio: 0.33,
    taxPct: 15,
    housePerTiles: 4,
  },
  hard: {
    evalInterval: 3,
    defenseRadius: 3,
    attackReach: 2.0,
    attackPowerRatio: 1.0,
    rallyEnabled: true,
    expandRatio: 0.66,
    castleQueenSendRatio: 0.4,
    taxPct: 18,
    housePerTiles: 3,
  },
};
