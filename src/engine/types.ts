export type FactionId = "TOKUGAWA" | "TAKEDA" | "ODA" | "UESUGI" | "NEUTRAL";

export type Tier = "SOLDIER" | "KNIGHT" | "QUEEN" | "KING";

// PRD §3.9 (v1.6): per-tile terrain. PLAINS is the neutral baseline. MOUNTAIN
// and WATER are impassable (can't be entered / claimed / pathed through). FOREST
// gives the unit standing on it a defensive damage reduction. Only MOUNTAIN is
// rendered with height (a continuous wave); the rest are flat, told apart by
// colour.
export type Terrain = "PLAINS" | "MOUNTAIN" | "WATER" | "FOREST";

export type TileId = string;

export type Occupant = {
  readonly faction: FactionId;
  readonly amount: number;
  readonly arrivalTick: number;
  readonly isDefender: boolean;
};

export type Province = {
  readonly id: TileId;
  readonly x: number;
  readonly y: number;
  readonly isCastle: boolean;
  readonly castleOwner: FactionId | null;
  // PRD §3.9 (v1.6): tile terrain. Optional in the type so existing fixtures
  // omit it; engine helpers treat absent as PLAINS. Generated per game (seeded)
  // and assigned at scenario load.
  readonly terrain?: Terrain;
  // PRD §4.3 (v2.6) House economy. A House is a building on an owned tile that
  // grows population, pays tax into its owner's treasury, and spawns troop
  // stacks. Modelled as flags on the tile (like a castle), not a separate
  // entity. Optional like `terrain` so existing fixtures omit them; engine
  // helpers treat absent as "no house". An enemy capturing the tile razes it.
  readonly isHouse?: boolean;
  readonly houseOwner?: FactionId | null;
  readonly housePopulation?: number;
  // PRD §3.6' (v1.4): invariant — at most one faction present at a time.
  // Units never share a tile with the enemy (combat is cross-edge).
  readonly occupants: readonly Occupant[];
  // PRD §3.5.4 v1.3 walk-through claim + §3.6' (v1.4) break/capture state.
  // Set to the occupant's faction whenever a tile gains a garrison, and kept
  // when that garrison is wiped out — so a freshly-emptied enemy tile still
  // reads as "enemy-claimed" and must be broken to NEUTRAL before capture.
  // Drives derivedOwner for empty tiles but never grants dispatch rights.
  readonly lastClaimedFaction: FactionId | null;
};

export type MarchingStack = {
  readonly id: string;
  readonly faction: FactionId;
  readonly count: number;
  readonly path: readonly TileId[];
  readonly idx: number;
  readonly dispatchedAtTick: number;
};

// PRD §3.6' (v1.4) + conquer-march (v1.5): a cross-edge siege carried out by a
// conquering column. `from` is the own-claimed tile the column stands on; `to`
// is the adjacent (4-conn) target being attacked. `count` is the column's own
// troops (v1.5: the order owns them — they are NOT a `from` occupant, so a
// source garrison / castle reserve never gets mixed in). `route` is the
// remaining tiles to conquer after `to` (empty = `to` is the final target).
// startTick anchors the step-function combat tick (t = currentTick - startTick).
// On capture the column advances (re-spawns a marching stack on `to`, or
// garrisons `to` when route is empty); the order is removed when the column is
// wiped out, the target is captured, or the faction is defeated.
export type AttackOrder = {
  readonly from: TileId;
  readonly to: TileId;
  readonly faction: FactionId;
  readonly count: number;
  readonly route: readonly TileId[];
  readonly startTick: number;
};

export type RuleTier = "easy" | "normal" | "hard";

export type AiMode =
  | { readonly kind: "rule"; readonly tier: RuleTier }
  | { readonly kind: "scripted" }
  | { readonly kind: "idle" };

export const AI_IDLE: AiMode = { kind: "idle" };
export const AI_SCRIPTED: AiMode = { kind: "scripted" };
export const AI_EASY: AiMode = { kind: "rule", tier: "easy" };
export const AI_NORMAL: AiMode = { kind: "rule", tier: "normal" };
export const AI_HARD: AiMode = { kind: "rule", tier: "hard" };

// PRD §4.3 (v2.6): per-faction economy. `gold` is the treasury that funds House
// construction; `taxPct` (0..30) is the rate Houses are taxed at — high tax
// yields more gold now but slows population growth (§4.3). NEUTRAL is present
// for total-record typing but never earns or spends.
export type FactionEconomy = {
  readonly gold: number;
  readonly taxPct: number;
};

export type GameState = {
  readonly boardSize: number;
  readonly tick: number;
  readonly provinces: ReadonlyMap<TileId, Province>;
  readonly marchingStacks: readonly MarchingStack[];
  readonly attackOrders: readonly AttackOrder[];
  readonly aiConfig: Readonly<Record<FactionId, AiMode>>;
  readonly economy: Readonly<Record<FactionId, FactionEconomy>>;
  readonly defeated: ReadonlySet<FactionId>;
  readonly rngSeed: number;
  readonly nextMarchingId: number;
};
