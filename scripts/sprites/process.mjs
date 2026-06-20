// Sprite asset processor (zero-dep, Node built-ins only) — strips the opaque
// background and the baked-in corner text label from the authored hero sprites,
// writing transparent PNGs. Background removal is a gradient-following region
// grow seeded from the (always-background) border, so it walks the smooth dark
// backdrop but stops at the figure's hard edge. The corner label is removed as
// connected components that sit wholly inside the top-left text zone and aren't
// the main figure.
//
// Usage:
//   node scripts/sprites/process.mjs <file-or-dir> [--out <suffix>]
//   node scripts/sprites/process.mjs public/507x            # all PNGs, in place
//   node scripts/sprites/process.mjs public/507x/blue/knight.png --out _preview
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import zlib from "node:zlib";

// ---- minimal PNG codec: 8-bit, non-interlaced, colour type 2 (RGB) / 6 (RGBA) ----
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = data;
    else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8) throw new Error(`unsupported bitDepth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error(`unsupported colorType ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const recon = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const rs = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[p++];
      const a = x >= ch ? recon[rs + x - ch] : 0;
      const b = y > 0 ? recon[rs - stride + x] : 0;
      const c = x >= ch && y > 0 ? recon[rs - stride + x - ch] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: v = cur + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      recon[rs + x] = v & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = recon[i * ch];
    rgba[i * 4 + 1] = recon[i * ch + 1];
    rgba[i * 4 + 2] = recon[i * ch + 2];
    rgba[i * 4 + 3] = ch === 4 ? recon[i * ch + 3] : 255;
  }
  return { width, height, rgba };
}

function crc32(buf) {
  return zlib.crc32(buf) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- processing ----
// A pixel is background only if it is contiguous with the border AND its colour
// is within ABS_TOL of an actual sampled background colour. The absolute gate
// (vs. a per-step gradient threshold) is what stops the fill leaking into a
// dark, low-contrast figure (e.g. dark-red armour on dark-navy). PEEL passes
// then nibble the thin anti-aliased halo left at the figure edge.
// Tuned across the full set (blue/yellow high-contrast → green dark-panther-on-
// dark low-contrast): a low absolute tolerance errs toward keeping the figure —
// a thin halo beats an eaten figure / outline. PEEL is OFF by default because it
// erodes the figure's own dark outline ring (the "eaten lines"); enable it only
// to clean a soft halo. Text removal only kills letter-sized components so a
// disconnected cape/banner tip in the corner is never mistaken for a label.
const ABS_TOL = Number(process.env.ABS_TOL ?? 18); // sum|dR|+|dG|+|dB| from nearest bg sample
const PEEL_TOL = Number(process.env.PEEL_TOL ?? 42); // looser tol for edge-halo cleanup
const PEEL_PASSES = Number(process.env.PEEL_PASSES ?? 0);
const TEXT_W = 0.44; // text zone: left fraction of width
const TEXT_H = 0.2; // text zone: top fraction of height

function processImage({ width: W, height: H, rgba }) {
  const N = W * H;

  // Sample background colours along the border (corners + edge midpoints, all
  // background for a centred figure), de-duped, to span any backdrop gradient.
  const seeds = [];
  const seedColors = [];
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) for (const fy of [0, 0.25, 0.5, 0.75, 1]) {
    const onBorder = fx === 0 || fx === 1 || fy === 0 || fy === 1;
    if (!onBorder) continue;
    const x = Math.min(W - 1, Math.round(fx * (W - 1)));
    const y = Math.min(H - 1, Math.round(fy * (H - 1)));
    const i = y * W + x;
    seeds.push(i);
    seedColors.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  }
  const seedDist = (i) => {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    let best = Infinity;
    for (const s of seedColors) {
      const d = Math.abs(r - s[0]) + Math.abs(g - s[1]) + Math.abs(b - s[2]);
      if (d < best) best = d;
    }
    return best;
  };

  // 1) background = pixels contiguous with the border whose colour stays within
  //    ABS_TOL of a sampled bg colour.
  const isBg = new Uint8Array(N);
  const stack = [];
  for (const s of seeds) stack.push(s);
  const tryPush = (j) => {
    if (!isBg[j] && seedDist(j) <= ABS_TOL) stack.push(j);
  };
  while (stack.length) {
    const i = stack.pop();
    if (isBg[i]) continue;
    isBg[i] = 1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) tryPush(i - 1);
    if (x < W - 1) tryPush(i + 1);
    if (y > 0) tryPush(i - W);
    if (y < H - 1) tryPush(i + W);
  }
  // Peel the thin halo: foreground pixels adjacent to bg whose colour is still
  // close-ish to bg (anti-aliased boundary). Bounded passes so it can't eat the
  // figure body.
  for (let pass = 0; pass < PEEL_PASSES; pass++) {
    const add = [];
    for (let i = 0; i < N; i++) {
      if (isBg[i]) continue;
      const x = i % W, y = (i / W) | 0;
      const touchesBg =
        (x > 0 && isBg[i - 1]) || (x < W - 1 && isBg[i + 1]) ||
        (y > 0 && isBg[i - W]) || (y < H - 1 && isBg[i + W]);
      if (touchesBg && seedDist(i) <= PEEL_TOL) add.push(i);
    }
    for (const i of add) isBg[i] = 1;
  }
  // 1b) optional shadow/dark-bg erode (SHADOW=1): nibble dark + desaturated
  //     pixels (ground shadow, residual navy) inward from the background, but
  //     only where a pixel already has ≥2 background neighbours — so a solid
  //     dark blob erodes while a 1px outline (1 bg neighbour) is spared. Bright
  //     or saturated figure pixels (greens/golds) are never touched.
  if (process.env.SHADOW === "1") {
    const SH_LUM = Number(process.env.SH_LUM ?? 104);
    const SH_CHR = Number(process.env.SH_CHR ?? 34);
    let changed = true, guard = 0;
    while (changed && guard++ < 400) {
      changed = false;
      const add = [];
      for (let i = 0; i < N; i++) {
        if (isBg[i]) continue;
        const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
        if ((r + g + b) / 3 > SH_LUM) continue; // bright → figure
        if (Math.max(r, g, b) - Math.min(r, g, b) > SH_CHR) continue; // saturated → figure
        const x = i % W, y = (i / W) | 0;
        let bn = 0;
        if (x > 0 && isBg[i - 1]) bn++;
        if (x < W - 1 && isBg[i + 1]) bn++;
        if (y > 0 && isBg[i - W]) bn++;
        if (y < H - 1 && isBg[i + W]) bn++;
        if (bn >= 2) add.push(i);
      }
      if (add.length) { changed = true; for (const i of add) isBg[i] = 1; }
    }
  }
  // 1c) reclaim narrow background intrusions (RECLAIM=1, default on): a removed
  //     pixel mostly surrounded by figure is an interior detail gap (dark armour
  //     recess the same colour as the bg, reached through a filigree bridge), not
  //     real background — restore it. Iterating fills enclosed pockets inward
  //     while the open outer background (few figure neighbours) stays removed.
  if (process.env.RECLAIM === "1") {
    const TH = Number(process.env.RECLAIM_NB ?? 3);
    let changed = true, guard = 0;
    while (changed && guard++ < 60) {
      changed = false;
      const restore = [];
      for (let i = 0; i < N; i++) {
        if (!isBg[i]) continue;
        const x = i % W, y = (i / W) | 0;
        let fn = 0;
        if (x > 0 && !isBg[i - 1]) fn++;
        if (x < W - 1 && !isBg[i + 1]) fn++;
        if (y > 0 && !isBg[i - W]) fn++;
        if (y < H - 1 && !isBg[i + W]) fn++;
        if (fn >= TH) restore.push(i);
      }
      if (restore.length) { changed = true; for (const i of restore) isBg[i] = 0; }
    }
  }
  let bgCount = 0;
  for (let i = 0; i < N; i++) if (isBg[i]) bgCount++;

  // 2) connected components of the remaining (foreground) pixels.
  const comp = new Int32Array(N).fill(-1);
  let nComp = 0;
  const compSize = [];
  const compBox = []; // [minx,miny,maxx,maxy]
  for (let s = 0; s < N; s++) {
    if (isBg[s] || comp[s] !== -1) continue;
    const id = nComp++;
    let size = 0;
    let minx = W, miny = H, maxx = 0, maxy = 0;
    const q = [s];
    comp[s] = id;
    while (q.length) {
      const i = q.pop();
      size++;
      const x = i % W, y = (i / W) | 0;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && !isBg[i - 1] && comp[i - 1] === -1) { comp[i - 1] = id; q.push(i - 1); }
      if (x < W - 1 && !isBg[i + 1] && comp[i + 1] === -1) { comp[i + 1] = id; q.push(i + 1); }
      if (y > 0 && !isBg[i - W] && comp[i - W] === -1) { comp[i - W] = id; q.push(i - W); }
      if (y < H - 1 && !isBg[i + W] && comp[i + W] === -1) { comp[i + W] = id; q.push(i + W); }
    }
    compSize.push(size);
    compBox.push([minx, miny, maxx, maxy]);
  }
  // main figure = largest component
  let main = -1, best = -1;
  for (let c = 0; c < nComp; c++) if (compSize[c] > best) { best = compSize[c]; main = c; }

  // 3) text = non-main components whose bbox lies wholly in the top-left zone.
  const zx = TEXT_W * W, zy = TEXT_H * H;
  const kill = new Uint8Array(nComp);
  let textComps = 0;
  // Kill non-main components that sit wholly inside the top-left label zone. The
  // figure is the main component, so even a banner/plume reaching the corner is
  // spared (it's connected to the body); only the detached label lives here.
  for (let c = 0; c < nComp; c++) {
    if (c === main) continue;
    const [minx, miny, , maxy] = compBox[c];
    const maxx = compBox[c][2];
    if (minx >= 0 && maxx <= zx && miny >= 0 && maxy <= zy) { kill[c] = 1; textComps++; }
  }

  // 4) apply alpha (or, in DEBUG, paint removed pixels magenta to inspect the cut)
  const debug = process.env.DEBUG === "1";
  for (let i = 0; i < N; i++) {
    const c = comp[i];
    const removed = isBg[i] || (c !== -1 && kill[c]);
    if (!removed) continue;
    if (debug) {
      rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
    } else {
      rgba[i * 4 + 3] = 0;
    }
  }
  return { bgCount, nComp, textComps, mainSize: best };
}

function collect(target) {
  const st = statSync(target);
  if (st.isFile()) return target.toLowerCase().endsWith(".png") ? [target] : [];
  const out = [];
  for (const e of readdirSync(target)) {
    if (e.startsWith(".")) continue;
    out.push(...collect(join(target, e)));
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const target = args[0];
  if (!target) {
    console.error("usage: node scripts/sprites/process.mjs <file-or-dir> [--out <suffix>]");
    process.exit(2);
  }
  const outIdx = args.indexOf("--out");
  const suffix = outIdx >= 0 ? args[outIdx + 1] : null;
  const files = collect(target);
  if (files.length === 0) {
    console.error(`no PNGs under ${target}`);
    process.exit(1);
  }
  for (const f of files) {
    const img = decodePng(readFileSync(f));
    const stats = processImage(img);
    let { width, height, rgba } = img;
    // CROP="x,y,w,h,scale" — inspect a region at pixel level (nearest upscale).
    if (process.env.CROP) {
      const [cx, cy, cw, ch, cs] = process.env.CROP.split(",").map(Number);
      const out = Buffer.alloc(cw * cs * ch * cs * 4);
      for (let y = 0; y < ch * cs; y++) {
        for (let x = 0; x < cw * cs; x++) {
          const sx = cx + ((x / cs) | 0), sy = cy + ((y / cs) | 0);
          const si = (sy * width + sx) * 4, di = (y * cw * cs + x) * 4;
          out[di] = rgba[si]; out[di + 1] = rgba[si + 1];
          out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
        }
      }
      width = cw * cs; height = ch * cs; rgba = out;
    }
    const dest = suffix
      ? join(dirname(f), basename(f, extname(f)) + suffix + ".png")
      : f;
    writeFileSync(dest, encodePng(width, height, rgba));
    const pct = ((stats.bgCount / (img.width * img.height)) * 100).toFixed(0);
    console.log(
      `${f}  →  ${dest}  [bg ${pct}%, ${stats.nComp} comps, killed ${stats.textComps} text, figure ${stats.mainSize}px]`,
    );
  }
}

main();
