// v2 browser smoke driver — zero npm deps, talks to Chrome over CDP via Node's
// global WebSocket + fetch. `run.mjs` boots a Vite dev server + headless Chrome
// and invokes this; nothing here launches anything.
//
// Flow (PRD §8 AC-38..42): menu renders → Start (no reload) → engine ticks
// (day advances) → entities render (castles/houses/units via window.__ks) →
// player control bar (tax slider / build mode) works → ?v1 easter egg boots the
// original prototype. Page exceptions are always fatal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CDP = process.env.CDP_URL ?? "http://localhost:9222";
const APP = process.env.APP_URL ?? "http://localhost:5173/";
const SHOTS = process.env.SHOTS_DIR ?? path.join(here, ".shots");
const STRICT_CONSOLE = process.env.SMOKE_STRICT_CONSOLE === "1";
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

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
    consoleErrors.push("console.error: " + (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
  } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    consoleErrors.push("log.error: " + msg.params.entry.text);
  }
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
  log("shot", name);
}
async function waitFor(expr, timeoutMs, interval, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evaluate(expr)) return true;
    } catch {
      /* mid-navigation: retry */
    }
    await sleep(interval);
  }
  throw new Error("waitFor timeout: " + (label || expr));
}
async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`${CDP}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* CDP not up yet */
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

  // STEP 1 — v2 menu renders (AC-38). v2 is at ?v2 (default is v1).
  await send("Page.navigate", { url: APP + "?v2" });
  await waitFor(`!!document.querySelector('.ks-menu')`, 30000, 500, "menu visible");
  const menu = await evaluate(
    `(()=>{const m=document.querySelector('.ks-menu');return{title:m.textContent.includes('Knight Strike'),start:[...m.querySelectorAll('button')].some(b=>b.textContent.trim()==='Start')};})()`,
  );
  log("STEP1 menu:", JSON.stringify(menu));
  if (!menu.title || !menu.start) fail("menu missing title or Start");
  await shot("v2-01-menu");

  // STEP 2 — Start → ticks advance, entities render (AC-40).
  await evaluate(`[...document.querySelectorAll('.ks-menu button')].find(b=>b.textContent.trim()==='Start').click()`);
  const day0 = await evaluate(`window.__ks.getTickInfo().day`);
  await waitFor(`window.__ks.getTickInfo().day > ${day0}`, 15000, 300, "day advances");
  const counts = await evaluate(
    `(()=>{const s=window.__ks.getState();return{units:s.units.length,houses:s.houses.length,castles:[...s.provinces.values()].filter(p=>p.isCastle).length,day:s.day};})()`,
  );
  log("STEP2 ticked + entities:", JSON.stringify(counts));
  if (counts.castles < 4 || counts.houses < 1 || counts.units < 1) fail("entities missing: " + JSON.stringify(counts));
  await shot("v2-02-game");

  // STEP 3 — player control bar: tax slider + build mode (AC-39/41).
  const controls = await evaluate(
    `(()=>{return{bar:!!document.querySelector('.ks-controls'),tax:!!document.querySelector('.ks-tax'),buildBtns:document.querySelectorAll('.ks-controls button').length};})()`,
  );
  log("STEP3 controls:", JSON.stringify(controls));
  if (!controls.bar || !controls.tax || controls.buildBtns < 4) fail("control bar/tax/build missing: " + JSON.stringify(controls));
  await evaluate(`window.__ks.setTax(0.15)`);
  const tax = await evaluate(`window.__ks.getState().factions.TOKUGAWA.taxRate`);
  if (tax !== 0.15) fail("tax not applied: " + tax);

  // STEP 4 — the DEFAULT (no param) boots the v1 game (the shipped default).
  await send("Page.navigate", { url: APP });
  await waitFor(`!!document.querySelector('.ks-menu') && !!document.querySelector('canvas')`, 30000, 500, "default v1 boots");
  log("STEP4 default (v1) booted");
  await shot("v2-03-default-v1");

  if (pageExceptions.length) fail("page exceptions: " + JSON.stringify(pageExceptions));
  if (STRICT_CONSOLE && consoleErrors.length) fail("console errors (strict): " + JSON.stringify(consoleErrors));
  log("RESULT_OK — default boots v1; ?v2 menu/start/ticks/entities/controls");
  process.exit(0);
})().catch((e) => fail(e.message));
