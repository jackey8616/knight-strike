import { razeHouseAt } from "./economy";
import { applyTerrainDefense } from "./terrain";
import type {
  AttackOrder,
  FactionId,
  GameState,
  MarchingStack,
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
// v1.4+ keeps "at most one faction per tile", so there is at most one.
function hostileOccupant(
  province: Province,
  faction: FactionId,
): Occupant | undefined {
  for (const o of province.occupants) {
    if (o.faction !== faction && o.amount > 0) return o;
  }
  return undefined;
}

// PRD §3.6' (v1.4) + conquer-march (v1.5): resolve every AttackOrder.
//   • target has a hostile garrison → cross-edge step-function combat: the
//     defender hits the column (order.count), the column hits the defender from
//     t≥1, NEUTRAL never fires back.
//   • target empty + enemy-claimed → break: spend 1 from the column, claim→null.
//   • target empty + neutral/unclaimed → capture: spend 1, claim→faction, then
//     ADVANCE — re-spawn the column on the captured tile to keep conquering the
//     route, or garrison it when the route is exhausted (final target).
// Stage-1 damage is dry-run against start-of-tick values then applied; claim
// steps run sequentially (sorted by from-tile id) so co-targeting orders agree.
export function resolveOrders(state: GameState): CombatResult {
  if (state.attackOrders.length === 0) return { state, events: [] };

  const provinces = new Map<TileId, Province>(state.provinces);
  const newStacks: MarchingStack[] = [...state.marchingStacks];
  let nextMarchingId = state.nextMarchingId;
  const events: CombatEvent[] = [];

  const kept: AttackOrder[] = [];
  const claimOrders: AttackOrder[] = [];

  // --- Stage one: dry-run cross-edge damage ---
  const defenderIncoming = new Map<TileId, number>(); // target tile → damage to its occupant
  const columnDamage = new Map<string, number>(); // order key → damage to the column
  const stageOneKeys = new Set<string>();

  for (const o of state.attackOrders) {
    const fromP = provinces.get(o.from);
    const toP = provinces.get(o.to);
    if (toP === undefined || o.count <= 0) continue; // invalid / spent → drop
    const defender = hostileOccupant(toP, o.faction);
    if (defender === undefined) {
      claimOrders.push(o);
      continue;
    }
    stageOneKeys.add(orderKey(o));
    const t = state.tick - o.startTick;
    const base = stageDamage(t);
    const attacks: Attack[] = [];
    if (defender.faction !== "NEUTRAL") {
      // Return fire is reduced by the attacking column's own terrain (§3.9).
      const dmg = applyTerrainDefense(Math.min(base, defender.amount), fromP?.terrain);
      columnDamage.set(orderKey(o), (columnDamage.get(orderKey(o)) ?? 0) + dmg);
      attacks.push({ attacker: defender.faction, defender: o.faction, damage: dmg });
    }
    if (t >= 1 && o.faction !== "NEUTRAL") {
      // The defender's loss is reduced by its own terrain (hill / forest).
      const dmg = applyTerrainDefense(Math.min(base, o.count), toP.terrain);
      defenderIncoming.set(o.to, (defenderIncoming.get(o.to) ?? 0) + dmg);
      attacks.push({ attacker: o.faction, defender: defender.faction, damage: dmg });
    }
    events.push({ from: o.from, to: o.to, kind: "fight", combatTick: t, baseDamage: base, attacks });
  }

  // Apply defender losses (single occupant per tile).
  for (const [tile, dmg] of defenderIncoming) {
    const p = provinces.get(tile);
    if (p === undefined) continue;
    const occ = p.occupants[0];
    if (occ === undefined) continue;
    const next = Math.max(0, occ.amount - dmg);
    provinces.set(tile, { ...p, occupants: next > 0 ? [{ ...occ, amount: next }] : [] });
  }

  // Stage-one orders survive iff the column is still alive.
  for (const o of state.attackOrders) {
    if (!stageOneKeys.has(orderKey(o))) continue;
    const left = o.count - (columnDamage.get(orderKey(o)) ?? 0);
    if (left > 0) kept.push({ ...o, count: left });
  }

  // --- Claim steps: deterministic order so co-targeting orders converge ---
  claimOrders.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  for (const o of claimOrders) {
    const toP = provinces.get(o.to);
    if (toP === undefined || o.count <= 0) continue;
    // A garrison may have (re)appeared via this tick's movement → fight next tick.
    if (hostileOccupant(toP, o.faction) !== undefined) {
      kept.push(o);
      continue;
    }
    const claimedBy = toP.lastClaimedFaction;
    if (claimedBy === o.faction) continue; // already ours → order complete

    const enemyClaim =
      claimedBy !== null && claimedBy !== "NEUTRAL" && !state.defeated.has(claimedBy);
    const t = state.tick - o.startTick;

    if (enemyClaim) {
      const left = o.count - 1; // break costs 1
      // PRD §4.3: breaking an enemy-claimed tile razes any House on it.
      provinces.set(o.to, { ...razeHouseAt(toP), lastClaimedFaction: null });
      events.push({ from: o.from, to: o.to, kind: "break", combatTick: t, baseDamage: 0, attacks: [] });
      if (left > 0) kept.push({ ...o, count: left }); // capture next tick
      continue;
    }

    // Capture (claim → faction) then advance. Raze any leftover House (a
    // defeated faction's inert House can sit on an unclaimed tile, §4.3).
    const remaining = o.count - 1;
    provinces.set(o.to, { ...razeHouseAt(toP), lastClaimedFaction: o.faction });
    events.push({ from: o.from, to: o.to, kind: "capture", combatTick: t, baseDamage: 0, attacks: [] });
    if (remaining <= 0) continue; // tile claimed, no troops left to advance
    // Advance onto the captured tile as a marching column. `from` stays at
    // path[0] with idx=1 (current tile = `to`) so the renderer slides the
    // column out of the staging tile instead of popping. route non-empty → it
    // keeps conquering; route empty → it has reached its destination and
    // advanceMarching settles it into a garrison next tick — a smooth
    // slide-then-settle rather than an instant garrison appearing on `to`.
    newStacks.push({
      id: `mstack:${nextMarchingId}`,
      faction: o.faction,
      count: remaining,
      path: [o.from, o.to, ...o.route],
      idx: 1,
      dispatchedAtTick: state.tick,
    });
    nextMarchingId += 1;
  }

  return {
    state: { ...state, provinces, attackOrders: kept, marchingStacks: newStacks, nextMarchingId },
    events,
  };
}
