// Shared helpers for the Tokós clinic build scripts (tools/tokos-build-*.mjs). Node only, never shipped.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET with an optional byte range. Retries on 429 and 5xx, honouring retry-after (Zenodo rate-limits at
// about 133 requests a minute). Returns the response headers too.
export async function request(url, start, end) {
  for (let attempt = 0; attempt < 8; attempt++) {
    // Zenodo answers 403 to Node's default user agent, so send a named one.
    const headers = { "User-Agent": "StewardMD-tokos-build/1.0 (dataset preparation)" };
    if (start != null) headers.Range = "bytes=" + start + "-" + end;
    const r = await fetch(url, { headers });
    if (r.status === 429 || r.status >= 500) {
      await r.arrayBuffer().catch(() => {});
      await sleep(Math.min(70, Math.max(2, +(r.headers.get("retry-after") || 5))) * 1000);
      continue;
    }
    if (!r.ok) throw new Error(url + " " + r.status);
    return { headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
  }
  throw new Error("gave up after retries: " + url);
}
export const fetchRange = async (url, start, end) => (await request(url, start, end)).buf;

// Reads members of a remote zip with HTTP range requests, so a 2 GB archive is never downloaded whole.
// Supports plain (non-zip64) archives with stored or deflated members, which both datasets use.
export async function openHttpZip(url) {
  const head = await request(url, 0, 0);
  const total = +(head.headers.get("content-range") || "").split("/")[1];
  if (!total) throw new Error("server did not answer the range request for " + url);
  const tailLen = Math.min(total, 70000);
  const tail = await fetchRange(url, total - tailLen, total - 1);
  const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0) throw new Error("no end-of-central-directory record");
  const count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  if (cdOff === 0xffffffff || count === 0xffff) throw new Error("zip64 archives are not supported");
  const cd = await fetchRange(url, cdOff, cdOff + cdSize - 1);
  const entries = [];
  for (let p = 0; entries.length < count; ) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry at " + p);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.toString("utf8", p + 46, p + 46 + nameLen), method: cd.readUInt16LE(p + 10),
      compSize: cd.readUInt32LE(p + 20), size: cd.readUInt32LE(p + 24), offset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  async function read(entry) {
    // 30-byte local header + name + extra (unknown length here, so over-read by 2 KB of slack).
    const buf = await fetchRange(url, entry.offset, entry.offset + 30 + 512 + 2048 + entry.compSize);
    const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
    const data = buf.subarray(start, start + entry.compSize);
    return entry.method === 0 ? Buffer.from(data) : inflateRawSync(data);
  }
  return { entries, read };
}

// Runs fn over items, n at a time, keeping order.
export async function pool(items, fn, n = 4) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); } }));
  return out;
}

// Deterministic sample: an even spread over a list (no randomness, so a rerun picks the same files).
export function evenPick(list, n) {
  if (list.length <= n) return list.slice();
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

export const MAX_WEBP_BYTES = 40 * 1024;

// cwebp: shrink the long side to maxSide, then lower the quality (and, as a last resort, the size) until the
// file is at most limit bytes. mask = {x, y, w, h} as fractions blacks out a rectangle first (ffmpeg drawbox),
// used to hide the scanner's on-screen preset text, which can name the answer ("Cardiac", "qCERVIX").
export function toWebp(srcFile, outFile, { maxSide = 640, limit = MAX_WEBP_BYTES - 1024, mask = null } = {}) {
  mkdirSync(dirname(outFile), { recursive: true });
  let src = srcFile;
  if (mask) {
    src = outFile + ".masked.png";
    const f = (v) => String(v);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", srcFile, "-vf",
      "drawbox=x=iw*" + f(mask.x) + ":y=ih*" + f(mask.y) + ":w=iw*" + f(mask.w) + ":h=ih*" + f(mask.h) + ":color=black:t=fill", src]);
  }
  const dims = imageSize(src);
  let side = maxSide;
  for (let q = 80; ; ) {
    const s = Math.min(1, side / Math.max(dims.w, dims.h));
    const w = Math.max(1, Math.round(dims.w * s)), h = Math.max(1, Math.round(dims.h * s));
    execFileSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", "-resize", String(w), String(h), src, "-o", outFile]);
    const bytes = statSync(outFile).size;
    if (bytes <= limit) { if (mask) rmSync(src); return { bytes, w, h, quality: q }; }
    if (q > 40) q -= 10;
    else if (side > 160) side = Math.round(side * 0.85);
    else throw new Error("cannot get " + srcFile + " under " + limit + " bytes");
  }
}

// PNG and JPEG dimensions from the file header, so no image library is needed.
export function imageSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let p = 2; p < b.length; ) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
      p += 2 + b.readUInt16BE(p + 2);
    }
  }
  throw new Error("unsupported image: " + file);
}

// Adds or replaces credit entries (keyed by dataset id) without touching the other keys.
export function mergeCredits(file, entries) {
  const cur = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  writeFileSync(file, JSON.stringify(Object.assign(cur, entries), null, 2) + "\n");
}

// 8-bit grayscale pixels of any image ffmpeg can read (row-major, w*h bytes). Used to read HC18 annotation masks.
export function grayPixels(file) {
  const { w, h } = imageSize(file);
  const data = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: w * h * 2 });
  if (data.length !== w * h) throw new Error("unexpected raw size for " + file);
  return { w, h, data };
}
