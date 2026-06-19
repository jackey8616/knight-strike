import { runScenario } from "./runner";
import { SCENARIOS } from "./scenarios";

function numArg(args: readonly string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined ? Number(v) : fallback;
}

function main(): void {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--")) ?? "spectator-4";
  const runs = numArg(args, "--runs", 1);
  const maxTicks = numArg(args, "--max-ticks", 500);
  const logEvents = args.includes("--log");

  const scenario = SCENARIOS[name];
  if (scenario === undefined) {
    console.error(`unknown scenario "${name}". known: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
    return;
  }

  const spectator = name.startsWith("spectator");
  const tally = new Map<string, number>();
  let totalTicks = 0;
  for (let i = 0; i < runs; i += 1) {
    const r = runScenario({ ...scenario, rngSeed: scenario.rngSeed + i }, { maxTicks, emitEvents: logEvents, spectator });
    const key = spectator
      ? (r.winner ?? "stalemate")
      : r.outcome.kind === "win"
        ? `win:${r.outcome.winner}`
        : r.outcome.kind;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    totalTicks += r.ticks;
    if (logEvents) console.log(`run ${i}: ${key} @ tick ${r.ticks} (${r.events?.length ?? 0} events)`);
  }

  console.log(`Scenario: ${name} | runs: ${runs}`);
  for (const [k, v] of [...tally.entries()].sort()) {
    console.log(`  ${k}: ${v} (${Math.round((v / runs) * 100)}%)`);
  }
  console.log(`Avg length: ${Math.round(totalTicks / runs)} ticks`);
}

main();
