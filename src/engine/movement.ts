import { computeLoss, tilePower } from "./combat";
import { parseTileId, tileId } from "./state";
import type {
  FactionId,
  GameState,
  MarchingStack,
  Province,
  TileId,
} from "./types";

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function isPassableIntermediate(
  province: Province | undefined,
  faction: FactionId,
): boolean {
  if (province === undefined) return false;
  if (province.owner === faction) return true;
  // PRD §3.5.2 passable rule: own faction tiles OR empty neutral. Anything else
  // (enemy with garrison, enemy empty, neutral with bandits) is wall to BFS.
  return province.owner === "NEUTRAL" && province.count === 0;
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
  if (source.owner !== faction) return null;

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
        // PRD §3.5.2: target tile is exempt from passable; reached → reconstruct.
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
      if (isPassableIntermediate(np, faction)) {
        queue.push(nid);
      }
    }
  }

  return null;
}

export type DispatchRatio = 0.25 | 0.5 | 0.75 | 1.0;

export type DispatchCommand = {
  readonly from: TileId;
  readonly to: TileId;
  readonly ratio: DispatchRatio;
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

export function dispatch(state: GameState, cmd: DispatchCommand): DispatchResult {
  const source = state.provinces.get(cmd.from);
  if (source === undefined) return { ok: false, state, reason: "no-source" };
  if (source.owner === "NEUTRAL") {
    return { ok: false, state, reason: "wrong-owner" };
  }
  if (source.count <= 0) return { ok: false, state, reason: "no-count" };
  // PRD §3.5.1 castle reserve: a castle source must always leave ≥ 1 behind.
  // When count == 1 the dispatch is impossible — fail early to keep AC-16 honest.
  if (source.isCastle && source.count <= 1) {
    return { ok: false, state, reason: "castle-min-1" };
  }

  const faction = source.owner;
  const path = findPath(state, cmd.from, cmd.to, faction);
  if (path === null || path.length < 2) {
    return { ok: false, state, reason: "no-path" };
  }

  let toSend = Math.max(1, Math.floor(source.count * cmd.ratio));
  toSend = Math.min(toSend, source.count);
  if (source.isCastle) {
    toSend = Math.min(toSend, source.count - 1);
  }

  const stack: MarchingStack = {
    id: `mstack:${state.nextMarchingId}`,
    faction,
    count: toSend,
    path,
    idx: 0,
    dispatchedAtTick: state.tick,
  };

  const newSource: Province = { ...source, count: source.count - toSend };
  const newProvinces = new Map<TileId, Province>(state.provinces);
  newProvinces.set(cmd.from, newSource);

  const newState: GameState = {
    ...state,
    provinces: newProvinces,
    marchingStacks: [...state.marchingStacks, stack],
    nextMarchingId: state.nextMarchingId + 1,
  };

  return { ok: true, state: newState, stack };
}

type AdvanceIntent = {
  readonly stack: MarchingStack;
  readonly newIdx: number;
  readonly newTile: TileId;
  readonly stalled: boolean;
};

type FactionArrival = {
  readonly faction: FactionId;
  readonly count: number;
  readonly chosenPath: readonly TileId[];
  readonly chosenIdx: number;
  readonly chosenDispatchedAtTick: number;
  readonly chosenId: string;
  readonly atTerminus: boolean;
};

export function advanceMarching(state: GameState): GameState {
  if (state.marchingStacks.length === 0) return state;

  const intents: AdvanceIntent[] = [];
  for (const stack of state.marchingStacks) {
    const nextIdx = stack.idx + 1;
    if (nextIdx >= stack.path.length) {
      // Defensive: a well-formed pipeline resolves stacks on arrival, so this
      // branch only fires if state was constructed by hand with an out-of-range
      // idx. Drop the stack rather than throw to keep step() total.
      continue;
    }
    const nextTile = stack.path[nextIdx] as TileId;
    const isTerminus = nextIdx === stack.path.length - 1;
    if (isTerminus) {
      intents.push({ stack, newIdx: nextIdx, newTile: nextTile, stalled: false });
      continue;
    }
    const np = state.provinces.get(nextTile);
    if (isPassableIntermediate(np, stack.faction)) {
      intents.push({ stack, newIdx: nextIdx, newTile: nextTile, stalled: false });
    } else {
      // PRD §3.5.4 #6 path cut: hold position, idx unchanged.
      intents.push({
        stack,
        newIdx: stack.idx,
        newTile: stack.path[stack.idx] as TileId,
        stalled: true,
      });
    }
  }

  const newProvinces = new Map<TileId, Province>(state.provinces);
  const newStacks: MarchingStack[] = [];

  for (const intent of intents) {
    if (intent.stalled) newStacks.push(intent.stack);
  }

  const groups = new Map<TileId, AdvanceIntent[]>();
  for (const intent of intents) {
    if (intent.stalled) continue;
    const list = groups.get(intent.newTile);
    if (list === undefined) groups.set(intent.newTile, [intent]);
    else list.push(intent);
  }

  for (const [tile, group] of groups) {
    resolveArrival(tile, group, newProvinces, newStacks);
  }

  return {
    ...state,
    provinces: newProvinces,
    marchingStacks: newStacks,
  };
}

function mergeFactionArrival(
  faction: FactionId,
  intents: readonly AdvanceIntent[],
): FactionArrival {
  const anyTerminus = intents.some(
    (i) => i.newIdx === i.stack.path.length - 1,
  );

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
    chosen = intents.find(
      (i) => i.newIdx === i.stack.path.length - 1,
    ) as AdvanceIntent;
  } else {
    // PRD §3.5.4 #2 path selection: fewest remaining steps wins;
    // tiebreak on earlier dispatchedAtTick; final tiebreak on id (lex).
    const ranked = intents.slice().sort((a, b) => {
      const remA = a.stack.path.length - 1 - a.newIdx;
      const remB = b.stack.path.length - 1 - b.newIdx;
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
    chosenPath: chosen.stack.path,
    chosenIdx: chosen.newIdx,
    chosenDispatchedAtTick: earliestDispatched,
    chosenId: chosen.stack.id,
    atTerminus: anyTerminus,
  };
}

function resolveArrival(
  tile: TileId,
  group: readonly AdvanceIntent[],
  newProvinces: Map<TileId, Province>,
  newStacks: MarchingStack[],
): void {
  const byFaction = new Map<FactionId, AdvanceIntent[]>();
  for (const intent of group) {
    const f = intent.stack.faction;
    const list = byFaction.get(f);
    if (list === undefined) byFaction.set(f, [intent]);
    else list.push(intent);
  }

  const arrivals: FactionArrival[] = [];
  for (const [faction, intents] of byFaction) {
    arrivals.push(mergeFactionArrival(faction, intents));
  }

  if (arrivals.length === 1) {
    resolveSingleFactionArrival(
      arrivals[0] as FactionArrival,
      tile,
      newProvinces,
      newStacks,
    );
  } else {
    resolveHeadOnCollision(arrivals, tile, newProvinces, newStacks);
  }
}

function continueAsMarching(
  arrival: FactionArrival,
  surviving: number,
  newStacks: MarchingStack[],
): void {
  if (surviving <= 0) return;
  newStacks.push({
    id: arrival.chosenId,
    faction: arrival.faction,
    count: surviving,
    path: arrival.chosenPath,
    idx: arrival.chosenIdx,
    dispatchedAtTick: arrival.chosenDispatchedAtTick,
  });
}

function resolveSingleFactionArrival(
  arrival: FactionArrival,
  tile: TileId,
  newProvinces: Map<TileId, Province>,
  newStacks: MarchingStack[],
): void {
  const province = newProvinces.get(tile);
  if (province === undefined) return;

  if (province.owner === arrival.faction) {
    if (arrival.atTerminus) {
      // PRD §3.5.4 #1 terminus branch: marching count joins garrison.
      newProvinces.set(tile, {
        ...province,
        count: province.count + arrival.count,
      });
    } else {
      // Non-terminus through own tile: pass through without disturbing garrison.
      continueAsMarching(arrival, arrival.count, newStacks);
    }
    return;
  }

  if (province.count === 0) {
    // Empty tile (neutral-empty or enemy-empty). At terminus we claim it;
    // otherwise we treat it as a passable intermediate and continue.
    if (arrival.atTerminus) {
      newProvinces.set(tile, {
        ...province,
        owner: arrival.faction,
        count: arrival.count,
      });
    } else {
      continueAsMarching(arrival, arrival.count, newStacks);
    }
    return;
  }

  if (!arrival.atTerminus) {
    // Garrisoned enemy on the path mid-flight — BFS should never produce this,
    // so just drop the stack defensively.
    return;
  }

  // PRD §3.5.4 #5 marching vs garrison: garrison plays terminus side.
  const ownPower = tilePower(arrival.count);
  const oppPower = tilePower(province.count);
  const lossOwn = computeLoss(ownPower, oppPower);
  const lossOpp = computeLoss(oppPower, ownPower);
  const survOwn = Math.max(0, arrival.count - lossOwn);
  const survOpp = Math.max(0, province.count - lossOpp);

  if (survOwn === 0 && survOpp === 0) {
    newProvinces.set(tile, { ...province, count: 0 });
  } else if (survOwn > 0 && survOpp === 0) {
    newProvinces.set(tile, {
      ...province,
      owner: arrival.faction,
      count: survOwn,
    });
  } else if (survOwn === 0 && survOpp > 0) {
    newProvinces.set(tile, { ...province, count: survOpp });
  } else {
    // Both alive: defender keeps the tile (terminus-side wins ties); attacker
    // survivors are destroyed since they can't co-occupy.
    newProvinces.set(tile, { ...province, count: survOpp });
  }
}

function resolveHeadOnCollision(
  arrivals: readonly FactionArrival[],
  tile: TileId,
  newProvinces: Map<TileId, Province>,
  newStacks: MarchingStack[],
): void {
  const province = newProvinces.get(tile);
  if (province === undefined) return;

  // PRD §3.5.4 #4 head-on: dry-run mutual loss vs every other faction's power.
  const powers = arrivals.map((a) => tilePower(a.count));
  const losses = arrivals.map((_, i) => {
    let total = 0;
    for (let j = 0; j < arrivals.length; j++) {
      if (i === j) continue;
      total += computeLoss(powers[i] as number, powers[j] as number);
    }
    return total;
  });
  const survivors = arrivals.map((a, i) =>
    Math.max(0, a.count - (losses[i] as number)),
  );

  // Non-terminus survivors keep marching (sub-scenario b). Terminus survivors
  // compete for the tile.
  const aliveAtTerminus: { arrival: FactionArrival; surviving: number }[] = [];
  for (let i = 0; i < arrivals.length; i++) {
    const a = arrivals[i] as FactionArrival;
    const surv = survivors[i] as number;
    if (surv <= 0) continue;
    if (a.atTerminus) {
      aliveAtTerminus.push({ arrival: a, surviving: surv });
    } else {
      continueAsMarching(a, surv, newStacks);
    }
  }

  if (aliveAtTerminus.length === 0) return;

  if (aliveAtTerminus.length === 1) {
    const winner = aliveAtTerminus[0] as { arrival: FactionArrival; surviving: number };
    newProvinces.set(tile, {
      ...province,
      owner: winner.arrival.faction,
      count: winner.surviving,
    });
    return;
  }

  // Multiple terminus winners (rare 3+-way arrival): higher surviving count
  // wins; deterministic tiebreak by faction id lex.
  let best = aliveAtTerminus[0] as { arrival: FactionArrival; surviving: number };
  for (let i = 1; i < aliveAtTerminus.length; i++) {
    const cand = aliveAtTerminus[i] as { arrival: FactionArrival; surviving: number };
    if (
      cand.surviving > best.surviving ||
      (cand.surviving === best.surviving &&
        cand.arrival.faction < best.arrival.faction)
    ) {
      best = cand;
    }
  }
  newProvinces.set(tile, {
    ...province,
    owner: best.arrival.faction,
    count: best.surviving,
  });
}
