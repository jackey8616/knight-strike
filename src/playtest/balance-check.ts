// AI balance guard (CI). Runs a fixed, deterministic batch of all-AI games at
// EVERY playable board size and asserts the rule AI stays balanced: no faction
// dominates or is shut out, and games converge (low stalemate rate). The engine
// is deterministic (fixed seeds → identical games every run), so this is NOT
// flaky: a change that skews the balance — at any size — fails this check.
//
// Why all sizes: the AI's reach / economy / conquest pace scale with the board,
// so a change that's fair on 11×11 can still skew or stall on 27×27 (the largest
// playable map). Guarding only one size missed that class of regression.
//
// If a balance shift is intentional, re-check the numbers (`pnpm balance`) and
// update the thresholds below. This guards `docs/PRD.md` §5's "no systematic
// positional bias" property (added with the v2.1 aggressive-AI pass).
import { AI_NORMAL, type FactionId } from "@/engine/types";
import { makeScenario } from "@/scenarios/sized";
import { runScenario, type ScenarioInput } from "./runner";

const SIZES = [11, 15, 19, 27] as const;
const GAMES_PER_SIZE = 48;
const FACTIONS: readonly Exclude<FactionId, "NEUTRAL">[] = ["TOKUGAWA", "TAKEDA", "ODA", "UESUGI"];

const MAX_WIN_RATE = 0.45; // dominance guard
const MIN_WIN_RATE = 0.05; // shut-out guard
const MAX_STALEMATE_RATE = 0.25; // convergence guard

// Bigger boards legitimately take longer to resolve, so the tick cap scales with
// size — otherwise large maps would hit the cap and read as all-stalemate. (No
// hard avg-ticks guard: pacing varies by size and we may intentionally slow
// conquest; the stalemate rate is what catches games that don't converge.)
function maxTicksFor(size: number): number {
  return size * 45;
}

// makeScenario builds the standard 4-corner + centre-neutral board (with seed
// Houses) at a given size, but leaves TOKUGAWA idle (the human seat). For an
// all-AI balance batch, promote TOKUGAWA to the same rule tier as the rest.
function fourAiScenario(size: number, seed: number): ScenarioInput {
  const base = makeScenario(size, "normal", "plateau", seed);
  return { ...base, aiConfig: { ...base.aiConfig, TOKUGAWA: AI_NORMAL } };
}

type SizeResult = {
  readonly size: number;
  readonly cap: number;
  readonly wins: ReadonlyMap<FactionId, number>;
  readonly stalemates: number;
  readonly avgTicks: number;
};

function runSize(size: number): SizeResult {
  const cap = maxTicksFor(size);
  const wins = new Map<FactionId, number>(FACTIONS.map((f) => [f, 0]));
  let stalemates = 0;
  let tickSum = 0;
  for (let i = 0; i < GAMES_PER_SIZE; i++) {
    const result = runScenario(fourAiScenario(size, (1 + i) >>> 0), { maxTicks: cap });
    tickSum += result.ticks;
    if (result.outcome === "stalemate") stalemates += 1;
    else if (result.winner !== null) {
      wins.set(result.winner, (wins.get(result.winner) ?? 0) + 1);
    }
  }
  return { size, cap, wins, stalemates, avgTicks: tickSum / GAMES_PER_SIZE };
}

function main(): void {
  const failures: string[] = [];
  console.log(
    `AI balance guard — ${SIZES.length} sizes × ${GAMES_PER_SIZE} all-AI games (normal, seeds 1..${GAMES_PER_SIZE}):`,
  );

  for (const size of SIZES) {
    const r = runSize(size);
    const stalemateRate = r.stalemates / GAMES_PER_SIZE;
    console.log(`\n  ${size}×${size} (cap ${r.cap}):`);
    for (const faction of FACTIONS) {
      const rate = (r.wins.get(faction) ?? 0) / GAMES_PER_SIZE;
      let flag = "";
      if (rate > MAX_WIN_RATE) {
        flag = " ✗ dominates";
        failures.push(`${size}×${size} ${faction} win ${(rate * 100).toFixed(0)}% > ${MAX_WIN_RATE * 100}%`);
      } else if (rate < MIN_WIN_RATE) {
        flag = " ✗ shut out";
        failures.push(`${size}×${size} ${faction} win ${(rate * 100).toFixed(0)}% < ${MIN_WIN_RATE * 100}%`);
      }
      console.log(`    ${faction.padEnd(9)} ${(rate * 100).toFixed(0).padStart(3)}%${flag}`);
    }
    console.log(
      `    stalemate ${(stalemateRate * 100).toFixed(0)}%   avg ${r.avgTicks.toFixed(0)} ticks`,
    );
    if (stalemateRate > MAX_STALEMATE_RATE) {
      failures.push(
        `${size}×${size} stalemate ${(stalemateRate * 100).toFixed(0)}% > ${MAX_STALEMATE_RATE * 100}%`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("\nAI BALANCE GUARD FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\nIf this AI change is intentional, re-check `pnpm balance` and update the\n" +
        "thresholds in src/playtest/balance-check.ts (and PRD §5 if behaviour changed).",
    );
    process.exit(1);
  }
  console.log("\nAI balance guard PASSED.");
}

main();
