// Recolour the green-screen leftover (edge fringe + ground shadow) to the
// faction colour. Those artifacts are strongly GREEN-DOMINANT (G clearly above R
// and B), whereas the figures are not — except the green faction, where green→
// green is a near no-op. Each targeted pixel keeps its brightness but takes the
// faction hue (luminance-scaled faction colour), so a dark shadow → dark faction
// tone and a bright fringe → bright faction tone. DEBUG=1 paints targets magenta.
//   node scripts/sprites/recolor-edge.mjs <faction> <file...>
import { readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
function decodePng(buf) {
  let off = 8, ihdr = null; const idat = [];
  while (off < buf.length) { const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len); if (type === "IHDR") ihdr = data; else if (type === "IDAT") idat.push(data); off += 12 + len; }
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), ch = ihdr[9] === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * ch, recon = Buffer.alloc(height * stride); let p = 0;
  for (let y = 0; y < height; y++) { const f = raw[p++], rs = y * stride; for (let x = 0; x < stride; x++) { const cur = raw[p++], a = x >= ch ? recon[rs + x - ch] : 0, b = y > 0 ? recon[rs - stride + x] : 0, c = x >= ch && y > 0 ? recon[rs - stride + x - ch] : 0; let v; switch (f) { case 0: v = cur; break; case 1: v = cur + a; break; case 2: v = cur + b; break; case 3: v = cur + ((a + b) >> 1); break; case 4: v = cur + paeth(a, b, c); break; default: throw new Error("filter"); } recon[rs + x] = v & 0xff; } }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i * 4] = recon[i * ch]; rgba[i * 4 + 1] = recon[i * ch + 1]; rgba[i * 4 + 2] = recon[i * ch + 2]; rgba[i * 4 + 3] = ch === 4 ? recon[i * ch + 3] : 255; }
  return { width, height, rgba };
}
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const tb = Buffer.from(t, "ascii"); const cr = Buffer.alloc(4); cr.writeUInt32BE(zlib.crc32(Buffer.concat([tb, d])) >>> 0, 0); return Buffer.concat([l, tb, d, cr]); }
function encodePng(W, H, rgba) { const s = W * 4, raw = Buffer.alloc(H * (s + 1)); for (let y = 0; y < H; y++) rgba.copy(raw, y * (s + 1) + 1, y * s, y * s + s); const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6; return Buffer.concat([SIG, chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]); }

const FACTION = {
  green: [0x4f, 0xb5, 0x5f], red: [0xc9, 0x45, 0x45],
  blue: [0x45, 0x75, 0xc9], yellow: [0xd9, 0xc1, 0x45],
};
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const T = Number(process.env.T ?? 16); // green-dominance margin
const DEBUG = process.env.DEBUG === "1";

const faction = process.argv[2];
const fc = FACTION[faction];
if (!fc) { console.error(`unknown faction "${faction}" (green|red|blue|yellow)`); process.exit(2); }
const fLuma = luma(fc[0], fc[1], fc[2]) || 1;

for (const file of process.argv.slice(3)) {
  const { width: W, height: H, rgba } = decodePng(readFileSync(file));
  const N = W * H;
  // Default: green-DOMINANT (G beats both R and B) — the green-screen leftover.
  // TEAL=1: the whole green-teal family (G beats R; B may be high) — used to
  // de-green a faction whose figures shouldn't have any green/teal at all.
  const TEAL = process.env.TEAL === "1";
  const isGreen = (i) =>
    rgba[i * 4 + 3] > 0 &&
    rgba[i * 4 + 1] - rgba[i * 4] >= T &&
    (TEAL || rgba[i * 4 + 1] - rgba[i * 4 + 2] >= T);
  const isTransp = (i) => rgba[i * 4 + 3] === 0;

  const mark = new Uint8Array(N);
  if (process.env.ALL === "1") {
    // ALL=1: recolour EVERY green-dominant pixel, including pockets enclosed by
    // the figure. Only safe for factions whose figures contain no green at all
    // (red, blue) — otherwise it eats figure greens/teals.
    for (let i = 0; i < N; i++) if (isGreen(i)) mark[i] = 1;
  } else {
    // Flood from the border through transparent + green-dominant pixels only.
    // This reaches the edge fringe and the ground shadow (both green, touching
    // the bg) but NOT green enclosed by the figure (teal headdress, green
    // armour) — the flood stops at the figure's non-green outline.
    const visited = new Uint8Array(N);
    const stack = [];
    const pushIf = (i) => { if (!visited[i] && (isTransp(i) || isGreen(i))) { visited[i] = 1; stack.push(i); } };
    for (let x = 0; x < W; x++) { pushIf(x); pushIf((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { pushIf(y * W); pushIf(y * W + W - 1); }
    while (stack.length) {
      const i = stack.pop();
      if (isGreen(i)) mark[i] = 1;
      const x = i % W, y = (i / W) | 0;
      if (x > 0) pushIf(i - 1);
      if (x < W - 1) pushIf(i + 1);
      if (y > 0) pushIf(i - W);
      if (y < H - 1) pushIf(i + W);
    }
  }

  let n = 0;
  for (let i = 0; i < N; i++) {
    if (!mark[i]) continue;
    n++;
    if (DEBUG) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 255; continue; }
    const scale = luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) / fLuma;
    rgba[i * 4] = Math.min(255, Math.round(fc[0] * scale));
    rgba[i * 4 + 1] = Math.min(255, Math.round(fc[1] * scale));
    rgba[i * 4 + 2] = Math.min(255, Math.round(fc[2] * scale));
  }
  writeFileSync(file, encodePng(W, H, rgba));
  console.log(`${file}: recoloured ${n} edge/shadow px → ${faction}`);
}
