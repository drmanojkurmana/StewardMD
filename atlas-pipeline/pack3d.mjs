#!/usr/bin/env node
/* pack3d.mjs — mesh packer for the RadioAnatome 3D layer (meshoptimizer, MIT).
 *
 * Two jobs, one binary layout (the one bp3d_import.py writes: f32 positions, i16 normals,
 * u16 part index, u32 indices, 4-byte aligned, gzip per chunk):
 *
 *   live   pack the living-CT meshes from live3d.py: simplify each surface to ~30% with a
 *          0.5% relative error bound, compute smooth vertex normals, write live-N.bin.gz and
 *          live.json (parts + chunks) for bp3d_import.py to merge.
 *   lod    read the shipped BodyParts3D chunks from manifest.json and write a mobile LOD set
 *          (<system>-N.lo.bin.gz, ~40% of the triangles, 0.4% error bound) + lod.json.
 *
 * Usage:  node pack3d.mjs live --in work/live3d --out atlas/3d --base 2227
 *         node pack3d.mjs lod  --out atlas/3d
 * meshoptimizer is resolved from MESHOPT_DIR (a directory with node_modules/meshoptimizer).
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "..");
const OUT = path.resolve(opt("out", path.join(REPO, "atlas", "3d")));
const MESHOPT_DIR = process.env.MESHOPT_DIR || REPO;
const req = createRequire(path.join(MESHOPT_DIR, "package.json"));
const { MeshoptSimplifier } = await import(req.resolve("meshoptimizer"));
await MeshoptSimplifier.ready;

const CHUNK_LIMIT = 4_000_000;

function smoothNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;   // area-weighted
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  const out = new Int16Array(pos.length);
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    out[i] = Math.round(n[i] / l * 32767); out[i + 1] = Math.round(n[i + 1] / l * 32767); out[i + 2] = Math.round(n[i + 2] / l * 32767);
  }
  return out;
}

function simplify(pos, idx, ratio, error, floor = 96) {
  const target = Math.max(floor, Math.floor(idx.length * ratio / 3) * 3);
  const [simplified, err] = MeshoptSimplifier.simplify(idx, pos, 3, Math.min(idx.length, target), error);
  const [remap, count] = MeshoptSimplifier.compactMesh(simplified);
  const p = new Float32Array(count * 3);
  for (let old = 0; old < remap.length; old++) { const nw = remap[old]; if (nw === 0xffffffff) continue; p.set(pos.subarray(old * 3, old * 3 + 3), nw * 3); }
  return { pos: p, idx: simplified, err };
}

class Packer {
  constructor(prefix, suffix = ".bin.gz") { this.prefix = prefix; this.suffix = suffix; this.chunks = []; this.files = {}; this.cur = null; this.n = 0; }
  need(vc, ic) { return vc * 20 + ic * 4; }
  begin(system) { this.cur = { name: `${this.prefix}${system ? system + "-" : ""}${this.n++}`, system, pos: [], nrm: [], pid: [], idx: [], v: 0, bytes: 0 }; }
  add(system, pid, pos, nrm, idx) {
    const need = this.need(pos.length / 3, idx.length);
    if (this.cur && (this.cur.bytes + need > CHUNK_LIMIT || this.cur.system !== system)) this.flush();
    if (!this.cur) this.begin(system);
    const base = this.cur.v, vc = pos.length / 3;
    this.cur.pos.push(pos); this.cur.nrm.push(nrm);
    const pids = new Uint16Array(vc).fill(pid); this.cur.pid.push(pids);
    const rebased = new Uint32Array(idx.length); for (let i = 0; i < idx.length; i++) rebased[i] = base + idx[i];
    const iStart = this.cur.idx.reduce((s, a) => s + a.length, 0);
    this.cur.idx.push(rebased); this.cur.v += vc; this.cur.bytes += need;
    return { chunk: this.chunks.length, iStart, iCount: idx.length };
  }
  flush() {
    const c = this.cur; if (!c || !c.v) { this.cur = null; return; }
    const cat = (arrs, T) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new T(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
    const parts = [["pos", cat(c.pos, Float32Array)], ["nrm", cat(c.nrm, Int16Array)], ["pid", cat(c.pid, Uint16Array)], ["idx", cat(c.idx, Uint32Array)]];
    const bufs = [], offs = {}; let len = 0;
    for (const [k, a] of parts) { const pad = (4 - len % 4) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); len += pad; } offs[k] = len; const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength); bufs.push(b); len += b.length; }
    const raw = Buffer.concat(bufs), gz = gzipSync(raw, { level: 9 });
    const name = c.name + this.suffix;
    this.files[name] = gz;
    this.chunks.push({ id: c.name, url: `/atlas/3d/${name}`, system: c.system, bytes: raw.length, gz: gz.length, sha256: createHash("sha256").update(gz).digest("hex"), v: c.v, i: parts[3][1].length, ...offs });
    this.cur = null;
  }
  write() { fs.mkdirSync(OUT, { recursive: true }); for (const [n, b] of Object.entries(this.files)) fs.writeFileSync(path.join(OUT, n), b); }
}

if (mode === "live") {
  const IN = path.resolve(opt("in", path.join(HERE, "work", "live3d")));
  const base = +opt("base", 0);
  const meta = JSON.parse(fs.readFileSync(path.join(IN, "live3d.json"), "utf8"));
  const bin = fs.readFileSync(path.join(IN, "parts.bin"));
  const packer = new Packer("live-");
  const parts = [];
  let srcTris = 0, tris = 0, maxErr = 0;
  // group by system so a chunk never mixes systems (the viewer colours per chunk)
  const order = [...meta.parts].sort((a, b) => a.system.localeCompare(b.system) || a.id.localeCompare(b.id));
  for (const p of order) {
    const pos0 = new Float32Array(bin.buffer.slice(bin.byteOffset + p.pos, bin.byteOffset + p.pos + p.nv * 12));
    const idx0 = new Uint32Array(bin.buffer.slice(bin.byteOffset + p.idx, bin.byteOffset + p.idx + p.ni * 4));
    srcTris += idx0.length / 3;
    const s = simplify(pos0, idx0, +opt("ratio", 0.28), +opt("error", 0.008));
    maxErr = Math.max(maxErr, s.err); tris += s.idx.length / 3;
    const nrm = smoothNormals(s.pos, s.idx);
    const gi = base + parts.length;
    if (gi > 65535) throw new Error("part index overflow");
    const loc = packer.add(p.system, gi, s.pos, nrm, s.idx);
    parts.push({ id: p.id, name: p.name, stem: p.stem, sid: p.sid, canon: p.canon, side: p.side, system: p.system, region: p.region, bounds: p.bounds.map((v) => +v.toFixed(5)), ...loc, tris: s.idx.length / 3 });
  }
  packer.flush(); packer.write();
  fs.writeFileSync(path.join(OUT, "live.json"), JSON.stringify({ frame: meta.frame, source: meta.source, planes: meta.planes, parts, chunks: packer.chunks, stats: { parts: parts.length, sourceTriangles: srcTris, triangles: tris, maxError: maxErr, gz: packer.chunks.reduce((s, c) => s + c.gz, 0) } }));
  console.log(JSON.stringify({ parts: parts.length, sourceTriangles: srcTris, triangles: tris, maxError: +maxErr.toFixed(4), chunks: packer.chunks.length, gzMB: +(packer.chunks.reduce((s, c) => s + c.gz, 0) / 1e6).toFixed(1) }));
} else if (mode === "lod") {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const ratio = +opt("ratio", 0.4), error = +opt("error", 0.004);
  const packer = new Packer("", ".lo.bin.gz");
  let tris = 0, src = 0;
  const bySystem = new Map();
  manifest.parts.forEach((p, i) => { if (p[10] === 1) return; const c = manifest.chunks[p[5]]; (bySystem.get(c.system) ?? bySystem.set(c.system, []).get(c.system)).push(i); });
  const raws = new Map();
  const raw = (ci) => { if (!raws.has(ci)) { const c = manifest.chunks[ci]; raws.set(ci, gunzipSync(fs.readFileSync(path.join(OUT, c.url.split("/").pop())))); } return raws.get(ci); };
  const partsLo = new Array(manifest.parts.length).fill(null);
  for (const [system, idxs] of bySystem) {
    for (const i of idxs) {
      const p = manifest.parts[i], c = manifest.chunks[p[5]], buf = raw(p[5]);
      const idxAll = new Uint32Array(buf.buffer, buf.byteOffset + c.idx, c.i);
      const posAll = new Float32Array(buf.buffer, buf.byteOffset + c.pos, c.v * 3);
      const sub = idxAll.subarray(p[6], p[6] + p[7]);
      // extract this part's vertices
      let lo = Infinity, hi = -1; for (const v of sub) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const pos = posAll.slice(lo * 3, (hi + 1) * 3);
      const idx = new Uint32Array(sub.length); for (let k = 0; k < sub.length; k++) idx[k] = sub[k] - lo;
      src += idx.length / 3;
      const s = simplify(pos, idx, ratio, error, 48);
      tris += s.idx.length / 3;
      const nrm = smoothNormals(s.pos, s.idx);
      const loc = packer.add(system, i, s.pos, nrm, s.idx);
      partsLo[i] = [loc.chunk, loc.iStart, loc.iCount];
    }
    packer.flush();
  }
  packer.write();
  fs.writeFileSync(path.join(OUT, "lod.json"), JSON.stringify({ ratio, error, chunks: packer.chunks, parts: partsLo, stats: { sourceTriangles: src, triangles: tris, gz: packer.chunks.reduce((s, c) => s + c.gz, 0) } }));
  console.log(JSON.stringify({ sourceTriangles: src, triangles: tris, chunks: packer.chunks.length, gzMB: +(packer.chunks.reduce((s, c) => s + c.gz, 0) / 1e6).toFixed(1) }));
} else {
  console.error("usage: pack3d.mjs live|lod ..."); process.exit(2);
}
