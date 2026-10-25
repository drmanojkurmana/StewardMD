#!/usr/bin/env node
// tools/kardia-us-png.mjs — render Kardia CPU ultrasound path to PNG.
// Usage: node tools/kardia-us-png.mjs <view> [out.png] [--side]
//   view: PLAX | A4C | PSAX-papillary | subcostal-4C | tte_* id | A2C...
// Renders snapshot() CPU grid at 640x480 (sector mask included), writes
// <out> and, with --side (default), <out-base>-side.png next to ref frame.
// Minimal PNG encoder/decoder (zlib only, no npm packages).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- minimal PNG ---------- */
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; rgba.copy ? rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4) : Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not png");
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 6, interlace = 0; const idats = []; let palette = null, trns = null;
  while (off < buf.length) { const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "PLTE") palette = data; else if (type === "tRNS") trns = data; else if (type === "IDAT") idats.push(data); else if (type === "IEND") break;
    off += 12 + len; }
  if (interlace) throw new Error("interlaced png unsupported");
  const raw = inflateSync(Buffer.concat(idats));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]; if (!ch) throw new Error("colorType " + colorType);
  const bpp = ch * (bitDepth / 8), stride = w * bpp;
  const out = Buffer.alloc(w * h * 4), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  let p = 0;
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) { const f = raw[p++]; raw.copy(cur, 0, p, p + stride); p += stride;
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) cur[i] = (cur[i] + a) & 255; else if (f === 2) cur[i] = (cur[i] + b) & 255; else if (f === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255; else if (f === 4) cur[i] = (cur[i] + paeth(a, b, c)) & 255; }
    cur.copy(prev);
    for (let x = 0; x < w; x++) { const s = x * bpp, d = (y * w + x) * 4;
      if (colorType === 6) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = bitDepth === 16 ? cur[s + 6] : cur[s + 3]; }
      else if (colorType === 2) { out[d] = cur[s]; out[d + 1] = cur[s + (bitDepth === 16 ? 2 : 1)]; out[d + 2] = cur[s + (bitDepth === 16 ? 4 : 2)]; out[d + 3] = 255; }
      else if (colorType === 0) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = 255; }
      else if (colorType === 4) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = cur[s + (bitDepth === 16 ? 2 : 1)]; }
      else if (colorType === 3) { const idx = cur[s] * 3; out[d] = palette[idx]; out[d + 1] = palette[idx + 1]; out[d + 2] = palette[idx + 2]; out[d + 3] = trns && cur[s] < trns.length ? trns[cur[s]] : 255; } } }
  return { w, h, data: out };
}
function resizeBilinear(img, W, H) { const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = (x + 0.5) * img.w / W - 0.5, sy = (y + 0.5) * img.h / H - 0.5;
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1), fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
    for (let c = 0; c < 4; c++) { const v = (img.data[(y0 * img.w + x0) * 4 + c] * (1 - fx) + img.data[(y0 * img.w + x1) * 4 + c] * fx) * (1 - fy) + (img.data[(y1 * img.w + x0) * 4 + c] * (1 - fx) + img.data[(y1 * img.w + x1) * 4 + c] * fx) * fy; out[(y * W + x) * 4 + c] = Math.round(v); } }
  return { w: W, h: H, data: out }; }

/* ---------- render via snapshot() CPU path ---------- */
const VIEWMAP = {
  "PLAX": ["tte_plax", "tte-plax-1.png"], "A4C": ["tte_a4c", "tte-a4c-1.png"],
  "A2C": ["tte_a2c", "tte-a2c-1.png"], "A3C": ["tte_a3c", "tte-a3c-1.png"],
  "PSAX-papillary": ["tte_psax_papillary", "tte-psax-papillary-1.png"], "PSAX-AV": ["tte_psax_av", "tte-psax-av-1.png"],
  "subcostal-4C": ["tte_subcostal_4c", "tte-subcostal-4c-1.png"], "IVC": ["tte_subcostal_ivc", "tte-subcostal-ivc-1.png"],
};
export function resolveView(name) {
  if (VIEWMAP[name]) return { viewId: VIEWMAP[name][0], ref: VIEWMAP[name][1] };
  for (const k of Object.keys(VIEWMAP)) if (VIEWMAP[k][0] === name) return { viewId: name, ref: VIEWMAP[k][1] };
  // case-insensitive alias
  for (const k of Object.keys(VIEWMAP)) if (k.toLowerCase() === String(name).toLowerCase()) return { viewId: VIEWMAP[k][0], ref: VIEWMAP[k][1] };
  return { viewId: name, ref: null };
}
function mockCanvas(w, h) { const c = { width: w, height: h, style: {}, _img: null, addEventListener() {},
  getContext(k) { if (k !== "2d") return null; return { createImageData: (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }), putImageData(img) { c._img = img; }, fillStyle: "", beginPath() {}, arc() {}, fill() {} }; } }; return c; }

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--side");
  const name = args[0]; if (!name) { console.error("usage: node tools/kardia-us-png.mjs <view> [out.png]"); process.exit(2); }
  const { viewId, ref } = resolveView(name);
  const outPath = args[1] ? path.resolve(args[1]) : path.join(root, "work/shots", `cpu-${name}-640.png`);
  const HEART = require(path.join(root, "kardia-sim-heart.js"));
  const GEOM = require(path.join(root, "kardia-sim-geom.js"));
  const US = require(path.join(root, "kardia-sim-us.js"));
  const views = JSON.parse(readFileSync(path.join(root, "kardia/views.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(root, "atlas/3d/manifest.json"), "utf8"));
  const heart = HEART.create(HEART.presets.normal);
  for (let t = 0; t < 12000; t += 10) heart.step(10);
  const geom = GEOM.create({ heart, views });
  geom.ingestManifest(manifest);
  const loadLod = (id) => { const c = manifest.lod.chunks.find((x) => x.id === id); const raw = gunzipSync(readFileSync(path.join(root, "atlas/3d", id + ".lo.bin.gz"))); return geom.ingestChunk(c, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };
  loadLod("cardiac-6"); loadLod("skeletal-0"); loadLod("skeletal-1");
  const live = JSON.parse(readFileSync(path.join(root, "atlas/3d/live.json"), "utf8"));
  for (const sys of ["respiratory", "digestive"]) { const c = live.chunks.find((x) => x.system === sys); const raw = gunzipSync(readFileSync(path.join(root, "atlas/3d", c.url.split("/").pop()))); geom.ingestChunk(c, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); }
  const W = 640, H = 480;
  const canvas = mockCanvas(290, 232);
  const us = US.create(canvas, geom, heart);
  us.setProbe({ viewId });
  us.frame(1000);
  const snap = us.snapshot({ includeGrid: true, gridW: W, gridH: H });
  if (!snap.grid) throw new Error("no grid; errors=" + us.errors.join(";"));
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = snap.grid.data[i]; rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
  writeFileSync(outPath, encodePNG(W, H, rgba));
  console.log(JSON.stringify({ view: name, viewId, out: outPath, regions: snap.regions, blockiness: snap.blockiness, autocorr: snap.autocorrelation }));
  if (ref) {
    try { const refImg = resizeBilinear(decodePNG(readFileSync(path.join(root, "work/ref", ref))), W, H);
      const side = Buffer.alloc(W * 2 * H * 4);
      for (let y = 0; y < H; y++) { rgba.copy(side, (y * W * 2) * 4, (y * W) * 4, (y * W + W) * 4); refImg.data.copy(side, (y * W * 2 + W) * 4, (y * W) * 4, (y * W + W) * 4); }
      const sidePath = outPath.replace(/\.png$/, "-side.png");
      writeFileSync(sidePath, encodePNG(W * 2, H, side)); console.log(JSON.stringify({ side: sidePath, ref })); }
    catch (e) { console.error("side-by-side failed: " + e.message); }
  }
  us.destroy();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
