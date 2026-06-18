import { describe, expect, it } from "vitest";
import { startConstruction } from "./construction";
import { computeConnectivity } from "./connectivity";
import { issueMarch } from "./movement";
import { runTicks } from "./tick";
import { createGameState, defaultFactions, makeFaction, tileId } from "./state";
import type { FactionId, Province, Unit } from "./types";

const unit = (id: string, owner: FactionId, x: number, y: number, pop: number): Unit => ({
  id,
  owner,
  tile: tileId(x, y),
  population: pop,
  isMonster: false,
  isElite: false,
  task: null,
  combatLock: null,
});

const prov = (x: number, y: number, terrain: Province["terrain"], extra: Partial<Province> = {}): [string, Province] => [
  tileId(x, y),
  { id: tileId(x, y), x, y, terrain, isCastle: false, castleOwner: null, ...extra },
];

const richTokugawa = (g: number) => ({
  ...defaultFactions(),
  TOKUGAWA: makeFaction("TOKUGAWA", { isPlayer: true, gold: g }),
});

describe("M8 construction integration", () => {
  it("a bridge built over a river lets a unit march across", () => {
    // a river at x=1 splits the board; the unit starts on the west bank
    let s = createGameState({
      boardSize: 4,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 0, 0, 5000)],
      provinces: new Map([prov(1, 0, "WATER"), prov(1, 1, "WATER"), prov(1, 2, "WATER"), prov(1, 3, "WATER")]),
      factions: richTokugawa(5000),
    });
    const started = startConstruction(s, {
      faction: "TOKUGAWA",
      unitId: "unit:1",
      kind: "BRIDGE",
      tile: tileId(1, 0),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // run the build to completion (2 ticks), then order the crossing
    s = runTicks(started.state, 2).state;
    expect(s.buildings.some((b) => b.kind === "BRIDGE")).toBe(true);

    s = issueMarch(s, "unit:1", tileId(2, 0));
    s = runTicks(s, 4).state;
    expect(s.units.find((u) => u.id === "unit:1")?.tile).toBe(tileId(2, 0)); // crossed the bridge
  });

  it("[AC-23] a fence built on the tax route cuts the house off (tax → 0 growth)", () => {
    // castle (0,0) — field (1,0) — house (2,0); fence the field to sever it
    let s = createGameState({
      boardSize: 4,
      rngSeed: 1,
      units: [unit("unit:1", "TOKUGAWA", 1, 0, 1000)],
      provinces: new Map([prov(0, 0, "PLAINS", { isCastle: true, castleOwner: "TOKUGAWA" })]),
      houses: [
        {
          id: "house:1",
          owner: "TOKUGAWA",
          tile: tileId(2, 0),
          population: 50,
          connectedToCastle: false,
          lastGrowthDay: 0,
          lastExpansionDay: 0,
        },
      ],
      fields: [{ owner: "TOKUGAWA", tile: tileId(1, 0) }],
      factions: richTokugawa(5000),
    });
    expect(computeConnectivity(s).state.houses[0]?.connectedToCastle).toBe(true);

    const started = startConstruction(s, {
      faction: "TOKUGAWA",
      unitId: "unit:1",
      kind: "FENCE",
      tile: tileId(1, 0),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // fence takes 5 ticks; run past a day boundary so connectivity re-runs
    s = runTicks(started.state, 12).state;
    expect(s.buildings.some((b) => b.kind === "FENCE")).toBe(true);
    expect(s.houses[0]?.connectedToCastle).toBe(false); // tax route severed
  });
});
