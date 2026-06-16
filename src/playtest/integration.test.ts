import { describe, expect, it, vi } from "vitest";
import { tileId } from "@/engine/state";
import { AI_IDLE, AI_NORMAL, AI_SCRIPTED } from "@/engine/types";
import { defaultScenario } from "@/scenarios/default";
import { idleTargetScenario } from "@/scenarios/idle-target";
import {
  buildInitialState,
  parseScenario,
  runScenario,
  type ScenarioInput,
} from "./runner";

describe("integration: default scenario loader", () => {
  it("default scenario parses into a well-formed initial state", () => {
    const state = buildInitialState(defaultScenario);
    expect(state.boardSize).toBe(11);
    expect(state.tick).toBe(0);
    expect(state.provinces.size).toBe(11 * 11);
    expect(state.provinces.get(tileId(0, 0))?.owner).toBe("TOKUGAWA");
    expect(state.provinces.get(tileId(10, 0))?.owner).toBe("TAKEDA");
    expect(state.provinces.get(tileId(0, 10))?.owner).toBe("ODA");
    expect(state.provinces.get(tileId(10, 10))?.owner).toBe("UESUGI");
    expect(state.provinces.get(tileId(5, 5))?.owner).toBe("NEUTRAL");
    expect(state.provinces.get(tileId(5, 5))?.count).toBe(3);
    expect(state.provinces.get(tileId(1, 1))?.owner).toBe("NEUTRAL");
    expect(state.provinces.get(tileId(1, 1))?.count).toBe(0);
  });
});

describe("integration: runScenario invariants", () => {
  it("[AC-22] same seed → same result (deterministic)", () => {
    const a = runScenario(defaultScenario, { maxTicks: 200 });
    const b = runScenario(defaultScenario, { maxTicks: 200 });
    expect(a.winner).toBe(b.winner);
    expect(a.ticks).toBe(b.ticks);
    expect(a.outcome).toBe(b.outcome);
  });

  it("runScenario produces well-formed events when emitEvents = true", () => {
    const result = runScenario(defaultScenario, {
      maxTicks: 50,
      emitEvents: true,
    });
    const events = result.events ?? [];
    expect(events.length).toBe(result.ticks);
    // The first event corresponds to the first step (output tick = 1) and the
    // last event must match the final game tick.
    expect(events[0]?.tick).toBe(1);
    expect(events[events.length - 1]?.tick).toBe(result.ticks);

    for (const event of events) {
      for (const f of event.factions) {
        expect(Number.isFinite(f.totalCount)).toBe(true);
        expect(f.totalCount).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(f.marchingCount)).toBe(true);
        expect(f.marchingCount).toBeGreaterThanOrEqual(0);
        expect(f.tiles).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("max-ticks cap produces a stalemate when factions stay idle", () => {
    const idleScenario: ScenarioInput = {
      ...defaultScenario,
      aiConfig: {
        TOKUGAWA: AI_IDLE,
        TAKEDA: AI_IDLE,
        ODA: AI_IDLE,
        UESUGI: AI_IDLE,
      },
    };
    const result = runScenario(idleScenario, { maxTicks: 25 });
    expect(result.outcome).toBe("stalemate");
    expect(result.winner).toBeNull();
    expect(result.ticks).toBe(25);
  });
});

describe("integration: scripted commands + win path", () => {
  // Carefully constrained scenario so the AI's short-circuit order (defense →
  // expand → attack) actually reaches the attack branch:
  //   - Tokugawa already owns the entire 3x3 minus the enemy castle, so
  //     `tryExpand` finds zero neutral-empty neighbours.
  //   - Takeda's castle sits at manhattan 4 from Tokugawa's, outside the
  //     defense trigger range (≤ 2) but inside the attack range (≤ 4 hops).
  //   - Tokugawa castle holds enough to clear the 1.5x power threshold.
  // Result: Tokugawa dispatches, marches 4 ticks, captures the castle.
  const attackScenario: ScenarioInput = {
    name: "attack-win",
    boardSize: 3,
    initialState: [
      { x: 0, y: 0, owner: "TOKUGAWA", count: 30, isCastle: true },
      { x: 1, y: 0, owner: "TOKUGAWA", count: 2, isCastle: false },
      { x: 2, y: 0, owner: "TOKUGAWA", count: 2, isCastle: false },
      { x: 0, y: 1, owner: "TOKUGAWA", count: 2, isCastle: false },
      { x: 1, y: 1, owner: "TOKUGAWA", count: 2, isCastle: false },
      { x: 2, y: 1, owner: "TOKUGAWA", count: 2, isCastle: false },
      { x: 0, y: 2, owner: "TOKUGAWA", count: 2, isCastle: false },
      { x: 1, y: 2, owner: "TOKUGAWA", count: 2, isCastle: false },
      { x: 2, y: 2, owner: "TAKEDA", count: 3, isCastle: true },
    ],
    aiConfig: {
      TOKUGAWA: AI_NORMAL,
      TAKEDA: AI_IDLE,
      ODA: AI_IDLE,
      UESUGI: AI_IDLE,
    },
    rngSeed: 42,
  };

  it("Tokugawa wins the lopsided attack scenario", () => {
    const result = runScenario(attackScenario, { maxTicks: 200 });
    expect(result.outcome).toBe("win");
    expect(result.winner).toBe("TOKUGAWA");
    expect(result.ticks).toBeLessThan(50);
  });

  it("scripted commands fire at the requested tick", () => {
    const scenario: ScenarioInput = {
      boardSize: 5,
      initialState: [
        { x: 0, y: 0, owner: "TOKUGAWA", count: 5, isCastle: true },
        { x: 4, y: 0, owner: "TAKEDA", count: 5, isCastle: true },
        { x: 0, y: 4, owner: "ODA", count: 5, isCastle: true },
        { x: 4, y: 4, owner: "UESUGI", count: 5, isCastle: true },
      ],
      aiConfig: {
        TOKUGAWA: AI_SCRIPTED,
        TAKEDA: AI_IDLE,
        ODA: AI_IDLE,
        UESUGI: AI_IDLE,
      },
      scriptedCommands: [
        { atTick: 2, from: [0, 0], to: [1, 0], ratio: 0.5 },
      ],
      rngSeed: 42,
    };
    const result = runScenario(scenario, {
      maxTicks: 10,
      emitEvents: true,
    });
    const lastEvent = result.events?.[result.events.length - 1];
    expect(lastEvent).toBeDefined();
    const tokugawa = lastEvent?.factions.find((f) => f.faction === "TOKUGAWA");
    // After the scripted dispatch lands on (1,0), Tokugawa owns its castle
    // plus the freshly captured tile → 2+ tiles.
    expect(tokugawa?.tiles).toBeGreaterThanOrEqual(2);
  });
});

describe("integration: aiConfig modes (PRD §4)", () => {
  it("[AC-37 v1.1] aiConfig all idle: no marching stacks and no growth over 100 ticks", () => {
    const result = runScenario(idleTargetScenario, {
      maxTicks: 100,
      emitEvents: true,
    });
    const events = result.events ?? [];
    expect(result.outcome).toBe("stalemate");
    expect(events.length).toBe(100);

    // §4 idle mode: every faction is idle → marching stacks must stay empty
    // every tick (no AI / scripted / overflow dispatches).
    for (const ev of events) {
      for (const f of ev.factions) {
        expect(f.marchingStacks).toBe(0);
        expect(f.marchingCount).toBe(0);
      }
    }

    // PRD §3.3 v1.1: castles don't produce. The idle-target scenario seeds
    // each faction with only a castle at count 3 — with no field garrison
    // there's nothing to produce from, so totalCount stays at 3 forever.
    const last = events[events.length - 1];
    expect(last).toBeDefined();
    for (const f of last!.factions) {
      expect(f.totalCount).toBe(3);
    }
  });

  it("[AC-38] aiConfig scripted: TAKEDA dispatches exactly once at the scripted tick", () => {
    const scenario: ScenarioInput = {
      name: "scripted-takeda",
      boardSize: 11,
      initialState: [
        { x: 0, y: 0, owner: "TOKUGAWA", count: 3, isCastle: true },
        { x: 10, y: 0, owner: "TAKEDA", count: 5, isCastle: true },
        { x: 0, y: 10, owner: "ODA", count: 3, isCastle: true },
        { x: 10, y: 10, owner: "UESUGI", count: 3, isCastle: true },
      ],
      aiConfig: {
        TOKUGAWA: AI_IDLE,
        TAKEDA: AI_SCRIPTED,
        ODA: AI_IDLE,
        UESUGI: AI_IDLE,
      },
      scriptedCommands: [
        { atTick: 5, from: [10, 0], to: [9, 0], ratio: 1.0 },
      ],
      rngSeed: 42,
    };
    const result = runScenario(scenario, { maxTicks: 10, emitEvents: true });
    const events = result.events ?? [];
    let dispatched = 0;
    let dispatchAtTick: number | null = null;
    for (const ev of events) {
      for (const sub of ev.events) {
        if (sub.type === "march_dispatch" && sub.faction === "TAKEDA") {
          dispatched += 1;
          dispatchAtTick = ev.tick;
        }
      }
    }
    expect(dispatched).toBe(1);
    expect(dispatchAtTick).toBe(5);
  });
});

describe("integration: parseScenario validation", () => {
  it("rejects out-of-bounds tiles", () => {
    expect(() =>
      parseScenario({
        boardSize: 5,
        initialState: [{ x: 5, y: 0, owner: "TOKUGAWA", count: 3, isCastle: true }],
        aiConfig: {
          TOKUGAWA: "default",
          TAKEDA: "default",
          ODA: "default",
          UESUGI: "default",
        },
        rngSeed: 1,
      }),
    ).toThrow(/out of bounds/);
  });

  it("rejects unknown ratios", () => {
    expect(() =>
      parseScenario({
        boardSize: 5,
        initialState: [],
        aiConfig: {
          TOKUGAWA: "default",
          TAKEDA: "default",
          ODA: "default",
          UESUGI: "default",
        },
        scriptedCommands: [
          { atTick: 1, from: [0, 0], to: [1, 0], ratio: 0.33 },
        ],
        rngSeed: 1,
      }),
    ).toThrow(/ratio/);
  });

  it("rejects unknown ai mode", () => {
    expect(() =>
      parseScenario({
        boardSize: 5,
        initialState: [],
        aiConfig: {
          TOKUGAWA: "rogue",
          TAKEDA: "default",
          ODA: "default",
          UESUGI: "default",
        },
        rngSeed: 1,
      }),
    ).toThrow(/ai mode/);
  });

  it("normalizes shorthand strings into the AiMode discriminated union", () => {
    const parsed = parseScenario({
      boardSize: 5,
      initialState: [
        { x: 0, y: 0, owner: "TOKUGAWA", count: 3, isCastle: true },
      ],
      aiConfig: {
        TOKUGAWA: "hard",
        TAKEDA: "normal",
        ODA: "easy",
        UESUGI: "idle",
      },
      rngSeed: 1,
    });
    expect(parsed.aiConfig.TOKUGAWA).toEqual({ kind: "rule", tier: "hard" });
    expect(parsed.aiConfig.TAKEDA).toEqual({ kind: "rule", tier: "normal" });
    expect(parsed.aiConfig.ODA).toEqual({ kind: "rule", tier: "easy" });
    expect(parsed.aiConfig.UESUGI).toEqual({ kind: "idle" });
  });

  it("accepts the explicit object form alongside shorthand", () => {
    const parsed = parseScenario({
      boardSize: 5,
      initialState: [],
      aiConfig: {
        TOKUGAWA: { kind: "rule", tier: "hard" },
        TAKEDA: { kind: "idle" },
        ODA: { kind: "scripted" },
        UESUGI: "normal",
      },
      rngSeed: 1,
    });
    expect(parsed.aiConfig.TOKUGAWA).toEqual({ kind: "rule", tier: "hard" });
    expect(parsed.aiConfig.TAKEDA).toEqual({ kind: "idle" });
    expect(parsed.aiConfig.ODA).toEqual({ kind: "scripted" });
    expect(parsed.aiConfig.UESUGI).toEqual({ kind: "rule", tier: "normal" });
  });

  it("aliases legacy 'default' to Normal tier with a deprecation warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parsed = parseScenario({
        boardSize: 5,
        initialState: [],
        aiConfig: {
          TOKUGAWA: "default",
          TAKEDA: "idle",
          ODA: "idle",
          UESUGI: "idle",
        },
        rngSeed: 1,
      });
      expect(parsed.aiConfig.TOKUGAWA).toEqual({ kind: "rule", tier: "normal" });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects object form with invalid rule tier", () => {
    expect(() =>
      parseScenario({
        boardSize: 5,
        initialState: [],
        aiConfig: {
          TOKUGAWA: { kind: "rule", tier: "legendary" },
          TAKEDA: "idle",
          ODA: "idle",
          UESUGI: "idle",
        },
        rngSeed: 1,
      }),
    ).toThrow(/rule tier/);
  });
});
