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

### #1 — production source (rewritten, r3)

**Was**: every main castle owned by a non-NEUTRAL, undefeated faction produces +1 every 2 ticks.

**Now**: garrisoned troops self-replicate. **Every tile** (castle or field) owned by an undefeated non-NEUTRAL faction with `count > 0` produces +1 **every tick**, capped at `PRODUCTION_CAP = 100`. The castle building doesn't auto-mint from nothing — an empty castle (count = 0) stays at 0 forever until someone garrisons it.

Mental model: the troops themselves reproduce while stationed; the tile (castle or field) just hosts them. Castles are **still** the win-condition objective (lose castle → §6.3 defeat) — they just no longer get a special production rule.

Exact eligibility per tile per production tick:

| Tile condition | Produces? |
| --- | --- |
| `owner === "NEUTRAL"` | No (NEUTRAL bandits stay static) |
| `count <= 0` | No (no seed from an empty tile, including empty castle) |
| `count >= PRODUCTION_CAP` | No (already capped) |
| `state.defeated.has(owner)` | No |
| All four above false | **+1** (clamped to `PRODUCTION_CAP`) |

Cadence: **every tick where `tick > 0`**. PRD §3.2 step order is unchanged — production runs after `defeats`, before `castle overflow` (orphan §3.5.5) and `upgrade`.

The cap applies only to production-induced growth. A tile pushed above 100 by a dispatch arrival or combat survivor stays above 100; subsequent production simply won't add more until the count drops below the cap (via combat or dispatch). This avoids the engine retroactively clipping legitimate troop reserves.

### #2 — castle's role (rewritten, r3)

The castle is the **win-condition objective** but is otherwise a normal producer:

- Holds the faction's defeat flag (lose castle → §6.3 defeat).
- Garrisoned soldiers grow exactly like any other tile (+1 per tick, capped at 100).
- An empty castle (count = 0) doesn't seed itself — it has to receive a dispatch before production can kick in.
- Still gates AI rule #2's castle-tier reserve math (`KNIGHT_RESERVE` / `QUEEN_RESERVE` / `KING_THRESHOLD`) — those are about dispatch behavior, not production.
- Castle overflow (§3.5.5 orphan code) can now fire again: castle grows past 30 via normal production → overflow strips a unit out.

### #3 — strategic implications (informative)

Three intentional consequences worth documenting in the PRD body:

1. **Expansion is mandatory.** The opening castle count (PRD §3.1.1 = 3) doesn't grow. To accumulate any tempo at all, the player has to dispatch out of the castle and claim non-castle ground that *will* grow.
2. **Frontline tiles partially heal.** A field tile that takes losses from §3.6 combat or §3.7 drain regains +1 every other tick (provided count > 0 survived). Stalemate drain still wins long-term (drain is -1 every tick post-threshold; production is +1 every 2 ticks → net -0.5/tick).
3. **Territory snowball.** Once one faction outgrows another in tile count, the gap compounds: 20 tiles produce 10/tick of average growth; 5 tiles produce 2.5/tick. The §4.1 AI rule #2.5 rally / rule #3 attack should be re-tuned in a later round to account for this.

---

## §3.1.1 — opening seed (no change required)

Each main castle still starts at count = 3. Under v1.1 r3 castles produce too, so the castle goes 3 → 4 → 5 → 6 over the first few ticks and the AI's rule #2 castle Knight-band branch can fire by tick 4 (count = 6 ≥ `KNIGHT_RESERVE + 1` enough to send 1 unit). No scenario-seed surgery needed; `default.json` / `idle-target.json` / `spectator-4ai.json` keep their current opening.

---

## §7 acceptance criteria changes

### Updated

- **AC-03 (v1.1)** — production rule per the table above. Existing wording about "each main castle's count +1 every 2 ticks" replaced. Verification: `production.test.ts` cases pass — castles static, non-castle garrisons +1, NEUTRAL static, empty tiles static, defeated owners skip.

### Updated again

- **AC-37 (v1.1 r3)** — idle mode + initial castle at count 3 + cap 100. After 100 ticks each idle faction reaches the cap exactly: `count(t=100) = min(3 + 100, 100) = 100`.

### New

- **AC-Z1** — Garrisoned tile (castle or field) +1 on every tick (e.g. a TOKUGAWA castle at count=3 at tick 0 → count 4 at tick 1). Verification: production.test.ts.
- **AC-Z2** — Production cap clamps at 100: tile at 99 grows to 100 then stops; tile pushed above 100 by dispatch / combat stays above 100. Verification: production.test.ts (two cases).
- **AC-Z3** — Empty tile (count=0) does not seed itself into production, including empty castle. Verification: production.test.ts.
- **AC-Z4** — NEUTRAL bandit tile (e.g. (5,5) count=3) never produces. Verification: production.test.ts.

---

## Migration notes for whoever merges this into `docs/PRD.md`

1. Rewrite §3.3 with the new production source table and the castle role section.
2. In §3.1.1, append a note about the AI gate (either decide to bump castle count or apply seed-A in `default.json`).
3. Update §7 AC-03 wording, retire AC-37, add AC-Z1..Z4.
4. Changelog entry: "v1.1 — castles no longer produce; non-castle garrisons +1 per emission tick (§3.3 amendment)".
5. Bump version banner to v1.1 (same bump as the tiered-AI and walk-through-claim drafts).

Engine + tests in this branch already match this prose. No code edits needed after the PRD merge.
