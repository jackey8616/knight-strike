import { CASTLE_DURABILITY } from "./construction";
import { ev, type GameEvent, type StepResult } from "./events";
import { applyMonsterKingKill } from "./monster";
import { tileId } from "./state";
import {
  PLAYER_FACTIONS,
  type FactionId,
  type GameState,
  type LevelEndResult,
  type TileId,
} from "./types";

export const LEVEL_START_BONUS = 3000;
export const EFFICIENCY_CAP = 600;

function playerFaction(state: GameState): FactionId {
  return PLAYER_FACTIONS.find((f) => state.factions[f].isPlayer) ?? "TOKUGAWA";
}

// PRD §7.1 — a nation with neither a house nor a unit has lost its territory.
function hasTerritory(state: GameState, faction: FactionId): boolean {
  return (
    state.units.some((u) => u.owner === faction) || state.houses.some((h) => h.owner === faction)
  );
}

// Human conquest: the killer inherits everything (PRD §7.1).
function inherit(state: GameState, victim: FactionId, killer: FactionId): GameState {
  const victimGold = state.factions[victim].gold;
  return {
    ...state,
    units: state.units.map((u) => (u.owner === victim ? { ...u, owner: killer } : u)),
    houses: state.houses.map((h) => (h.owner === victim ? { ...h, owner: killer } : h)),
    fields: state.fields.map((f) => (f.owner === victim ? { ...f, owner: killer } : f)),
    factions: {
      ...state.factions,
      [victim]: { ...state.factions[victim], gold: 0 },
      [killer]: { ...state.factions[killer], gold: state.factions[killer].gold + victimGold },
    },
  };
}

function resolveCastle(state: GameState, tile: TileId, newOwner: FactionId | null): GameState {
  const p = state.provinces.get(tile);
  if (p === undefined) return state;
  const provinces = new Map(state.provinces);
  if (newOwner === null) {
    // catastrophe: the castle reverts to bare land
    const { castleDestroyedBy: _d, castleDurability: _h, ...rest } = p;
    provinces.set(tile, { ...rest, isCastle: false, castleOwner: null });
  } else {
    // inheritance: the killer takes the castle at full HP
    const { castleDestroyedBy: _d, ...rest } = p;
    provinces.set(tile, { ...rest, castleOwner: newOwner, castleDurability: CASTLE_DURABILITY });
  }
  return { ...state, provinces };
}

// PRD §7.1 — process all defeat conditions for this tick in priority order:
// TIME_OUT (player) → KING_KILLED (razed castle) → TERRITORY_LOST.
export function applyDefeats(state: GameState): StepResult {
  let s = state;
  const events: GameEvent[] = [];
  const newlyDefeated = new Set<FactionId>();

  // 1) TIME_OUT — player only
  const player = playerFaction(s);
  if (!s.defeated.has(player) && s.elapsedDaysThisLevel > s.remainingDays) {
    newlyDefeated.add(player);
    events.push(ev.nationDefeated(player, "TIME_OUT"));
  }

  // 2) KING_KILLED — castles razed to 0 durability
  for (const [tile, p] of state.provinces) {
    if (!p.isCastle || p.castleOwner === null) continue;
    if ((p.castleDurability ?? Number.POSITIVE_INFINITY) > 0 || p.castleDestroyedBy === undefined) continue;
    const victim = p.castleOwner;
    if (s.defeated.has(victim) || newlyDefeated.has(victim)) continue;
    const killer = p.castleDestroyedBy;
    if (killer === "MONSTER") {
      const r = applyMonsterKingKill(s, victim);
      s = r.state;
      for (const e of r.events) events.push(e);
      s = resolveCastle(s, tile, null);
      events.push(ev.nationDefeated(victim, "KING_KILLED", "MONSTER"));
    } else {
      s = inherit(s, victim, killer);
      s = resolveCastle(s, tile, killer);
      events.push(ev.nationDefeated(victim, "KING_KILLED", killer));
    }
    newlyDefeated.add(victim);
  }

  // 3) TERRITORY_LOST
  for (const f of PLAYER_FACTIONS) {
    if (s.defeated.has(f) || newlyDefeated.has(f)) continue;
    if (!hasTerritory(s, f)) {
      s = {
        ...s,
        factions: { ...s.factions, [f]: { ...s.factions[f], gold: 0 } },
        fields: s.fields.map((fl) => (fl.owner === f ? { ...fl, owner: "NEUTRAL" } : fl)),
      };
      newlyDefeated.add(f);
      events.push(ev.nationDefeated(f, "TERRITORY_LOST"));
    }
  }

  if (newlyDefeated.size === 0) return { state, events: [] };
  const defeated = new Set(s.defeated);
  for (const f of newlyDefeated) defeated.add(f);
  return { state: { ...s, defeated }, events };
}

export type GameOutcome =
  | { readonly kind: "ongoing" }
  | { readonly kind: "win"; readonly winner: FactionId }
  | { readonly kind: "loss" }
  | { readonly kind: "stalemate" };

// PRD §7.2 — the player wins when it's the last nation standing, loses if it is
// defeated, otherwise the game is ongoing.
export function evaluateOutcome(state: GameState): GameOutcome {
  const player = playerFaction(state);
  if (state.defeated.has(player)) return { kind: "loss" };
  const alive = PLAYER_FACTIONS.filter((f) => !state.defeated.has(f));
  if (alive.length === 1) return { kind: "win", winner: player };
  if (alive.length === 0) return { kind: "stalemate" };
  return { kind: "ongoing" };
}

// --- level scoring (PRD §7.3) -------------------------------------------

export function occupationRate(state: GameState, faction: FactionId): number {
  let buildable = 0;
  for (let x = 0; x < state.boardSize; x += 1) {
    for (let y = 0; y < state.boardSize; y += 1) {
      const terrain = state.provinces.get(tileId(x, y))?.terrain ?? "PLAINS";
      if (terrain === "PLAINS" || terrain === "FOREST") buildable += 1;
    }
  }
  if (buildable === 0) return 1;
  const owned =
    state.houses.filter((h) => h.owner === faction).length +
    state.fields.filter((f) => f.owner === faction).length;
  return Math.min(1, owned / buildable);
}

export function occupationPenalty(remaining: number, rate: number): number {
  return Math.floor(remaining * (1 - rate));
}

export function battleEfficiency(myLosses: number, enemyLosses: number): number {
  if (myLosses <= 0) return EFFICIENCY_CAP;
  return Math.min(EFFICIENCY_CAP, Math.floor((enemyLosses / myLosses) * 100));
}

// PRD §7.3 settlement order: +3000 → −elapsed → −occupation penalty →
// +battle-efficiency bonus. The result carries to the next level.
export function scoreLevelEnd(state: GameState): LevelEndResult {
  const player = playerFaction(state);
  let remaining = state.remainingDays + LEVEL_START_BONUS;
  remaining -= state.elapsedDaysThisLevel;
  const rate = occupationRate(state, player);
  const daysDecrease = occupationPenalty(remaining, rate);
  remaining -= daysDecrease;
  const efficiency = battleEfficiency(
    state.factions[player].unitsLostTotal,
    state.factions[player].enemyLossesCredited,
  );
  const daysIncrease = efficiency - 100;
  remaining += daysIncrease;
  return {
    occupationRate: rate,
    battleEfficiency: efficiency,
    daysDecrease,
    daysIncrease,
    finalRemainingDays: remaining,
  };
}
