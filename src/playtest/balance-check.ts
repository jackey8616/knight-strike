// AI balance guard (CI). Runs a fixed, deterministic batch of all-AI games and
// asserts the rule AI stays balanced: no faction dominates or is shut out, games
// converge (low stalemate rate), and they don't drag on. The engine is
// deterministic (fixed seeds → identical games every run), so this is NOT flaky:
// a future change to the AI rules that skews the balance fails this check.
//
// If a balance shift is intentional, re-check the numbers (`pnpm balance`) and
// update the thresholds below. This guards `docs/PRD.md` §5's "no systematic
// positional bias" property (added with the v2.1 aggressive-AI pass).
import { readFileSync } from "node:fs";
import type { FactionId } from "@/engine/types";
import { parseScenario, runScenario } from "./runner";

const GAMES = 96;
const MAX_TICKS = 500;
const FACTIONS: readonly Exclude<FactionId, "NEUTRAL">[] = ["TOKUGAWA", "TAKEDA", "ODA", "UESUGI"];

// Current sample (4-AI normal, seeds 1..96, v2.6 House economy): win
// ~18/21/22/32%, stalemate ~7%, avg ~295 ticks. Thresholds keep margin over that
// while clearly catching a regression to the pre-v2.1 state (one faction ~55%,
// others ~5%, stalemate ~35%).
const MAX_WIN_RATE = 0.45; // dominance guard
const MIN_WIN_RATE = 0.05; // shut-out guard
const MAX_STALEMATE_RATE = 0.25; // convergence guard
const MAX_AVG_TICKS = 400; // pacing guard

function main(): void {
  // Read the scenario JSON directly (same path the playtest CLI uses), resolved
  // relative to this module so it works regardless of the working directory.
  const base = parseScenario(
    JSON.parse(readFileSync(new URL("../scenarios/spectator-4ai.json", import.meta.url), "utf8")),
  );

  const wins = new Map<FactionId, number>(FACTIONS.map((f) => [f, 0]));
  let stalemates = 0;
  let tickSum = 0;

  for (let i = 0; i < GAMES; i++) {
    const result = runScenario({ ...base, rngSeed: (1 + i) >>> 0 }, { maxTicks: MAX_TICKS });
    tickSum += result.ticks;
    if (result.outcome === "stalemate") stalemates += 1;
    else if (result.winner !== null) {
      wins.set(result.winner, (wins.get(result.winner) ?? 0) + 1);
    }
  }

  const avgTicks = tickSum / GAMES;
  const stalemateRate = stalemates / GAMES;
  const failures: string[] = [];

  console.log(`AI balance guard — ${GAMES} all-AI games (spectator-4ai, seeds 1..${GAMES}):`);
  for (const faction of FACTIONS) {
    const rate = (wins.get(faction) ?? 0) / GAMES;
    let flag = "";
    if (rate > MAX_WIN_RATE) {
      flag = " ✗ dominates";
      failures.push(`${faction} win rate ${(rate * 100).toFixed(0)}% > ${MAX_WIN_RATE * 100}%`);
    } else if (rate < MIN_WIN_RATE) {
      flag = " ✗ shut out";
      failures.push(`${faction} win rate ${(rate * 100).toFixed(0)}% < ${MIN_WIN_RATE * 100}%`);
    }
    console.log(`  ${faction.padEnd(9)} ${(rate * 100).toFixed(0).padStart(3)}%${flag}`);
  }
  console.log(
    `  stalemate ${(stalemateRate * 100).toFixed(0)}%   avg ${avgTicks.toFixed(0)} ticks`,
  );
  if (stalemateRate > MAX_STALEMATE_RATE) {
    failures.push(
      `stalemate rate ${(stalemateRate * 100).toFixed(0)}% > ${MAX_STALEMATE_RATE * 100}%`,
    );
  }
  if (avgTicks > MAX_AVG_TICKS) {
    failures.push(`avg game length ${avgTicks.toFixed(0)} > ${MAX_AVG_TICKS} ticks`);
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
