export type FactionId = "TOKUGAWA" | "TAKEDA" | "ODA" | "UESUGI" | "NEUTRAL";

export type Tier = "SOLDIER" | "KNIGHT" | "QUEEN" | "KING";

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
  readonly occupants: readonly Occupant[];
  readonly combatStartTick: number | null;
};

export type MarchingStack = {
  readonly id: string;
  readonly faction: FactionId;
  readonly count: number;
  readonly path: readonly TileId[];
  readonly idx: number;
  readonly dispatchedAtTick: number;
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

export type GameState = {
  readonly boardSize: number;
  readonly tick: number;
  readonly provinces: ReadonlyMap<TileId, Province>;
  readonly marchingStacks: readonly MarchingStack[];
  readonly aiConfig: Readonly<Record<FactionId, AiMode>>;
  readonly defeated: ReadonlySet<FactionId>;
  readonly rngSeed: number;
  readonly nextMarchingId: number;
};
