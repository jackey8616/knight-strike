// Downscale every PNG under <srcRoot> into <dstRoot>, mirroring the folder
// structure, each to size×size (premultiplied box filter so transparent edges
// don't bleed dark). Zero-dep.
//   node scripts/sprites/downscale.mjs <size> <srcRoot> <dstRoot>
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
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

function downscale(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) { const sy0 = Math.floor((dy * sh) / dh), sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) { const sx0 = Math.floor((dx * sw) / dw), sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { const si = (sy * sw + sx) * 4, al = src[si + 3]; r += src[si] * al; g += src[si + 1] * al; b += src[si + 2] * al; a += al; n++; }
      const di = (dy * dw + dx) * 4; if (a > 0) { dst[di] = Math.round(r / a); dst[di + 1] = Math.round(g / a); dst[di + 2] = Math.round(b / a); } dst[di + 3] = Math.round(a / n); } }
  return dst;
}

const size = Number(process.argv[2]);
const srcRoot = process.argv[3];
const dstRoot = process.argv[4];
if (!size || !srcRoot || !dstRoot) { console.error("usage: node downscale.mjs <size> <srcRoot> <dstRoot>"); process.exit(2); }

function walk(rel = "") {
  const dir = join(srcRoot, rel);
  for (const e of readdirSync(dir)) {
    if (e.startsWith(".")) continue;
    const childRel = join(rel, e);
    if (statSync(join(srcRoot, childRel)).isDirectory()) { walk(childRel); continue; }
    if (!e.toLowerCase().endsWith(".png")) continue;
    const img = decodePng(readFileSync(join(srcRoot, childRel)));
    const out = downscale(img.rgba, img.width, img.height, size, size);
    const dest = join(dstRoot, childRel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, encodePng(size, size, out));
    console.log(`${childRel} → ${size}×${size}`);
  }
}
walk();
