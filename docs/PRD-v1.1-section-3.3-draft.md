# PRD §3.3 + §3.1.1 Draft — v1.1 Production Rewrite

> **Status**: Draft proposal for PRD v1.1. Reviewer merges desired prose into `docs/PRD.md`. This file is the working space, not the spec.
>
> Engine reality (this branch): the amendment is implemented and unit-tested in `src/engine/production.ts` + `src/engine/production.test.ts`. PRD prose is what's missing.

---

## Why this amendment

Player feedback on v1.0:

> 我想要改一下生兵的規則：不是只有城堡才可以產士兵，而是每個單位都可以在駐紮的時候自動產生一單位的士兵。

Translation: "I want to change the production rule: not just castles, but every garrisoned unit on the board should auto-produce 1 unit per cycle."

Follow-up clarification from the user:

> 城堡只是單純的陣地，一但被攻佔就失敗了。本身不會產出士兵。

Translation: "Castles are pure strategic ground — capture = defeat. They themselves don't produce."

So the new rule is *not* "castle + universal" — it's "no castle, only field garrisons". Castles become purely the win-condition objective.

---

## §3.3 amendments

### #1 — production source (rewritten)

**Was**: every main castle owned by a non-NEUTRAL, undefeated faction produces +1 every 2 ticks.

**Now**: every **non-castle, non-NEUTRAL, garrisoned** tile owned by an undefeated faction produces +1 **every tick** (no 2-tick skip). Castles never produce. Tiles cap out at `PRODUCTION_CAP = 100` to keep field garrisons from running into 4-digit territory over a long game.

Exact eligibility per tile per production tick:

| Tile condition | Produces? |
| --- | --- |
| `isCastle === true` | **No** (regardless of owner / count) |
| `owner === "NEUTRAL"` | No |
| `count <= 0` | No (no seed from an empty tile) |
| `count >= PRODUCTION_CAP` | No (already capped) |
| `state.defeated.has(owner)` | No |
| All five above false | **+1** (clamped to `PRODUCTION_CAP`) |

Cadence: **every tick where `tick > 0`**. PRD §3.2 step order is unchanged — production runs after `defeats`, before `castle overflow` (orphan §3.5.5) and `upgrade`.

The cap applies only to production-induced growth. A tile pushed above 100 by a dispatch arrival or combat survivor stays above 100; subsequent production simply won't add more until the count drops below the cap (via combat or dispatch). This avoids the engine retroactively clipping legitimate troop reserves.

### #2 — castle's role (rewritten)

The castle is **purely the win-condition objective**:

- Holds the faction's defeat flag (lose castle → §6.3 defeat).
- Receives no production bonus.
- Can still hold a garrison count > 0 (initial seed, dispatched arrivals, walk-through stops); that count is static unless combat or dispatch changes it.
- Still gates AI rule #2's castle-tier reserve math (`KNIGHT_RESERVE` / `QUEEN_RESERVE` / `KING_THRESHOLD`) — those are about dispatch behavior, not production.
- Castle overflow (§3.5.5 orphan code, currently never fires) is structurally impossible under this rule without manual seeding; the code stays in repo as orphan.

### #3 — strategic implications (informative)

Three intentional consequences worth documenting in the PRD body:

1. **Expansion is mandatory.** The opening castle count (PRD §3.1.1 = 3) doesn't grow. To accumulate any tempo at all, the player has to dispatch out of the castle and claim non-castle ground that *will* grow.
2. **Frontline tiles partially heal.** A field tile that takes losses from §3.6 combat or §3.7 drain regains +1 every other tick (provided count > 0 survived). Stalemate drain still wins long-term (drain is -1 every tick post-threshold; production is +1 every 2 ticks → net -0.5/tick).
3. **Territory snowball.** Once one faction outgrows another in tile count, the gap compounds: 20 tiles produce 10/tick of average growth; 5 tiles produce 2.5/tick. The §4.1 AI rule #2.5 rally / rule #3 attack should be re-tuned in a later round to account for this.

---

## §3.1.1 amendment — opening seed (must follow §3.3)

**Was**: each main castle starts at count = 3.

**Now**: each main castle still starts at count = 3 by default, **but the AI cannot fire from this state**.

The v0.8 design rationale (3 Soldiers giving the castle 8 ticks to reach Knight 5) relied on castle production. Under v1.1 the castle never grows, so a castle-only opener leaves the AI permanently below `EXPAND_MIN_STACK = 5` and the rule #2 expand never fires. The AI sits at 3 troops forever.

Two acceptable resolutions — pick one before merging this PRD:

- **(A) Seed each faction with an adjacent field garrison.** Each scenario adds 1 non-castle tile beside the castle, count = 5 (or higher), owned by the faction. This is what `ai.test.ts` `buildDefaultBoard` does post-v1.1 to keep AC-15 valid. Recommended for `default.json` and `spectator-4ai.json`. Author opinion: minimal disruption, lets the new production rule actually run.
- **(B) Bump initial castle count.** Set castle initial count to 6+ so the castle can dispatch (rule #2 castle Knight band: send = min(floor(c·0.25), c−5), needs c ≥ 6). Cheaper edit but it makes castle counts a static reservoir of dispatched units rather than the symbolic objective the rest of the PRD now treats them as.

The implementation in this branch goes with **(A)** for the AI test fixture; the player-facing default scenario JSON file is *not* edited yet — the reviewer decides whether to apply (A) to `src/scenarios/default.json` / `idle-target.json` or accept the static-game UX.

---

## §7 acceptance criteria changes

### Updated

- **AC-03 (v1.1)** — production rule per the table above. Existing wording about "each main castle's count +1 every 2 ticks" replaced. Verification: `production.test.ts` cases pass — castles static, non-castle garrisons +1, NEUTRAL static, empty tiles static, defeated owners skip.

### Retired

- **AC-37 (v1.1)** — old wording "TOKUGAWA 主城 count 仍每 2 ticks +1（§3.3 產兵照常）" is no longer true. The integration test now asserts the *opposite*: idle factions stay at their initial count forever because castles can't seed production. Rephrase AC-37 to "idle mode + no field garrison ⇒ no growth at all".

### New

- **AC-Z1** — Field garrison +1 on every emission tick (e.g. a count=4 TOKUGAWA non-castle tile at tick 2 → count 5 at tick 3). Verification: production.test.ts.
- **AC-Z2** — Castle stays at its current count across emission ticks. Verification: production.test.ts.
- **AC-Z3** — Empty tile (count=0) does not seed itself into production. Verification: production.test.ts.
- **AC-Z4** — NEUTRAL bandit tile (e.g. (5,5) count=3) never produces. Verification: production.test.ts.

---

## Migration notes for whoever merges this into `docs/PRD.md`

1. Rewrite §3.3 with the new production source table and the castle role section.
2. In §3.1.1, append a note about the AI gate (either decide to bump castle count or apply seed-A in `default.json`).
3. Update §7 AC-03 wording, retire AC-37, add AC-Z1..Z4.
4. Changelog entry: "v1.1 — castles no longer produce; non-castle garrisons +1 per emission tick (§3.3 amendment)".
5. Bump version banner to v1.1 (same bump as the tiered-AI and walk-through-claim drafts).

Engine + tests in this branch already match this prose. No code edits needed after the PRD merge.
