import { isContested } from "./state";
import type {
  FactionId,
  GameState,
  Occupant,
  Province,
  TileId,
} from "./types";
import { createRng } from "./util/rng";

// PRD §3.6 (v1.2): step-function ramp. damage(t) = 2^floor(log2(max(t, 1))).
// t=0..1 → 1; t=2..3 → 2; t=4..7 → 4; t=8..15 → 8; ...
export function stageDamage(t: number): number {
  const clamped = Math.max(t, 1);
  return 2 ** Math.floor(Math.log2(clamped));
}

export type Attack = {
  readonly attacker: FactionId;
  readonly defender: FactionId;
  readonly damage: number;
};

export type CombatEvent = {
  readonly tile: TileId;
  readonly combatTick: number;
  readonly baseDamage: number;
  readonly attacks: readonly Attack[];
};

export type CombatResult = {
  readonly state: GameState;
  readonly events: readonly CombatEvent[];
};

function hashTileId(id: TileId): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Among occupants with the smallest arrivalTick, pick one — single tile that
// has only one earliest is unique; multi-faction tie uses a deterministic
// RNG keyed on (rngSeed, tile, currentTick). Sorted by faction id first so
// the shuffle input order is itself deterministic regardless of occupants[]
// insertion order.
function pickDefenderFaction(
  state: GameState,
  tile: TileId,
  ties: readonly FactionId[],
): FactionId {
  if (ties.length === 1) return ties[0] as FactionId;
  const sorted = [...ties].sort();
  const rng = createRng((state.rngSeed ^ hashTileId(tile) ^ state.tick) >>> 0);
  // Fisher–Yates; first element is the chosen defender.
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = sorted[i] as FactionId;
    sorted[i] = sorted[j] as FactionId;
    sorted[j] = tmp;
  }
  return sorted[0] as FactionId;
}

// PRD §3.6: at combat start (tile transitions to contested), recompute who is
// the defender. Smallest arrivalTick wins; ties broken by deterministic RNG.
function assignDefender(state: GameState, p: Province): readonly Occupant[] {
  if (p.occupants.length === 0) return p.occupants;
  let minArrival = Infinity;
  for (const o of p.occupants) {
    if (o.arrivalTick < minArrival) minArrival = o.arrivalTick;
  }
  const tieFactions: FactionId[] = [];
  for (const o of p.occupants) {
    if (o.arrivalTick === minArrival) tieFactions.push(o.faction);
  }
  const defenderFaction = pickDefenderFaction(state, p.id, tieFactions);
  return p.occupants.map((o) => ({
    ...o,
    isDefender: o.faction === defenderFaction && o.arrivalTick === minArrival,
  }));
}

// PRD §3.6 v1.2: every tile with 2+ distinct-faction occupants resolves one
// round of damage. Within a tile, all incoming damages are computed against
// the post-merge (start-of-tick-combat) amounts so adding a hit and taking a
// hit are independent. NEUTRAL occupants (defeated factions, per §6.3) are
// punching bags — they take damage but never deal it.
export function resolveSameTileCombat(state: GameState): CombatResult {
  let provincesNext: Map<TileId, Province> | null = null;
  const events: CombatEvent[] = [];

  for (const [id, p] of state.provinces) {
    const contested = isContested(p);

    if (!contested) {
      // Tile not in combat — make sure stale combatStartTick is cleared.
      if (p.combatStartTick !== null) {
        if (provincesNext === null) provincesNext = new Map(state.provinces);
        provincesNext.set(id, { ...p, combatStartTick: null });
      }
      continue;
    }

    let occupants = p.occupants;
    let combatStartTick = p.combatStartTick;
    if (combatStartTick === null) {
      combatStartTick = state.tick;
      occupants = assignDefender({ ...state, tick: state.tick }, { ...p, occupants });
    }

    const t = state.tick - combatStartTick;
    const base = stageDamage(t);
    const incoming = new Array<number>(occupants.length).fill(0);
    const attacks: Attack[] = [];

    for (let i = 0; i < occupants.length; i++) {
      const attacker = occupants[i] as Occupant;
      // §6.3 NEUTRAL never attacks (defeated-faction passive remnant).
      if (attacker.faction === "NEUTRAL") continue;
      // §3.6 tick-0 駐紮優勢: only the defender attacks at t=0.
      if (t === 0 && !attacker.isDefender) continue;
      if (attacker.amount <= 0) continue;

      for (let j = 0; j < occupants.length; j++) {
        if (i === j) continue;
        const defender = occupants[j] as Occupant;
        if (defender.faction === attacker.faction) continue;

        const actual = Math.min(base, attacker.amount);
        if (actual <= 0) continue;
        incoming[j] = (incoming[j] as number) + actual;
        attacks.push({
          attacker: attacker.faction,
          defender: defender.faction,
          damage: actual,
        });
      }
    }

    const newOccupants: Occupant[] = [];
    for (let i = 0; i < occupants.length; i++) {
      const o = occupants[i] as Occupant;
      const survivors = Math.max(0, o.amount - (incoming[i] as number));
      if (survivors > 0) newOccupants.push({ ...o, amount: survivors });
    }

    // Combat ends (combatStartTick → null) when the post-tick tile has ≤ 1
    // distinct active faction. NEUTRAL counts as a faction for this check
    // (a NEUTRAL survivor sharing a tile with one live attacker is still
    // a 2-faction tile and combat keeps going), matching §6.3's punching-bag
    // semantics — the bandit doesn't end the fight until it's killed.
    const factions = new Set<FactionId>();
    for (const o of newOccupants) factions.add(o.faction);
    const stillContested = factions.size >= 2;

    if (provincesNext === null) provincesNext = new Map(state.provinces);
    // §3.5.4 v1.3 walk-through claim continuation: when combat ends with a
    // single survivor, that faction "owns" the tile going forward (visual +
    // BFS). Mutual annihilation (0 occupants) leaves lastClaimedFaction
    // alone so the previous claimant's colour still shows on the empty tile
    // — feels right since neither attacker "won" the contested patch.
    let nextLastClaimed = p.lastClaimedFaction;
    if (!stillContested && newOccupants.length === 1) {
      nextLastClaimed = (newOccupants[0] as Occupant).faction;
    }

    provincesNext.set(id, {
      ...p,
      occupants: newOccupants,
      combatStartTick: stillContested ? combatStartTick : null,
      lastClaimedFaction: nextLastClaimed,
    });

    events.push({ tile: id, combatTick: t, baseDamage: base, attacks });
  }

  if (provincesNext === null) return { state, events };
  return { state: { ...state, provinces: provincesNext }, events };
}
