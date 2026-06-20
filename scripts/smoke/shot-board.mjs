// One-off: boot the v1 game and screenshot the board so we can eyeball the new
// authored faction sprites. Run via the smoke harness which boots the dev server
// + Chrome:  SMOKE_DRIVER=shot-board.mjs pnpm smoke
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CDP = process.env.CDP_URL ?? "http://localhost:9222";
const APP = process.env.APP_URL ?? "http://localhost:5173/";
const SHOTS = path.join(here, ".shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[shot]", ...a);

let ws, nextId = 1;
const pending = new Map();
const consoleErrors = [];
const pageExceptions = [];
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
function onMessage(raw) {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") pageExceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
  else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") consoleErrors.push("log: " + m.params.entry.text);
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.data, "base64"));
  log("shot", name);
}
async function waitFor(expr, timeout, interval, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (await evaluate(expr)) return true; } catch { /* retry */ } await sleep(interval); }
  throw new Error("waitFor timeout: " + (label || expr));
}
async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try { const t = await (await fetch(`${CDP}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error("no page target on " + CDP);
}

(async () => {
  ws = new WebSocket(await getPageWs());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  const dump = () => { log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors)); log("PAGE_EXCEPTIONS:", JSON.stringify(pageExceptions)); };
  // Retina-ish viewport so we judge crispness at 2× device pixels.
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 820, deviceScaleFactor: 2, mobile: false });

  // Small board (11×11) so units render large and clear; fixed seed.
  log("navigate");
  await send("Page.navigate", { url: APP + "?size=11&seed=1" });
  try {
    await waitFor(`!!document.querySelector('.ks-menu')`, 20000, 500, "v1 menu");
  } catch (e) {
    log("menu never appeared:", e.message);
    const probe = await evaluate(`(()=>({menu:!!document.querySelector('.ks-menu'),canvas:!!document.querySelector('canvas'),ks:typeof window.__ks}))()`).catch(() => "eval-failed");
    log("probe:", JSON.stringify(probe));
    dump();
    process.exit(1);
  }
  log("menu up, clicking Start");
  await evaluate(`[...document.querySelectorAll('.ks-menu button')].find(b=>b.textContent.trim()==='Start').click()`);
  await waitFor(`!!(window.__ks && window.__ks.getState && window.__ks.getState().economy)`, 15000, 300, "v1 game");
  log("game up");
  await sleep(1200);
  await shot("board-1-start");
  dump();

  // Let it run so AI spawns/marches troops, then shoot again.
  await evaluate(`window.__ks.setPaused(false)`);
  await sleep(18000);
  await shot("board-2-running");

  const counts = await evaluate(`(()=>{const s=window.__ks.getState();let occ=0;for(const p of s.provinces.values())occ+=p.occupants.length;return{tick:s.tick,occTiles:occ,marching:s.marchingStacks.length};})()`);
  log("state:", JSON.stringify(counts));
  process.exit(0);
})().catch((e) => { console.error("[shot] ERR", e.message); process.exit(1); });
