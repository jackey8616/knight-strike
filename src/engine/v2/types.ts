// PRD v2.0 §3 / §4 — the v2 (Lord Monarch economy) state model. Entity-centric:
// units / houses / fields / nests / buildings are first-class objects keyed by
// id, with per-faction economy. `provinces` survives only as the terrain +
// castle substrate (territory ownership in v2 is derived from houses/fields/
// units, not garrison stamps). Built under engine/v2/ so the v1 engine keeps
// compiling until the M11 cutover (BACKLOG risk #1).

export type FactionId =
  | "TOKUGAWA"
  | "TAKEDA"
  | "ODA"
  | "UESUGI"
  | "NEUTRAL"
  | "MONSTER";

// The four playable nations (have castle / gold / tax / can be defeated).
export const PLAYER_FACTIONS = [
  "TOKUGAWA",
  "TAKEDA",
  "ODA",
  "UESUGI",
] as const satisfies readonly FactionId[];

// All faction ids in a fixed, deterministic order — used to build total
// `Record<FactionId, …>` maps and to iterate without relying on Map order.
export const ALL_FACTIONS = [
  "TOKUGAWA",
  "TAKEDA",
  "ODA",
  "UESUGI",
  "NEUTRAL",
  "MONSTER",
] as const satisfies readonly FactionId[];

// PRD §4.6 — population tier (display + damage-magnitude bands). S/M/L at
// 1 / 1000 / 10000 (replaces the v1 5/15/30 SOLDIER/KNIGHT/QUEEN/KING model).
export type UnitTier = "S" | "M" | "L";

// PRD §4.2 — game speed. Affects only the real-time tick interval, never logic.
export type Speed = "slow" | "medium" | "fast";

// PRD §4.11 — LAVA is new in v2 (bridgeable barrier, like WATER/river).
export type Terrain = "PLAINS" | "MOUNTAIN" | "WATER" | "FOREST" | "LAVA";

export type TileId = string;

export type Faction = {
  readonly id: FactionId;
  readonly gold: number;
  readonly taxRate: number; // 0 .. 0.30 (PRD §4.3)
  readonly isPlayer: boolean; // only a player can lose by TIME_OUT (§7.1)
  // victory §3.3 battle-efficiency accounting (own losses vs enemy/monster kills)
  readonly unitsLostTotal: number;
  readonly enemyLossesCredited: number;
};

export type DestructionTargetKind =
  | "HOUSE"
  | "FIELD"
  | "BRIDGE"
  | "FENCE"
  | "CASTLE"
  | "NEST";

export type DestructionTask = {
  readonly unitId: string;
  readonly targetKind: DestructionTargetKind;
  readonly targetId: string; // entity id, or tileId for field/castle
};

// What a stationary unit is busy doing (construction occupies it; PRD §4.9).
export type UnitTask =
  | { readonly kind: "construct"; readonly taskId: string }
  | { readonly kind: "destruct"; readonly target: DestructionTask };

export type Unit = {
  readonly id: string; // "unit:N"
  readonly owner: FactionId;
  readonly tile: TileId;
  readonly population: number;
  readonly isMonster: boolean; // monster combat multiplier + king-kill discriminator
  readonly isElite: boolean; // derived: largest unit of its nation (star, §4.6)
  readonly task: UnitTask | null;
  readonly combatLock: string | null; // opposing unitId while fighting-to-death
};

export type House = {
  readonly id: string; // "house:N"
  readonly owner: FactionId;
  readonly tile: TileId;
  readonly population: number; // doubles as durability (PRD §4.9)
  readonly connectedToCastle: boolean; // set by the connectivity pass (§4.5)
  readonly lastGrowthDay: number;
  readonly lastExpansionDay: number;
};

export type Field = {
  readonly owner: FactionId;
  readonly tile: TileId; // one field per tile; durability 1
};

export type MonsterNest = {
  readonly id: string;
  readonly tile: TileId;
  readonly accumulated: number; // 0 .. 99
  readonly createdTick: number;
  readonly durability: number; // default 100 (§6)
};

export type BuildingKind = "BRIDGE" | "FENCE";

export type Building = {
  readonly id: string;
  readonly kind: BuildingKind;
  readonly owner: FactionId | null; // bridges/fences may be ownerless
  readonly tile: TileId;
  readonly durability: number;
  readonly maxDurability: number;
};

export type ConstructionKind = "HOUSE" | "BRIDGE" | "FENCE";

export type ConstructionTask = {
  readonly id: string;
  readonly kind: ConstructionKind;
  readonly unitId: string;
  readonly tile: TileId;
  readonly startTick: number;
  readonly totalTicks: number; // HOUSE 0 (instant), BRIDGE 2, FENCE 5
  readonly ticksRemaining: number;
};

// Replaces the v1 MarchingStack: in v2 a unit moves whole (no ratio split;
// splitting happens only when a unit builds a house, §4.4).
export type MarchOrder = {
  readonly unitId: string;
  readonly path: readonly TileId[];
  readonly idx: number;
};

// Minimal AI config tag. Opponent AI behaviour is deferred to M12 (PRD §5.1 —
// v2_spec under-specs it); this only records the intended mode per faction.
export type AiMode = "idle" | "easy" | "normal" | "hard" | "scripted";

// PRD §7.3 / victory-conditions-spec §4 — per-level settlement result carried
// by the `level.completed` event and surfaced on the level-result screen.
export type LevelEndResult = {
  readonly occupationRate: number; // 0 .. 1
  readonly battleEfficiency: number; // 0 .. 600
  readonly daysDecrease: number;
  readonly daysIncrease: number;
  readonly finalRemainingDays: number;
};

// Terrain + castle substrate only — no occupants/lastClaimedFaction (v1 model).
export type Province = {
  readonly id: TileId;
  readonly x: number;
  readonly y: number;
  readonly terrain: Terrain;
  readonly isCastle: boolean;
  readonly castleOwner: FactionId | null;
  // PRD §4.9 — castle HP (default CASTLE_DURABILITY when undefined). Reaching 0
  // via destruction = the king is down (M8 sets it; M10 acts on it).
  readonly castleDurability?: number;
  // The faction whose unit razed this castle (the killer), set when durability
  // hits 0. M10 reads it to choose inheritance (human) vs catastrophe (MONSTER).
  readonly castleDestroyedBy?: FactionId;
};

export type GameState = {
  readonly boardSize: number;
  readonly tick: number;
  readonly day: number; // = floor(tick / 2), cached for events (§4.2)
  readonly speed: Speed; // UI knob; does NOT affect logic (determinism)
  readonly provinces: ReadonlyMap<TileId, Province>;
  readonly factions: Readonly<Record<FactionId, Faction>>;
  readonly units: readonly Unit[];
  readonly houses: readonly House[];
  readonly fields: readonly Field[];
  readonly nests: readonly MonsterNest[];
  readonly buildings: readonly Building[];
  readonly constructions: readonly ConstructionTask[];
  readonly marchOrders: readonly MarchOrder[];
  readonly connectivity: ReadonlySet<string>; // house ids connected to own castle
  readonly aiConfig: Readonly<Record<FactionId, AiMode>>;
  readonly defeated: ReadonlySet<FactionId>;
  readonly remainingDays: number; // victory §3, persists across levels
  readonly elapsedDaysThisLevel: number;
  readonly rngSeed: number;
  readonly nextEntityId: number; // single monotonic id source
};
