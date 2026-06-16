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

export type RuleTier = "easy" | "normal" | "hard";

// PRD §4 (v1.1): discriminated union so the future LLM tier slots in as a
// `{kind: "llm", …}` variant without breaking type assignability across the
// dozens of `aiConfig[faction]` switches. Shorthand strings in scenario JSON
// (`"easy"`, `"normal"`, `"hard"`, `"idle"`, `"scripted"`) get normalized to
// this shape by `parseScenario`.
export type AiMode =
  | { readonly kind: "rule"; readonly tier: RuleTier }
  | { readonly kind: "scripted" }
  | { readonly kind: "idle" };

// Canonical `AiMode` constants for fixture / scenario authoring. Re-exposing
// the literals as named values keeps tests and engine call-sites from spelling
// the discriminator key out 5×4 times in every aiConfig record.
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
  readonly stalemates: StalemateMap;
  readonly aiConfig: Readonly<Record<FactionId, AiMode>>;
  readonly defeated: ReadonlySet<FactionId>;
  readonly rngSeed: number;
  readonly nextMarchingId: number;
};
