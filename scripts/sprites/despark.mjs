// Remove the decorative sparkle in the bottom-right corner of the queen sprites.
// After matting it's a small connected component, isolated from the centred
// figure, sitting in the bottom-right — so we drop any non-main (not the largest
// figure) opaque component whose centroid is in the bottom-right region and that
// is small. DEBUG=1 paints what it would remove magenta instead of clearing it.
//   node scripts/sprites/despark.mjs <queen.png> [more.png ...]
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

const DEBUG = process.env.DEBUG === "1";
const RX = Number(process.env.RX ?? 0.6); // bottom-right region: centroid x fraction
const RY = Number(process.env.RY ?? 0.6); // centroid y fraction
const MAXAREA = Number(process.env.MAXAREA ?? 8000); // a sparkle is small

for (const file of process.argv.slice(2)) {
  const { width: W, height: H, rgba } = decodePng(readFileSync(file));
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  let nComp = 0; const size = [], cx = [], cy = [];
  for (let s = 0; s < N; s++) {
    if (rgba[s * 4 + 3] === 0 || comp[s] !== -1) continue;
    const id = nComp++; let sz = 0, sx = 0, sy = 0; const q = [s]; comp[s] = id;
    while (q.length) {
      const i = q.pop(); sz++; const x = i % W, y = (i / W) | 0; sx += x; sy += y;
      if (x > 0 && rgba[(i - 1) * 4 + 3] > 0 && comp[i - 1] === -1) { comp[i - 1] = id; q.push(i - 1); }
      if (x < W - 1 && rgba[(i + 1) * 4 + 3] > 0 && comp[i + 1] === -1) { comp[i + 1] = id; q.push(i + 1); }
      if (y > 0 && rgba[(i - W) * 4 + 3] > 0 && comp[i - W] === -1) { comp[i - W] = id; q.push(i - W); }
      if (y < H - 1 && rgba[(i + W) * 4 + 3] > 0 && comp[i + W] === -1) { comp[i + W] = id; q.push(i + W); }
    }
    size.push(sz); cx.push(sx / sz); cy.push(sy / sz);
  }
  let main = -1, best = -1;
  for (let c = 0; c < nComp; c++) if (size[c] > best) { best = size[c]; main = c; }
  const kill = new Uint8Array(nComp);
  let killed = 0;
  for (let c = 0; c < nComp; c++) {
    if (c === main) continue;
    if (size[c] <= MAXAREA && cx[c] >= RX * W && cy[c] >= RY * H) { kill[c] = 1; killed++; }
  }
  for (let i = 0; i < N; i++) {
    const c = comp[i];
    if (c < 0 || !kill[c]) continue;
    if (DEBUG) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
    else rgba[i * 4 + 3] = 0;
  }
  writeFileSync(file, encodePng(W, H, rgba));
  console.log(`${file}: removed ${killed} bottom-right component(s)`);
}
