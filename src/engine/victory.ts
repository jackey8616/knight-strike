import { findOccupant } from "./state";
import type {
  FactionId,
  GameState,
  MarchingStack,
  Occupant,
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

// PRD §6.1 v1.2: castle "held" by its castleOwner means the owner faction has
// an occupant on that castle tile. Empty castle or castle with only enemy
// occupants → owner has fallen.
function holdsCastle(state: GameState, faction: FactionId): boolean {
  for (const p of state.provinces.values()) {
    if (!p.isCastle) continue;
    if (p.castleOwner !== faction) continue;
    if (findOccupant(p, faction) !== undefined) return true;
  }
  return false;
}

export function applyDefeats(state: GameState): GameState {
  const newlyDefeated: FactionId[] = [];
  for (const faction of NON_NEUTRAL_FACTIONS) {
    if (state.defeated.has(faction)) continue;
    if (holdsCastle(state, faction)) continue;
    newlyDefeated.push(faction);
  }

  if (newlyDefeated.length === 0) return state;

  const newlySet = new Set<FactionId>(newlyDefeated);
  const newDefeated = new Set<FactionId>(state.defeated);
  for (const faction of newlyDefeated) newDefeated.add(faction);

  // PRD §6.3 v1.2: defeated faction's remaining occupants become NEUTRAL
  // (passive punching bags). Walk every tile and rewrite any occupant of the
  // newly-defeated factions. Same-tile NEUTRAL collision (defeated A turned
  // NEUTRAL on a tile that already had NEUTRAL) merges into one NEUTRAL entry.
  let provincesChanged = false;
  const newProvinces = new Map<TileId, Province>(state.provinces);
  for (const [id, province] of state.provinces) {
    let touched = false;
    let remappedOccupants: Occupant[] = [];
    for (const o of province.occupants) {
      if (newlySet.has(o.faction)) {
        remappedOccupants.push({ ...o, faction: "NEUTRAL", isDefender: false });
        touched = true;
      } else {
        remappedOccupants.push(o);
      }
    }
    if (!touched) continue;
    // Coalesce duplicate NEUTRAL entries that arose from the rewrite.
    const neutrals = remappedOccupants.filter((o) => o.faction === "NEUTRAL");
    if (neutrals.length > 1) {
      const totalAmount = neutrals.reduce((sum, o) => sum + o.amount, 0);
      const minArrival = neutrals.reduce(
        (min, o) => Math.min(min, o.arrivalTick),
        Number.POSITIVE_INFINITY,
      );
      const others = remappedOccupants.filter((o) => o.faction !== "NEUTRAL");
      remappedOccupants = [
        ...others,
        {
          faction: "NEUTRAL",
          amount: totalAmount,
          arrivalTick: minArrival === Number.POSITIVE_INFINITY ? 0 : minArrival,
          isDefender: false,
        },
      ];
    }
    newProvinces.set(id, { ...province, occupants: remappedOccupants });
    provincesChanged = true;
  }

  // PRD §6.3 v1.2 (rewrite): defeated faction's marching stacks are dropped
  // immediately rather than re-mapped to NEUTRAL — keeping them around would
  // let dead factions still create occupants on arrival, which the v1.2
  // multi-occupant model can't sanely route.
  let stacksChanged = false;
  const newStacks: MarchingStack[] = [];
  for (const stack of state.marchingStacks) {
    if (newlySet.has(stack.faction)) {
      stacksChanged = true;
      continue;
    }
    newStacks.push(stack);
  }

  // PRD §4.6 / step order step 4: a defeated faction's sieges drop with it.
  let ordersChanged = false;
  const newOrders = state.attackOrders.filter((o) => {
    if (newlySet.has(o.faction)) {
      ordersChanged = true;
      return false;
    }
    return true;
  });

  return {
    ...state,
    provinces: provincesChanged ? newProvinces : state.provinces,
    marchingStacks: stacksChanged ? newStacks : state.marchingStacks,
    attackOrders: ordersChanged ? newOrders : state.attackOrders,
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
