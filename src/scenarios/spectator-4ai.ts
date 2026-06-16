import { parseScenario, type ScenarioInput } from "@/playtest/runner";
import data from "./spectator-4ai.json";

export const spectator4aiScenario: ScenarioInput = parseScenario(data);
