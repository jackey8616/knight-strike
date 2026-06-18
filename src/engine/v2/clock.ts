import type { Speed } from "./types";

// PRD §4.2 / game-time-spec §2 — fixed ticks-per-second per speed. Speed only
// changes the real-time interval between ticks; the tick *logic* is identical
// at every speed (determinism prerequisite, §4.2).
export const TICK_RATES: Readonly<Record<Speed, number>> = {
  slow: 2,
  medium: 4,
  fast: 8,
};

export function tickMs(speed: Speed): number {
  return 1000 / TICK_RATES[speed];
}

// 1 day = 2 ticks (PRD §3 / §4.2).
export function dayOf(tick: number): number {
  return Math.floor(tick / 2);
}

// fixed-timestep + accumulator (game-time-spec §3.1): fold real elapsed time
// into the accumulator, emit as many whole ticks as fit, carry the remainder.
// Stateless — the caller owns `acc` and the tick counter, so switching speed
// mid-run never skips or renumbers ticks (it only changes the divisor).
export function advanceClock(
  acc: number,
  deltaMs: number,
  speed: Speed,
): { readonly ticks: number; readonly acc: number } {
  const step = tickMs(speed);
  const total = acc + deltaMs;
  const ticks = Math.floor(total / step);
  return { ticks, acc: total - ticks * step };
}
