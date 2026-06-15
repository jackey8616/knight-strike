export type FactionId = "TOKUGAWA" | "TAKEDA" | "ODA" | "UESUGI" | "NEUTRAL";

export type Tier = "SOLDIER" | "KNIGHT" | "QUEEN" | "KING";

export type TileId = string;

export type PairKey = string;

export type Province = {
  readonly id: TileId;
  readonly x: number;
  readonly y: number;
  readonly owner: FactionId;
  readonly count: number;
  readonly isCastle: boolean;
  // PRD §3.6.1 hysteresis: tick at which §3.6.1 last flipped this tile's
  // owner; null = never claimed. Used to enforce the 3-tick protection
  // window. Other ownership changes (dispatch arrival, defeat conversion)
  // do not touch this field.
  readonly lastClaimedAtTick: number | null;
};

export type MarchingStack = {
  readonly id: string;
  readonly faction: FactionId;
  readonly count: number;
  readonly path: readonly TileId[];
  readonly idx: number;
  readonly dispatchedAtTick: number;
};

export type StalemateMap = ReadonlyMap<PairKey, number>;

export type AiMode = "default" | "scripted" | "idle";

export type GameState = {
  readonly boardSize: number;
  readonly tick: number;
  readonly provinces: ReadonlyMap<TileId, Province>;
  readonly marchingStacks: readonly MarchingStack[];
  readonly stalemates: StalemateMap;
  readonly aiConfig: Readonly<Record<FactionId, AiMode>>;
  readonly defeated: ReadonlySet<FactionId>;
  readonly rngSeed: number;
  readonly nextMarchingId: number;
};
