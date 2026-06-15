import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

describe("createRng (mulberry32)", () => {
  it("[AC-22] same seed produces identical sequence", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 256; i++) {
      seqA.push(a());
      seqB.push(b());
    }
    expect(seqA).toEqual(seqB);
  });

  it("[AC-22] different seeds diverge in the first 64 draws", () => {
    const a = createRng(42);
    const b = createRng(43);
    const seqA = Array.from({ length: 64 }, () => a());
    const seqB = Array.from({ length: 64 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("every value falls in [0, 1)", () => {
    const rng = createRng(123);
    for (let i = 0; i < 1024; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seed 0 is valid and produces finite values", () => {
    const rng = createRng(0);
    for (let i = 0; i < 8; i++) {
      const v = rng();
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("consecutive draws advance state (no constant output)", () => {
    const rng = createRng(7);
    const draws = new Set<number>();
    for (let i = 0; i < 16; i++) draws.add(rng());
    expect(draws.size).toBeGreaterThan(1);
  });

  it("negative and >2^32 seeds normalize via >>> 0", () => {
    const a = createRng(-1);
    const b = createRng(0xffffffff);
    expect(a()).toBe(b());
  });
});
