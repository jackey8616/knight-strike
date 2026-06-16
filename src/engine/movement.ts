import {
  derivedOwner,
  findOccupant,
  isContested,
  parseTileId,
  tileId,
} from "./state";
import type {
  FactionId,
  GameState,
  MarchingStack,
  Occupant,
  Province,
  TileId,
} from "./types";
import { createRng } from "./util/rng";

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// PRD §3.5.2 (v1.2): intermediate tiles in a BFS path must be either empty
// (no occupants) or single-faction self-owned. Any hostile occupant — even
// alongside friendly ones — blocks transit, since arriving at a contested
// tile triggers force-join (§3.5.4 #2(e)) and the stack can't reach further
// down the original path.
function isPassableIntermediate(
  province: Province | undefined,
  faction: FactionId,
): boolean {
  if (province === undefined) return false;
  if (province.occupants.length === 0) return true;
  for (const o of province.occupants) {
    if (o.faction !== faction) return false;
  }
  return true;
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
  // PRD §3.5.1: dispatch must originate from a fully-owned source tile
  // (single own-faction occupant). Contested or empty source = no dispatch.
  if (derivedOwner(source) !== faction) return null;

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
      if (isPassableIntermediate(np, faction)) queue.push(nid);
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

// Update a province by replacing the occupant of `faction` with a new
// amount; drop the occupant entirely if amount reaches 0. Returns the new
// province (immutable copy).
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
    // amount <= 0 → drop occupant
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

// Player cancel — drop the stack back onto its current tile as if it had
// just arrived (force-join semantics if the current tile is contested).
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
  newProvinces.set(tileAt, mergeArrivalIntoTile(province, stack.faction, stack.count, state.tick));

  const newStacks = state.marchingStacks.filter((s) => s.id !== stackId);
  return {
    ok: true,
    state: { ...state, provinces: newProvinces, marchingStacks: newStacks },
  };
}

// PRD §3.5.4 (v1.2): landing one faction's merged arrival onto a tile.
// Same-faction occupant present → merge amount. Otherwise add new occupant
// at currentTick with isDefender=false (combat.ts re-assigns defender on
// combat start). isDefender=true is only granted in the special path:
// empty tile + single arriving faction this tick, set by callers via
// `mergeArrivalIntoTileEmptyFirstArrival`.
function mergeArrivalIntoTile(
  province: Province,
  faction: FactionId,
  amount: number,
  currentTick: number,
): Province {
  const existing = findOccupant(province, faction);
  if (existing !== undefined) {
    const updated = province.occupants.map((o) =>
      o.faction === faction ? { ...o, amount: o.amount + amount } : o,
    );
    return { ...province, occupants: updated };
  }
  const newOccupant: Occupant = {
    faction,
    amount,
    arrivalTick: currentTick,
    isDefender: false,
  };
  return { ...province, occupants: [...province.occupants, newOccupant] };
}

function mergeArrivalIntoTileAsDefender(
  province: Province,
  faction: FactionId,
  amount: number,
  currentTick: number,
): Province {
  const existing = findOccupant(province, faction);
  if (existing !== undefined) {
    const updated = province.occupants.map((o) =>
      o.faction === faction ? { ...o, amount: o.amount + amount } : o,
    );
    return { ...province, occupants: updated };
  }
  const newOccupant: Occupant = {
    faction,
    amount,
    arrivalTick: currentTick,
    isDefender: true,
  };
  return { ...province, occupants: [...province.occupants, newOccupant] };
}

type AdvanceIntent = {
  readonly stack: MarchingStack;
  readonly nextIdx: number;
  readonly nextTile: TileId;
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
    // PRD §3.5.4 #1 path pick: fewest remaining steps; tiebreak on earliest
    // dispatched; final tiebreak on id (lex).
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

// Deterministic shuffle of a small list (used when 2+ factions co-arrive on
// an empty tile and the defender slot must be assigned by RNG).
function hashTileId(id: TileId): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

function pickInitialDefenderFromTies(
  state: GameState,
  tile: TileId,
  factions: readonly FactionId[],
): FactionId {
  if (factions.length === 1) return factions[0] as FactionId;
  const sorted = [...factions].sort();
  const rng = createRng((state.rngSeed ^ hashTileId(tile) ^ state.tick) >>> 0);
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = sorted[i] as FactionId;
    sorted[i] = sorted[j] as FactionId;
    sorted[j] = tmp;
  }
  return sorted[0] as FactionId;
}

export function advanceMarching(state: GameState): GameState {
  if (state.marchingStacks.length === 0) return state;

  const intents: AdvanceIntent[] = [];
  for (const stack of state.marchingStacks) {
    const nextIdx = stack.idx + 1;
    if (nextIdx >= stack.path.length) continue;
    const nextTile = stack.path[nextIdx] as TileId;
    const isTerminus = nextIdx === stack.path.length - 1;
    intents.push({ stack, nextIdx, nextTile, isTerminus });
  }

  if (intents.length === 0) {
    // All marching stacks have invalid idx — drop them defensively.
    return { ...state, marchingStacks: [] };
  }

  // Group intents by tile
  const byTile = new Map<TileId, AdvanceIntent[]>();
  for (const intent of intents) {
    const list = byTile.get(intent.nextTile);
    if (list === undefined) byTile.set(intent.nextTile, [intent]);
    else list.push(intent);
  }

  const newProvinces = new Map<TileId, Province>(state.provinces);
  const continuingStacks: MarchingStack[] = [];

  for (const [tile, group] of byTile) {
    const province = newProvinces.get(tile);
    if (province === undefined) continue;

    // Merge same-faction intents on this tile (§3.5.4 #1)
    const byFaction = new Map<FactionId, AdvanceIntent[]>();
    for (const intent of group) {
      const list = byFaction.get(intent.stack.faction);
      if (list === undefined) byFaction.set(intent.stack.faction, [intent]);
      else list.push(intent);
    }
    const arrivals: FactionArrival[] = [];
    for (const [faction, intents] of byFaction) {
      arrivals.push(mergeFactionArrivals(faction, intents));
    }

    // Determine final faction set on the tile after this tick's arrivals.
    // forceJoin = the resulting tile would be contested (2+ distinct factions).
    const existingFactions = new Set<FactionId>(
      province.occupants.map((o) => o.faction),
    );
    const arrivingFactions = new Set<FactionId>(arrivals.map((a) => a.faction));
    const allFactions = new Set<FactionId>();
    for (const f of existingFactions) allFactions.add(f);
    for (const f of arrivingFactions) allFactions.add(f);
    const forceJoin = allFactions.size >= 2;

    let workingProvince: Province = province;

    for (const arrival of arrivals) {
      const landing = forceJoin || arrival.anyTerminus;
      if (landing) {
        // Decide whether this arrival becomes the initial defender of a
        // brand-new empty tile (single arriving faction, no existing
        // occupants). Otherwise isDefender=false; combat.ts may re-assign on
        // combat start.
        const tileWasEmpty = existingFactions.size === 0;
        const onlyOneArrivingFaction = arrivals.length === 1;
        const becomesDefender =
          tileWasEmpty && onlyOneArrivingFaction && !forceJoin;
        if (becomesDefender) {
          workingProvince = mergeArrivalIntoTileAsDefender(
            workingProvince,
            arrival.faction,
            arrival.count,
            state.tick,
          );
        } else {
          workingProvince = mergeArrivalIntoTile(
            workingProvince,
            arrival.faction,
            arrival.count,
            state.tick,
          );
        }
      } else {
        // Pass through — single-faction, no terminus, no force-join.
        continuingStacks.push({
          id: arrival.chosenId,
          faction: arrival.faction,
          count: arrival.count,
          path: arrival.chosenPath,
          idx: arrival.chosenIdx,
          dispatchedAtTick: arrival.chosenDispatchedAtTick,
        });
      }
    }

    // §3.5.4 #3: when 2+ factions co-arrived on a previously-empty tile this
    // tick, assign one as initial defender via RNG. This pre-stages the
    // defender flag so combat.ts assignDefender can re-derive the same pick
    // (smallest arrivalTick + RNG tiebreak with the same seed → same result).
    if (
      forceJoin &&
      existingFactions.size === 0 &&
      arrivingFactions.size >= 2
    ) {
      const chosenDefender = pickInitialDefenderFromTies(
        state,
        tile,
        [...arrivingFactions],
      );
      const adjusted = workingProvince.occupants.map((o) =>
        o.arrivalTick === state.tick && arrivingFactions.has(o.faction)
          ? { ...o, isDefender: o.faction === chosenDefender }
          : o,
      );
      workingProvince = { ...workingProvince, occupants: adjusted };
    }

    // When force-join into an already-occupied tile, ensure the newly added
    // occupants are isDefender=false (mergeArrivalIntoTile already does this,
    // so nothing extra here).

    // If the tile transitions into contested this tick, combat.ts will fill in
    // combatStartTick at the next combat step. No-op here.
    newProvinces.set(tile, workingProvince);
  }

  return {
    ...state,
    provinces: newProvinces,
    marchingStacks: continuingStacks,
  };
}

// Convenience re-export so callers reading derived ownership can do so
// alongside dispatch / findPath without a second import.
export { derivedOwner, isContested };
