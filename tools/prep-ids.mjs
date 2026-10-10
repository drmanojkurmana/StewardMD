#!/usr/bin/env node
/* PrepNucleus share IDs: derive, check and publish the global ID index (prep-ids.js has the format and the reasons).
 *
 *   node tools/prep-ids.mjs fetch     download the LIVE content (bank modules of every subject at its bank version,
 *                                     overlay sets, the PYQ items, the lesson index) into the cache
 *   node tools/prep-ids.mjs build     derive every ID, resolve collisions, keep withdrawn IDs as tombstones (from the
 *                                     published index), write index.json + the changed shards to --out
 *   node tools/prep-ids.mjs verify    read the PUBLISHED index over the API and check every live item and lesson
 *                                     resolves to where it lives, and no withdrawn ID was dropped (exit 1 otherwise)
 *   node tools/prep-ids.mjs publish   fetch + build + upload (tools/prep-upload-bank.mjs --as v1/ids) + verify
 *
 * Options: --cache <dir> (default ~/prep-data/ids/cache, outside git: module files carry question text), --out <dir>
 * (default ~/prep-data/ids/out), --api <base> (default https://stewardmd.in/api/prep/bank/), --prev none (build as if
 * nothing was published yet), --yes (publish: really upload). Run `publish --yes` after every bank, overlay, PYQ or
 * lesson release: IDs never change (they follow the immutable item ids), only the index needs the new items.
 * The index holds IDs and where they live (subject/module, "p", lesson key, "x"); never question text.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ID = createRequire(import.meta.url)(path.join(ROOT, "prep-ids.js"));
export const IDS_VER = "v1";

/* ---------- what is live (read from the repo, as the app reads it) ---------- */
// The subjects and their bank versions (taxonomy `bv`, else the app's main version VER in prep.js).
export function appConfig(root = ROOT) {
  const src = fs.readFileSync(path.join(root, "prep.js"), "utf8");
  const ver = /VER = G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(src)[1];
  const pyq = /PYQ_VER = G\.SMD_PREP_PYQ_VER \|\| "(v\d+)"/.exec(src)[1];
  const ov = /var OVERLAYS = G\.SMD_PREP_OVERLAYS \|\| (\{[^\n]*\});/.exec(src)[1];
  const overlays = new Function("return " + ov)();
  const pubIdx = path.join(process.env.HOME || "", "prep-data/qgen/publish/maik/index.json");
  if (fs.existsSync(pubIdx)) {
    try {
      const extra = JSON.parse(fs.readFileSync(pubIdx, "utf8")).sets;
      if (extra && typeof extra === "object") {
        for (const [sid, list] of Object.entries(extra)) {
          const cur = overlays[sid] || (overlays[sid] = []);
          for (const s of list) if (!cur.includes(s)) cur.push(s);
        }
      }
    } catch (_) {}
  }
  const tax = JSON.parse(fs.readFileSync(path.join(root, "prep/taxonomy.json"), "utf8"));
  const subjects = [];
  for (const b of tax.branches) for (const s of b.subjects) subjects.push({ id: s.id, bv: s.bv || ver });
  return { ver, pyq, overlays, subjects };
}
export function subjectIndex(sid, bv, root = ROOT) {
  const p = path.join(root, "prep/bank", bv, sid, "index.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { topics: [] };
}

/* ---------- fetch ---------- */
async function getJSON(url) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(url + " HTTP " + r.status);
      return await r.json();
    } catch (e) { if (t >= 4) throw e; await new Promise((res) => setTimeout(res, 1500 * t)); }
  }
}
async function pool(list, n, fn) {
  let i = 0; const out = new Array(list.length);
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } }));
  return out;
}
/* The files to read: every module of every subject at its bank version, the overlay files the app asks for, the PYQ
   index and items file, the lesson index. Module files under the main version are re-read when the live manifest's
   stamp for the subject changes (they are patched in place on a respell); everything else is immutable by path. */
export async function fetchLive({ api, cache, log = console.log }) {
  const cfg = appConfig();
  fs.mkdirSync(cache, { recursive: true });
  const man = await getJSON(api + cfg.ver + "/manifest.json");
  const stamps = {}; for (const s of (man && man.subjects) || []) stamps[s.id] = s.bytes + "." + (s.items || 0);
  const metaP = path.join(cache, "stamps.json");
  const old = fs.existsSync(metaP) ? JSON.parse(fs.readFileSync(metaP, "utf8")) : {};
  for (const sid of Object.keys(stamps)) if (old[sid] && old[sid] !== stamps[sid]) fs.rmSync(path.join(cache, cfg.ver, sid), { recursive: true, force: true });
  const ovc = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/bank/overlay-counts.json"), "utf8")).sets || {};
  const want = [];
  for (const s of cfg.subjects) {
    for (const t of subjectIndex(s.id, s.bv).topics || []) want.push(`${s.bv}/${s.id}/mcq/${t.id}.json`);
    for (const set of cfg.overlays[s.id] || []) {
      const mods = ovc[set] && ovc[set][s.id] ? Object.keys(ovc[set][s.id]) : (subjectIndex(s.id, s.bv).topics || []).map((t) => t.id);
      for (const m of mods) want.push(`overlay/${set}/${s.id}/${m}.json`);
    }
  }
  let got = 0, miss = 0, fetched = 0;
  await pool(want, 12, async (p) => {
    const f = path.join(cache, p);
    if (fs.existsSync(f)) { got++; return; }
    const j = await getJSON(api + p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(j ? { items: (j.items || []).map((it) => ({ id: it.id, flags: it.flags })) } : { missing: 1 }));
    if (j) { fetched++; got++; } else miss++;
    if ((fetched + miss) % 200 === 0) log(`  ${fetched + miss} fetched`);
  });
  fs.writeFileSync(metaP, JSON.stringify(stamps));
  // Always fresh: the PYQ index names its items file; the lesson index lists the lessons.
  const pyqIx = await getJSON(api + cfg.pyq + "/pyq/index.json");
  const pyqF = path.join(cache, cfg.pyq, "pyq", pyqIx.file);
  if (!fs.existsSync(pyqF)) { const j = await getJSON(api + cfg.pyq + "/pyq/" + pyqIx.file); fs.mkdirSync(path.dirname(pyqF), { recursive: true }); fs.writeFileSync(pyqF, JSON.stringify({ items: (j.items || []).map((it) => ({ id: it.id, flags: it.flags })) })); }
  fs.writeFileSync(path.join(cache, "pyq-index.json"), JSON.stringify({ file: pyqIx.file }));
  const les = await getJSON(api + "v1/lessons/index.json");
  fs.writeFileSync(path.join(cache, "lessons-index.json"), JSON.stringify(les));
  log(`fetch: ${want.length} module/overlay paths (${got} present, ${miss} not published), PYQ ${pyqIx.file}, ${Object.keys(les.modules || {}).length} bank lessons`);
}

/* ---------- collect: every live MCQ and lesson with where it lives ---------- */
/* -> { q: [{ key, loc }], l: [{ key, loc }], dup } in the order that decides a duplicate's home: subjects in taxonomy
   order, a subject's own modules before its "mixed" ones, bank before overlay, then PYQ. dup counts item ids met again
   (the same question in a second place keeps its first home and its one ID). */
export function collect(cache, root = ROOT) {
  const cfg = appConfig(root), seen = new Map(), q = [], l = [];
  let dup = 0;
  const read = (p) => { const f = path.join(cache, p); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
  const add = (id, loc) => { if (!id) return; if (seen.has(id)) { dup++; return; } seen.set(id, loc); q.push({ key: String(id), loc }); };
  for (const s of cfg.subjects) {
    const topics = (subjectIndex(s.id, s.bv, root).topics || []).slice().sort((a, b) => (a.group === "mixed") - (b.group === "mixed"));
    for (const t of topics) {
      const loc = `m:${s.id}/${t.id}`, f = read(`${s.bv}/${s.id}/mcq/${t.id}.json`);
      for (const it of (f && f.items) || []) add(it.id, loc);
      for (const set of cfg.overlays[s.id] || []) { const o = read(`overlay/${set}/${s.id}/${t.id}.json`); for (const it of (o && o.items) || []) add(it.id, loc); }
    }
  }
  const pf = read("pyq-index.json");
  const py = pf && read(`${cfg.pyq}/pyq/${pf.file}`);
  for (const it of (py && py.items) || []) add(it.id, "p");
  // Lessons: the bundled index (prep/lessons/v1/index.json) and the bank index, as the app merges them (prep-lessons.js).
  const app = JSON.parse(fs.readFileSync(path.join(root, "prep/lessons/v1/index.json"), "utf8")).modules || {};
  const bank = (read("lessons-index.json") || {}).modules || {};
  const keys = Array.from(new Set(Object.keys(bank).concat(Object.keys(app)))).sort();
  for (const k of keys) l.push({ key: k, loc: "l:" + k });
  return { q, l, dup };
}

/* ---------- assign IDs ---------- */
/* assign(entries, prev, idFn) -> { ids: Map(fullId -> loc), xt: { "q:key": 1 }, long, errors }
   entries: [{ type: "Q"|"L", key, loc }]. prev: the published index as { e: { id: loc }, xt } (or empty).
   A short ID shared by two keys: the key that already held it in prev keeps it, else the smallest key; every other key
   takes the long form. A key in prev.xt keeps the long form for good. idFn(type, key, long) defaults to the real one
   (tests pass a weak one to force collisions). */
export function assign(entries, prev = { e: {}, xt: {} }, idFn = ID.idFor) {
  const xt = Object.assign({}, prev.xt || {}), errors = [], byShort = new Map();
  for (const en of entries) {
    const short = idFn(en.type, en.key, false);
    if (!byShort.has(short)) byShort.set(short, []);
    byShort.get(short).push(en);
  }
  const prevE = prev.e || {};
  for (const [short, list] of byShort) {
    const keys = Array.from(new Set(list.map((x) => x.key)));
    if (keys.length < 2) continue;
    // The short ID's owner: the key it already resolved to (same type, published before), else the smallest key.
    let owner = null;
    if (prevE[short] && prevE[short] !== "x") for (const en of list) if (!xt[en.type.toLowerCase() + ":" + en.key] && en.loc === prevE[short] && !owner) owner = en.key;
    if (!owner) owner = keys.slice().sort()[0];
    for (const en of list) if (en.key !== owner) xt[en.type.toLowerCase() + ":" + en.key] = 1;
  }
  const ids = new Map();
  let long = 0;
  for (const en of entries) {
    const isLong = !!xt[en.type.toLowerCase() + ":" + en.key], id = idFn(en.type, en.key, isLong);
    if (isLong) long++;
    if (ids.has(id) && ids.get(id) !== en.loc) errors.push(`collision ${id}: ${en.key}`);
    ids.set(id, en.loc);
  }
  for (const id of ids.keys()) { const n = ID.norm(id); if (!n.ok || n.id !== id) errors.push(`format ${id}`); }
  return { ids, xt, long, errors };
}
/* shards(ids, tomb) -> { files: [{ n, name, body }], pointer }. tomb: ids withdrawn (kept as "x" for good). */
export function shards(ids, tomb, meta) {
  const by = Array.from({ length: ID.SHARDS }, () => ({}));
  const all = new Map(ids); for (const id of tomb) if (!all.has(id)) all.set(id, "x");
  for (const id of Array.from(all.keys()).sort()) by[ID.shardOf(id)][id] = all.get(id);
  const files = by.map((e, n) => {
    const body = JSON.stringify({ v: 1, k: ID.shardKey(n), e });
    const h = createHash("sha256").update(body).digest("hex").slice(0, 6);
    return { n, name: ID.shardFile(n, h), h, body };
  });
  const pointer = Object.assign({ v: 1 }, meta, { s: files.map((f) => f.h).join("") });
  return { files, pointer };
}

/* ---------- the published index ---------- */
export async function readPublished(api) {
  const ptr = await getJSON(api + IDS_VER + "/ids/index.json");
  if (!ptr) return null;
  const e = {};
  await pool(ID.shardNames(ptr), 12, async (name) => {
    const j = await getJSON(api + IDS_VER + "/ids/" + name);
    if (!j) throw new Error("published shard missing: " + name);
    const body = JSON.stringify(j), h = createHash("sha256").update(body).digest("hex").slice(0, 6);
    if (name.slice(3, 9) !== h) throw new Error(`shard ${name}: content hash ${h} does not match its name`);
    Object.assign(e, j.e);
  });
  return { ptr, e, xt: ptr.xt || {} };
}

export function build({ cache, prev }) {
  const c = collect(cache);
  const entries = c.q.map((x) => ({ type: "Q", key: x.key, loc: x.loc })).concat(c.l.map((x) => ({ type: "L", key: x.key, loc: x.loc })));
  const a = assign(entries, prev || { e: {}, xt: {} });
  const tomb = [];
  if (prev) for (const id of Object.keys(prev.e)) if (!a.ids.has(id)) tomb.push(id);
  const meta = { gen: new Date().toISOString().slice(0, 10), q: c.q.length, l: c.l.length, n: a.ids.size, x: tomb.length, xt: a.xt };
  return Object.assign({ c, a, tomb }, shards(a.ids, tomb, meta));
}

/* ---------- verify ---------- */
export async function verify({ api, cache, log = console.log }) {
  const pub = await readPublished(api);
  if (!pub) throw new Error("no published index at " + api + IDS_VER + "/ids/index.json");
  const c = collect(cache), bad = [];
  const check = (type, key, loc) => { const id = ID.idOf(type, key, pub.xt); if (pub.e[id] !== loc) bad.push(`${ID.show(id)} (${type} ${key}): index has ${pub.e[id] || "nothing"}, live is ${loc}`); };
  for (const x of c.q) check("Q", x.key, x.loc);
  for (const x of c.l) check("L", x.key, x.loc);
  const tomb = Object.keys(pub.e).filter((id) => pub.e[id] === "x").length;
  log(`verify: ${c.q.length} MCQs + ${c.l.length} lessons checked against the published index (${Object.keys(pub.e).length} entries, ${tomb} withdrawn, ${Object.keys(pub.xt).length} long IDs): ${bad.length} wrong`);
  for (const b of bad.slice(0, 20)) log("  " + b);
  return bad;
}

/* ---------- cli ---------- */
function upload(dir, yes) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(ROOT, "tools/prep-upload-bank.mjs"), "--dir", dir, "--as", IDS_VER + "/ids", "--jobs", "8"].concat(yes ? ["--yes"] : []), { stdio: "inherit" });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error("upload failed"))));
  });
}
async function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[0];
  const api = arg("--api", "https://stewardmd.in/api/prep/bank/").replace(/\/?$/, "/");
  const cache = path.resolve(arg("--cache", path.join(os.homedir(), "prep-data/ids/cache")));
  const out = path.resolve(arg("--out", path.join(os.homedir(), "prep-data/ids/out")));
  if (cmd === "fetch" || cmd === "publish") await fetchLive({ api, cache });
  if (cmd === "build" || cmd === "publish") {
    const prev = arg("--prev", "live") === "none" ? null : await readPublished(api);
    const b = build({ cache, prev });
    console.log(`build: ${b.c.q.length} MCQs, ${b.c.l.length} lessons, ${b.c.dup} repeated item ids (kept once), ${b.a.ids.size} IDs, ${b.a.long} long, ${b.tomb.length} withdrawn kept, previous index ${prev ? prev.ptr.gen + " (" + Object.keys(prev.e).length + " entries)" : "none"}`);
    if (b.a.errors.length) { for (const e of b.a.errors.slice(0, 20)) console.error("  " + e); throw new Error(b.a.errors.length + " errors"); }
    fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
    const had = new Set(prev ? ID.shardNames(prev.ptr) : []);
    let changed = 0;
    for (const f of b.files) if (!had.has(f.name)) { fs.writeFileSync(path.join(out, f.name), f.body); changed++; }
    fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(b.pointer));
    const bytes = b.files.map((f) => f.body.length);
    console.log(`out: ${out} (${changed} new or changed shards + index.json); shard size ${Math.min(...bytes)}..${Math.max(...bytes)} bytes, index.json ${JSON.stringify(b.pointer).length} bytes`);
  }
  if (cmd === "publish") {
    await upload(out, argv.includes("--yes"));
    if (!argv.includes("--yes")) return;
  }
  if (cmd === "verify" || cmd === "publish") {
    const bad = await verify({ api, cache });
    if (bad.length) process.exit(1);
  }
  if (!["fetch", "build", "verify", "publish"].includes(cmd)) { console.log("usage: node tools/prep-ids.mjs fetch|build|verify|publish [--yes] [--cache dir] [--out dir] [--api base] [--prev none]"); process.exit(2); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
