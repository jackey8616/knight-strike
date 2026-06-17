import { findOccupant } from "./state";
import type {
  AttackOrder,
  FactionId,
  GameState,
  Occupant,
  Province,
  TileId,
} from "./types";

// PRD §3.6' (v1.4): step-function ramp, unchanged from v1.2.
// stageDamage(t) = 2^floor(log2(max(t, 1))). t=0..1 → 1; t=2..3 → 2; t=4..7 → 4…
export function stageDamage(t: number): number {
  const clamped = Math.max(t, 1);
  return 2 ** Math.floor(Math.log2(clamped));
}

export type Attack = {
  readonly attacker: FactionId;
  readonly defender: FactionId;
  readonly damage: number;
};

export type CombatEventKind = "fight" | "break" | "capture";

export type CombatEvent = {
  readonly from: TileId;
  readonly to: TileId;
  readonly kind: CombatEventKind;
  readonly combatTick: number;
  readonly baseDamage: number;
  readonly attacks: readonly Attack[];
};

export type CombatResult = {
  readonly state: GameState;
  readonly events: readonly CombatEvent[];
};

function orderKey(o: AttackOrder): string {
  return `${o.from}|${o.to}|${o.faction}`;
}

// The single hostile (different-faction, amount > 0) occupant on a tile, if any.
// v1.4 keeps the "at most one faction per tile" invariant, so there is at most
// one such occupant.
function hostileOccupant(
  province: Province,
  faction: FactionId,
): Occupant | undefined {
  for (const o of province.occupants) {
    if (o.faction !== faction && o.amount > 0) return o;
  }
  return undefined;
}

// Reduce the (single) occupant of `faction` on a tile by `amount`; drop the
// occupant if it reaches 0. lastClaimedFaction is intentionally preserved so a
// freshly-emptied tile still reads as that faction's claim (break/capture).
function spend(
  provinces: Map<TileId, Province>,
  tile: TileId,
  faction: FactionId,
  amount: number,
): number {
  const p = provinces.get(tile);
  if (p === undefined) return 0;
  const occ = findOccupant(p, faction);
  if (occ === undefined) return 0;
  const next = Math.max(0, occ.amount - amount);
  const occupants =
    next > 0
      ? p.occupants.map((o) => (o.faction === faction ? { ...o, amount: next } : o))
      : p.occupants.filter((o) => o.faction !== faction);
  provinces.set(tile, { ...p, occupants });
  return next;
}

// PRD §3.6' (v1.4): resolve every AttackOrder.
//   • target has a hostile garrison → cross-edge step-function combat (stage 1);
//     defender-only at t=0, both fire from t≥1, NEUTRAL never fires back.
//   • target empty + enemy-claimed → break: spend 1, claim → null (stage 2).
//   • target empty + neutral/unclaimed → capture: spend 1, claim → faction (3).
// All stage-1 damage is dry-run against the start-of-tick amounts then applied
// together; claim steps run sequentially (sorted by from-tile id) so two orders
// on one target see each other's progress.
export function resolveOrders(state: GameState): CombatResult {
  if (state.attackOrders.length === 0) return { state, events: [] };

  const provinces = new Map<TileId, Province>(state.provinces);
  const events: CombatEvent[] = [];

  const stageOne: AttackOrder[] = [];
  const claim: AttackOrder[] = [];
  const kept = new Set<string>();

  // Pass 1: validate + classify by start-of-tick target state.
  const incoming = new Map<TileId, number>();
  for (const order of state.attackOrders) {
    const fromP = provinces.get(order.from);
    const toP = provinces.get(order.to);
    if (fromP === undefined || toP === undefined) continue; // invalid → drop
    const attacker = findOccupant(fromP, order.faction);
    if (attacker === undefined || attacker.amount <= 0) continue; // §D8 drop
    const defender = hostileOccupant(toP, order.faction);
    if (defender === undefined) {
      claim.push(order);
      continue;
    }
    stageOne.push(order);
    const t = state.tick - order.startTick;
    const base = stageDamage(t);
    const attacks: Attack[] = [];
    // Defender returns fire (NEUTRAL bandits / remnants never do, §6.3).
    if (defender.faction !== "NEUTRAL") {
      const dmg = Math.min(base, defender.amount);
      incoming.set(order.from, (incoming.get(order.from) ?? 0) + dmg);
      attacks.push({ attacker: defender.faction, defender: order.faction, damage: dmg });
    }
    // Attacker hits the defender from t≥1 (tick-0 defender advantage, §D3).
    if (t >= 1 && order.faction !== "NEUTRAL") {
      const dmg = Math.min(base, attacker.amount);
      incoming.set(order.to, (incoming.get(order.to) ?? 0) + dmg);
      attacks.push({ attacker: order.faction, defender: defender.faction, damage: dmg });
    }
    events.push({
      from: order.from,
      to: order.to,
      kind: "fight",
      combatTick: t,
      baseDamage: base,
      attacks,
    });
  }

  // Pass 2: apply all stage-1 damage simultaneously (single occupant per tile).
  for (const [tile, dmg] of incoming) {
    const p = provinces.get(tile);
    if (p === undefined) continue;
    const occ = p.occupants[0];
    if (occ === undefined) continue;
    const next = Math.max(0, occ.amount - dmg);
    const occupants = next > 0 ? [{ ...occ, amount: next }] : [];
    provinces.set(tile, { ...p, occupants });
  }

  // Stage-1 orders survive iff the attacking garrison is still alive. A target
  // killed this tick stays an order — its break happens next tick.
  for (const order of stageOne) {
    const fromP = provinces.get(order.from);
    if (fromP !== undefined && findOccupant(fromP, order.faction) !== undefined) {
      kept.add(orderKey(order));
    }
  }

  // Pass 3: claim steps, deterministic order so co-targeting orders converge.
  const claimSorted = [...claim].sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
  );
  for (const order of claimSorted) {
    const fromP = provinces.get(order.from);
    const toP = provinces.get(order.to);
    if (fromP === undefined || toP === undefined) continue;
    const attacker = findOccupant(fromP, order.faction);
    if (attacker === undefined || attacker.amount <= 0) continue;
    // A hostile garrison may have (re)appeared via this tick's movement; if so,
    // fight it next tick rather than claim.
    if (hostileOccupant(toP, order.faction) !== undefined) {
      kept.add(orderKey(order));
      continue;
    }
    const claimedBy = toP.lastClaimedFaction;
    if (claimedBy === order.faction) continue; // already ours → order complete

    const enemyClaim =
      claimedBy !== null &&
      claimedBy !== "NEUTRAL" &&
      !state.defeated.has(claimedBy);

    if (enemyClaim) {
      const left = spend(provinces, order.from, order.faction, 1);
      const cur = provinces.get(order.to) as Province;
      provinces.set(order.to, { ...cur, lastClaimedFaction: null });
      events.push({
        from: order.from,
        to: order.to,
        kind: "break",
        combatTick: state.tick - order.startTick,
        baseDamage: 0,
        attacks: [],
      });
      if (left > 0) kept.add(orderKey(order)); // capture next tick
    } else {
      spend(provinces, order.from, order.faction, 1);
      const cur = provinces.get(order.to) as Province;
      provinces.set(order.to, { ...cur, lastClaimedFaction: order.faction });
      events.push({
        from: order.from,
        to: order.to,
        kind: "capture",
        combatTick: state.tick - order.startTick,
        baseDamage: 0,
        attacks: [],
      });
      // capture complete → order drops (not re-kept)
    }
  }

  const attackOrders = state.attackOrders.filter((o) => kept.has(orderKey(o)));
  return { state: { ...state, provinces, attackOrders }, events };
}
