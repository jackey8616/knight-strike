# PRD §3.5.2 + §3.5.4 + §5.3 Draft — v1.1 Movement & Interaction Amendments

> **Status**: Draft proposal for PRD v1.1. Reviewer merges desired prose into `docs/PRD.md`. This file is the working space, not the spec.
>
> Engine + UI reality (on this branch): the three amendments below are already implemented and unit-tested. PRD prose is what's missing.

---

## Why these amendments

Player feedback during the v1.0 baseline play-test surfaced three pain points:

1. **Walk-through claim** — players expected territory they march across to come under their control, not just the terminus. The current §3.5.4 rule "non-terminus 不變更所有權" felt unintuitive and made expansion feel artificially slow.
2. **Cancel a stack mid-march** — once dispatched, troops were uncancellable. Players wanted a way to pull back a march in flight.
3. **Auto-pause on interaction** — the 2-second tick kept advancing while the player was reading the board or planning a dispatch, making careful play impossible.

The amendments below address each. None of them changes the engine's combat / production / stalemate semantics; they only extend movement and add one UI rule.

---

## §3.5.2 amendment — passable intermediates

**Was**: `passable = 己方格 + 空無主格 (NEUTRAL count=0)`.
**Now**: `passable = 己方格 + 任何 count = 0 的格 (NEUTRAL 或敵方皆可)`.

Garrisoned enemy tiles (count > 0) remain walls — that part is unchanged.

Strategic consequence: once an enemy tile drops to 0 (combat clear, drain, captured-then-emptied), it becomes a corridor that you (and the enemy, symmetrically) can route through. Combined with the §3.5.4 walk-through claim below, this means abandoned enemy frontier flips ownership the moment a friendly stack walks across it.

This is a relaxation of the BFS rule, not a behavioural override of `findPath` — the function still respects exactly the same passable predicate, just with a wider definition.

---

## §3.5.4 amendments

### #3-bis — walk-through claim (intermediate empty tile)

**New rule**: when a marching stack steps onto a `count = 0` intermediate tile (`idx` is not the terminus), the tile's `owner` immediately flips to `stack.faction`. The tile's `count` stays 0 because the troops are still in transit. The stack continues marching on its original path.

Concrete edge cases:

| Intermediate tile state | Result |
| --- | --- |
| Own faction (count any) | No change (already own). Stack passes through. |
| NEUTRAL count = 0 | Owner flips to `stack.faction`, count stays 0. Stack continues. |
| Enemy count = 0 | Owner flips to `stack.faction`, count stays 0. Stack continues. |
| NEUTRAL or enemy with count > 0 | Not passable (`isPassableIntermediate` rejects). Falls through to §3.5.4 #6 path-cut. |

The terminus arm is unchanged: arrival at a `count = 0` tile claims owner AND drops `arrival.count` as the new garrison.

### #7 — cancel marching stack (player-initiated)

**New rule**: the player can cancel a marching stack of their own faction at any time before it reaches its terminus. On cancel:

- The stack is removed from `state.marchingStacks`.
- The stack's `count` is **dropped on the tile at `path[idx]`** (its current position).
- If the drop tile is own → count joins existing garrison.
- If the drop tile is empty (NEUTRAL or enemy with count = 0) → owner flips to `stack.faction` and count becomes the dropped count.
- If the drop tile is garrisoned enemy (shouldn't be possible at `idx` mid-march, but a defensive guard) → cancel is rejected, stack stays in flight.

Cancel is exposed as the pure engine function `cancelMarchingStack(state, stackId): {ok, state} | {ok: false, state, reason}`. The function is total and never mutates input.

AI factions do not cancel; their `stepAi` dispatches are commit-once. Scripted commands also don't cancel.

---

## §5.3 amendment — auto-pause during pointer interaction

**New rule**: the game time auto-pauses for the duration of any pointer press on the canvas, then auto-resumes on release. Concretely:

- Pointer-down on a board tile → if `paused === false`, set `paused = true` and remember the press induced this.
- Pointer-up (drag committed, drag cancelled, click released, or pointer lifted anywhere) → if the press induced the pause, clear `paused`.
- If the player manually pauses (Space / HUD button / keyboard) **during** a press, the manual toggle wins: the next pointer-up does NOT auto-resume.
- Resume happens immediately on release; there is no grace period.
- Right-click cancel of a marching stack counts as a pointer interaction too — game pauses on press, resumes on release after the cancel commits.

This is purely a UI layer rule; the engine is untouched and still expects `step()` calls at the cadence the host loop dictates.

---

## §5.3 amendment — right-click cancel UX

**New rule**: right-click (`pointer.button === 2`) on a marching stack's sprite cancels that stack, applying §3.5.4 #7 above. Left-click is reserved for the existing dispatch / tile-select gestures.

UI affordance: the marching sprite is hit-testable in a ~36×44 px box centred on the sprite (`HIT_HALF_W = 18`, `HIT_HALF_H = 22`) so cancels don't require pixel-perfect aim on a moving target. Adjacent stacks remain individually selectable because the hit box doesn't overflow a tile width.

The right-click cancel is gated to the **player faction's stacks only** at the UI layer. Right-clicking an AI / NEUTRAL stack does nothing — the call short-circuits before reaching `cancelMarchingStack`.

---

## §7 acceptance criteria additions

| #     | Condition | Verification |
| ----- | --- | --- |
| AC-Y1 | Walk-through claim: marching from (0,0) through NEUTRAL empty (1,0) → terminus (2,0). After advance: (1,0).owner === TOKUGAWA, (1,0).count === 0. | Headless (movement.test.ts). |
| AC-Y2 | Enemy empty (count=0) is passable + walk-through-claimed. `findPath` routes through enemy empty; `advanceMarching` flips owner mid-flight. | Headless. |
| AC-Y3 | cancelMarchingStack drops count at `path[idx]`: own tile → garrison + count, empty tile → owner flip + count. | Headless. |
| AC-Y4 | cancelMarchingStack with unknown stack id → `{ok: false, reason: "not-found"}`, state untouched. | Headless. |
| AC-Y5 | Auto-pause: pointer-down on canvas while `paused === false` → `paused === true`; pointer-up → `paused === false`. Manual Space mid-press blocks auto-resume. | Manual smoke (browser). |
| AC-Y6 | Right-click on player marching sprite cancels it; right-click on AI marching sprite is a no-op. | Manual smoke (browser). |

---

## Migration notes for whoever merges this into `docs/PRD.md`

1. In §3.5.2, replace the passable-intermediate rule wording.
2. In §3.5.4, add #3-bis and #7 sub-rules (or restructure the numbering as you prefer).
3. In §5.3 operations table, add the auto-pause row and the right-click cancel row.
4. In §7, add AC-Y1..Y6.
5. Bump version banner to v1.1 (the same bump as the §4 tiered-AI draft).
6. Changelog entry: "v1.1 — restore tiered AI (§4 draft) + walk-through claim, cancel marching, auto-pause on interaction (§3.5.2 / §3.5.4 / §5.3 drafts)".

The implementation matches this prose 1-to-1 already; merging the PRD doesn't require any engine or UI changes.
