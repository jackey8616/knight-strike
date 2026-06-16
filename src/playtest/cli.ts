import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit, argv, stderr, stdout } from "node:process";
import type { FactionId } from "@/engine/types";
import { NON_NEUTRAL_FACTIONS } from "@/engine/victory";
import {
  parseScenario,
  runScenario,
  type RunResult,
  type ScenarioInput,
} from "./runner";

const DEFAULT_MAX_TICKS = 500;
const DEFAULT_RUNS = 1;
// PRD §10.3 shows "374s @ 1x" beside "187 ticks" — 1 tick = 2 seconds.
const SECONDS_PER_TICK = 2;

type CliOptions = {
  readonly scenarioFile: string;
  readonly runs: number;
  readonly maxTicks: number;
  readonly logEvents: boolean;
  readonly seedOverride: number | undefined;
};

function fail(msg: string): never {
  stderr.write(`playtest: ${msg}\n`);
  stderr.write(
    "usage: pnpm playtest <scenario.json> [--runs N] [--max-ticks N] [--log events] [--seed N]\n",
  );
  exit(1);
}

function parseArgs(args: readonly string[]): CliOptions {
  let scenarioFile: string | undefined;
  let runs = DEFAULT_RUNS;
  let maxTicks = DEFAULT_MAX_TICKS;
  let logEvents = false;
  let seedOverride: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    switch (arg) {
      case "--runs": {
        const next = args[++i];
        const n = next === undefined ? NaN : Number.parseInt(next, 10);
        if (!Number.isInteger(n) || n <= 0) fail("--runs requires a positive integer");
        runs = n;
        break;
      }
      case "--max-ticks": {
        const next = args[++i];
        const n = next === undefined ? NaN : Number.parseInt(next, 10);
        if (!Number.isInteger(n) || n <= 0) fail("--max-ticks requires a positive integer");
        maxTicks = n;
        break;
      }
      case "--seed": {
        const next = args[++i];
        const n = next === undefined ? NaN : Number.parseInt(next, 10);
        if (!Number.isInteger(n)) fail("--seed requires an integer");
        seedOverride = n;
        break;
      }
      case "--log": {
        const next = args[++i];
        if (next !== "events") fail("--log only supports 'events'");
        logEvents = true;
        break;
      }
      case "-h":
      case "--help":
        fail("see usage");
      // falls through (fail does not return)
      default: {
        if (arg.startsWith("--")) fail(`unknown flag: ${arg}`);
        if (scenarioFile !== undefined) fail(`unexpected positional arg: ${arg}`);
        scenarioFile = arg;
      }
    }
  }

  if (scenarioFile === undefined) fail("missing scenario file");
  return { scenarioFile, runs, maxTicks, logEvents, seedOverride };
}

function loadScenario(file: string, seedOverride: number | undefined): ScenarioInput {
  let raw: unknown;
  try {
    const text = readFileSync(resolve(file), "utf8");
    raw = JSON.parse(text);
  } catch (err) {
    fail(`failed to load ${file}: ${(err as Error).message}`);
  }
  const scenario = parseScenario(raw);
  if (seedOverride !== undefined) {
    return { ...scenario, rngSeed: seedOverride };
  }
  return scenario;
}

// PRD §10.4 expects multi-run reports; we still want determinism for a given
// (--seed, --runs), so per-run we derive a deterministic offset from the base
// seed rather than reusing it (which would replay the same game 100 times).
function seedForRun(base: number, runIdx: number): number {
  return ((base >>> 0) + runIdx) >>> 0;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] as number;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

function pad(label: string, width: number): string {
  if (label.length >= width) return label;
  return label + " ".repeat(width - label.length);
}

function printSummary(
  scenario: ScenarioInput,
  results: readonly RunResult[],
): void {
  const wins = new Map<FactionId, number>();
  let stalemates = 0;
  let eliminations = 0;
  const lengths: number[] = [];
  for (const r of results) {
    lengths.push(r.ticks);
    if (r.outcome === "stalemate") stalemates += 1;
    else if (r.outcome === "elimination") eliminations += 1;
    else if (r.winner !== null) wins.set(r.winner, (wins.get(r.winner) ?? 0) + 1);
  }
  lengths.sort((a, b) => a - b);

  const total = results.length;
  // PRD §10.3 example shows integer percent ("24 (24%)") — match it. Rounding
  // is fine for sample sizes >= 10; sub-1% precision isn't a goal of the
  // summary view (the per-event log carries the detail).
  const pct = (n: number): string => Math.round((n / total) * 100) + "%";

  stdout.write(`Scenario: ${scenario.name ?? "unnamed"}\n`);
  stdout.write(`Runs: ${total}\n`);
  stdout.write(`Results:\n`);
  for (const faction of NON_NEUTRAL_FACTIONS) {
    const w = wins.get(faction) ?? 0;
    stdout.write(`  ${pad(`${faction} wins:`, 16)} ${w} (${pct(w)})\n`);
  }
  if (stalemates > 0) {
    stdout.write(`  ${pad("Stalemate:", 16)} ${stalemates} (${pct(stalemates)})\n`);
  }
  if (eliminations > 0) {
    stdout.write(
      `  ${pad("Mutual KO:", 16)} ${eliminations} (${pct(eliminations)})\n`,
    );
  }
  const avg =
    lengths.reduce((acc, n) => acc + n, 0) / Math.max(1, lengths.length);
  stdout.write(
    `Avg game length: ${avg.toFixed(0)} ticks (${(avg * SECONDS_PER_TICK).toFixed(0)}s @ 1x)\n`,
  );
  stdout.write(`Median:          ${median(lengths)} ticks\n`);
  stdout.write(`P95:             ${percentile(lengths, 95)} ticks\n`);
}

function main(): void {
  const options = parseArgs(argv.slice(2));
  const base = loadScenario(options.scenarioFile, options.seedOverride);

  const results: RunResult[] = [];
  for (let i = 0; i < options.runs; i++) {
    const scenario: ScenarioInput = {
      ...base,
      rngSeed: seedForRun(base.rngSeed, i),
    };
    const result = runScenario(scenario, {
      maxTicks: options.maxTicks,
      emitEvents: options.logEvents,
    });
    results.push(result);
    if (options.logEvents) {
      for (const event of result.events ?? []) {
        stdout.write(JSON.stringify({ run: i, ...event }) + "\n");
      }
    }
  }

  printSummary(base, results);
}

main();
