import { PLAYER_FACTIONS } from "@/engine/v2/types";
import { step } from "@/engine/v2/tick";
import { buildScenarioState } from "./runner";
import { SPECTATOR_4AI } from "./scenarios";

// Throwaway balance diagnostic: run the 4-AI board and report what actually
// happens — event tally + final army / castle state — so we can see why it
// stalemates.
let s = buildScenarioState(SPECTATOR_4AI);
const tally = new Map<string, number>();
const maxTicks = Number(process.argv[2] ?? 1500);
for (let i = 0; i < maxTicks; i += 1) {
  const r = step(s);
  s = r.state;
  for (const e of r.events) tally.set(e.kind, (tally.get(e.kind) ?? 0) + 1);
}

console.log(`final tick ${s.tick}, day ${s.day}`);
console.log("event tally:");
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

console.log("per faction:");
for (const f of PLAYER_FACTIONS) {
  const units = s.units.filter((u) => u.owner === f);
  const pop = units.reduce((a, u) => a + u.population, 0);
  const biggest = units.reduce((a, u) => Math.max(a, u.population), 0);
  const houses = s.houses.filter((h) => h.owner === f).length;
  console.log(
    `  ${f}: units ${units.length} (pop ${pop}, biggest ${biggest}), houses ${houses}, gold ${s.factions[f].gold}, defeated ${s.defeated.has(f)}`,
  );
}
const castles = [...s.provinces.values()].filter((p) => p.isCastle);
console.log("castles:", castles.map((c) => `${c.castleOwner}=${c.castleDurability ?? "full"}`).join(", "));
