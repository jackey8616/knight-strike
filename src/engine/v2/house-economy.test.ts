import { describe, expect, it } from "vitest";
import { expandFields, spawnFromHouses } from "./house";
import { createGameState, tileId } from "./state";
import type { FactionId, House } from "./types";

const house = (id: string, owner: FactionId, tile: string, population: number): House => ({
  id,
  owner,
  tile,
  population,
  connectedToCastle: false,
  lastGrowthDay: 0,
  lastExpansionDay: 0,
});

const withHouses = (houses: House[], fields = []) =>
  createGameState({ boardSize: 5, rngSeed: 1, houses, fields });

describe("expandFields [AC-07]", () => {
  it("skips a house with population < 10 (no field, same state)", () => {
    const s = withHouses([house("house:1", "TOKUGAWA", tileId(2, 2), 5)]);
    const r = expandFields(s);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it("converts one Moore-8 empty tile per 10 house-people", () => {
    // pop 25 → afford 2 conversions (cost 20), pop 5 left
    const s = withHouses([house("house:1", "TOKUGAWA", tileId(2, 2), 25)]);
    const r = expandFields(s);
    expect(r.state.fields).toHaveLength(2);
    expect(r.state.fields.every((f) => f.owner === "TOKUGAWA")).toBe(true);
    expect(r.state.houses[0]?.population).toBe(5);
    expect(r.events).toHaveLength(2);
    expect(r.events[0]?.kind).toBe("house.expanded_field");
  });

  it("does not re-claim a tile that is already an own field", () => {
    const s = createGameState({
      boardSize: 5,
      rngSeed: 1,
      houses: [house("house:1", "TOKUGAWA", tileId(2, 2), 100)],
      fields: [{ owner: "TOKUGAWA", tile: tileId(2, 1) }],
    });
    const r = expandFields(s);
    // (2,1) stays the single pre-existing field plus the newly converted ones,
    // and is never duplicated
    const at21 = r.state.fields.filter((f) => f.tile === tileId(2, 1));
    expect(at21).toHaveLength(1);
  });
});

describe("spawnFromHouses [AC-08]", () => {
  it("spawns one 100-person unit and debits the house by 100", () => {
    const s = withHouses([house("house:1", "TOKUGAWA", tileId(2, 2), 100)]);
    const r = spawnFromHouses(s);
    expect(r.state.units).toHaveLength(1);
    expect(r.state.units[0]?.population).toBe(100);
    expect(r.state.units[0]?.owner).toBe("TOKUGAWA");
    expect(r.state.houses[0]?.population).toBe(0);
    expect(r.state.nextEntityId).toBe(s.nextEntityId + 1);
    expect(r.events).toContainEqual({
      kind: "house.spawned_unit",
      houseId: "house:1",
      unitId: r.state.units[0]?.id,
    });
  });

  it("does not spawn below the 100 threshold (same state)", () => {
    const s = withHouses([house("house:1", "TOKUGAWA", tileId(2, 2), 99)]);
    const r = spawnFromHouses(s);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it("spawns at most one unit per house per call (250 → one unit, house 150)", () => {
    const s = withHouses([house("house:1", "TOKUGAWA", tileId(2, 2), 250)]);
    const r = spawnFromHouses(s);
    expect(r.state.units).toHaveLength(1);
    expect(r.state.houses[0]?.population).toBe(150);
  });
});
