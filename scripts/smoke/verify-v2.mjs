// One-off M13 slice-1 verification: boot the v2 app, click Start, confirm the
// engine ticks (day advances) and entities exist, screenshot. Self-contained
// (CDP over Node's WebSocket/fetch). Not the milestone smoke — that's a later
// slice; this just proves the render boots and runs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5179;
const APP = `http://localhost:${PORT}/`;
const CDP = "http://localhost:9223";
const CHROME = process.env.CHROME_PATH;
const SHOTS = path.join(here, ".shots");
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[verify-v2]", ...a);
let ws, nextId = 1;
const pending = new Map();
const exceptions = [];

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
function onMessage(raw) {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  } else if (m.method === "Runtime.exceptionThrown") {
    exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  }
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function waitFor(expr, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await evaluate(expr)) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error("timeout: " + label);
}
async function pageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const ts = await (await fetch(`${CDP}/json`)).json();
      const p = ts.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error("no CDP page target");
}

const vite = spawn("pnpm", ["exec", "vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
const chrome = spawn(
  CHROME,
  ["--headless=new", "--remote-debugging-port=9223", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "about:blank"],
  { stdio: "ignore", detached: true },
);
const cleanup = () => {
  try { process.kill(-vite.pid); } catch { /* already gone */ }
  try { process.kill(-chrome.pid); } catch { /* already gone */ }
};

try {
  ws = new WebSocket(await pageWs());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);
  await send("Page.enable");
  await send("Runtime.enable");
  log("CDP connected");

  await send("Page.navigate", { url: APP });
  await waitFor(`!!document.querySelector('.ks-menu')`, 30000, "menu");
  log("menu rendered");
  await send("Page.captureScreenshot", { format: "png" }).then((r) =>
    fs.writeFileSync(path.join(SHOTS, "v2-01-menu.png"), Buffer.from(r.data, "base64")),
  );

  await evaluate(`document.querySelector('.ks-menu button').click()`);
  await sleep(500);
  const day0 = await evaluate(`window.__ks.getTickInfo().day`);
  await waitFor(`window.__ks.getTickInfo().day > ${day0}`, 15000, "day advances");
  const info = await evaluate(`window.__ks.getTickInfo()`);
  const counts = await evaluate(
    `(()=>{const s=window.__ks.getState();return{units:s.units.length,houses:s.houses.length,castles:[...s.provinces.values()].filter(p=>p.isCastle).length};})()`,
  );
  log("after start:", JSON.stringify(info), "entities:", JSON.stringify(counts));
  await send("Page.captureScreenshot", { format: "png" }).then((r) =>
    fs.writeFileSync(path.join(SHOTS, "v2-02-game.png"), Buffer.from(r.data, "base64")),
  );

  if (exceptions.length) throw new Error("page exceptions: " + JSON.stringify(exceptions));
  if (counts.castles < 4 || counts.houses < 1) throw new Error("entities missing: " + JSON.stringify(counts));
  log("RESULT_OK — v2 render boots, ticks advance, entities present");
  cleanup();
  process.exit(0);
} catch (e) {
  log("RESULT_ERROR:", e.message, "exceptions:", JSON.stringify(exceptions));
  cleanup();
  process.exit(1);
}
