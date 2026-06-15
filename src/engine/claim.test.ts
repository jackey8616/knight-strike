import { describe, expect, it } from "vitest";
import { applyClaimPhase } from "./claim";
import { tileId } from "./state";
import type {
  AiMode,
  FactionId,
  GameState,
  Province,
  TileId,
} from "./types";

const idleAi: Readonly<Record<FactionId, AiMode>> = {
  TOKUGAWA: "idle",
  TAKEDA: "idle",
  ODA: "idle",
  UESUGI: "idle",
  NEUTRAL: "idle",
};

function makeProvince(
  x: number,
  y: number,
  owner: FactionId,
  count: number,
  isCastle = false,
): Province {
  return { id: tileId(x, y), x, y, owner, count, isCastle };
}

type BuildOpts = {
  readonly provinces: readonly Province[];
  readonly tick?: number;
  readonly rngSeed?: number;
  readonly defeated?: ReadonlySet<FactionId>;
  readonly boardSize?: number;
};

function buildState(opts: BuildOpts): GameState {
  const map = new Map<TileId, Province>();
  for (const p of opts.provinces) map.set(p.id, p);
  return {
    boardSize: opts.boardSize ?? 11,
    tick: opts.tick ?? 1,
    provinces: map,
    marchingStacks: [],
    stalemates: new Map(),
    aiConfig: idleAi,
    defeated: opts.defeated ?? new Set<FactionId>(),
    rngSeed: opts.rngSeed ?? 42,
    nextMarchingId: 1,
  };
}

describe("[AC-23] single adjacent claimant flips empty enemy tile", () => {
  it("A(TOKUGAWA count=3) ↔ B(TAKEDA count=0) → B flips to TOKUGAWA, count stays 0", () => {
    // B's other neighbours are all NEUTRAL count=0 (i.e. no claimants), so the
    // only claimant is TOKUGAWA from A. PRD §3.6.1 single-claimant branch.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 3),
        makeProvince(1, 0, "TAKEDA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
      ],
    });
    const out = applyClaimPhase(state);
    const b = out.provinces.get(tileId(1, 0)) as Province;
    expect(b.owner).toBe("TOKUGAWA");
    expect(b.count).toBe(0);
  });
});

describe("[AC-24] multi-claimant: highest summed power wins", () => {
  it("X(NEUTRAL count=0) with N=Knight power20, E=Soldier power3 → X.owner=TOKUGAWA", () => {
    // N at (5,4) = TOKUGAWA count=5 (Knight, power = 5 × 4 = 20)
    // E at (6,5) = TAKEDA   count=3 (Soldier, power = 3 × 1 = 3)
    // S, W are unowned (count=0 NEUTRAL → not a claimant). X is the centre.
    const state = buildState({
      provinces: [
        makeProvince(5, 5, "NEUTRAL", 0),
        makeProvince(5, 4, "TOKUGAWA", 5),
        makeProvince(6, 5, "TAKEDA", 3),
        makeProvince(5, 6, "NEUTRAL", 0),
        makeProvince(4, 5, "NEUTRAL", 0),
      ],
    });
    const out = applyClaimPhase(state);
    const x = out.provinces.get(tileId(5, 5)) as Province;
    expect(x.owner).toBe("TOKUGAWA");
    expect(x.count).toBe(0);
  });
});

describe("[AC-25] claim mutates only owner, never count", () => {
  it("A(TOKUGAWA count=5) ↔ B(TAKEDA count=0) → A.count unchanged, B.count stays 0", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5),
        makeProvince(1, 0, "TAKEDA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
      ],
    });
    const out = applyClaimPhase(state);
    const a = out.provinces.get(tileId(0, 0)) as Province;
    const b = out.provinces.get(tileId(1, 0)) as Province;
    expect(a.owner).toBe("TOKUGAWA");
    expect(a.count).toBe(5);
    expect(b.owner).toBe("TOKUGAWA");
    expect(b.count).toBe(0);
  });
});

describe("§3.6.1 negative cases", () => {
  it("no neighbour with count>0 → tile unchanged (defeated faction empty tile stays put)", () => {
    const state = buildState({
      provinces: [
        // B is owned by defeated TAKEDA, count=0, but no live faction adjacent
        makeProvince(1, 0, "TAKEDA", 0),
        makeProvince(0, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
      ],
    });
    const out = applyClaimPhase(state);
    const b = out.provinces.get(tileId(1, 0)) as Province;
    expect(b.owner).toBe("TAKEDA");
    expect(b.count).toBe(0);
    // Same map reference when nothing changes — keeps the pure-function
    // contract cheap for the no-op fast path.
    expect(out).toBe(state);
  });

  it("NEUTRAL adjacent does not claim (NEUTRAL has no intent)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "NEUTRAL", 5),
        makeProvince(1, 0, "TAKEDA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
      ],
    });
    const out = applyClaimPhase(state);
    const b = out.provinces.get(tileId(1, 0)) as Province;
    expect(b.owner).toBe("TAKEDA");
  });

  it("defeated faction adjacent does not claim (野怪不行動 per §6.3)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5),
        makeProvince(1, 0, "TAKEDA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
      ],
      defeated: new Set<FactionId>(["TOKUGAWA"]),
    });
    const out = applyClaimPhase(state);
    const b = out.provinces.get(tileId(1, 0)) as Province;
    expect(b.owner).toBe("TAKEDA");
  });

  it("own count=0 tile with adjacent claimants stays own (PRD §3.3 protection): claimant must be different from current owner", () => {
    // B is already TOKUGAWA count=0; adjacent TOKUGAWA count=5 is same owner, not a claimant.
    // No other claimants → no change.
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5),
        makeProvince(1, 0, "TOKUGAWA", 0),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
      ],
    });
    const out = applyClaimPhase(state);
    const b = out.provinces.get(tileId(1, 0)) as Province;
    expect(b.owner).toBe("TOKUGAWA");
    expect(b.count).toBe(0);
  });

  it("count>0 tile is skipped entirely (claim only targets empty tiles)", () => {
    const state = buildState({
      provinces: [
        makeProvince(0, 0, "TOKUGAWA", 5),
        makeProvince(1, 0, "TAKEDA", 2),
        makeProvince(2, 0, "NEUTRAL", 0),
        makeProvince(1, 1, "NEUTRAL", 0),
      ],
    });
    const out = applyClaimPhase(state);
    const b = out.provinces.get(tileId(1, 0)) as Province;
    expect(b.owner).toBe("TAKEDA");
    expect(b.count).toBe(2);
  });
});

describe("multi-claimant tiebreak (deterministic under §4.2 RNG)", () => {
  function buildTie(seed: number): GameState {
    // X(NEUTRAL count=0); two equal-power claimants both 3-Soldier (power 3).
    return buildState({
      provinces: [
        makeProvince(5, 5, "NEUTRAL", 0),
        makeProvince(5, 4, "TOKUGAWA", 3),
        makeProvince(6, 5, "TAKEDA", 3),
        makeProvince(5, 6, "NEUTRAL", 0),
        makeProvince(4, 5, "NEUTRAL", 0),
      ],
      tick: 7,
      rngSeed: seed,
    });
  }

  it("same seed → same winner across runs", () => {
    const a = applyClaimPhase(buildTie(42));
    const b = applyClaimPhase(buildTie(42));
    const wa = (a.provinces.get(tileId(5, 5)) as Province).owner;
    const wb = (b.provinces.get(tileId(5, 5)) as Province).owner;
    expect(wa).toBe(wb);
    expect(["TOKUGAWA", "TAKEDA"]).toContain(wa);
  });

  it("at least one of several seeds picks the other winner", () => {
    const baseline = (
      applyClaimPhase(buildTie(42)).provinces.get(tileId(5, 5)) as Province
    ).owner;
    const winners = new Set<string>();
    for (const seed of [1, 7, 13, 99, 256, 2024]) {
      const w = (
        applyClaimPhase(buildTie(seed)).provinces.get(tileId(5, 5)) as Province
      ).owner;
      winners.add(w);
    }
    winners.add(baseline);
    expect(winners.size).toBeGreaterThan(1);
  });
});
