import { getTier } from "./combat-tier";
import { ev, type GameEvent, type StepResult } from "./events";
import { parseTileId, vonNeumannNeighbors } from "./state";
import type { FactionId, GameState, TileId, Unit, UnitTier } from "./types";

// PRD §6.1 (v2.1) — damage is proportional to the attacker's population scaled
// by a tier weight, so a larger force always wins and the gap widens each tick
// (Lanchester square law), and a higher tier dominates a lower one with no
// overlap. Flagged playtest-tunable.
export const TIER_WEIGHT: Record<UnitTier, number> = { S: 1, M: 10, L: 100 };

// PRD §4.9 / §6 — monsters fight as if their headcount were doubled (real
// population is still what gets debited; used by M9 monster units).
export const MONSTER_MULTIPLIER = 2;

export function effectivePopulation(unit: Pick<Unit, "population" | "isMonster">): number {
  return unit.isMonster ? unit.population * MONSTER_MULTIPLIER : unit.population;
}

export function calcDamage(population: number): number {
  const tier = getTier(population);
  return Math.max(1, Math.floor((population * TIER_WEIGHT[tier]) / 100));
}

// PRD §4.7 — contact → fight to the death, per-unit 1v1 (no headcount merging),
// can't interrupt. Each tick: keep valid locks, pair the rest with their nearest
// adjacent enemy (tie → smaller id), deal simultaneous damage, resolve deaths
// (mutual annihilation → larger pre-combat pop survives). NEUTRAL never retaliates.
export function resolveCombat(state: GameState): StepResult {
  const units = state.units;
  if (units.length < 2) return clearStaleLocks(state);

  const byId = new Map<string, Unit>(units.map((u) => [u.id, u]));
  const byTile = new Map<TileId, string[]>();
  for (const u of units) {
    const arr = byTile.get(u.tile);
    if (arr) arr.push(u.id);
    else byTile.set(u.tile, [u.id]);
  }

  const adjacentEnemies = (u: Unit): string[] => {
    const { x, y } = parseTileId(u.tile);
    const res: string[] = [];
    for (const nbr of vonNeumannNeighbors(x, y, state.boardSize)) {
      for (const oid of byTile.get(nbr) ?? []) {
        const o = byId.get(oid);
        if (o && o.owner !== u.owner) res.push(oid);
      }
    }
    res.sort();
    return res;
  };

  const ids = [...byId.keys()].sort();
  const lock = new Map<string, string>();
  const events: GameEvent[] = [];

  // 1) honour still-valid existing locks (can't interrupt a fight)
  for (const id of ids) {
    if (lock.has(id)) continue;
    const u = byId.get(id);
    if (u === undefined || u.combatLock === null) continue;
    const opp = byId.get(u.combatLock);
    if (
      opp !== undefined &&
      opp.owner !== u.owner &&
      !lock.has(opp.id) &&
      adjacentEnemies(u).includes(opp.id)
    ) {
      lock.set(id, opp.id);
      lock.set(opp.id, id);
    }
  }
  // 2) form new pairings for the unlocked
  for (const id of ids) {
    if (lock.has(id)) continue;
    const u = byId.get(id);
    if (u === undefined) continue;
    const cand = adjacentEnemies(u).filter((oid) => !lock.has(oid));
    const oppId = cand[0];
    if (oppId === undefined) continue;
    lock.set(id, oppId);
    lock.set(oppId, id);
    events.push(ev.combatEngaged(id, oppId));
  }

  if (lock.size === 0) return clearStaleLocks(state);

  // 3) simultaneous damage (NEUTRAL deals none)
  const damageTaken = new Map<string, number>();
  const attacker = new Map<string, string>();
  const pairSeen = new Set<string>();
  for (const [aId, bId] of lock) {
    if (pairSeen.has(aId)) continue;
    pairSeen.add(aId);
    pairSeen.add(bId);
    const a = byId.get(aId) as Unit;
    const b = byId.get(bId) as Unit;
    const dmgToB = a.owner === "NEUTRAL" ? 0 : calcDamage(effectivePopulation(a));
    const dmgToA = b.owner === "NEUTRAL" ? 0 : calcDamage(effectivePopulation(b));
    damageTaken.set(aId, dmgToA);
    attacker.set(aId, bId);
    damageTaken.set(bId, dmgToB);
    attacker.set(bId, aId);
    if (dmgToA > 0) events.push(ev.combatDamageDealt(aId, dmgToA, Math.max(0, a.population - dmgToA)));
    if (dmgToB > 0) events.push(ev.combatDamageDealt(bId, dmgToB, Math.max(0, b.population - dmgToB)));
  }

  // 4) deaths + mutual-annihilation tiebreak (larger pre-combat wins, tie → id)
  const newPop = new Map<string, number>();
  for (const u of units) newPop.set(u.id, u.population - (damageTaken.get(u.id) ?? 0));
  const dead = new Set<string>();
  pairSeen.clear();
  for (const [aId, bId] of lock) {
    if (pairSeen.has(aId)) continue;
    pairSeen.add(aId);
    pairSeen.add(bId);
    if ((newPop.get(aId) ?? 0) <= 0 && (newPop.get(bId) ?? 0) <= 0) {
      const a = byId.get(aId) as Unit;
      const b = byId.get(bId) as Unit;
      const aWins = a.population > b.population || (a.population === b.population && a.id < b.id);
      newPop.set(aWins ? aId : bId, 1);
      dead.add(aWins ? bId : aId);
    }
  }
  for (const u of units) {
    if (!dead.has(u.id) && (newPop.get(u.id) ?? 0) <= 0) dead.add(u.id);
  }

  // 5) build next units + accrue losses (for victory §3.3 battle efficiency)
  const nextUnits: Unit[] = [];
  const lostBy = new Map<FactionId, number>();
  const creditTo = new Map<FactionId, number>();
  for (const u of units) {
    if (dead.has(u.id)) {
      events.push(ev.combatUnitDestroyed(u.id, attacker.get(u.id) ?? null));
      lostBy.set(u.owner, (lostBy.get(u.owner) ?? 0) + u.population);
      const killer = byId.get(attacker.get(u.id) ?? "");
      if (killer !== undefined) {
        creditTo.set(killer.owner, (creditTo.get(killer.owner) ?? 0) + u.population);
      }
      continue;
    }
    const np = newPop.get(u.id) ?? u.population;
    const oppId = lock.get(u.id);
    const newLock = oppId !== undefined && !dead.has(oppId) ? oppId : null;
    if (np !== u.population || newLock !== u.combatLock) {
      nextUnits.push({ ...u, population: np, combatLock: newLock });
    } else {
      nextUnits.push(u);
    }
  }

  let factions = state.factions;
  if (lostBy.size > 0 || creditTo.size > 0) {
    const f = { ...state.factions };
    for (const [fac, lost] of lostBy) f[fac] = { ...f[fac], unitsLostTotal: f[fac].unitsLostTotal + lost };
    for (const [fac, cred] of creditTo) {
      f[fac] = { ...f[fac], enemyLossesCredited: f[fac].enemyLossesCredited + cred };
    }
    factions = f;
  }

  return { state: { ...state, units: nextUnits, factions }, events };
}

function clearStaleLocks(state: GameState): StepResult {
  let changed = false;
  const units = state.units.map((u) => {
    if (u.combatLock === null) return u;
    changed = true;
    return { ...u, combatLock: null };
  });
  return changed ? { state: { ...state, units }, events: [] } : { state, events: [] };
}
