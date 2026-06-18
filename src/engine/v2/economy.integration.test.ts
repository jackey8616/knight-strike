import { describe, expect, it } from "vitest";
import { runTicks } from "./tick";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { Building, FactionId, House, Province } from "./types";

const castle = (x: number, y: number, owner: FactionId): [string, Province] => [
  tileId(x, y),
  { id: tileId(x, y), x, y, terrain: "PLAINS", isCastle: true, castleOwner: owner },
];

const house = (id: string, x: number, y: number, pop: number): House => ({
  id,
  owner: "TOKUGAWA",
  tile: tileId(x, y),
  population: pop,
  connectedToCastle: false,
  lastGrowthDay: 0,
  lastExpansionDay: 0,
});

describe("M6 economy integration", () => {
  it("a connected house grows → expands fields → spawns a unit over time", () => {
    const s0 = createGameState({
      boardSize: 6,
      rngSeed: 1,
      provinces: new Map([castle(0, 0, "TOKUGAWA")]),
      houses: [house("house:1", 1, 0, 50)],
    });

    const { state, events } = runTicks(s0, 80); // 40 days

    // fields were expanded around the house
    expect(state.fields.length).toBeGreaterThanOrEqual(4);
    // the house produced at least one 100-person unit, marked elite (its nation's only/largest)
    expect(state.units.length).toBeGreaterThanOrEqual(1);
    const spawned = state.units[0];
    expect(spawned?.owner).toBe("TOKUGAWA");
    expect(spawned?.isElite).toBe(true);

    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has("day.elapsed")).toBe(true);
    expect(kinds.has("house.expanded_field")).toBe(true);
    expect(kinds.has("house.spawned_unit")).toBe(true);
    expect(kinds.has("connectivity.recomputed")).toBe(true);
  });

  it("[AC-13] a fence on the tax route disconnects the house through the tick pipeline", () => {
    // house:1 reaches its castle (0,0) only through the own field at (1,0)
    const s0 = createGameState({
      boardSize: 6,
      rngSeed: 1,
      provinces: new Map([castle(0, 0, "TOKUGAWA")]),
      houses: [house("house:1", 2, 0, 50)],
      fields: [{ owner: "TOKUGAWA", tile: tileId(1, 0) }],
      factions: { ...defaultFactions(), TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, taxRate: 0.3 }) },
    });

    // one day → connectivity pass marks the house connected
    const connected = runTicks(s0, 2).state;
    expect(connected.houses[0]?.connectedToCastle).toBe(true);

    // drop a fence on the path field, then run another day
    const fence: Building = {
      id: "fence:1,0",
      kind: "FENCE",
      owner: "TOKUGAWA",
      tile: tileId(1, 0),
      durability: 10,
      maxDurability: 10,
    };
    // run to the next day boundary so the connectivity pass re-runs
    const fenced = runTicks({ ...connected, buildings: [fence] }, 2).state;
    expect(fenced.houses[0]?.connectedToCastle).toBe(false);
  });
});
