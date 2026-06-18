// Browser smoke driver — zero npm deps, talks to Chrome over the DevTools
// Protocol (CDP) directly via Node's built-in WebSocket + fetch (both global in
// Node 22). It assumes a Vite *dev* server (so the DEV-only `window.__ks` hook
// in src/main.ts is present) and a headless Chrome already listening on
// `--remote-debugging-port`. `run.mjs` is the orchestrator that boots both and
// invokes this; nothing here downloads or launches anything.
//
// Flow mirrors PR #21's manual verification: menu renders → Start (no reload) →
// ticks advance → play to natural end → Restart rebuilds + plays to end again →
// Main Menu → start a different board. The Restart/Main-Menu legs exercise the
// main.ts teardown/rebuild that PR #21 refactored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const CDP = process.env.CDP_URL ?? "http://localhost:9222";
const APP = process.env.APP_URL ?? "http://localhost:5173/";
const SHOTS = process.env.SHOTS_DIR ?? path.join(here, ".shots");
const DIFFICULTY = process.env.SMOKE_DIFFICULTY ?? "Easy";
const SIZE = process.env.SMOKE_SIZE ?? "11";
const SIZE2 = process.env.SMOKE_SIZE2 ?? "19";
const END_TIMEOUT_MS = Number(process.env.SMOKE_END_TIMEOUT_MS ?? 300000);
const STRICT_CONSOLE = process.env.SMOKE_STRICT_CONSOLE === "1";

fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

// Uncaught page exceptions are always fatal (they're the breakage a smoke is
// meant to catch). console.error is collected and reported, fatal only under
// SMOKE_STRICT_CONSOLE=1 — dev builds can emit benign warnings.
const pageExceptions = [];
const consoleErrors = [];

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function onMessage(raw) {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    pageExceptions.push("exception: " + (d.exception?.description || d.text));
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(
      "console.error: " +
        (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "),
    );
  } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    consoleErrors.push("log.error: " + msg.params.entry.text);
  }
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw new Error(
      "eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text),
    );
  return r.result.value;
}

async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, "base64"));
  log("shot", p);
}

async function waitFor(expr, timeoutMs, interval, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let v = false;
    try {
      v = await evaluate(expr);
    } catch {
      /* mid-navigation: retry */
    }
    if (v) return true;
    await sleep(interval);
  }
  throw new Error("waitFor timeout: " + (label || expr));
}

const clickByText = (sel, text) =>
  evaluate(
    `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(
      sel,
    )})].find(e=>e.textContent.trim()===${JSON.stringify(
      text,
    )});if(!b)return false;b.click();return true;})()`,
  );

// HUD speed buttons are labelled "1x".."4x"; max speed shortens the play-to-end
// wait. Returns the clicked label (or null) so the caller can assert it took.
const setMaxSpeed = () =>
  evaluate(
    `(()=>{const b=[...document.querySelectorAll('.ks-hud button')].find(e=>/4x/.test(e.textContent));if(b){b.click();return b.textContent.trim();}return null;})()`,
  );

const tick = () => evaluate(`window.__ks.getTickInfo().tick`);

async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`${CDP}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* CDP not up yet: retry */
    }
    await sleep(500);
  }
  throw new Error("no page target on " + CDP);
}

function fail(message) {
  log("RESULT_ERROR:", message);
  log("PAGE_EXCEPTIONS:", JSON.stringify(pageExceptions));
  log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));
  process.exit(1);
}

(async () => {
  ws = new WebSocket(await getPageWs());
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => onMessage(e.data);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  log("CDP connected:", CDP);

  // STEP 1 — menu renders.
  await send("Page.navigate", { url: APP });
  await waitFor(
    `!!document.querySelector('.ks-menu') && getComputedStyle(document.querySelector('.ks-menu')).display!=='none'`,
    30000,
    500,
    "menu visible",
  );
  const menu = await evaluate(
    `(()=>{const m=document.querySelector('.ks-menu');return{title:[...m.querySelectorAll('div')].some(d=>d.textContent==='Knight Strike'),demoBox:!!m.querySelector('.ks-demo-area'),buttons:[...m.querySelectorAll('button')].map(b=>b.textContent.trim())};})()`,
  );
  log("STEP1 menu:", JSON.stringify(menu));
  if (!menu.title || !menu.demoBox) fail("menu missing title or demo box");
  await shot("01-menu");

  // STEP 2 — pick difficulty + size, Start with no reload.
  if (!(await clickByText(".ks-menu button", DIFFICULTY)))
    fail(`difficulty button ${DIFFICULTY} not found`);
  if (!(await clickByText(".ks-menu button", SIZE))) fail(`size button ${SIZE} not found`);
  await shot("02-selected");
  if (!(await clickByText(".ks-menu button", "Start"))) fail("Start not found");
  await waitFor(
    `getComputedStyle(document.querySelector('.ks-menu')).display==='none' && !!window.__ks`,
    20000,
    300,
    "game1 started",
  );
  const g1 = await evaluate(
    `(()=>{const s=window.__ks.getState();return{boardSize:s.boardSize,provinces:s.provinces.size,tick:s.tick};})()`,
  );
  log("STEP2 game1:", JSON.stringify(g1));
  if (g1.boardSize !== Number(SIZE)) fail(`board size ${g1.boardSize} != ${SIZE}`);
  await shot("03-game");

  // STEP 2b — ticks advance.
  log("STEP2 speed ->", await setMaxSpeed());
  const t1 = await tick();
  await sleep(2500);
  const t2 = await tick();
  log("STEP2 tick advance:", t1, "->", t2);
  if (!(t2 > t1)) fail(`ticks did not advance (${t1} -> ${t2})`);

  // STEP 3 — play to natural end.
  log(`waiting for end screen 1 (up to ${END_TIMEOUT_MS / 1000}s)...`);
  await waitFor(
    `!!document.querySelector('.ks-end') && getComputedStyle(document.querySelector('.ks-end')).display!=='none'`,
    END_TIMEOUT_MS,
    2000,
    "end1",
  );
  const end1 = await evaluate(
    `(()=>{const e=document.querySelector('.ks-end');return{title:e.querySelector('div')?.textContent,buttons:[...e.querySelectorAll('button')].map(b=>b.textContent.trim()),tick:window.__ks.getTickInfo().tick};})()`,
  );
  log("STEP3 end1:", JSON.stringify(end1));
  await shot("04-end1");

  // STEP 4 — Restart rebuilds the game (teardown path), plays to end again.
  if (!(await clickByText(".ks-end button", "Restart"))) fail("Restart not found");
  await waitFor(
    `getComputedStyle(document.querySelector('.ks-end')).display==='none' && !!window.__ks && window.__ks.getTickInfo().tick < 6`,
    20000,
    200,
    "restart fresh",
  );
  const g2 = await evaluate(
    `(()=>{const s=window.__ks.getState();return{boardSize:s.boardSize,tick:s.tick};})()`,
  );
  log("STEP4 restarted:", JSON.stringify(g2));
  if (g2.boardSize !== Number(SIZE)) fail("restart did not preserve config");
  await shot("05-restart");

  log("STEP4 speed ->", await setMaxSpeed());
  log(`waiting for end screen 2 (up to ${END_TIMEOUT_MS / 1000}s)...`);
  await waitFor(
    `!!document.querySelector('.ks-end') && getComputedStyle(document.querySelector('.ks-end')).display!=='none'`,
    END_TIMEOUT_MS,
    2000,
    "end2",
  );
  await shot("06-end2");

  // STEP 5 — Main Menu returns, a different board starts fresh.
  if (!(await clickByText(".ks-end button", "Main Menu"))) fail("Main Menu not found");
  await waitFor(
    `getComputedStyle(document.querySelector('.ks-menu')).display!=='none'`,
    20000,
    200,
    "menu reappear",
  );
  await shot("07-menu2");

  if (!(await clickByText(".ks-menu button", SIZE2))) fail(`size button ${SIZE2} not found`);
  if (!(await clickByText(".ks-menu button", "Start"))) fail("Start not found");
  await waitFor(
    `getComputedStyle(document.querySelector('.ks-menu')).display==='none' && !!window.__ks`,
    20000,
    300,
    "game2 start",
  );
  const g3 = await evaluate(
    `(()=>{const s=window.__ks.getState();return{boardSize:s.boardSize,provinces:s.provinces.size};})()`,
  );
  log("STEP5 game2:", JSON.stringify(g3));
  if (g3.boardSize !== Number(SIZE2)) fail(`board size ${g3.boardSize} != ${SIZE2}`);
  await shot("08-game2");

  log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));
  if (pageExceptions.length) fail(`${pageExceptions.length} page exception(s)`);
  if (STRICT_CONSOLE && consoleErrors.length)
    fail(`${consoleErrors.length} console error(s) under STRICT`);
  log("RESULT_DONE");
  process.exit(0);
})().catch(async (e) => {
  try {
    await shot("99-error");
  } catch {
    /* ignore */
  }
  fail(e?.message ?? String(e));
});
