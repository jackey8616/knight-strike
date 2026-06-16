import { describe, expect, it } from "vitest";
import { tileId } from "./state";
import { step } from "./tick";
import {
  AI_IDLE,
  type FactionId,
  type GameState,
  type Occupant,
  type Province,
} from "./types";

function makeState(
  provinces: ReadonlyMap<string, Province>,
  tick = 0,
): GameState {
  return {
    boardSize: 11,
    tick,
    provinces,
    marchingStacks: [],
    aiConfig: {
      TOKUGAWA: AI_IDLE,
      TAKEDA: AI_IDLE,
      ODA: AI_IDLE,
      UESUGI: AI_IDLE,
      NEUTRAL: AI_IDLE,
    },
    defeated: new Set<FactionId>(),
    rngSeed: 42,
    nextMarchingId: 1,
  };
}

function occ(
  faction: FactionId,
  amount: number,
  arrivalTick = 0,
  isDefender = false,
): Occupant {
  return { faction, amount, arrivalTick, isDefender };
}

function tile(
  id: string,
  occupants: readonly Occupant[],
  opts: { isCastle?: boolean; castleOwner?: FactionId | null; combatStartTick?: number | null } = {},
): Province {
  return {
    id,
    x: 0,
    y: 0,
    isCastle: opts.isCastle ?? false,
    castleOwner: opts.castleOwner ?? null,
    occupants,
    combatStartTick: opts.combatStartTick ?? null,
  };
}

describe("step (tick orchestrator)", () => {
  it("[AC-V2-02] increments tick by 1", () => {
    const s = makeState(new Map(), 5);
    expect(step(s).tick).toBe(6);
  });

  it("[AC-V2-26] production runs before combat: castle defender gets +1 then attacks", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(
          id,
          [occ("TOKUGAWA", 1, 0, true), occ("TAKEDA", 5, 0, false)],
          { isCastle: true, castleOwner: "TOKUGAWA", combatStartTick: null },
        ),
      ],
      // Need other castles so applyDefeats doesn't kill everyone
      [
        tileId(10, 0),
        tile(
          tileId(10, 0),
          [occ("TAKEDA", 3, 0, true)],
          { isCastle: true, castleOwner: "TAKEDA" },
        ),
      ],
      [
        tileId(0, 10),
        tile(
          tileId(0, 10),
          [occ("ODA", 3, 0, true)],
          { isCastle: true, castleOwner: "ODA" },
        ),
      ],
      [
        tileId(10, 10),
        tile(
          tileId(10, 10),
          [occ("UESUGI", 3, 0, true)],
          { isCastle: true, castleOwner: "UESUGI" },
        ),
      ],
    ]);
    // Step with tick currently 1 → after step, state.tick becomes 2.
    // (Production gates on `tick > 0`, so we start at 1 to exercise it.)
    // During the step at state.tick = 1:
    //   1. movement: no stacks → no-op
    //   2. produce: TOKUGAWA amount 1 → 2 (castle owner gains +1)
    //   3. combat: combatStartTick=0, t = 1-0 = 1, damage=1, both attack.
    //      A→B = min(1, 2) = 1, B→A = min(1, 5) = 1.
    //      But wait — the v1.2 test wants to show production preceding combat
    //      at t=0. So setup combatStartTick=null and start tick=1: then
    //      combat first runs with tick=1, combatStartTick gets set to 1,
    //      t=0, defender (TOK) attacks TAK for min(1, 2)=1; TAK silent.
    //      TOK ends at 2 (1 + produce); TAK ends at 4 (5 - 1).
    const out = step(makeState(provinces, 1));
    const final = out.provinces.get(id) as Province;
    const tok = final.occupants.find((o) => o.faction === "TOKUGAWA");
    const tak = final.occupants.find((o) => o.faction === "TAKEDA");
    expect(tok?.amount).toBe(2);
    expect(tak?.amount).toBe(4);
  });

  it("contested tile combat: combatStartTick set on first step", () => {
    const id = tileId(0, 0);
    const provinces = new Map([
      [
        id,
        tile(
          id,
          [occ("TOKUGAWA", 5, 0, true), occ("TAKEDA", 5, 0, false)],
          { combatStartTick: null },
        ),
      ],
      // Add other castles so applyDefeats doesn't trigger
      [
        tileId(10, 10),
        tile(
          tileId(10, 10),
          [occ("UESUGI", 3, 0, true)],
          { isCastle: true, castleOwner: "UESUGI" },
        ),
      ],
    ]);
    // No castle on the contested tile, but TOK and TAK have no castles either,
    // so applyDefeats will mark them defeated. To keep the test focused on
    // combat-tick semantics, give both factions a castle.
    provinces.set(
      tileId(1, 0),
      tile(
        tileId(1, 0),
        [occ("TOKUGAWA", 3, 0, true)],
        { isCastle: true, castleOwner: "TOKUGAWA" },
      ),
    );
    provinces.set(
      tileId(2, 0),
      tile(
        tileId(2, 0),
        [occ("TAKEDA", 3, 0, true)],
        { isCastle: true, castleOwner: "TAKEDA" },
      ),
    );
    provinces.set(
      tileId(3, 0),
      tile(
        tileId(3, 0),
        [occ("ODA", 3, 0, true)],
        { isCastle: true, castleOwner: "ODA" },
      ),
    );
    const out = step(makeState(provinces, 0));
    const final = out.provinces.get(id) as Province;
    expect(final.combatStartTick).toBe(0);
  });
});
