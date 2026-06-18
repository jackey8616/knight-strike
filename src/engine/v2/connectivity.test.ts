import { describe, expect, it } from "vitest";
import { computeConnectivity } from "./connectivity";
import { createGameState, tileId } from "./state";
import type { Building, FactionId, Field, House, Province } from "./types";

const castle = (x: number, y: number, owner: FactionId): [string, Province] => [
  tileId(x, y),
  { id: tileId(x, y), x, y, terrain: "PLAINS", isCastle: true, castleOwner: owner },
];

const house = (id: string, owner: FactionId, x: number, y: number): House => ({
  id,
  owner,
  tile: tileId(x, y),
  population: 50,
  connectedToCastle: false,
  lastGrowthDay: 0,
  lastExpansionDay: 0,
});

const field = (owner: FactionId, x: number, y: number): Field => ({ owner, tile: tileId(x, y) });

const fence = (x: number, y: number): Building => ({
  id: `fence:${x},${y}`,
  kind: "FENCE",
  owner: "TOKUGAWA",
  tile: tileId(x, y),
  durability: 10,
  maxDurability: 10,
});

const build = (o: {
  houses: House[];
  fields?: Field[];
  buildings?: Building[];
  withCastle?: boolean;
}) =>
  createGameState({
    boardSize: 6,
    rngSeed: 1,
    provinces: new Map(o.withCastle === false ? [] : [castle(0, 0, "TOKUGAWA")]),
    houses: o.houses,
    fields: o.fields ?? [],
    buildings: o.buildings ?? [],
  });

const connOf = (s: ReturnType<typeof build>) => computeConnectivity(s).state.connectivity;

describe("computeConnectivity", () => {
  it("[AC-10] a house adjacent to its castle is connected", () => {
    const r = computeConnectivity(build({ houses: [house("house:1", "TOKUGAWA", 1, 0)] }));
    expect(r.state.connectivity.has("house:1")).toBe(true);
    expect(r.state.houses[0]?.connectedToCastle).toBe(true);
  });

  it("[AC-10] a house connected through an own-field path is connected", () => {
    const r = build({
      houses: [house("house:1", "TOKUGAWA", 3, 0)],
      fields: [field("TOKUGAWA", 1, 0), field("TOKUGAWA", 2, 0)],
    });
    expect(connOf(r).has("house:1")).toBe(true);
  });

  it("[AC-11] an enemy field in the path disconnects the house", () => {
    const r = build({
      houses: [house("house:1", "TOKUGAWA", 3, 0)],
      fields: [field("TAKEDA", 1, 0), field("TOKUGAWA", 2, 0)],
    });
    expect(connOf(r).has("house:1")).toBe(false);
  });

  it("[AC-11] an own fence in the path disconnects the house", () => {
    const r = build({
      houses: [house("house:1", "TOKUGAWA", 3, 0)],
      fields: [field("TOKUGAWA", 1, 0), field("TOKUGAWA", 2, 0)],
      buildings: [fence(1, 0)], // fence sits on the path field
    });
    expect(connOf(r).has("house:1")).toBe(false);
  });

  it("[AC-12] no castle → every house disconnected", () => {
    const r = build({ houses: [house("house:1", "TOKUGAWA", 1, 0)], withCastle: false });
    expect(connOf(r).has("house:1")).toBe(false);
    expect(r.houses[0]?.connectedToCastle).toBe(false);
  });

  it("[AC-12] removing a key path field disconnects the downstream house", () => {
    const connectedState = build({
      houses: [house("house:1", "TOKUGAWA", 3, 0)],
      fields: [field("TOKUGAWA", 1, 0), field("TOKUGAWA", 2, 0)],
    });
    expect(connOf(connectedState).has("house:1")).toBe(true);
    const broken = build({
      houses: [house("house:1", "TOKUGAWA", 3, 0)],
      fields: [field("TOKUGAWA", 2, 0)], // (1,0) removed → gap
    });
    expect(connOf(broken).has("house:1")).toBe(false);
  });

  it("emits connectivity.recomputed with the connected/disconnected partition, once", () => {
    const s = build({
      houses: [house("house:1", "TOKUGAWA", 1, 0), house("house:2", "TOKUGAWA", 5, 5)],
    });
    const first = computeConnectivity(s);
    expect(first.events).toEqual([
      { kind: "connectivity.recomputed", connected: ["house:1"], disconnected: ["house:2"] },
    ]);
    // idempotent: recomputing the settled state emits nothing and keeps the ref
    const second = computeConnectivity(first.state);
    expect(second.state).toBe(first.state);
    expect(second.events).toEqual([]);
  });
});
