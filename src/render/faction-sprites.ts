import { Assets, type Texture } from "pixi.js";

import type { FactionId, Tier } from "@/engine/types";

// Authored per-(faction, tier) sprite set, loaded from public/downscale/. These
// replace the procedural tier bitmaps (sprites.ts) for the v1 game: full-colour
// art, so the renderer no longer tints by faction (NEUTRAL bandits, who have no
// art, reuse a faction sprite desaturated via tint at the call site).
export type FactionSprites = {
  get(faction: FactionId, tier: Tier): Texture;
};

// FactionId → public/downscale/<dir>. Matches the board's faction colours
// (FACTION_COLORS): red→TOKUGAWA, blue→TAKEDA, green→ODA, yellow→UESUGI.
const COLOR_DIR: Readonly<Record<Exclude<FactionId, "NEUTRAL">, string>> = {
  TOKUGAWA: "red",
  TAKEDA: "blue",
  ODA: "green",
  UESUGI: "yellow",
};
const TIERS: readonly Tier[] = ["SOLDIER", "KNIGHT", "QUEEN", "KING"];
const TIER_FILE: Readonly<Record<Tier, string>> = {
  SOLDIER: "soldier",
  KNIGHT: "knight",
  QUEEN: "queen",
  KING: "king",
};

export async function loadFactionSprites(): Promise<FactionSprites> {
  const base = import.meta.env.BASE_URL;
  const map = new Map<string, Texture>();
  await Promise.all(
    (
      Object.entries(COLOR_DIR) as [Exclude<FactionId, "NEUTRAL">, string][]
    ).flatMap(([faction, dir]) =>
      TIERS.map(async (tier) => {
        const url = `${base}downscale/${dir}/${TIER_FILE[tier]}.png`;
        const tex = await Assets.load<Texture>(url);
        // The art is downscaled to tile size at render time — linear sampling
        // (not the app's global nearest) keeps it smooth instead of aliased.
        tex.source.scaleMode = "linear";
        map.set(`${faction}|${tier}`, tex);
      }),
    ),
  );
  return {
    get(faction, tier) {
      return (
        map.get(`${faction}|${tier}`) ??
        (map.get(`TOKUGAWA|${tier}`) as Texture)
      );
    },
  };
}
