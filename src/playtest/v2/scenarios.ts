import type { ScenarioInput } from "./runner";

// The three rivals start with nothing → they fall to TERRITORY_LOST and the
// player wins almost immediately. Smoke-tests the victory path.
export const QUICK_WIN: ScenarioInput = {
  name: "quick-win",
  boardSize: 5,
  rngSeed: 1,
  units: [{ owner: "TOKUGAWA", x: 0, y: 0, population: 100 }],
};

// Four nations, each a castle + an adjacent house in a corner — far apart, so
// nothing fights. Economies grow / expand / spawn while the game stays ongoing.
export const SPECTATOR_4: ScenarioInput = {
  name: "spectator-4",
  boardSize: 9,
  rngSeed: 42,
  castles: [
    { owner: "TOKUGAWA", x: 0, y: 0 },
    { owner: "TAKEDA", x: 8, y: 0 },
    { owner: "ODA", x: 0, y: 8 },
    { owner: "UESUGI", x: 8, y: 8 },
  ],
  houses: [
    { owner: "TOKUGAWA", x: 1, y: 0, population: 60 },
    { owner: "TAKEDA", x: 7, y: 0, population: 60 },
    { owner: "ODA", x: 1, y: 8, population: 60 },
    { owner: "UESUGI", x: 7, y: 8, population: 60 },
  ],
};

// The 4-nation board plus a lone central nest dripping monster units. All four
// stay alive (each holds a house), so the game runs long enough to spawn.
export const NEST_DRIP: ScenarioInput = {
  ...SPECTATOR_4,
  name: "nest-drip",
  rngSeed: 3,
  nests: [{ x: 4, y: 4 }],
};

export const SCENARIOS: Readonly<Record<string, ScenarioInput>> = {
  "quick-win": QUICK_WIN,
  "spectator-4": SPECTATOR_4,
  "nest-drip": NEST_DRIP,
};
