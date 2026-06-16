import { findOccupant } from "./state";
import type { GameState, Occupant, Province, TileId } from "./types";

// PRD §3.3 v1.2: castles produce 1 unit per tick, added to the castleOwner's
// occupant on that tile. If the castleOwner has no occupant (castle empty
// or contested without owner presence), production is skipped this tick.
// Step order (§3.2) puts production between movement and combat, so the
// newly produced unit can immediately participate in the same-tick combat
// addition phase as reinforcement.
export const PRODUCTION_CAP = 100;

export function produce(state: GameState): GameState {
  if (state.tick <= 0) return state;

  let provincesNext: Map<TileId, Province> | null = null;
  for (const [id, province] of state.provinces) {
    if (!province.isCastle) continue;
    const owner = province.castleOwner;
    if (owner === null || owner === "NEUTRAL") continue;
    if (state.defeated.has(owner)) continue;

    const ownerOccupant = findOccupant(province, owner);
    if (ownerOccupant === undefined) continue;
    if (ownerOccupant.amount >= PRODUCTION_CAP) continue;

    const newAmount = Math.min(ownerOccupant.amount + 1, PRODUCTION_CAP);
    const updatedOccupants: Occupant[] = province.occupants.map((o) =>
      o.faction === owner ? { ...o, amount: newAmount } : o,
    );

    if (provincesNext === null) provincesNext = new Map(state.provinces);
    provincesNext.set(id, { ...province, occupants: updatedOccupants });
  }

  if (provincesNext === null) return state;
  return { ...state, provinces: provincesNext };
}
