// Cut a grid sprite-sheet into individually-named tiles (zero-dep). Each grid
// cell is sheet/(cols,rows); the output is a SIZE×SIZE centre-crop of the cell.
//   node scripts/sprites/cut.mjs <sheet> <outdir> [cols rows size name0,name1,...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

const [, , sheetPath, outDir, colsA, rowsA, sizeA, namesA] = process.argv;
const cols = Number(colsA ?? 2), rows = Number(rowsA ?? 2), size = Number(sizeA ?? 507);
const names = (namesA ?? "soldier,king,knight,queen").split(",");
const sheet = decodePng(readFileSync(sheetPath));
const cellW = Math.floor(sheet.width / cols), cellH = Math.floor(sheet.height / rows);
mkdirSync(outDir, { recursive: true });
let idx = 0;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const name = names[idx++] ?? `tile${idx}`;
    const ox = c * cellW + ((cellW - size) >> 1);
    const oy = r * cellH + ((cellH - size) >> 1);
    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = Math.min(sheet.width - 1, Math.max(0, ox + x));
      const sy = Math.min(sheet.height - 1, Math.max(0, oy + y));
      const si = (sy * sheet.width + sx) * 4, di = (y * size + x) * 4;
      out[di] = sheet.rgba[si]; out[di + 1] = sheet.rgba[si + 1]; out[di + 2] = sheet.rgba[si + 2]; out[di + 3] = sheet.rgba[si + 3];
    }
    const dest = join(outDir, `${name}.png`);
    writeFileSync(dest, encodePng(size, size, out));
    console.log(`${name}: cell (${c},${r}) crop ${size}×${size} @ (${ox},${oy}) → ${dest}`);
  }
}
