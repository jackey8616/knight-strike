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

// Four rule AIs on the 4-nation board — the balance battleground. Each starts
// with a castle, a house, and a starting army; the AIs build, expand and march
// to conquer. Used to check the game converges (a winner, not perpetual stalemate).
export const SPECTATOR_4AI: ScenarioInput = {
  ...SPECTATOR_4,
  name: "spectator-4ai",
  ai: { TOKUGAWA: "normal", TAKEDA: "normal", ODA: "normal", UESUGI: "normal" },
  units: [
    { owner: "TOKUGAWA", x: 1, y: 1, population: 100 },
    { owner: "TAKEDA", x: 7, y: 1, population: 100 },
    { owner: "ODA", x: 1, y: 7, population: 100 },
    { owner: "UESUGI", x: 7, y: 7, population: 100 },
  ],
  factions: {
    TOKUGAWA: { gold: 300 },
    TAKEDA: { gold: 300 },
    ODA: { gold: 300 },
    UESUGI: { gold: 300 },
  },
};

export const SCENARIOS: Readonly<Record<string, ScenarioInput>> = {
  "quick-win": QUICK_WIN,
  "spectator-4": SPECTATOR_4,
  "spectator-4ai": SPECTATOR_4AI,
  "nest-drip": NEST_DRIP,
};
