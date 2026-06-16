import { parseScenario, type ScenarioInput } from "@/playtest/runner";
import data from "./default.json";

// Pre-parse at import time so consumers (engine tests, main.ts) get a
// post-normalization `ScenarioInput` with the discriminated-union `AiMode`
// shape rather than the raw shorthand strings the JSON file holds.
export const defaultScenario: ScenarioInput = parseScenario(data);
