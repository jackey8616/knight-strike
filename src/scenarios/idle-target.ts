import { parseScenario, type ScenarioInput } from "@/playtest/runner";
import data from "./idle-target.json";

export const idleTargetScenario: ScenarioInput = parseScenario(data);
