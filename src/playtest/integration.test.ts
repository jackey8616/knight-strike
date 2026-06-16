import { describe, expect, it } from "vitest";
import { tileId } from "@/engine/state";
import { defaultScenario } from "@/scenarios/default";
import { idleTargetScenario } from "@/scenarios/idle-target";
import { buildInitialState, runScenario } from "./runner";

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
