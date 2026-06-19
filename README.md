# Knight Strike

Web remake of the 2005 free Japanese title _国家大作戦_ / Falcom's **Lord Monarch**: a 45° isometric, real-time-tick economy wargame. Build **houses** (100 gold) that grow **fields** and **population**, route tax back to your **castle**, spend the population into 100-strong armies, **stack them into a real force**, and march out to raze enemy castles. Manage upkeep, bridges and fences, and **monster nests** that drip out monster armies. Four corner castles (you play **Tokugawa**) against three economy-aware rule AIs; last nation standing wins.

[`docs/PRD.md`](docs/PRD.md) (v2.x) is the single source of truth for rules, numbers and acceptance criteria; [`docs/AI-DESIGN.md`](docs/AI-DESIGN.md) covers the opponent AI; [`docs/MILESTONES.md`](docs/MILESTONES.md) / [`docs/BACKLOG.md`](docs/BACKLOG.md) track delivery; [`CLAUDE.md`](CLAUDE.md) is the engineering reference. This README only covers running, building and the scripts.

> **Easter egg:** the original prototype (the v1 territory-claim game) is preserved, hidden — load the app with **`?v1`** to play it.

## Status

- **Engine** — shipped (`src/engine/v2/**`, pure logic, full unit + integration tests, ≥90% line coverage).
- **AI** — shipped: economy-aware rule AI (`easy` / `normal` / `hard`); deterministic. Balance (even win-spread) is an ongoing tune.
- **Render / input / UI** — playable (Pixi.js v8 iso board, DOM HUD/controls): build mode, tax slider, click-to-move, level-result screen. Sprite-art polish is a follow-up (current visuals are simple shapes).
- **Headless** — `pnpm playtest:v2` runs scenarios / AI batches; `pnpm smoke` is a zero-dep CDP browser gate.
- **Deploy** — `pnpm build:pages` → GitHub Pages; CI gate + deploy workflows under `.github/workflows/`.

## Requirements

- Node 22 (`.nvmrc` locked; Vite will fail on Node 18). Run `nvm use` after cloning.
- pnpm 8.x (see `packageManager` in `package.json`).

```sh
nvm use
pnpm install
```

## Common commands

| Script | When to use |
| --- | --- |
| `pnpm dev` | Local dev server on http://localhost:5173 with HMR |
| `pnpm build` | Production build to `dist/` (base path `/`) |
| `pnpm build:pages` | Same, base path `/knight-strike/` for GitHub Pages |
| `pnpm preview` | Serve `dist/` locally to verify the production build |
| `pnpm test` / `pnpm test:run` | Vitest (watch / once) |
| `pnpm test:coverage` | Coverage report under `coverage/` |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | `tsc --noEmit` / ESLint / Prettier write |
| `pnpm playtest:v2 <scenario> [--runs N] [--log]` | v2 headless scenario / AI batch runner (see below) |
| `pnpm smoke` | Zero-dep headless-Chrome (CDP) UI smoke (manual; needs Chrome) |
| `pnpm playtest` / `pnpm balance` | v1 (easter-egg) headless runner / balance guard |

## Playing

You are **Tokugawa**. Press **Start**, then use the bottom control bar:

- **Build mode** — pick **House** (click a tile where your unit stands), **Bridge** (a river/lava tile next to your unit) or **Fence** (a land tile next to your unit). **Select** mode: click a unit, then a tile to move it.
- **Tax slider** (0–30 %) — higher tax funds armies but slows population growth; disconnected houses pay 0 % (and grow fastest).
- **Pause / speed** buttons. Houses spawn 100-strong units automatically; stack your units on a tile to merge them into a big army, then march it onto an enemy castle to siege it.

Rules in detail: PRD §4 (gameplay), §5 (AI), §7 (win/lose & scoring).

## Headless playtest

`pnpm playtest:v2 <scenario>` runs a scenario without rendering and prints outcomes / win-rates / event counts.

```sh
pnpm playtest:v2 player --runs 1 --max-ticks 500
pnpm playtest:v2 spectator-4ai --runs 24 --max-ticks 2000   # 4-AI balance batch
```

Scenarios live in `src/playtest/v2/scenarios.ts`; the runner / scenario schema in `src/playtest/v2/runner.ts`.

## Deploying to GitHub Pages

1. Push to `main`. The deploy workflow runs the CI gate (typecheck + lint + tests + build), then `pnpm build:pages`, and uploads `dist/` as a Pages artifact.
2. First time: enable Pages in repo settings → Pages → Source: "GitHub Actions".
3. Different sub-path? Override `VITE_BASE_PATH` (e.g. `VITE_BASE_PATH=/my-fork/ pnpm build`).

## Repo layout

- `src/engine/v2/` — pure v2 logic; **no Pixi / DOM / GSAP** (ESLint-enforced). `src/engine/*.ts` is the v1 engine (kept for the `?v1` easter egg).
- `src/render/v2/`, `src/ui/v2/` — v2 Pixi board + DOM HUD/controls. `src/main.ts` boots v2 (or v1 on `?v1`).
- `src/playtest/v2/` — v2 headless runner, scenarios, CLI.
- `docs/` — `PRD.md` (spec), `AI-DESIGN.md`, `MILESTONES.md`, `BACKLOG.md`, `v2_spec/` (source).
- `scripts/smoke/` — CDP browser smoke (`run.mjs` + `driver.mjs`).
