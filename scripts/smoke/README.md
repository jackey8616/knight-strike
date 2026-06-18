# Browser smoke test

A zero-dependency, headless-browser smoke for the UI shell. It drives a real
Chrome over the **DevTools Protocol** (CDP) — no Playwright/Puppeteer, only
Node 22 built-ins (`WebSocket` + `fetch`).

## What it checks

Mirrors PR #21's manual verification, end to end:

1. Start Menu renders (title + Move/Attack demo box + buttons).
1b. **Mobile guard** (issue #26): under an emulated phone viewport +
   `prefers-reduced-motion: reduce` (iOS Low Power Mode / Android battery
   saver), the menu demo must still animate — not freeze on `animation: none`.
2. Pick difficulty + map size → **Start** builds a game with **no page reload**.
3. Ticks advance at max speed.
4. Game plays to a natural end → **End screen**.
5. **Restart** rebuilds the game (the `main.ts` teardown/rebuild path) and plays
   to end again.
6. **Main Menu** returns to the menu; a different board starts fresh.

It asserts game state via the DEV-only `window.__ks` hook (`src/main.ts`), and
fails on any uncaught page exception. Screenshots of every step land in
`scripts/smoke/.shots/` (gitignored; uploaded as a CI artifact).

> Runs against the **dev** server, not a production build: `window.__ks` is
> `import.meta.env.DEV`-only and stripped from `pnpm build` output.

## Run it

```bash
pnpm smoke
```

`run.mjs` does everything: resolves a Chrome binary, boots the Vite dev server,
launches headless Chrome with remote debugging, runs `driver.mjs`, then tears it
all down and exits non-zero on failure. The same command runs in CI — see
`.github/workflows/smoke.yml` (manual `workflow_dispatch` only, because it boots
a browser and plays games to completion).

If a dev server (`:5173`) or a debuggable Chrome (`:9222`) is already up, it
reuses them instead of spawning duplicates.

## Knobs (env vars)

| Var                     | Default               | Notes                                         |
| ----------------------- | --------------------- | --------------------------------------------- |
| `CHROME_PATH`           | auto-detected         | Force a specific Chrome binary.               |
| `SMOKE_DIFFICULTY`      | `Easy`                | `Easy` / `Normal` / `Hard`; Hard ends faster. |
| `SMOKE_SIZE` / `_SIZE2` | `11` / `19`           | First and second board sizes.                 |
| `SMOKE_END_TIMEOUT_MS`  | `300000`              | Per-game play-to-end wait.                    |
| `SMOKE_STRICT_CONSOLE`  | unset                 | `1` → fail on any `console.error` too.        |
| `CHROME_NO_SANDBOX`     | unset (auto on Linux) | `1` → add `--no-sandbox`.                     |

## Chrome resolution

System Chrome first (no download): macOS `Google Chrome.app`, Linux
`google-chrome` / `chromium`. CI uses the runner's preinstalled Chrome. Only if
nothing is found does it fall back to downloading Chrome for Testing via
`npx @puppeteer/browsers` — never hit in CI.
