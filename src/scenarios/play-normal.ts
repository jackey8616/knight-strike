import { parseScenario, type ScenarioInput } from "@/playtest/runner";
import data from "./play-normal.json";

// Dev-playground scenario for `pnpm dev`: player (TOKUGAWA) is idle so the
// browser UI is the only thing driving its dispatches, while the other three
// corners run on Normal-tier rule AI so the player has actual opponents.
export const playNormalScenario: ScenarioInput = parseScenario(data);
