#!/usr/bin/env node
// PrepNucleus: write an explanation for EVERY question the app serves that has none (owner 2026-11-20: "write
// explanation for all mcqs without explanation in our qbank", "use haiku 5.5"). Dev-only, owner-run. COSTS MONEY.
//
// What it reads (straight from R2 bucket stewardmd-offline, prefix prep-bank/, the files the app actually loads):
//   bank modules   <VER>/<subject>/mcq/*.json   VER = v5, or the subject's bv in prep/taxonomy.json (ss-radiology v16)
//   overlay sets   overlay/<set>/<subject>/*.json for every set in prep.js OVERLAYS and overlay/maik's manifest
//   PYQ            v5/pyq/index.json -> its items file
// A question "has none" when it has no exp text, no x.key and no reason for its key in r. Questions hidden by a flag
// (any flag but exp-pending) are skipped: students never see them.
//
// Model: claude-haiku-5-5 through the Message Batches API (half price), the same prompt, schema and checks as the app's
// /api/prep/explain route (functions/api/prep/explain.js): key line, topic notes, one reason per wrong option, pearl.
// Extra check: the key line must name the stored answer (tools/prep-explain.mjs keyAgrees). A reply that fails gets one
// retry in a second batch; still failing, the question keeps nothing and the app's live route covers it.
// Written items get x (and r when they had none) plus ax: 1, which the app shows as "Explanation written by MaiK AI".
// exp, q, o and a are never touched.
//
// RUN (on the Mac with ~/.stewardmd-secrets/r2-s3.env and ~/.config/stewardmd/anthropic.env):
//   node tools/prep-fill-missing.mjs scan                 download the live files, count, estimate. No model call.
//   node tools/prep-fill-missing.mjs run --max-usd 40     Batch jobs, resumable: re-run the same command to continue
//   node tools/prep-fill-missing.mjs apply                what would change (files, items); no upload
//   node tools/prep-fill-missing.mjs apply --yes          upload the changed files, then the touched bank manifests
//                                                         (subject bytes change, so phones refetch cached modules)
//   node tools/prep-fill-missing.mjs all --max-usd 40 --yes    scan + run + apply in one go
// Options: --work <dir> (default ~/prep-data/fill-missing, outside the repo: bank text is licensed), --limit <n>,
//   --only <path prefix> (e.g. v5/pathology/), --chunk <n> requests a batch (default 10000), --poll-sec 60.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { axBody, toX, readReq, AX_MODEL } from "../functions/api/prep/explain.js";
import { batchCreate, batchGet, batchResults, readMessage, usd } from "../functions/_prep-qgen.js";
import { keyAgrees } from "./prep-explain.mjs";
import { listR2, getR2Object, putR2Object, getR2Config } from "./prep-r2-s3.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "prep-bank/";
const L = ["A", "B", "C", "D", "E", "F"];
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

// ---------------------------------------------------------------------------------------------------------------------
// What the app serves
// ---------------------------------------------------------------------------------------------------------------------
/* liveSets(prepJs, taxonomy, maikSets) -> { ver, bv: {subject: ver}, overlays: Set(set names) } */
export function liveSets(prepJs, taxonomy, maikSets) {
  const ver = (/G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(prepJs) || [, "v5"])[1];
  const bv = {};
  for (const b of (taxonomy && taxonomy.branches) || []) for (const s of b.subjects || []) if (s.bv) bv[s.id] = s.bv;
  const overlays = new Set();
  const m = /var OVERLAYS = G\.SMD_PREP_OVERLAYS \|\| (\{[^\n]*\});/.exec(prepJs);
  if (m) for (const sets of Object.values(JSON.parse(m[1].replace(/([{,]\s*)([a-z][a-z0-9-]*)\s*:/g, '$1"$2":')))) sets.forEach((x) => overlays.add(x));
  for (const sets of Object.values(maikSets || {})) (sets || []).forEach((x) => overlays.add(x));
  return { ver, bv, overlays };
}
/* served(key, live) -> "bank" | "overlay" | "pyq-index" | null for an R2 key under prep-bank/. */
export function served(key, live) {
  const k = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
  let m = /^(v\d+)\/([a-z0-9-]+)\/mcq\/[a-z0-9-]+\.json$/.exec(k);
  if (m) return (live.bv[m[2]] || live.ver) === m[1] ? "bank" : null;
  m = /^overlay\/([a-z0-9-]+)\/[a-z0-9-]+\/[a-z0-9-]+\.json$/.exec(k);
  if (m) return m[1] !== "maik" && live.overlays.has(m[1]) ? "overlay" : null;
  if (k === live.ver + "/pyq/index.json") return "pyq-index";
  return null;
}
/* missing(it) -> true when the app would show no explanation for it. */
export function missing(it) {
  if (!it || typeof it.q !== "string" || !Array.isArray(it.o) || it.o.length < 2 || it.o.length > 6 || !Number.isInteger(it.a) || it.a < 0 || it.a >= it.o.length) return false;
  if (Array.isArray(it.flags) && it.flags.some((f) => f !== "exp-pending")) return false;
  if (String(it.exp || "").trim()) return false;
  if (it.x && typeof it.x.key === "string" && it.x.key.trim()) return false;
  const r = it.r;
  if (Array.isArray(r) && String(r[it.a] || "").trim()) return false;
  if (r && !Array.isArray(r) && String(r[L[it.a]] || r[L[it.a].toLowerCase()] || "").trim()) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// scan: mirror the served files, list the questions without an explanation
// ---------------------------------------------------------------------------------------------------------------------
export async function scan(work, opts = {}, deps = {}) {
  const log = deps.log || console.log, list = deps.listR2 || listR2, get = deps.getR2Object || getR2Object;
  const prepJs = deps.prepJs || fs.readFileSync(path.join(ROOT, "prep.js"), "utf8");
  const tax = deps.taxonomy || readJson(path.join(ROOT, "prep", "taxonomy.json"), {});
  let maikSets = {};
  try {
    const ptr = JSON.parse(String((await get(PREFIX + "overlay/maik/index.json")) || "null"));
    if (ptr && ptr.manifest) { const man = JSON.parse(String((await get(PREFIX + "overlay/maik/" + ptr.manifest)) || "null")); maikSets = (man && man.sets) || ptr.sets || {}; }
    else if (ptr) maikSets = ptr.sets || {};
  } catch (e) { log("overlay/maik index not read: " + e.message); }
  const live = liveSets(prepJs, tax, maikSets);
  log(`live: bank ${live.ver} (${Object.entries(live.bv).map(([s, v]) => s + " " + v).join(", ") || "no per-subject versions"}), ${live.overlays.size} overlay sets`);
  const keys = (await list(PREFIX)).map((o) => o.key);
  const files = [];
  for (const k of keys) {
    const kind = served(k, live);
    if (!kind) continue;
    if (kind === "pyq-index") {
      const ix = JSON.parse(String(await get(k)));
      if (ix && ix.file) files.push({ key: PREFIX + live.ver + "/pyq/" + ix.file, kind: "pyq" });
    } else files.push({ key: k, kind });
  }
  const only = opts.only ? PREFIX + String(opts.only).replace(/^prep-bank\//, "") : "";
  const want = only ? files.filter((f) => f.key.startsWith(only)) : files;
  log(`${want.length} served question files to read`);
  const todo = [];
  let n = 0, items = 0;
  const conc = 12;
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++; if (i >= want.length) return;
      const f = want[i], local = path.join(work, "mirror", f.key);
      let buf = fs.existsSync(local) ? fs.readFileSync(local) : null;
      if (!buf) { buf = await get(f.key); if (!buf) continue; fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, buf); }
      let j; try { j = JSON.parse(String(buf)); } catch (e) { log("not JSON, skipped: " + f.key); continue; }
      const its = (j && j.items) || [];
      items += its.length;
      its.forEach((it, idx) => { if (missing(it)) todo.push({ key: f.key, kind: f.kind, idx, id: it.id || "", q: it.q, o: it.o, a: it.a }); });
      if (++n % 200 === 0) log(`  read ${n} of ${want.length} files`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  todo.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.idx - y.idx));
  const byKind = {};
  for (const t of todo) byKind[t.kind] = (byKind[t.kind] || 0) + 1;
  const est = estimate(todo);
  writeJson(path.join(work, "todo.json"), { at: new Date().toISOString(), live: { ver: live.ver, bv: live.bv }, files: want.length, items, todo });
  log(`scanned ${want.length} files, ${items} questions; WITHOUT an explanation: ${todo.length} ${JSON.stringify(byKind)}`);
  log(`estimate (Haiku 5.5 Batch, one retry for 10%): in ${est.inTok} out ${est.outTok} tokens, about $${est.usd.toFixed(2)}`);
  return { files: want.length, items, todo, est };
}
/* estimate(todo) -> tokens and USD at Batch price: prompt chars / 4 in, about 550 out an item (key, notes, reasons, pearl). */
export function estimate(todo) {
  let inTok = 0;
  for (const t of todo) { const b = axBody(t, AX_MODEL); inTok += Math.ceil((b.system[0].text.length + b.messages[0].content[0].text.length + JSON.stringify(b.output_config.format.schema).length) / 4) + 30; }
  const outTok = todo.length * 550;
  inTok = Math.round(inTok * 1.1);
  return { inTok, outTok: Math.round(outTok * 1.1), usd: usd(AX_MODEL, { input_tokens: inTok, output_tokens: Math.round(outTok * 1.1) }, true) };
}

// ---------------------------------------------------------------------------------------------------------------------
// run: Message Batches, resumable (state.json), one retry pass for replies that fail the checks
// ---------------------------------------------------------------------------------------------------------------------
/* check(t, json) -> x or null: the route's toX, and the key line names the stored answer. */
export function check(t, json) {
  const r = readReq(t);
  if (!r) return null;
  const x = toX(json, r);
  if (!x) return null;
  return keyAgrees(x.key, { o: t.o, a: t.a }) ? x : null;
}
function anthropicEnv() {
  const env = { ...process.env };
  const f = path.join(os.homedir(), ".config", "stewardmd", "anthropic.env");
  if (!env.ANTHROPIC_API_KEY && fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z_]+)=["']?(.*?)["']?\s*$/.exec(l); if (m) env[m[1]] = m[2];
  }
  delete env.ANTHROPIC_BASE_URL;   // a shell's proxy setting must not redirect a paid run
  return env;
}
export async function run(work, opts = {}, deps = {}) {
  const log = deps.log || console.log, env = deps.env || anthropicEnv(), sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const api = { create: deps.batchCreate || batchCreate, get: deps.batchGet || batchGet, results: deps.batchResults || batchResults };
  if (!env.ANTHROPIC_API_KEY) throw new Error("no ANTHROPIC_API_KEY (env or ~/.config/stewardmd/anthropic.env)");
  const td = readJson(path.join(work, "todo.json"), null);
  if (!td) throw new Error("no todo.json: run scan first");
  const todo = opts.limit ? td.todo.slice(0, Number(opts.limit)) : td.todo;
  const stF = path.join(work, "state.json"), resF = path.join(work, "results.json");
  const st = readJson(stF, null) || { model: AX_MODEL, jobs: [], spent: 0 };
  const res = readJson(resF, {});
  const save = () => { writeJson(stF, st); writeJson(resF, res); };
  const idOf = (t) => crypto.createHash("sha1").update(t.key + "#" + t.idx).digest("hex").slice(0, 24);
  const byCid = new Map(todo.map((t) => ["t" + idOf(t), t]));
  const cap = opts.maxUsd != null ? Number(opts.maxUsd) : null, chunk = Math.max(1, Number(opts.chunk) || 10000);
  for (const pass of [1, 2]) {
    const pending = todo.filter((t) => { const r = res["t" + idOf(t)]; return !r || (!r.x && (r.pass || 0) < pass); });
    // jobs of this pass already submitted cover their items
    const inFlight = new Set(st.jobs.filter((j) => j.pass === pass).flatMap((j) => j.cids));
    const fresh = pending.filter((t) => !inFlight.has("t" + idOf(t)));
    for (let i = 0; i < fresh.length; i += chunk) {
      const part = fresh.slice(i, i + chunk), est = estimate(part).usd;
      if (cap != null && st.spent + est > cap) throw new Error(`next batch (about $${est.toFixed(2)}) would pass --max-usd ${cap} ($${st.spent.toFixed(2)} spent); raise the cap and re-run`);
      const requests = part.map((t) => ({ custom_id: "t" + idOf(t), params: axBody(readReq(t), AX_MODEL) }));
      const b = await api.create(env, requests);
      st.jobs.push({ id: b.id, pass, cids: requests.map((r) => r.custom_id), at: new Date().toISOString(), done: false });
      save(); log(`pass ${pass}: submitted ${requests.length} questions as ${b.id}`);
    }
    for (const j of st.jobs.filter((x) => x.pass === pass && !x.done)) {
      let b;
      for (;;) { b = await api.get(env, j.id); if (b.processing_status === "ended") break; log(`  ${j.id}: ${b.processing_status} ${JSON.stringify(b.request_counts || {})}`); await sleep((opts.pollSec || 60) * 1000); }
      const out = await api.results(env, b);
      let ok = 0, cost = 0;
      for (const r of out) {
        const t = byCid.get(r.custom_id); if (!t) continue;
        let x = null;
        if (r.ok && r.message) { const m = readMessage(r.message, AX_MODEL); cost += usd(AX_MODEL, m.usage, true); if (m.stop !== "refusal") x = check(t, m.json); }
        res[r.custom_id] = x ? { x, pass } : { pass, why: r.ok ? "check" : "errored" };
        if (x) ok++;
      }
      j.done = true; j.ok = ok; j.usd = cost; st.spent += cost; save();
      log(`  ${j.id}: ${ok} of ${j.cids.length} accepted, $${cost.toFixed(4)} (total $${st.spent.toFixed(2)})`);
    }
  }
  const acc = todo.filter((t) => (res["t" + idOf(t)] || {}).x).length;
  log(`done: ${acc} of ${todo.length} questions have an explanation; ${todo.length - acc} left to the app's live route. Spent $${st.spent.toFixed(2)}`);
  return { accepted: acc, total: todo.length, spent: st.spent };
}

// ---------------------------------------------------------------------------------------------------------------------
// apply: write x into the mirrored files, upload the changed ones, then bump the touched bank manifests
// ---------------------------------------------------------------------------------------------------------------------
export function applyFile(json, entries) {
  let n = 0;
  for (const { idx, x } of entries) {
    const it = json.items[idx];
    if (!it || !missing(it)) continue;
    it.x = x;
    if (!(Array.isArray(it.r) && it.r.length === it.o.length && it.r.every((s) => String(s || "").trim()))) it.r = it.o.map((o, k) => (k === it.a ? x.key : x.others[L[k]] || ""));
    it.ax = 1;
    n++;
  }
  return n;
}
/* bumpManifest(man, deltas) -> changed? Every touched subject's bytes change (by the real delta, at least 1), which is
 * the stamp phones compare their cached module files against (prep.js bankStamps). */
export function bumpManifest(man, deltas) {
  let ch = false;
  for (const s of (man && man.subjects) || []) if (s && deltas[s.id] != null) { s.bytes = (Number(s.bytes) || 0) + Math.max(1, deltas[s.id]); ch = true; }
  return ch;
}
export async function apply(work, opts = {}, deps = {}) {
  const log = deps.log || console.log, put = deps.putR2Object || putR2Object, get = deps.getR2Object || getR2Object;
  const td = readJson(path.join(work, "todo.json"), null), res = readJson(path.join(work, "results.json"), {});
  if (!td) throw new Error("no todo.json: run scan first");
  const byKey = new Map();
  for (const t of td.todo) {
    const r = res["t" + crypto.createHash("sha1").update(t.key + "#" + t.idx).digest("hex").slice(0, 24)];
    if (r && r.x) { if (!byKey.has(t.key)) byKey.set(t.key, []); byKey.get(t.key).push({ idx: t.idx, x: r.x }); }
  }
  const out = path.join(work, "out"), changed = [], deltas = {};
  let items = 0;
  for (const [key, entries] of byKey) {
    const src = path.join(work, "mirror", key), json = readJson(src, null);
    if (!json) { log("missing mirror copy, skipped: " + key); continue; }
    const before = fs.statSync(src).size, n = applyFile(json, entries);
    if (!n) continue;
    const body = JSON.stringify(json), dst = path.join(out, key);
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, body);
    changed.push({ key, n, dst }); items += n;
    const m = new RegExp("^" + PREFIX + "(v\\d+)/([a-z0-9-]+)/mcq/").exec(key);
    if (m) deltas[m[2]] = (deltas[m[2]] || 0) + (Buffer.byteLength(body) - before);
  }
  log(`${items} questions in ${changed.length} files get an explanation; bank subjects touched: ${Object.keys(deltas).length}`);
  writeJson(path.join(work, "applied.json"), { at: new Date().toISOString(), items, files: changed.map((c) => ({ key: c.key, n: c.n })), subjects: deltas });
  if (!opts.yes) { log("dry: nothing uploaded (add --yes). Files are in " + out); return { items, files: changed.length, uploaded: 0 }; }
  if (!deps.putR2Object && !getR2Config()) throw new Error("no R2 S3 credentials (~/.stewardmd-secrets/r2-s3.env)");
  let up = 0;
  for (const c of changed) {
    // overlays and PYQ files are immutable on the CDN and in phone caches; module files refetch on the manifest stamp
    await put(c.key, c.dst, "application/json", "public, max-age=31536000, immutable");
    if (++up % 100 === 0) log(`  uploaded ${up} of ${changed.length}`);
  }
  // manifests last: a phone only refetches once every changed module is in the bucket
  const vers = new Set(Object.keys(deltas).map((s) => (td.live.bv || {})[s] || td.live.ver).concat([td.live.ver]));
  for (const v of vers) {
    const mk = PREFIX + v + "/manifest.json", buf = await get(mk);
    if (!buf) continue;
    const man = JSON.parse(String(buf));
    if (bumpManifest(man, deltas)) { const f = path.join(out, mk); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(man)); await put(mk, f, "application/json", "public, max-age=300"); log("manifest updated: " + mk); }
  }
  log(`uploaded ${up} files`);
  return { items, files: changed.length, uploaded: up };
}

export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0], a = {};
  for (let i = 1; i < argv.length; i++) { const k = argv[i].replace(/^--/, ""); if (["yes"].includes(k)) a[k] = true; else a[k] = argv[++i]; }
  const work = path.resolve(a.work || path.join(os.homedir(), "prep-data", "fill-missing"));
  fs.mkdirSync(work, { recursive: true });
  const o = { maxUsd: a["max-usd"], limit: a.limit, only: a.only, chunk: a.chunk, pollSec: a["poll-sec"] ? Number(a["poll-sec"]) : 60, yes: !!a.yes };
  if (cmd === "scan") return scan(work, o);
  if (cmd === "run") return run(work, o);
  if (cmd === "apply") return apply(work, o);
  if (cmd === "all") { await scan(work, o); await run(work, o); return apply(work, o); }
  throw new Error("usage: node tools/prep-fill-missing.mjs scan | run [--max-usd n] | apply [--yes] | all --max-usd n [--yes]");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
