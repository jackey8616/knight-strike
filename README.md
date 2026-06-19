# Knight Strike

Web remake of the 2005 free Japanese title _国家大作戦_ (lm_exp): a 45° isometric, real-time-tick grid wargame. Your territory self-replicates troops every tick; you drag-dispatch garrisons to expand, siege, and conquer; the first faction to take every other castle wins. Four corner castles (you play **Tokugawa**) around a neutral camp, on seeded terrain — mountains and water block, forest defends — against a three-tier rule AI.

[`docs/PRD.md`](docs/PRD.md) is the single source of truth for game rules, numbers, and acceptance criteria. [`CLAUDE.md`](CLAUDE.md) is the engineering reference (file/module map, spec→implementation, conventions). This README only covers running, building, and the available scripts.

## Status

- **Engine** — shipped (`src/engine/**`, full unit + integration tests).
- **Rendering / input / UI** — shipped (Pixi.js v8 + GSAP).
- **AI** — shipped: three-tier rule AI (`easy` / `normal` / `hard`); the default game runs `normal` opponents.
- **Terrain** — shipped (seeded plains / mountain / water / forest, programmatic pixel-art textured tiles, selectable map shapes: Plateau / Island / Coast).
- **Deploy** — `pnpm build:pages` produces a GitHub Pages dist; CI gate + deploy workflows under `.github/workflows/`.

## Requirements

- Node 22 (`.nvmrc` locked; Vite 8 will fail on Node 18). Run `nvm use` after cloning.
- pnpm 8.x (see `packageManager` in `package.json`).

```sh
nvm use
pnpm install
```

## Common commands

| Script                          | When to use                                          |
| ------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                      | Local dev server on http://localhost:5173 with HMR   |
| `pnpm build`                    | Production build to `dist/` (base path `/`)          |
| `pnpm build:pages`              | Same, base path `/knight-strike/` for GitHub Pages   |
| `pnpm preview`                  | Serve `dist/` locally to verify the production build |
| `pnpm test`                     | Vitest in watch mode                                 |
| `pnpm test:run`                 | Run vitest once (CI mode)                            |
| `pnpm test:coverage`            | Coverage report under `coverage/`                    |
| `pnpm typecheck`                | `tsc --noEmit`                                       |
| `pnpm lint`                     | ESLint + Prettier check (no auto-fix)                |
| `pnpm format`                   | Prettier write                                       |
| `pnpm playtest <scenario.json>` | Headless scenario runner (see below)                 |
| `pnpm balance`                  | AI balance guard (deterministic 4-AI batch; CI)      |

## Playing

- The player faction is fixed to **Tokugawa** (top-left corner of the iso board).
- **Left-click + drag** from one of your tiles to a target to dispatch troops along the shortest path (highlighted; a red line means no valid route). Dragging to an enemy / neutral tile starts a **conquer-march** that sieges the line tile-by-tile.
- The dispatch ratio (25 / 50 / 75 / 100 %) sets how much of the source garrison ships out; castles always keep at least 1 troop.
- **Click a marching column** to cancel it — its troops drop onto the tile it's standing on.
- **Space** pause/resume, **1–4** speed, **R** recentre camera, **Esc** cancel an in-flight drag, **WASD / arrow keys** pan. **Right-drag / wheel / two-finger** pan and zoom.
- The HUD (tick + countdown + speed) sits bottom-centre; the faction panel (tile count / troops / castle status) bottom-left; hover any tile for ownership / tier / count in the top-centre; the map-size selector (11 / 15 / 19 / 27) is top-right.

Rules in detail: PRD §4 (gameplay), §5 (AI), §7 (win/lose).

## Headless playtest

`pnpm playtest <scenario.json>` runs a single scenario without rendering and prints a result line — handy for engine regression checks and (with a `rule`-tier AI) win-rate / game-length stats.

```sh
pnpm playtest src/scenarios/idle-target.json --runs 1 --max-ticks 100
pnpm playtest src/scenarios/default.json --runs 10 --log events
```

Scenario JSON format and AI modes: see [`CLAUDE.md`](CLAUDE.md) (§5 / §6) and `src/playtest/runner.ts`.

## Deploying to GitHub Pages

1. Push to `main`. The deploy workflow runs the CI gate (typecheck + lint + tests + build), then `pnpm build:pages`, and uploads `dist/` as a Pages artifact.
2. The first time, enable Pages in repo settings → Pages → Source: "GitHub Actions".
3. If your repo lives under a different sub-path, override `VITE_BASE_PATH` (e.g. `VITE_BASE_PATH=/my-fork/ pnpm build`) and adjust the workflow.

## Repo layout

- `src/engine/` — pure logic; **no Pixi / DOM / GSAP** allowed (ESLint-enforced).
- `src/render/` — Pixi.js v8 board / units / marching / combat / paths.
- `src/input/` — pointer, keyboard, camera, dispatch gesture state machine.
- `src/ui/` — HUD, faction panel, tile info, map-size, end screen (vanilla DOM).
- `src/scenarios/` — JSON scenario configs + their TypeScript wrappers.
- `src/playtest/` — headless CLI + scenario runner + integration tests.
- `docs/PRD.md` — product spec (rules, numbers, ACs).
- `docs/MILESTONES.md` — milestone breakdown (M1–M4) × AC coverage.
- `CLAUDE.md` — engineering reference: file/module map, spec→implementation, conventions, tooling.
