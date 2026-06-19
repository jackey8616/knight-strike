import { describe, expect, it } from "vitest";
import {
  buildHouse,
  collectTax,
  DEFAULT_TAX_PCT,
  ECONOMY_INTERVAL_TICKS,
  growPopulation,
  growthAmount,
  GROWTH_BASE,
  HOUSE_COST,
  HOUSE_SEED_POP,
  isEconomyTick,
  makeEconomy,
  MAX_TAX_PCT,
  MIN_GROWTH,
  razeHouseAt,
  setTaxPct,
  spawnFromHouses,
  SPAWN_SIZE,
  SPAWN_THRESHOLD,
} from "./economy";
import { tileId } from "./state";
import {
  AI_IDLE,
  type FactionEconomy,
  type FactionId,
  type GameState,
  type Occupant,
  type Province,
} from "./types";

function emptyBoard(n: number): Map<string, Province> {
  const m = new Map<string, Province>();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const id = tileId(x, y);
      m.set(id, {
        id,
        x,
        y,
        isCastle: false,
        castleOwner: null,
        occupants: [],
        lastClaimedFaction: null,
      });
    }
  }
  return m;
}

function patch(
  m: Map<string, Province>,
  x: number,
  y: number,
  p: Partial<Province>,
): void {
  const id = tileId(x, y);
  const cur = m.get(id) as Province;
  m.set(id, { ...cur, ...p });
}

function occ(faction: FactionId, amount: number): Occupant {
  return { faction, amount, arrivalTick: 0, isDefender: true };
}

// Mark a tile as owned (empty but claimed) by a faction — counts as owned
// territory for growth without placing a garrison.
function ownEmpty(m: Map<string, Province>, x: number, y: number, f: FactionId): void {
  patch(m, x, y, { lastClaimedFaction: f });
}

function makeState(
  provinces: Map<string, Province>,
  opts: {
    tick?: number;
    economy?: Record<FactionId, FactionEconomy>;
    defeated?: ReadonlySet<FactionId>;
    boardSize?: number;
  } = {},
): GameState {
  return {
    boardSize: opts.boardSize ?? 5,
    tick: opts.tick ?? 5,
    provinces,
    marchingStacks: [],
    attackOrders: [],
    aiConfig: {
      TOKUGAWA: AI_IDLE,
      TAKEDA: AI_IDLE,
      ODA: AI_IDLE,
      UESUGI: AI_IDLE,
      NEUTRAL: AI_IDLE,
    },
    economy: opts.economy ?? makeEconomy(0, 0),
    defeated: opts.defeated ?? new Set<FactionId>(),
    rngSeed: 42,
    nextMarchingId: 1,
  };
}

describe("economy: build house (AC-27)", () => {
  it("[AC-27] spends gold, raises a house, and splits the builder's troops", () => {
    const m = emptyBoard(3);
    patch(m, 1, 1, { occupants: [occ("TOKUGAWA", 10)], lastClaimedFaction: "TOKUGAWA" });
    const state = makeState(m, { economy: makeEconomy(HOUSE_COST, 0) });
    const res = buildHouse(state, { faction: "TOKUGAWA", tile: tileId(1, 1) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.state.provinces.get(tileId(1, 1)) as Province;
    expect(p.isHouse).toBe(true);
    expect(p.houseOwner).toBe("TOKUGAWA");
    expect(p.housePopulation).toBe(5); // floor(10/2)
    expect(p.occupants[0]?.amount).toBe(5); // remainder stays as garrison
    expect(res.state.economy.TOKUGAWA.gold).toBe(0); // 100 spent
  });

  it("[AC-27] a new House always keeps at least one defender (ceil-half stays)", () => {
    const m = emptyBoard(3);
    patch(m, 1, 1, { occupants: [occ("TOKUGAWA", 3)], lastClaimedFaction: "TOKUGAWA" });
    const res = buildHouse(makeState(m, { economy: makeEconomy(HOUSE_COST, 0) }), {
      faction: "TOKUGAWA",
      tile: tileId(1, 1),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.state.provinces.get(tileId(1, 1)) as Province;
    expect(p.housePopulation).toBe(1); // floor(3/2)
    expect(p.occupants[0]?.amount).toBe(2); // ceil(3/2) garrison remains
    expect(p.lastClaimedFaction).toBe("TOKUGAWA");
  });

  it("[AC-27] rejects: not owned / no builder / castle / already-house / impassable / no gold", () => {
    const mk = (p: Partial<Province>, gold = HOUSE_COST): GameState => {
      const m = emptyBoard(3);
      patch(m, 1, 1, p);
      return makeState(m, { economy: makeEconomy(gold, 0) });
    };
    const at = tileId(1, 1);
    expect(
      buildHouse(mk({ occupants: [occ("TAKEDA", 5)], lastClaimedFaction: "TAKEDA" }), {
        faction: "TOKUGAWA",
        tile: at,
      }),
    ).toMatchObject({ ok: false, reason: "wrong-owner" });
    expect(
      buildHouse(mk({ lastClaimedFaction: "TOKUGAWA" }), { faction: "TOKUGAWA", tile: at }),
    ).toMatchObject({ ok: false, reason: "no-builder" });
    expect(
      buildHouse(
        mk({ occupants: [occ("TOKUGAWA", 5)], lastClaimedFaction: "TOKUGAWA", isCastle: true, castleOwner: "TOKUGAWA" }),
        { faction: "TOKUGAWA", tile: at },
      ),
    ).toMatchObject({ ok: false, reason: "is-castle" });
    expect(
      buildHouse(
        mk({ occupants: [occ("TOKUGAWA", 5)], lastClaimedFaction: "TOKUGAWA", isHouse: true, houseOwner: "TOKUGAWA" }),
        { faction: "TOKUGAWA", tile: at },
      ),
    ).toMatchObject({ ok: false, reason: "already-house" });
    expect(
      buildHouse(
        mk({ occupants: [occ("TOKUGAWA", 5)], lastClaimedFaction: "TOKUGAWA", terrain: "MOUNTAIN" }),
        { faction: "TOKUGAWA", tile: at },
      ),
    ).toMatchObject({ ok: false, reason: "not-buildable" });
    expect(
      buildHouse(mk({ occupants: [occ("TOKUGAWA", 5)], lastClaimedFaction: "TOKUGAWA" }, HOUSE_COST - 1), {
        faction: "TOKUGAWA",
        tile: at,
      }),
    ).toMatchObject({ ok: false, reason: "insufficient-gold" });
  });
});

describe("economy: population growth (AC-28)", () => {
  it("[AC-28] growth scales with owned neighbours at 0% tax", () => {
    expect(growthAmount(0, 0)).toBe(GROWTH_BASE);
    expect(growthAmount(8, 0)).toBe(GROWTH_BASE + 8);
  });

  it("[AC-28] max tax slows growth to the MIN_GROWTH trickle (never fully stalls)", () => {
    // High tax must not zero growth, or a max-tax House never reaches the spawn
    // threshold and produces no troops while gold piles up.
    expect(growthAmount(8, MAX_TAX_PCT)).toBe(MIN_GROWTH);
    expect(growthAmount(0, MAX_TAX_PCT)).toBe(MIN_GROWTH);
    const half = Math.floor(MAX_TAX_PCT / 2);
    expect(growthAmount(8, half)).toBe(
      Math.max(MIN_GROWTH, Math.floor(((GROWTH_BASE + 8) * (MAX_TAX_PCT - half)) / MAX_TAX_PCT)),
    );
  });

  it("[AC-28] grows the house by territory-scaled amount", () => {
    const m = emptyBoard(3);
    // house at centre with 4 owned (claimed) orthogonal neighbours
    patch(m, 1, 1, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: 0, lastClaimedFaction: "TOKUGAWA" });
    ownEmpty(m, 0, 1, "TOKUGAWA");
    ownEmpty(m, 2, 1, "TOKUGAWA");
    ownEmpty(m, 1, 0, "TOKUGAWA");
    ownEmpty(m, 1, 2, "TOKUGAWA");
    const out = growPopulation(makeState(m, { economy: makeEconomy(0, 0) }));
    expect(out.provinces.get(tileId(1, 1))?.housePopulation).toBe(GROWTH_BASE + 4);
  });

  it("[AC-28] defeated / neutral houses do not grow", () => {
    const m = emptyBoard(3);
    patch(m, 1, 1, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: 0, lastClaimedFaction: "TOKUGAWA" });
    const state = makeState(m, { defeated: new Set<FactionId>(["TOKUGAWA"]) });
    expect(growPopulation(state)).toBe(state);
  });
});

describe("economy: tax (AC-29)", () => {
  it("[AC-29] each house pays floor(pop × taxPct / 100) into the treasury", () => {
    const m = emptyBoard(3);
    patch(m, 0, 0, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: 50, lastClaimedFaction: "TOKUGAWA" });
    patch(m, 2, 2, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: 33, lastClaimedFaction: "TOKUGAWA" });
    const out = collectTax(makeState(m, { economy: makeEconomy(0, 20) }));
    // floor(50*20/100) + floor(33*20/100) = 10 + 6 = 16
    expect(out.economy.TOKUGAWA.gold).toBe(16);
  });

  it("[AC-29] zero tax yields no gold (state unchanged)", () => {
    const m = emptyBoard(3);
    patch(m, 0, 0, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: 50, lastClaimedFaction: "TOKUGAWA" });
    const state = makeState(m, { economy: makeEconomy(0, 0) });
    expect(collectTax(state)).toBe(state);
  });
});

describe("economy: house troop spawn (AC-30)", () => {
  it("[AC-30] house at threshold spawns a stack on an adjacent owned tile and loses SPAWN_SIZE", () => {
    const m = emptyBoard(3);
    patch(m, 1, 1, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: SPAWN_THRESHOLD, lastClaimedFaction: "TOKUGAWA" });
    ownEmpty(m, 2, 1, "TOKUGAWA"); // the (sorted-first by id? check) owned neighbour
    ownEmpty(m, 1, 2, "TOKUGAWA");
    const out = spawnFromHouses(makeState(m));
    const house = out.provinces.get(tileId(1, 1)) as Province;
    expect(house.housePopulation).toBe(SPAWN_THRESHOLD - SPAWN_SIZE);
    // exactly SPAWN_SIZE troops landed on one owned neighbour
    let spawned = 0;
    for (const p of out.provinces.values()) {
      if (p.id === tileId(1, 1)) continue;
      const o = p.occupants.find((x) => x.faction === "TOKUGAWA");
      if (o) spawned += o.amount;
    }
    expect(spawned).toBe(SPAWN_SIZE);
  });

  it("[AC-30] below threshold does nothing", () => {
    const m = emptyBoard(3);
    patch(m, 1, 1, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: SPAWN_THRESHOLD - 1, lastClaimedFaction: "TOKUGAWA" });
    const state = makeState(m);
    expect(spawnFromHouses(state)).toBe(state);
  });

  it("[AC-30] a max-tax house still grows to threshold and spawns (no zero-growth stall)", () => {
    // Regression: at 30% tax the old formula zeroed growth, so a house piled up
    // gold but never reached the spawn threshold — no troops ever appeared.
    const m = emptyBoard(3);
    patch(m, 1, 1, {
      isHouse: true,
      houseOwner: "TOKUGAWA",
      housePopulation: HOUSE_SEED_POP,
      lastClaimedFaction: "TOKUGAWA",
    });
    let s = makeState(m, { economy: makeEconomy(0, MAX_TAX_PCT) });
    let spawned = false;
    for (let day = 0; day < 100 && !spawned; day++) {
      s = growPopulation(s);
      s = spawnFromHouses(s);
      for (const p of s.provinces.values()) {
        if (p.occupants.some((o) => o.faction === "TOKUGAWA")) spawned = true;
      }
    }
    expect(spawned).toBe(true);
  });

  it("[AC-30] with no owned neighbour, spawns onto the house tile itself", () => {
    const m = emptyBoard(3);
    patch(m, 1, 1, { isHouse: true, houseOwner: "TOKUGAWA", housePopulation: SPAWN_THRESHOLD, lastClaimedFaction: "TOKUGAWA" });
    const out = spawnFromHouses(makeState(m));
    const house = out.provinces.get(tileId(1, 1)) as Province;
    expect(house.housePopulation).toBe(SPAWN_THRESHOLD - SPAWN_SIZE);
    expect(house.occupants.find((o) => o.faction === "TOKUGAWA")?.amount).toBe(SPAWN_SIZE);
  });
});

describe("economy: raze + tax rate (AC-31)", () => {
  it("[AC-31] razeHouseAt clears the house and its population", () => {
    const p: Province = {
      id: tileId(0, 0),
      x: 0,
      y: 0,
      isCastle: false,
      castleOwner: null,
      isHouse: true,
      houseOwner: "TAKEDA",
      housePopulation: 80,
      occupants: [],
      lastClaimedFaction: "TAKEDA",
    };
    const razed = razeHouseAt(p);
    expect(razed.isHouse).toBe(false);
    expect(razed.houseOwner).toBe(null);
    expect(razed.housePopulation).toBe(0);
  });

  it("[AC-31] razeHouseAt is a no-op on a tile with no house", () => {
    const p: Province = {
      id: tileId(0, 0),
      x: 0,
      y: 0,
      isCastle: false,
      castleOwner: null,
      occupants: [],
      lastClaimedFaction: null,
    };
    expect(razeHouseAt(p)).toBe(p);
  });

  it("setTaxPct clamps to 0..MAX_TAX_PCT and no-ops when unchanged", () => {
    const state = makeState(emptyBoard(1), { economy: makeEconomy(0, DEFAULT_TAX_PCT) });
    expect(setTaxPct(state, "TOKUGAWA", 100).economy.TOKUGAWA.taxPct).toBe(MAX_TAX_PCT);
    expect(setTaxPct(state, "TOKUGAWA", -5).economy.TOKUGAWA.taxPct).toBe(0);
    expect(setTaxPct(state, "TOKUGAWA", DEFAULT_TAX_PCT)).toBe(state);
  });
});

describe("economy: cadence", () => {
  it("isEconomyTick fires on multiples of the interval after tick 0", () => {
    expect(isEconomyTick(0)).toBe(false);
    expect(isEconomyTick(ECONOMY_INTERVAL_TICKS)).toBe(true);
    expect(isEconomyTick(ECONOMY_INTERVAL_TICKS + 1)).toBe(false);
    expect(isEconomyTick(ECONOMY_INTERVAL_TICKS * 2)).toBe(true);
  });
});
