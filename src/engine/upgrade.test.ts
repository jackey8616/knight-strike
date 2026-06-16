import { describe, expect, it } from "vitest";
import { deriveTier } from "./upgrade";

describe("deriveTier", () => {
  it("[AC-04] count=5 → KNIGHT, 15 → QUEEN, 30 → KING", () => {
    expect(deriveTier(5)).toBe("KNIGHT");
    expect(deriveTier(15)).toBe("QUEEN");
    expect(deriveTier(30)).toBe("KING");
  });

  it("[AC-04] threshold-minus-one stays at lower tier", () => {
    expect(deriveTier(4)).toBe("SOLDIER");
    expect(deriveTier(14)).toBe("KNIGHT");
    expect(deriveTier(29)).toBe("QUEEN");
  });

  it("[AC-04] interior values map to the correct tier", () => {
    expect(deriveTier(1)).toBe("SOLDIER");
    expect(deriveTier(3)).toBe("SOLDIER");
    expect(deriveTier(6)).toBe("KNIGHT");
    expect(deriveTier(10)).toBe("KNIGHT");
    expect(deriveTier(20)).toBe("QUEEN");
    expect(deriveTier(100)).toBe("KING");
  });

  it("[AC-05] count drops below threshold → tier downgrades (15 → 14 = KNIGHT)", () => {
    expect(deriveTier(15)).toBe("QUEEN");
    expect(deriveTier(14)).toBe("KNIGHT");
  });

  it("[AC-05] count drops below threshold → tier downgrades (5 → 4 = SOLDIER)", () => {
    expect(deriveTier(5)).toBe("KNIGHT");
    expect(deriveTier(4)).toBe("SOLDIER");
  });

  it("[AC-05] King → Queen on dropping below 30", () => {
    expect(deriveTier(30)).toBe("KING");
    expect(deriveTier(29)).toBe("QUEEN");
  });

  it("count=0 → SOLDIER (empty tile retains lowest tier)", () => {
    expect(deriveTier(0)).toBe("SOLDIER");
  });

  it("negative count is clamped to SOLDIER (defensive)", () => {
    expect(deriveTier(-1)).toBe("SOLDIER");
    expect(deriveTier(-9999)).toBe("SOLDIER");
  });
});
