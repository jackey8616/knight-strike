# Knight Strike

Web remake of the 2005 free Japanese title *国家大作戦* (lm_exp): a 45° isometric, real-time-tick grid wargame. Castles produce troops, you drag-dispatch garrisons toward enemy territory, and the first player to take every other castle wins.

The single source of truth for game rules, numbers, and acceptance criteria is [`docs/PRD.md`](docs/PRD.md). This README only covers running, building, and the deck of available scripts.

## Status (v1.0 baseline)

- Engine — shipped (`src/engine/**`, full unit + integration tests)
- Rendering / input / UI (M2.0–M2.8) — shipped
- AI — deferred; non-player factions default to `idle` (`src/scenarios/idle-target.json`). Pre-v1.0 AI code remains in the repo as a spec orphan
- Deploy — `pnpm build:pages` produces a GitHub Pages drop-in dist; CI workflow at `.github/workflows/deploy.yml`

## Requirements

- Node 22 (`.nvmrc` locked; Vite 8 will fail on Node 18). Use `nvm use` after cloning.
- pnpm 8.x (see `packageManager` in `package.json`).

```sh
nvm use
pnpm install
```

## Common commands

| Script | When to use |
|--------|-------------|
| `pnpm dev` | Local dev server on http://localhost:5173 with HMR |
| `pnpm build` | Production build to `dist/` (base path `/`) |
| `pnpm build:pages` | Same as `build`, base path `/knight-strike/` for GitHub Pages |
| `pnpm preview` | Serve `dist/` locally to verify the production build |
| `pnpm test` | Vitest in watch mode |
| `pnpm test:run` | Run vitest once (CI mode) |
| `pnpm test:coverage` | Coverage report under `coverage/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint + Prettier check (no auto-fix) |
| `pnpm format` | Prettier write |
| `pnpm playtest <scenario.json>` | Headless scenario runner (see below) |

## Playing

- The player faction is fixed to **Tokugawa** (red, top-left corner of the iso board).
- **Left click + drag** from one of your tiles to a target tile to dispatch troops along the BFS path. A green-dashed line shows a valid path; a red line means no passable route exists.
- The bottom-right dispatch ratio (25 / 50 / 75 / 100 %) decides how much of the source garrison ships out. Castles always leave at least 1 troop behind.
- **Space** pauses, **1 / 2** switch between 1× and 2× speed, **R** recentres the camera, **Esc** cancels an in-flight drag, **WASD / arrow keys** pan the camera.
- The top HUD shows the current tick + countdown bar + speed controls. The bottom-left faction panel lists each faction's tile count, total troops and castle status. Hover any tile for ownership / tier / count in the bottom-right.

PRD §3 / §5 describe the rules in detail; the four AI factions sit idle in v1.0 by default, which lets you focus on the dispatch + production loop without an opponent fighting back.

## Headless playtest

`pnpm playtest <scenario.json>` runs a single scenario without rendering and prints a result line. Useful for engine-only regression checks.

Examples:

```sh
pnpm playtest src/scenarios/idle-target.json --runs 1 --max-ticks 100
pnpm playtest src/scenarios/default.json --runs 10 --log events
```

Scenario JSON schema: see PRD §10.2 plus `src/scenarios/idle-target.json` and `src/playtest/runner.ts` (`ScenarioInput`).

## Deploying to GitHub Pages

1. Push to `main` / `master`. The `Deploy to GitHub Pages` workflow runs typecheck + lint + tests, then `pnpm build:pages`, and uploads `dist/` as a Pages artifact.
2. The first time, enable Pages in repo settings → Pages → Source: "GitHub Actions".
3. If your repo lives under a different sub-path, override `VITE_BASE_PATH` (e.g. `VITE_BASE_PATH=/my-fork/ pnpm build`) and adjust the workflow.

## Repo layout

- `src/engine/` — pure logic; **no Pixi / DOM / GSAP** allowed (ESLint-enforced)
- `src/render/` — Pixi.js v8 board / units / marching / paths
- `src/input/` — pointer, keyboard, dispatch gesture state machine
- `src/ui/` — HUD, faction panel, tile info, end screen (vanilla DOM)
- `src/scenarios/` — JSON scenario configs + their TypeScript wrappers
- `src/playtest/` — headless CLI + scenario runner + integration tests
- `docs/PRD.md` — game spec (rules, numbers, ACs)
- `docs/MILESTONES.md` — milestone breakdown (M1–M4)
- `CLAUDE.md` — coding conventions, tooling, contribution rules
