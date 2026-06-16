# PRD §4 Draft — v1.1 Tiered AI

> **Status**: Draft proposal for PRD v1.1. Reviewer merges desired prose into `docs/PRD.md` and bumps the version banner. This file is the working space, not the spec.
>
> Engine reality (commit on the same branch): the discriminated-union `AiMode`, the `RuleProfile` table, and the per-tier deltas described below are already implemented and unit-tested. The PRD prose is what's missing.

---

## §4 Non-Player Faction Control (v1.1)

### §4.0 Tier Overview

Non-player factions are controlled by one of four `AiMode` variants, set per-faction in `scenario.aiConfig`:

| `aiConfig[faction]` shorthand | Engine shape | Behaviour |
| --- | --- | --- |
| `"easy"` | `{kind: "rule", tier: "easy"}` | Rule-based AI, slow + short-sighted. Player can flank trivially. |
| `"normal"` | `{kind: "rule", tier: "normal"}` | Rule-based AI, baseline cadence + reach (= v0.12 orphan AI bit-for-bit). |
| `"hard"` | `{kind: "rule", tier: "hard"}` | Rule-based AI, tighter cadence, longer attack reach, more aggressive castle siphon. |
| `"idle"` | `{kind: "idle"}` | Faction never evaluates, never dispatches. Castle still produces (§3.3). |
| `"scripted"` | `{kind: "scripted"}` | Faction only fires `scenario.scriptedCommands` at their `atTick`. |

The scenario JSON loader (`parseScenario`) accepts either the shorthand string or the explicit `{kind, tier?}` object form per faction. Legacy `"default"` is accepted as an alias for `"normal"` with a one-time `console.warn`; the alias should be removed in a follow-up minor.

LLM-driven AI is **explicitly out of scope** for v1.1 and is documented in §8 future scope. The discriminated-union `AiMode` shape was chosen so an `{kind: "llm", …}` variant can be added later without rewriting every consumer.

### §4.1 Rule-Tier Knobs

All three rule tiers share the same five rules (Defense → Expand → Rally → Attack → Hoard) and the same RNG plumbing (§4.3). Tier difference is entirely in the `RuleProfile` knob bag at `src/engine/ai-profile.ts`:

| Knob | Easy | Normal | Hard | Effect |
| --- | --- | --- | --- | --- |
| `evalInterval` | 8 | 5 | 3 | Ticks between evaluations per faction. Lower = AI reacts faster. |
| `defenseRadius` (manhattan) | 1 | 2 | 3 | Threat trigger radius around own castle. |
| `attackHops` | 4 | 8 | 10 | Max BFS hops to consider enemy castles. |
| `attackPowerRatio` | 2.0 | 1.5 | 1.25 | Power multiplier the source must exceed over target. |
| `rallyEnabled` | false | true | true | Whether Rally rule fires at all. |
| `expandRatio` (non-castle) | 0.5 | 0.5 | 0.66 | Fraction of non-castle source shipped out. |
| `castleQueenSendRatio` | 0.20 | 0.33 | 0.40 | Fraction of Queen-band castle (count 15..29) siphoned. |

Soldier-band castle (count 5..14) and King-band castle (count ≥ 30) keep static ratios across all tiers because those bands gate tier progression, not aggression.

Faction staggering (`FACTION_OFFSETS`: TOKUGAWA 1 / TAKEDA 2 / ODA 3 / UESUGI 4) is unchanged; evaluations fire on `(tick - offset) % profile.evalInterval === 0`.

### §4.2 Rule Catalogue

Rules fire in priority order, short-circuit on first success.

1. **Defense** — if any enemy with count > 0 lies within `defenseRadius` manhattan of own castle, route 50% from the closest passable own non-castle tile back to the castle.
2. **Expand** — if any empty tile (count 0) sits adjacent to faction territory, dispatch from a passable own source. Non-castle source must have `count ≥ EXPAND_MIN_STACK` (= 5) and ships `floor(count * expandRatio)`. Castle source must clear the tier reserve (Knight 5 / Queen 15) and ships per the castle-tier branches.
3. **Rally** — if `rallyEnabled` and any non-castle frontline (own tile with at least one non-self neighbour) exists, ship 50% from every adjacent own non-castle source into the highest-count anchor.
4. **Attack** — if any live enemy castle is reachable within `attackHops` and the source's `(count - 1) × tierPower` exceeds `target.power × attackPowerRatio`, dispatch `count - 1` from that source toward the target.
5. **Hoard** — no dispatch.

`dispatch()` mutations stay routed through the public `src/engine/movement.ts` API, so AI dispatches are indistinguishable from player or scripted dispatches downstream (combat, marching, victory, event log).

### §4.3 Determinism & RNG

Per-faction-per-tick RNG seed = `hash(rngSeed, factionId, tick)`. The hash is `mixSeed` in `src/engine/ai.ts` and is unchanged from v0.12. `shouldEvaluate(faction, tick, evalInterval)` is pure; `evalInterval` participating in the stagger math is the only v1.1 change.

Acceptance carry-over: AC-22 (RNG determinism) stays as written but is restated as Normal-tier — `rngSeed + factionId + tick` produces identical decisions across runs at any tier.

### §4.4 Configuration Surface

Scenario JSON `aiConfig` is `Record<Exclude<FactionId, "NEUTRAL">, AiModeShorthand | AiMode>` where:

- `AiModeShorthand` = `"easy" | "normal" | "hard" | "idle" | "scripted" | "default"`
- `AiMode` = discriminated union (engine-side, post-parse)

`parseScenario` normalises to `AiMode` and validates `kind` + `tier`. Object form requires explicit `kind`; shorthand strings are convenience for hand-authored scenarios.

Default scenario `src/scenarios/default.json` opens with all-Normal. Demo / spectator scenarios can stage e.g. `{TOKUGAWA: "hard", TAKEDA: "normal", ODA: "easy", UESUGI: "easy"}` to give the player an asymmetric opponent triple.

`"default"` is a back-compat alias that warns once per session and resolves to Normal. Removal targets PRD v1.2.

### §4.5 Acceptance Criteria

| #     | Condition | Verification |
| ----- | --- | --- |
| AC-X1 | Tier cadence: Easy fires every 8 ticks, Normal every 5, Hard every 3, all offset by `FACTION_OFFSETS`. | `shouldEvaluate("TOKUGAWA", 9, 8) === true`, `shouldEvaluate("TOKUGAWA", 4, 3) === true`. |
| AC-X2 | Easy disables Rally — a board state that fires Rally under Normal produces no `(5,5)`-terminus stack under Easy. | Headless: build anchor+sources scenario, call `stepAi` at Easy vs Normal. |
| AC-X3 | Hard attack reaches 9-hop target that Normal skips. | Headless: 10×1 strip TOK castle vs TAK castle. Within a 20-tick eval window Hard dispatches toward (9,0); Normal never does. |
| AC-X4 | Defense radius scales: Easy ignores manhattan-2 threats; Normal reacts at manhattan 2; Hard reacts at manhattan 3. | Headless: place enemy single-tile at the target manhattan; assert defense-terminus stack present/absent. |
| AC-X5 | Queen-band castle (count 24) siphon: Easy ships 4, Normal 7, Hard 9. | Headless: castle (0,0) count 24 + adjacent empty; `stepAi` and read `marchingStacks[0].count`. |

Existing AC carry-over scoped to Normal tier:

- AC-15 (each AI captures ≥ 1 adjacent tile within 30 ticks) restored at Normal.
- AC-22 (rngSeed determinism) restored at Normal.
- AC-27 / AC-28 / AC-29 / AC-30 / AC-31 / AC-32 (rule #2 / rule #3 reserves and reach) restored at Normal — these were deleted by v1.0 and come back unchanged.

### §4.6 Test Strategy

- Unit tests for each rule live in `src/engine/ai.test.ts`. Existing Normal-tier cases stay; tier-delta cases (AC-X1..X5) lock the knob deltas.
- Integration tests for scenario JSON shorthand + object form live in `src/playtest/integration.test.ts`.
- Engine coverage target ≥ 90% line. Today: 96.57% — should hold post-tier-refactor.

### §4.7 LLM Tier (Deferred — §8 Future Scope)

LLM-driven AI is documented in §8 as future scope. Design notes accumulated during the v1.1 planning round are preserved here for the next-round PRD writer:

- Variant shape would be `{kind: "llm", tier: RuleTier, config: {…}}` — `tier` field carries the synchronous rule-tier fallback used when the LLM has not yet responded.
- Async decisions never block tick cadence. Dispatcher fires LLM call at eval window N; resolution lands at boundary N+k (typically k = 1..3) and is consumed via the existing scripted-command channel with `expiresAtTick = producedAtTick + 3` to discard stale plans.
- Deployment: pure-browser with `anthropic-dangerous-direct-browser-access: true` header. User pastes API key into a first-game modal; memory-only by default with opt-in `localStorage` checkbox (PRD §8 storage carveout).
- Prompt: cached static prefix (rules digest + persona + tool schema, ~1 k tokens) + dynamic suffix (ASCII grid + marching list, ~500 tokens). Output via Claude tool `submit_turn_plan` emitting up to 4 `DispatchCommand` triples plus a 120-char strategy note fed back as memory next turn.
- Cost ballpark: ~$1/game with 1 LLM faction, ~$3-4/game with all 4 LLM. Cache hit rate expected ~95% on the static prefix.
- Graceful degradation: timeout / 429 / malformed → fall back to the configured rule tier for that eval window. No game pause.
- Critical risk: Anthropic's browser-CORS opt-in flag is a single point of failure; if revoked, the design assumes we'd ship a Cloudflare Workers proxy (contradicts the current "no backend" rule).

These notes are scaffolding only — when LLM is revived as a PRD section, the prose should be rewritten against the API/SDK state at that time.

---

## Migration notes for whoever merges this into `docs/PRD.md`

1. Replace existing §4 (`非玩家勢力控制 (v1.0 暫定, AI 規格 deferred)`) with the §4.0..§4.7 sections above.
2. Update §7 acceptance criteria table: restore AC-15, AC-22 scoped Normal; add AC-X1..X5; drop the `~~AC-15~~` strikeouts.
3. Update §8 future scope: add a bullet "LLM-driven AI tier — see §4.7 design notes".
4. Bump version banner to v1.1.
5. Add changelog entry summarising the tier reintroduction.

The implementation matches this prose 1-to-1 already; nothing in the engine needs to change after the PRD merge.
