// Browser smoke orchestrator — the single entry point behind `pnpm smoke`, run
// identically on a dev machine and in CI. It: resolves a Chrome binary (system
// install first, no download), boots the Vite dev server, launches headless
// Chrome with remote debugging, runs driver.mjs against both, then tears
// everything down and propagates the driver's exit code.
//
// Zero npm deps: only Node built-ins. Browser download is a last resort
// (`@puppeteer/browsers` via npx) and is skipped entirely on CI, where
// ubuntu-latest ships Chrome preinstalled.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const DEV_PORT = Number(process.env.SMOKE_DEV_PORT ?? 5173);
const CDP_PORT = Number(process.env.SMOKE_CDP_PORT ?? 9222);
const APP_URL = `http://localhost:${DEV_PORT}/`;
const CDP_URL = `http://localhost:${CDP_PORT}`;

const log = (...a) => console.log("[smoke]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode != null && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHttp(url, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await httpOk(url)) return;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label} (${url})`);
}

function resolveChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH;

  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium",
        ];
  for (const c of candidates) if (fs.existsSync(c)) return c;

  // Last resort (local dev with no Chrome): download Chrome for Testing into a
  // cache dir and parse its path. CI never reaches here.
  log("no system Chrome found; installing Chrome for Testing via npx...");
  const cache = path.join(os.homedir(), ".cache", "ks-smoke-chrome");
  fs.mkdirSync(cache, { recursive: true });
  const out = spawnSync(
    "npx",
    ["--yes", "@puppeteer/browsers", "install", "chrome@stable", "--path", cache],
    { encoding: "utf8" },
  );
  // @puppeteer/browsers prints "<browser>@<version> <absolute path>". On macOS
  // the path contains spaces ("Google Chrome for Testing.app/Contents/MacOS/…"),
  // so capture everything after the version token to end of line. A `\S+` regex
  // truncates at the first space and yields the `.app` bundle dir rather than the
  // executable inside it, which then fails to spawn (ENOENT).
  const m = (out.stdout + "\n" + out.stderr).match(/^\s*\S+@\S+\s+(\/.+?)\s*$/m);
  if (!m) {
    throw new Error(
      "could not resolve a Chrome binary from install output:\n" +
        out.stdout +
        out.stderr,
    );
  }
  const resolved = m[1];
  if (!fs.existsSync(resolved)) {
    throw new Error(`resolved Chrome path does not exist: ${resolved}`);
  }
  return resolved;
}

const children = [];
function spawnTracked(cmd, args, opts) {
  const child = spawn(cmd, args, { detached: true, ...opts });
  children.push(child);
  return child;
}

function killAll() {
  for (const child of children) {
    if (child.pid == null || child.killed) continue;
    try {
      // Kill the whole process group (detached:true makes the child a leader),
      // so Vite's node child and Chrome's helpers go down with it.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}

let profileDir;
function cleanup() {
  killAll();
  if (profileDir) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

async function main() {
  const chrome = resolveChrome();
  log("chrome:", chrome);

  // Reuse an already-running dev server / Chrome (handy locally) instead of
  // spawning a duplicate.
  const devUp = await httpOk(APP_URL);
  if (devUp) {
    log(`reusing dev server on ${APP_URL}`);
  } else {
    log(`starting dev server on ${APP_URL}`);
    const vite = path.join(repoRoot, "node_modules", ".bin", "vite");
    spawnTracked(vite, ["--port", String(DEV_PORT), "--strictPort"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    await waitForHttp(APP_URL, 60000, "dev server");
    log("dev server up");
  }

  const cdpUp = await httpOk(`${CDP_URL}/json/version`);
  if (cdpUp) {
    log(`reusing Chrome CDP on ${CDP_URL}`);
  } else {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ks-smoke-"));
    const flags = [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--window-size=1200,900",
      // Pixi v8 is WebGL-only; force software rendering so it works headless on
      // CI runners without a GPU.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ];
    if (process.platform === "linux" || process.env.CHROME_NO_SANDBOX === "1")
      flags.push("--no-sandbox");
    log(`launching Chrome on ${CDP_URL}`);
    spawnTracked(chrome, [...flags, "about:blank"], { stdio: "ignore" });
    await waitForHttp(`${CDP_URL}/json/version`, 30000, "Chrome CDP");
    log("Chrome up");
  }

  const code = await new Promise((resolve) => {
    const driver = spawn(process.execPath, [path.join(here, "driver.mjs")], {
      stdio: "inherit",
      env: { ...process.env, APP_URL, CDP_URL },
    });
    driver.on("exit", (c) => resolve(c ?? 1));
  });
  return code;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

main()
  .then((code) => {
    cleanup();
    log(code === 0 ? "PASS" : "FAIL");
    process.exit(code);
  })
  .catch((e) => {
    log("orchestrator error:", e?.message ?? e);
    cleanup();
    process.exit(1);
  });
