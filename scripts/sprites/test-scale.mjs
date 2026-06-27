// Test: does downscaling to game size hide the eaten-gap holes? Downscales a
// sprite to several target sizes (premultiplied box filter) and shows each over
// a dark (game-like) and a checkerboard background, nearest-upscaled so the
// small result is inspectable.  node scripts/sprites/test-scale.mjs <png> [out]
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

function downscale(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) { const sy0 = Math.floor((dy * sh) / dh), sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) { const sx0 = Math.floor((dx * sw) / dw), sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { const si = (sy * sw + sx) * 4, al = src[si + 3]; r += src[si] * al; g += src[si + 1] * al; b += src[si + 2] * al; a += al; n++; }
      const di = (dy * dw + dx) * 4; if (a > 0) { dst[di] = Math.round(r / a); dst[di + 1] = Math.round(g / a); dst[di + 2] = Math.round(b / a); } dst[di + 3] = Math.round(a / n); } }
  return dst;
}
// nearest upscale a thumb by integer k → opaque-over-bg composite for viewing
function tile(thumb, tw, th, k, bg) {
  const W = tw * k, H = th * k, out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = (((y / k) | 0) * tw + ((x / k) | 0)) * 4, a = thumb[si + 3], ia = 255 - a, di = (y * W + x) * 4;
    const bx = bg.check ? ((((x / (k * 2)) | 0) + ((y / (k * 2)) | 0)) & 1 ? bg.c2 : bg.c1) : bg.c1;
    out[di] = (thumb[si] * a + bx[0] * ia) / 255; out[di + 1] = (thumb[si + 1] * a + bx[1] * ia) / 255; out[di + 2] = (thumb[si + 2] * a + bx[2] * ia) / 255; out[di + 3] = 255;
  }
  return { rgba: out, W, H };
}

const src = decodePng(readFileSync(process.argv[2]));
const out = process.argv[3] ?? "public/507x/_scaletest.png";
const SIZES = [96, 64, 48, 32];
const DARK = { c1: [0x2b, 0x2f, 0x36] };
const CHECK = { check: true, c1: [0x35, 0x35, 0x3b], c2: [0x42, 0x42, 0x48] };
const VIEW = 200, GAP = 8;
// rows: dark, checker ; cols: sizes
const cellW = VIEW, cellH = VIEW;
const W = GAP + SIZES.length * (cellW + GAP), H = GAP + 2 * (cellH + GAP);
const sheet = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { sheet[i * 4] = 0x18; sheet[i * 4 + 1] = 0x18; sheet[i * 4 + 2] = 0x1c; sheet[i * 4 + 3] = 255; }
const bgs = [DARK, CHECK];
for (let r = 0; r < 2; r++) {
  for (let c = 0; c < SIZES.length; c++) {
    const s = SIZES[c], thumb = downscale(src.rgba, src.width, src.height, s, s);
    const k = Math.max(1, Math.floor(VIEW / s));
    const t = tile(thumb, s, s, k, bgs[r]);
    const ox = GAP + c * (cellW + GAP) + ((cellW - t.W) >> 1), oy = GAP + r * (cellH + GAP) + ((cellH - t.H) >> 1);
    for (let y = 0; y < t.H; y++) for (let x = 0; x < t.W; x++) { const si = (y * t.W + x) * 4, di = ((oy + y) * W + (ox + x)) * 4; sheet[di] = t.rgba[si]; sheet[di + 1] = t.rgba[si + 1]; sheet[di + 2] = t.rgba[si + 2]; }
  }
}
writeFileSync(out, encodePng(W, H, sheet));
console.log(`wrote ${out} — top row over dark game bg, bottom over checkerboard; cols = ${SIZES.join("/")}px (nearest-zoomed for viewing)`);
