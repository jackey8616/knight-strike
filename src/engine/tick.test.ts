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
    lastClaimedFaction: null,
  };
}

describe("step (tick orchestrator)", () => {
  it("[AC-V2-02] increments tick by 1", () => {
    const s = makeState(new Map(), 5);
    expect(step(s).tick).toBe(6);
  });

  it("[AC-V2-26] non-contested castle self-replicates each tick (produce phase fires)", () => {
    // v1.3 rule: production only fires on non-contested tiles. Set up four
    // castles all uncontested with amount > 1, advance one tick, and verify
    // each castle's occupant +1.
    const provinces = new Map([
      [
        tileId(0, 0),
        tile(tileId(0, 0), [occ("TOKUGAWA", 3, 0, true)], {
          isCastle: true,
          castleOwner: "TOKUGAWA",
        }),
      ],
      [
        tileId(10, 0),
        tile(tileId(10, 0), [occ("TAKEDA", 3, 0, true)], {
          isCastle: true,
          castleOwner: "TAKEDA",
        }),
      ],
      [
        tileId(0, 10),
        tile(tileId(0, 10), [occ("ODA", 3, 0, true)], {
          isCastle: true,
          castleOwner: "ODA",
        }),
      ],
      [
        tileId(10, 10),
        tile(tileId(10, 10), [occ("UESUGI", 3, 0, true)], {
          isCastle: true,
          castleOwner: "UESUGI",
        }),
      ],
    ]);
    const out = step(makeState(provinces, 1));
    for (const id of [
      tileId(0, 0),
      tileId(10, 0),
      tileId(0, 10),
      tileId(10, 10),
    ]) {
      const tk = out.provinces.get(id) as Province;
      expect(tk.occupants[0]?.amount).toBe(4);
    }
  });

  it("contested tile does NOT produce during the produce phase (v1.3 §3.3)", () => {
    // TOK + TAK both on the same tile — produce should skip.
    const id = tileId(5, 5);
    const provinces = new Map([
      [
        id,
        tile(
          id,
          [
            occ("TOKUGAWA", 5, 0, true),
            occ("TAKEDA", 5, 0, false),
          ],
          { combatStartTick: 0 },
        ),
      ],
      // Keep both factions alive with castles so applyDefeats stays quiet.
      [
        tileId(0, 0),
        tile(tileId(0, 0), [occ("TOKUGAWA", 3, 0, true)], {
          isCastle: true,
          castleOwner: "TOKUGAWA",
        }),
      ],
      [
        tileId(10, 0),
        tile(tileId(10, 0), [occ("TAKEDA", 3, 0, true)], {
          isCastle: true,
          castleOwner: "TAKEDA",
        }),
      ],
      [
        tileId(0, 10),
        tile(tileId(0, 10), [occ("ODA", 3, 0, true)], {
          isCastle: true,
          castleOwner: "ODA",
        }),
      ],
      [
        tileId(10, 10),
        tile(tileId(10, 10), [occ("UESUGI", 3, 0, true)], {
          isCastle: true,
          castleOwner: "UESUGI",
        }),
      ],
    ]);
    const out = step(makeState(provinces, 1));
    const contested = out.provinces.get(id) as Province;
    const tok = contested.occupants.find((o) => o.faction === "TOKUGAWA");
    const tak = contested.occupants.find((o) => o.faction === "TAKEDA");
    // No produce; t=1 damage=1, both attack → both lose 1.
    expect(tok?.amount).toBe(4);
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
