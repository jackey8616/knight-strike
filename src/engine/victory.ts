import type {
  FactionId,
  GameState,
  MarchingStack,
  Province,
  TileId,
} from "./types";

export const NON_NEUTRAL_FACTIONS: readonly FactionId[] = [
  "TOKUGAWA",
  "TAKEDA",
  "ODA",
  "UESUGI",
];

export type GameOutcome =
  | { readonly status: "ongoing" }
  | { readonly status: "ended"; readonly winner: FactionId | null };

function ownsAnyCastle(state: GameState, faction: FactionId): boolean {
  for (const p of state.provinces.values()) {
    if (p.isCastle && p.owner === faction) return true;
  }
  return false;
}

export function applyDefeats(state: GameState): GameState {
  const newlyDefeated: FactionId[] = [];
  for (const faction of NON_NEUTRAL_FACTIONS) {
    if (state.defeated.has(faction)) continue;
    if (ownsAnyCastle(state, faction)) continue;
    newlyDefeated.push(faction);
  }

  if (newlyDefeated.length === 0) return state;

  const newlySet = new Set<FactionId>(newlyDefeated);
  const newDefeated = new Set<FactionId>(state.defeated);
  for (const faction of newlyDefeated) newDefeated.add(faction);

  // PRD §6.3: defeated faction's non-castle tiles immediately become NEUTRAL.
  // The captured castle keeps its new owner (already set by upstream resolvers),
  // so leave isCastle tiles untouched here.
  let provincesChanged = false;
  const newProvinces = new Map<TileId, Province>(state.provinces);
  for (const [id, province] of state.provinces) {
    if (province.isCastle) continue;
    if (!newlySet.has(province.owner)) continue;
    newProvinces.set(id, { ...province, owner: "NEUTRAL" });
    provincesChanged = true;
  }

  // PRD §6.3: remaining marching stacks of a defeated faction stay on the board
  // as "野怪" — they still fight under §3.6 but never act on their own. Flipping
  // their faction to NEUTRAL is the simplest way to make every downstream
  // resolver treat them like bandits without a special-case branch.
  let stacksChanged = false;
  const newStacks: MarchingStack[] = [];
  for (const stack of state.marchingStacks) {
    if (newlySet.has(stack.faction)) {
      newStacks.push({ ...stack, faction: "NEUTRAL" });
      stacksChanged = true;
    } else {
      newStacks.push(stack);
    }
  }

  return {
    ...state,
    provinces: provincesChanged ? newProvinces : state.provinces,
    marchingStacks: stacksChanged ? newStacks : state.marchingStacks,
    defeated: newDefeated,
  };
}

export function evaluateOutcome(state: GameState): GameOutcome {
  const alive: FactionId[] = [];
  for (const faction of NON_NEUTRAL_FACTIONS) {
    if (!state.defeated.has(faction)) alive.push(faction);
  }
  if (alive.length === 0) return { status: "ended", winner: null };
  if (alive.length === 1) {
    return { status: "ended", winner: alive[0] as FactionId };
  }
  return { status: "ongoing" };
}
