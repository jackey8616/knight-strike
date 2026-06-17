import {
  derivedOwner,
  findOccupant,
  isOwnClaimed,
  parseTileId,
  tileId,
} from "./state";
import type {
  AttackOrder,
  FactionId,
  GameState,
  MarchingStack,
  Occupant,
  Province,
  TileId,
} from "./types";

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// PRD §3.5.2 (v1.4): only own-claimed tiles are passable as intermediates —
// a tile with an own garrison or an empty tile trail-marked as ours. Neutral,
// unclaimed, and enemy tiles are walls. The BFS target itself is exempt (you
// may aim a dispatch at a non-own tile to attack / capture it).
function isPassableIntermediate(
  province: Province | undefined,
  faction: FactionId,
): boolean {
  if (province === undefined) return false;
  return isOwnClaimed(province, faction);
}

export function findPath(
  state: GameState,
  from: TileId,
  to: TileId,
  faction: FactionId,
): readonly TileId[] | null {
  if (from === to) return null;
  const source = state.provinces.get(from);
  const target = state.provinces.get(to);
  if (source === undefined || target === undefined) return null;
  // PRD §3.5.1: dispatch must originate from a fully-owned source tile.
  if (derivedOwner(source) !== faction) return null;

  // PRD §3.5.2 (v1.5 conquer-march): an own target = pure reinforcement, so the
  // whole path must stay on own claim (v1.4 rule). A non-own target = a
  // conquering drag, so the route is the plain shortest path ignoring ownership
  // — the column will siege every non-own tile it steps onto (§3.6').
  const ownTarget = isOwnClaimed(target, faction);

  const parent = new Map<TileId, TileId>();
  const visited = new Set<TileId>([from]);
  const queue: TileId[] = [from];

  while (queue.length > 0) {
    const current = queue.shift() as TileId;
    const { x, y } = parseTileId(current);
    for (const offset of NEIGHBOR_OFFSETS) {
      const dx = offset[0] as number;
      const dy = offset[1] as number;
      const nid = tileId(x + dx, y + dy);
      if (visited.has(nid)) continue;
      const np = state.provinces.get(nid);
      if (np === undefined) continue;
      visited.add(nid);
      parent.set(nid, current);
      if (nid === to) {
        const path: TileId[] = [to];
        let cur: TileId = to;
        while (cur !== from) {
          const par = parent.get(cur);
          if (par === undefined) return null;
          path.push(par);
          cur = par;
        }
        path.reverse();
        return path;
      }
      // Own target → only own-claimed intermediates extend the frontier.
      // Non-own target → all in-bounds tiles are walkable (conquer-march).
      if (!ownTarget || isPassableIntermediate(np, faction)) queue.push(nid);
    }
  }
  return null;
}

export type DispatchRatio = 0.25 | 0.5 | 0.75 | 1.0;

export type DispatchCommand = {
  readonly from: TileId;
  readonly to: TileId;
  readonly ratio: DispatchRatio;
  readonly forceCount?: number;
};

export type DispatchFailureReason =
  | "no-source"
  | "wrong-owner"
  | "no-count"
  | "castle-min-1"
  | "no-path";

export type DispatchResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly stack: MarchingStack;
    }
  | {
      readonly ok: false;
      readonly state: GameState;
      readonly reason: DispatchFailureReason;
    };

// Replace the occupant of `faction` with a new amount; drop it if amount ≤ 0.
function withOccupantAmount(
  province: Province,
  faction: FactionId,
  newAmount: number,
): Province {
  const next: Occupant[] = [];
  for (const o of province.occupants) {
    if (o.faction !== faction) {
      next.push(o);
      continue;
    }
    if (newAmount > 0) next.push({ ...o, amount: newAmount });
  }
  return { ...province, occupants: next };
}

export function dispatch(state: GameState, cmd: DispatchCommand): DispatchResult {
  const source = state.provinces.get(cmd.from);
  if (source === undefined) return { ok: false, state, reason: "no-source" };

  const ownerFaction = derivedOwner(source);
  if (ownerFaction === null || ownerFaction === "NEUTRAL") {
    return { ok: false, state, reason: "wrong-owner" };
  }
  const occupant = findOccupant(source, ownerFaction);
  if (occupant === undefined || occupant.amount <= 0) {
    return { ok: false, state, reason: "no-count" };
  }
  if (source.isCastle && occupant.amount <= 1) {
    return { ok: false, state, reason: "castle-min-1" };
  }

  const faction = ownerFaction;
  const path = findPath(state, cmd.from, cmd.to, faction);
  if (path === null || path.length < 2) {
    return { ok: false, state, reason: "no-path" };
  }

  let toSend: number;
  if (cmd.forceCount !== undefined) {
    toSend = Math.max(1, Math.min(cmd.forceCount, occupant.amount));
  } else {
    toSend = Math.max(1, Math.floor(occupant.amount * cmd.ratio));
    toSend = Math.min(toSend, occupant.amount);
  }
  if (source.isCastle) {
    toSend = Math.min(toSend, occupant.amount - 1);
  }
  if (toSend <= 0) return { ok: false, state, reason: "no-count" };

  const stack: MarchingStack = {
    id: `mstack:${state.nextMarchingId}`,
    faction,
    count: toSend,
    path,
    idx: 0,
    dispatchedAtTick: state.tick,
  };

  const newSource = withOccupantAmount(source, faction, occupant.amount - toSend);
  const newProvinces = new Map<TileId, Province>(state.provinces);
  newProvinces.set(cmd.from, newSource);

  return {
    ok: true,
    state: {
      ...state,
      provinces: newProvinces,
      marchingStacks: [...state.marchingStacks, stack],
      nextMarchingId: state.nextMarchingId + 1,
    },
    stack,
  };
}

export type CancelResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly state: GameState; readonly reason: "not-found" };

// Player cancel — drop the stack onto its current tile (always own-claimed) as
// a garrison.
export function cancelMarchingStack(
  state: GameState,
  stackId: string,
): CancelResult {
  const idx = state.marchingStacks.findIndex((s) => s.id === stackId);
  if (idx < 0) return { ok: false, state, reason: "not-found" };
  const stack = state.marchingStacks[idx] as MarchingStack;
  const tileAt = stack.path[stack.idx] as TileId;
  const province = state.provinces.get(tileAt);
  if (province === undefined) return { ok: false, state, reason: "not-found" };

  const newProvinces = new Map(state.provinces);
  newProvinces.set(tileAt, garrison(province, stack.faction, stack.count, state.tick));
  const newStacks = state.marchingStacks.filter((s) => s.id !== stackId);
  return {
    ok: true,
    state: { ...state, provinces: newProvinces, marchingStacks: newStacks },
  };
}

// Add `amount` troops of `faction` onto a tile (merge with an existing same-
// faction occupant, else create one) and stamp lastClaimedFaction = faction
// (PRD §3.6' invariant). Used for both move-in (own target) and siege staging.
function garrison(
  province: Province,
  faction: FactionId,
  amount: number,
  currentTick: number,
): Province {
  const existing = findOccupant(province, faction);
  const occupants =
    existing !== undefined
      ? province.occupants.map((o) =>
          o.faction === faction ? { ...o, amount: o.amount + amount } : o,
        )
      : [
          ...province.occupants,
          { faction, amount, arrivalTick: currentTick, isDefender: true },
        ];
  return { ...province, occupants, lastClaimedFaction: faction };
}

type AdvanceIntent = {
  readonly stack: MarchingStack;
  readonly nextIdx: number;
  readonly nextTile: TileId;
  readonly currentTile: TileId;
  readonly isTerminus: boolean;
};

type FactionArrival = {
  readonly faction: FactionId;
  readonly count: number;
  readonly anyTerminus: boolean;
  readonly chosenPath: readonly TileId[];
  readonly chosenIdx: number;
  readonly chosenDispatchedAtTick: number;
  readonly chosenId: string;
};

// PRD §3.5.4' #1: same-faction stacks reaching one tile this tick merge into a
// single arrival — counts sum, the continuing path is the one with the fewest
// remaining steps (terminus wins outright), tiebroken by earliest dispatch then
// id.
function mergeFactionArrivals(
  faction: FactionId,
  intents: readonly AdvanceIntent[],
): FactionArrival {
  const anyTerminus = intents.some((i) => i.isTerminus);
  let totalCount = 0;
  let earliestDispatched = (intents[0] as AdvanceIntent).stack.dispatchedAtTick;
  for (const i of intents) {
    totalCount += i.stack.count;
    if (i.stack.dispatchedAtTick < earliestDispatched) {
      earliestDispatched = i.stack.dispatchedAtTick;
    }
  }

  let chosen: AdvanceIntent;
  if (anyTerminus) {
    chosen = intents.find((i) => i.isTerminus) as AdvanceIntent;
  } else {
    const ranked = intents.slice().sort((a, b) => {
      const remA = a.stack.path.length - 1 - a.nextIdx;
      const remB = b.stack.path.length - 1 - b.nextIdx;
      if (remA !== remB) return remA - remB;
      if (a.stack.dispatchedAtTick !== b.stack.dispatchedAtTick) {
        return a.stack.dispatchedAtTick - b.stack.dispatchedAtTick;
      }
      return a.stack.id < b.stack.id ? -1 : 1;
    });
    chosen = ranked[0] as AdvanceIntent;
  }

  return {
    faction,
    count: totalCount,
    anyTerminus,
    chosenPath: chosen.stack.path,
    chosenIdx: chosen.nextIdx,
    chosenDispatchedAtTick: earliestDispatched,
    chosenId: chosen.stack.id,
  };
}

function orderKey(from: TileId, to: TileId, faction: FactionId): string {
  return `${from}|${to}|${faction}`;
}

// PRD §3.5.4' (v1.4): advance every marching stack one step. Ownership of the
// next tile is read against the start-of-phase snapshot so same-tick arrivals
// are independent.
//   • next tile own + terminus → move in (garrison).
//   • next tile own + not terminus → step (keep marching).
//   • next tile not own → siege: garrison the current (staging) tile and
//     register an AttackOrder current→next. Covers both an enemy terminus and a
//     mid-path tile that flipped out of our control.
export function advanceMarching(state: GameState): GameState {
  if (state.marchingStacks.length === 0) return state;

  const intents: AdvanceIntent[] = [];
  for (const stack of state.marchingStacks) {
    const nextIdx = stack.idx + 1;
    if (nextIdx >= stack.path.length) continue; // overran terminus → drop
    intents.push({
      stack,
      nextIdx,
      nextTile: stack.path[nextIdx] as TileId,
      currentTile: stack.path[stack.idx] as TileId,
      isTerminus: nextIdx === stack.path.length - 1,
    });
  }
  if (intents.length === 0) return { ...state, marchingStacks: [] };

  const provinces = new Map<TileId, Province>(state.provinces);
  const continuing: MarchingStack[] = [];
  const orders = new Map<string, AttackOrder>();
  for (const o of state.attackOrders) orders.set(orderKey(o.from, o.to, o.faction), o);

  // Group by (nextTile, faction); ownership of nextTile is uniform per group.
  const byTile = new Map<TileId, AdvanceIntent[]>();
  for (const intent of intents) {
    const list = byTile.get(intent.nextTile);
    if (list === undefined) byTile.set(intent.nextTile, [intent]);
    else list.push(intent);
  }

  for (const [nextTile, group] of byTile) {
    const byFaction = new Map<FactionId, AdvanceIntent[]>();
    for (const intent of group) {
      const list = byFaction.get(intent.stack.faction);
      if (list === undefined) byFaction.set(intent.stack.faction, [intent]);
      else list.push(intent);
    }

    for (const [faction, factionIntents] of byFaction) {
      const snapshotNext = state.provinces.get(nextTile);
      const ownNext =
        snapshotNext !== undefined && isOwnClaimed(snapshotNext, faction);

      if (ownNext) {
        const arrival = mergeFactionArrivals(faction, factionIntents);
        if (arrival.anyTerminus) {
          const p = provinces.get(nextTile);
          if (p !== undefined) {
            provinces.set(nextTile, garrison(p, faction, arrival.count, state.tick));
          }
        } else {
          continuing.push({
            id: arrival.chosenId,
            faction,
            count: arrival.count,
            path: arrival.chosenPath,
            idx: arrival.chosenIdx,
            dispatchedAtTick: arrival.chosenDispatchedAtTick,
          });
        }
      } else {
        // Siege (PRD §3.6' / v1.5): the column's troops go into the order's
        // `count` — NOT a staging-tile garrison — so a source castle reserve or
        // a tile we passed never gets conscripted. Sub-group by staging tile so
        // different approaches stay distinct; the order also carries the route
        // beyond the target so the column keeps conquering after capture.
        const byStaging = new Map<TileId, AdvanceIntent[]>();
        for (const intent of factionIntents) {
          const list = byStaging.get(intent.currentTile);
          if (list === undefined) byStaging.set(intent.currentTile, [intent]);
          else list.push(intent);
        }
        for (const [staging, stagingIntents] of byStaging) {
          let count = 0;
          let route: readonly TileId[] = [];
          let bestRemaining = -1;
          for (const i of stagingIntents) {
            count += i.stack.count;
            const remaining = i.stack.path.length - (i.nextIdx + 1);
            if (remaining > bestRemaining) {
              bestRemaining = remaining;
              route = i.stack.path.slice(i.nextIdx + 1);
            }
          }
          const key = orderKey(staging, nextTile, faction);
          const existing = orders.get(key);
          if (existing !== undefined) {
            // Reinforce an ongoing siege of the same target from the same tile.
            orders.set(key, { ...existing, count: existing.count + count });
          } else {
            orders.set(key, {
              from: staging,
              to: nextTile,
              faction,
              count,
              route,
              startTick: state.tick,
            });
          }
        }
      }
    }
  }

  return {
    ...state,
    provinces,
    marchingStacks: continuing,
    attackOrders: [...orders.values()],
  };
}

export { derivedOwner };
