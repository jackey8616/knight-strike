// Contact-sheet generator (zero-dep) — lays the 16 processed sprites into a
// 4×4 grid (rows = factions blue/green/red/yellow, cols = tiers
// soldier/knight/queen/king) on a checkerboard so transparency is visible.
//   node scripts/sprites/montage.mjs [srcDir] [outFile]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import zlib from "node:zlib";

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePng(buf) {
  let off = 8, ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = data; else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4);
  const ch = ihdr[9] === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch, recon = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++], rs = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[p++];
      const a = x >= ch ? recon[rs + x - ch] : 0;
      const b = y > 0 ? recon[rs - stride + x] : 0;
      const c = x >= ch && y > 0 ? recon[rs - stride + x - ch] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break; case 1: v = cur + a; break; case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break; case 4: v = cur + paeth(a, b, c); break;
        default: throw new Error(`filter ${filter}`);
      }
      recon[rs + x] = v & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = recon[i * ch]; rgba[i * 4 + 1] = recon[i * ch + 1];
    rgba[i * 4 + 2] = recon[i * ch + 2]; rgba[i * 4 + 3] = ch === 4 ? recon[i * ch + 3] : 255;
  }
  return { width, height, rgba };
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(W, H, rgba) {
  const stride = W * 4, raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// premultiplied box downscale → dw×dh
function downscale(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor((dy * sh) / dh), sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor((dx * sw) / dw), sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const si = (sy * sw + sx) * 4, al = src[si + 3];
        r += src[si] * al; g += src[si + 1] * al; b += src[si + 2] * al; a += al; n++;
      }
      const di = (dy * dw + dx) * 4;
      if (a > 0) { dst[di] = Math.round(r / a); dst[di + 1] = Math.round(g / a); dst[di + 2] = Math.round(b / a); }
      dst[di + 3] = Math.round(a / n);
    }
  }
  return dst;
}

// Optional srcRoot reads <srcRoot>/<faction>/<tier>.png (e.g. public/downscale
// or public/matted); with no arg it falls back to the public/<color>-matted/
// layout. Faction order fixed; only completed ones are included.
// argv[2]: a dir (srcRoot, reads <srcRoot>/<faction>/<tier>.png) or a .png out
// path; argv[3]: out path. No args → read public/<color>-matted/.
const a2 = process.argv[2];
const srcRoot = a2 && !a2.endsWith(".png") ? a2 : null;
const outFile =
  (a2 && a2.endsWith(".png") ? a2 : process.argv[3]) ??
  (srcRoot ? `${srcRoot}/_overview.png` : "public/_overview-matted.png");
const ORDER = ["green", "red", "blue", "yellow"];
const FACTIONS = ORDER.filter((f) => existsSync(srcRoot ? `${srcRoot}/${f}` : `public/${f}-matted`));
const TIERS = ["soldier", "knight", "queen", "king"];
const pathFor = (fac, tier) => (srcRoot ? `${srcRoot}/${fac}/${tier}.png` : `public/${fac}-matted/${tier}.png`);

const CELL = 200, SP = 192, CHK = 16;
const W = TIERS.length * CELL, H = FACTIONS.length * CELL;
const canvas = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const on = (((x / CHK) | 0) + ((y / CHK) | 0)) & 1;
  const v = on ? 0x42 : 0x35, i = (y * W + x) * 4;
  canvas[i] = v; canvas[i + 1] = v; canvas[i + 2] = v + 6; canvas[i + 3] = 255;
}
for (let r = 0; r < FACTIONS.length; r++) {
  for (let c = 0; c < TIERS.length; c++) {
    const img = decodePng(readFileSync(pathFor(FACTIONS[r], TIERS[c])));
    const thumb = downscale(img.rgba, img.width, img.height, SP, SP);
    const ox = c * CELL + ((CELL - SP) >> 1), oy = r * CELL + ((CELL - SP) >> 1);
    for (let y = 0; y < SP; y++) for (let x = 0; x < SP; x++) {
      const si = (y * SP + x) * 4, a = thumb[si + 3];
      if (a === 0) continue;
      const di = ((oy + y) * W + (ox + x)) * 4, ia = 255 - a;
      canvas[di] = (thumb[si] * a + canvas[di] * ia) / 255;
      canvas[di + 1] = (thumb[si + 1] * a + canvas[di + 1] * ia) / 255;
      canvas[di + 2] = (thumb[si + 2] * a + canvas[di + 2] * ia) / 255;
    }
  }
}
writeFileSync(outFile, encodePng(W, H, canvas));
console.log(`wrote ${outFile} (${W}×${H}) — rows ${FACTIONS.join("/")}, cols ${TIERS.join("/")}`);
