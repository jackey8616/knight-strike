import { describe, expect, it } from "vitest";
import { dispatch, findPath } from "@/engine/movement";
import { derivedOwner, tileId } from "@/engine/state";
import { step } from "@/engine/tick";
import {
  AI_IDLE,
  type FactionId,
  type GameState,
  type Province,
} from "@/engine/types";
import { defaultScenario } from "@/scenarios/default";
import { idleTargetScenario } from "@/scenarios/idle-target";
import { buildInitialState, runScenario } from "./runner";

function blankBoard(size: number): GameState {
  const provinces = new Map<string, Province>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const id = tileId(x, y);
      provinces.set(id, {
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
  return {
    boardSize: size,
    tick: 0,
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
    defeated: new Set<FactionId>(),
    rngSeed: 1,
    nextMarchingId: 1,
  };
}

function setTile(s: GameState, p: Province): GameState {
  const next = new Map(s.provinces);
  next.set(p.id, p);
  return { ...s, provinces: next };
}

describe("integration: default scenario loader", () => {
  it("default scenario parses into a well-formed initial state", () => {
    const state = buildInitialState(defaultScenario);
    expect(state.boardSize).toBe(11);
    expect(state.tick).toBe(0);
    expect(state.provinces.size).toBe(11 * 11);

    // Castles
    const castleCorners: [string, string][] = [
      [tileId(0, 0), "TOKUGAWA"],
      [tileId(10, 0), "TAKEDA"],
      [tileId(0, 10), "ODA"],
      [tileId(10, 10), "UESUGI"],
    ];
    for (const [id, faction] of castleCorners) {
      const p = state.provinces.get(id);
      expect(p?.isCastle).toBe(true);
      expect(p?.castleOwner).toBe(faction);
      expect(p?.occupants).toHaveLength(1);
      expect(p?.occupants[0]?.faction).toBe(faction);
      expect(p?.occupants[0]?.amount).toBe(3);
      expect(p?.occupants[0]?.isDefender).toBe(true);
    }

    // NEUTRAL bandit at centre
    const centre = state.provinces.get(tileId(5, 5));
    expect(centre?.isCastle).toBe(false);
    expect(centre?.occupants[0]?.faction).toBe("NEUTRAL");
    expect(centre?.occupants[0]?.amount).toBe(3);

    // Empty tile
    const empty = state.provinces.get(tileId(1, 1));
    expect(empty?.occupants).toHaveLength(0);
  });

  it("idle scenario: non-player factions don't spawn marching stacks", () => {
    const result = runScenario(idleTargetScenario, {
      maxTicks: 50,
      emitEvents: true,
    });
    const events = result.events ?? [];
    // No marching stacks should ever appear because all aiConfig is idle and
    // no scripted commands are present.
    for (const ev of events) {
      const dispatches = ev.events.filter((e) => e.type === "march_dispatch");
      expect(dispatches).toHaveLength(0);
    }
  });
});

describe("integration: runScenario invariants", () => {
  it("[AC-V2-02] same scenario run produces consistent tick counts", () => {
    const a = runScenario(idleTargetScenario, { maxTicks: 30 });
    const b = runScenario(idleTargetScenario, { maxTicks: 30 });
    expect(a.ticks).toBe(b.ticks);
    expect(a.outcome).toBe(b.outcome);
  });

  it("emitEvents produces one TickEvent per simulated tick", () => {
    const result = runScenario(idleTargetScenario, {
      maxTicks: 20,
      emitEvents: true,
    });
    const events = result.events ?? [];
    expect(events.length).toBe(result.ticks);
    expect(events[0]?.tick).toBe(1);
    expect(events[events.length - 1]?.tick).toBe(result.ticks);
  });
});

describe("integration: v1.5 conquer-march (AC-V5)", () => {
  it("[AC-V5-03] one drag conquers a line: intermediates left empty-claimed, destination garrisoned", () => {
    // Row 0: TOK castle (0,0); (1,0)(2,0) neutral empty. Drag to (2,0).
    let s = blankBoard(5);
    s = setTile(s, {
      id: tileId(0, 0),
      x: 0,
      y: 0,
      isCastle: true,
      castleOwner: "TOKUGAWA",
      occupants: [{ faction: "TOKUGAWA", amount: 20, arrivalTick: 0, isDefender: true }],
      lastClaimedFaction: "TOKUGAWA",
    });

    // Non-own target → shortest path straight down the row.
    expect(findPath(s, tileId(0, 0), tileId(2, 0), "TOKUGAWA")).toEqual([
      tileId(0, 0),
      tileId(1, 0),
      tileId(2, 0),
    ]);

    const d = dispatch(s, { from: tileId(0, 0), to: tileId(2, 0), ratio: 1.0 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    s = d.state;

    for (let i = 0; i < 5; i++) s = step(s);

    const mid = s.provinces.get(tileId(1, 0)) as Province;
    const dest = s.provinces.get(tileId(2, 0)) as Province;
    expect(derivedOwner(mid)).toBe("TOKUGAWA");
    expect(mid.occupants).toHaveLength(0); // intermediate passed through → empty claim
    expect(dest.occupants[0]?.faction).toBe("TOKUGAWA"); // destination garrisoned
    expect((dest.occupants[0]?.amount ?? 0) > 0).toBe(true);
    expect(s.attackOrders).toHaveLength(0);
    expect(s.marchingStacks).toHaveLength(0);
  });

  it("grinds an enemy garrison then captures and garrisons the tile", () => {
    // TOK castle (0,0) strong; TAKEDA garrison on adjacent (1,0).
    let s = blankBoard(3);
    s = setTile(s, {
      id: tileId(0, 0),
      x: 0,
      y: 0,
      isCastle: true,
      castleOwner: "TOKUGAWA",
      occupants: [{ faction: "TOKUGAWA", amount: 40, arrivalTick: 0, isDefender: true }],
      lastClaimedFaction: "TOKUGAWA",
    });
    s = setTile(s, {
      id: tileId(1, 0),
      x: 1,
      y: 0,
      isCastle: false,
      castleOwner: null,
      occupants: [{ faction: "TAKEDA", amount: 4, arrivalTick: 0, isDefender: true }],
      lastClaimedFaction: "TAKEDA",
    });

    const d = dispatch(s, { from: tileId(0, 0), to: tileId(1, 0), ratio: 0.5 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    s = d.state;

    // Grind 4 defenders, break the enemy claim, capture, then garrison.
    for (let i = 0; i < 12; i++) s = step(s);

    const target = s.provinces.get(tileId(1, 0)) as Province;
    expect(target.occupants.some((o) => o.faction === "TAKEDA")).toBe(false);
    expect(derivedOwner(target)).toBe("TOKUGAWA");
    expect(target.occupants[0]?.faction).toBe("TOKUGAWA"); // surviving column garrisons it
    expect(s.attackOrders).toHaveLength(0);
  });
});
