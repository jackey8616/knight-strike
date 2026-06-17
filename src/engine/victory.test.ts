import { describe, expect, it } from "vitest";
import { tileId } from "./state";
import {
  AI_IDLE,
  type AttackOrder,
  type FactionId,
  type GameState,
  type MarchingStack,
  type Occupant,
  type Province,
} from "./types";
import { applyDefeats, evaluateOutcome } from "./victory";

function makeState(
  provinces: ReadonlyMap<string, Province>,
  marchingStacks: readonly MarchingStack[] = [],
  defeated: ReadonlySet<FactionId> = new Set(),
  attackOrders: readonly AttackOrder[] = [],
): GameState {
  return {
    boardSize: 11,
    tick: 1,
    provinces,
    marchingStacks,
    attackOrders,
    aiConfig: {
      TOKUGAWA: AI_IDLE,
      TAKEDA: AI_IDLE,
      ODA: AI_IDLE,
      UESUGI: AI_IDLE,
      NEUTRAL: AI_IDLE,
    },
    defeated,
    rngSeed: 42,
    nextMarchingId: 1,
  };
}

function tile(
  id: string,
  occupants: readonly Occupant[],
  opts: { isCastle?: boolean; castleOwner?: FactionId | null } = {},
): Province {
  return {
    id,
    x: 0,
    y: 0,
    isCastle: opts.isCastle ?? false,
    castleOwner: opts.castleOwner ?? null,
    occupants,
    lastClaimedFaction: occupants[0]?.faction ?? null,
  };
}

describe("applyDefeats", () => {
  it("no-op when every faction still holds its castle", () => {
    const provinces = new Map<string, Province>([
      [
        tileId(0, 0),
        tile(
          tileId(0, 0),
          [{ faction: "TOKUGAWA", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "TOKUGAWA" },
        ),
      ],
      [
        tileId(10, 0),
        tile(
          tileId(10, 0),
          [{ faction: "TAKEDA", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "TAKEDA" },
        ),
      ],
      [
        tileId(0, 10),
        tile(
          tileId(0, 10),
          [{ faction: "ODA", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "ODA" },
        ),
      ],
      [
        tileId(10, 10),
        tile(
          tileId(10, 10),
          [{ faction: "UESUGI", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "UESUGI" },
        ),
      ],
    ]);
    const state = makeState(provinces);
    const out = applyDefeats(state);
    expect(out).toBe(state);
  });

  it("[AC-V2-25] castle empty of owner → faction defeated, remnants → NEUTRAL", () => {
    const provinces = new Map<string, Province>([
      [
        tileId(0, 0),
        tile(
          tileId(0, 0),
          [{ faction: "TAKEDA", amount: 5, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "TOKUGAWA" }, // TOK's castle held by TAK
        ),
      ],
      [
        tileId(1, 1),
        tile(tileId(1, 1), [
          { faction: "TOKUGAWA", amount: 4, arrivalTick: 0, isDefender: true },
        ]),
      ],
      [
        tileId(10, 0),
        tile(
          tileId(10, 0),
          [{ faction: "TAKEDA", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "TAKEDA" },
        ),
      ],
      [
        tileId(0, 10),
        tile(
          tileId(0, 10),
          [{ faction: "ODA", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "ODA" },
        ),
      ],
      [
        tileId(10, 10),
        tile(
          tileId(10, 10),
          [{ faction: "UESUGI", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "UESUGI" },
        ),
      ],
    ]);
    const marchingStacks: MarchingStack[] = [
      {
        id: "tok-march",
        faction: "TOKUGAWA",
        count: 2,
        path: [tileId(1, 1), tileId(2, 1)],
        idx: 0,
        dispatchedAtTick: 0,
      },
    ];
    const state = makeState(provinces, marchingStacks);
    const out = applyDefeats(state);
    expect(out.defeated.has("TOKUGAWA")).toBe(true);
    // The non-castle TOK occupant flips to NEUTRAL
    const remnant = out.provinces.get(tileId(1, 1));
    expect(remnant?.occupants[0]?.faction).toBe("NEUTRAL");
    // TOK marching stack dropped
    expect(out.marchingStacks).toHaveLength(0);
  });

  it("[AC-V4-11] defeated faction's AttackOrders are dropped", () => {
    const provinces = new Map<string, Province>([
      [
        tileId(0, 0),
        tile(
          tileId(0, 0),
          [{ faction: "TAKEDA", amount: 5, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "TOKUGAWA" }, // TOK castle lost
        ),
      ],
      [
        tileId(10, 0),
        tile(
          tileId(10, 0),
          [{ faction: "TAKEDA", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "TAKEDA" },
        ),
      ],
      [
        tileId(0, 10),
        tile(
          tileId(0, 10),
          [{ faction: "ODA", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "ODA" },
        ),
      ],
      [
        tileId(10, 10),
        tile(
          tileId(10, 10),
          [{ faction: "UESUGI", amount: 3, arrivalTick: 0, isDefender: true }],
          { isCastle: true, castleOwner: "UESUGI" },
        ),
      ],
    ]);
    const orders: AttackOrder[] = [
      { from: tileId(1, 1), to: tileId(1, 2), faction: "TOKUGAWA", startTick: 0 },
      { from: tileId(9, 0), to: tileId(8, 0), faction: "TAKEDA", startTick: 0 },
    ];
    const state = makeState(provinces, [], new Set(), orders);
    const out = applyDefeats(state);
    expect(out.defeated.has("TOKUGAWA")).toBe(true);
    // TOK order gone, TAKEDA order kept.
    expect(out.attackOrders).toHaveLength(1);
    expect(out.attackOrders[0]?.faction).toBe("TAKEDA");
  });
});

describe("evaluateOutcome", () => {
  function castleState(holders: readonly FactionId[]): GameState {
    const provinces = new Map<string, Province>();
    const corners: [FactionId, [number, number]][] = [
      ["TOKUGAWA", [0, 0]],
      ["TAKEDA", [10, 0]],
      ["ODA", [0, 10]],
      ["UESUGI", [10, 10]],
    ];
    for (const [castleOwner, [x, y]] of corners) {
      const id = tileId(x, y);
      const occupants: Occupant[] = holders.includes(castleOwner)
        ? [
            {
              faction: castleOwner,
              amount: 3,
              arrivalTick: 0,
              isDefender: true,
            },
          ]
        : [];
      provinces.set(id, tile(id, occupants, { isCastle: true, castleOwner }));
    }
    let state = makeState(provinces);
    // Run applyDefeats so the defeated set is populated.
    state = applyDefeats(state);
    return state;
  }

  it("ongoing when 2+ factions alive", () => {
    const s = castleState(["TOKUGAWA", "TAKEDA"]);
    expect(evaluateOutcome(s).status).toBe("ongoing");
  });

  it("ended with winner when exactly one faction alive", () => {
    const s = castleState(["TOKUGAWA"]);
    const out = evaluateOutcome(s);
    expect(out.status).toBe("ended");
    if (out.status === "ended") expect(out.winner).toBe("TOKUGAWA");
  });

  it("ended with null winner when all factions defeated", () => {
    const s = castleState([]);
    const out = evaluateOutcome(s);
    expect(out.status).toBe("ended");
    if (out.status === "ended") expect(out.winner).toBeNull();
  });
});
