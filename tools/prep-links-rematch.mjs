#!/usr/bin/env node
/* LINKS-100 per-module rematch: unlinked usable items the deterministic phrase matcher missed (possessives,
 * plurals, paraphrase: "Ewings sarcoma" never scans "ewing sarcoma") get one cheap-model map call per module
 * plus a second-pass verify call, both claude-haiku-5-5 over Message Batches (50% price), every call ledgered.
 *
 *   node tools/prep-links-rematch.mjs --modules all --top 40        plan + estimate, $0 (default dry run)
 *   node tools/prep-links-rematch.mjs --modules all --top 40 --run --cap 20
 *   node tools/prep-links-rematch.mjs --modules pat-mixed,ana-mixed --run --cap 20
 *
 * Honesty rules (a wrong link is worse than none): map output keeps confidence 0-100 and only resolved,
 * real targets survive (lesson keys must exist in the merged lessons index; KB names must resolve through the
 * same byKey/alias map the library opens; drugs/protocols through the same dictionaries); anything below the
 * confidence floor 75 is dropped; the verify pass independently re-judges every proposal against the item's
 * tested concept (correct answer, not a distractor or vignette background) and drops failures. Survivors land
 * in prep/bank/rematch-links.json, which the index build merges as v:"rm" links capped at 80. Work files with
 * item text stay in --work (default /tmp/links100-lgen), outside the repo. Spend ledger rows go to --ledger.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as E from "../functions/_prep-qgen.js";
import { loadEnv } from "./prep-links-confirm.mjs";
import { plan, kbDocs, drugLexicon, drugPhrases, protoDocs, SHOW, MAX } from "./prep-links.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "claude-haiku-5-5";
const LEDGER_COLS = ["date", "job", "model", "input_tokens", "output_tokens", "cost_usd", "note"];
const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const writeJ = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1) + "\n"); };
const usable = (it) => it && !(it.flags && it.flags.length) && Array.isArray(it.o) && it.o.length >= 2 && typeof it.a === "number";

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

/* ---------- universe ---------- */
/* lessonCatalog(root, cache) -> [{ key, title, module }]: the same merged lessons index the build links
 * (bank wins, except a hand-written bundled file wins for its module). */
export function lessonCatalog(root = ROOT, cache = null) {
  const bankLes = (cache && readJ(path.join(cache, "lessons-index.json")) || {}).modules || {};
  const appLes = (readJ(path.join(root, "prep/lessons/v1/index.json")) || {}).modules || {};
  const merged = { ...bankLes };
  for (const [k, e] of Object.entries(appLes)) if (!merged[k] || e.gen === "hand") merged[k] = e;
  return Object.entries(merged).map(([k, e]) => ({ key: k, title: String((e && e.title) || ""), module: String((e && e.module) || k) }));
}
/* kbAliasMap(root) -> Map(normalized name-or-alias -> real KB id): the same keys the library opens. */
export function kbAliasMap(root = ROOT) {
  const m = new Map();
  const put = (name, id) => {
    const k = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (k && !m.has(k)) m.set(k, id);
  };
  for (const d of kbDocs(root)) { put(d.id.replace(/_/g, " "), d.id); put(d.name, d.id); for (const a of d.aliases || []) put(a, d.id); }
  return m;
}
/* unlinkedByModule({ root, cache, bank, out }) -> [{ mid, sid, items }] over the built links out dir, biggest
 * residue first. items carry the text the model judges: stem, keyed answer, and a short explanation slice. */
export function unlinkedByModule({ root = ROOT, cache, bank, out }) {
  const { cfg, mods } = plan(root);
  const BANK = bank;
  const file = (rel, bv) => {
    if (bv === cfg.ver) { const j = readJ(path.join(BANK, rel.slice(bv.length + 1))); if (j) return j; }
    return readJ(path.join(cache, rel));
  };
  const ix = readJ(path.join(out, "index.json"));
  const linked = new Set();
  for (const [mod, ptr] of Object.entries((ix && ix.m) || {})) {
    const sh = readJ(path.join(out, `m/${mod}-${String(ptr).split("/")[1]}.json`));
    for (const iid of Object.keys((sh && sh.e) || {})) linked.add(String(iid));
  }
  const expOf = (it) => {
    const x = it && it.x && typeof it.x === "object" ? it.x : {};
    return [it.exp, x.key, x.notes, x.why, x.clues, x.pearl].filter((s) => typeof s === "string" && s.trim()).join("\n").slice(0, 500);
  };
  const rows = [];
  for (const m of mods) {
    const lists = [];
    if (m.bank) lists.push(file(m.bank, m.bv));
    for (const o of m.overlays || []) lists.push(readJ(path.join(cache, o)));
    const items = [];
    for (const f of lists) for (const it of (f && f.items) || []) {
      if (!usable(it) || linked.has(String(it.id))) continue;
      if (items.some((e) => e.id === String(it.id))) continue;
      items.push({ id: String(it.id), q: String(it.q || "").slice(0, 600), key: String(it.o[it.a] || "").slice(0, 160), exp: expOf(it) });
    }
    if (items.length) rows.push({ mid: m.mid, sid: m.sid, title: m.mid, items });
  }
  rows.sort((a, b) => b.items.length - a.items.length);
  return rows;
}

/* ---------- prompts (pure, $0 to test) ---------- */
const KINDS = ["lesson", "kb", "drug", "protocol"];
export function mapPrompt(mod, items, catalog) {
  const system = "You link exam questions to teaching targets. Reply with RAW JSON only, no prose, no fences.";
  const cat = catalog.map((c) => `${c.key} :: ${c.title}`).join("\n");
  const lines = items.map((it, i) => `### ${i + 1} [${it.id}]\nQ: ${it.q}\nCorrect answer: ${it.key}\nExplanation: ${it.exp}`).join("\n");
  const user = `Module ${mod.mid} (${mod.sid}). For EACH numbered item below, decide what single teaching target the item TESTS (the concept of the CORRECT answer, never a distractor, never vignette background).\n\nLESSON CATALOG (exact keys; prefer a lesson when one teaches the item's concept):\n${cat}\n\nKinds: "lesson" (target = exact catalog key), "kb" (target = Knowledge Library disease/article name, e.g. "Ewing sarcoma"), "drug" (target = generic drug name), "protocol" (target = protocol title). Omit an item when nothing fits honestly. Confidence c is 0-100: use >=75 only when the target is ABOUT the item's tested concept; a link that is not about the item's topic is worse than none.\n\nITEMS:\n${lines}\n\nReply JSON: {"links":[{"n":<item number>,"kind":"lesson|kb|drug|protocol","target":"<exact key or name>","c":<0-100>}]}.`;
  return { system, user };
}
export function verifyPrompt(mod, jobs) {
  const system = "You audit question-to-target links. Reply with RAW JSON only, no prose, no fences.";
  const lines = jobs.map((j, i) => `### ${i + 1} [${j.id}]\nQ: ${j.q}\nCorrect answer: ${j.key}\nProposed ${j.kind} target: ${j.title}\nClaimed confidence: ${j.c}`).join("\n");
  const user = `Module ${mod.mid} (${mod.sid}). For EACH numbered proposal, KEEP it only when the proposed target is ABOUT the concept the item tests (the correct answer's topic: the disease, drug, lesson chapter, or protocol the question turns on). DROP it when the target is a distractor, vignette background, a nearby-but-different condition, or a lesson chapter that does not teach this concept.\n\n${lines}\n\nReply JSON: {"keep":[<proposal numbers to keep>]}. When in doubt, leave it out.`;
  return { system, user };
}
/* parseMapResponse(json, items) -> [{ n, id, kind, target, c }]: shape-checked, item numbers must exist. */
export function parseMapResponse(json, items) {
  const list = json && Array.isArray(json.links) ? json.links : null;
  if (!list) return null;
  const out = [];
  for (const l of list) {
    if (!l || typeof l !== "object") continue;
    const n = Number(l.n);
    if (!Number.isInteger(n) || n < 1 || n > items.length) continue;
    if (!KINDS.includes(l.kind) || typeof l.target !== "string" || !l.target.trim()) continue;
    const c = Number(l.c);
    if (!Number.isFinite(c)) continue;
    out.push({ n, id: items[n - 1].id, kind: l.kind, target: l.target.trim(), c });
  }
  return out;
}
/* resolveTargets(proposals, dicts) -> [{ id, k, targetId, title, c }]: every name must resolve to a real
 * target through the same maps the library opens; anything else (and anything below the floor) is dropped. */
export function resolveTargets(proposals, dicts) {
  const { lessonKeys, lessonTitles, kbAliases, kbTitles, drugIds, protoIds } = dicts;
  const out = [];
  for (const p of proposals || []) {
    if (p.c < SHOW) continue;
    if (p.kind === "lesson") {
      const hit = lessonKeys.find((k) => k.toLowerCase() === p.target.toLowerCase());
      if (!hit) continue;
      out.push({ id: p.id, k: "ls", targetId: hit, title: lessonTitles.get(hit) || hit, c: p.c });
    } else if (p.kind === "kb") {
      const k = p.target.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const id = kbAliases.get(k);
      if (!id) continue;
      out.push({ id: p.id, k: "kb", targetId: id, title: kbTitles.get(id) || id, c: p.c });
    } else if (p.kind === "drug") {
      const k = p.target.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ");
      const title = drugIds.get(k);
      if (!title) continue;
      out.push({ id: p.id, k: "dr", targetId: k, title, c: p.c });
    } else if (p.kind === "protocol") {
      const title = protoIds.get(p.target.trim());
      if (!title) continue;
      out.push({ id: p.id, k: "pr", targetId: p.target.trim(), title, c: p.c });
    }
  }
  return out;
}
/* parseVerifyResponse(json, jobs) -> Set of kept job indexes (1-based numbers), or null on bad shape. */
export function parseVerifyResponse(json, jobs) {
  const keep = json && Array.isArray(json.keep) ? json.keep : null;
  if (!keep) return null;
  const out = new Set();
  for (const n of keep) { const i = Number(n); if (Number.isInteger(i) && i >= 1 && i <= jobs.length) out.add(i); }
  return out;
}

/* chunkItems(items, n) -> item slices of at most n: big modules split so one map call's JSON fits max_tokens. */
export function chunkItems(items, n = 100) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/* ---------- paid runner ---------- */
async function retry(fn, n = 5) {
  for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n - 1 || !e.retry) throw e; await new Promise((r) => setTimeout(r, 3000 * (i + 1))); } }
}
function ledgerSpent(ledger) {
  let s = 0;
  try {
    for (const line of fs.readFileSync(ledger, "utf8").split("\n")) {
      const c = line.split("\t");
      if (c.length >= 6 && !isNaN(Number(c[5]))) s += Number(c[5]);
    }
  } catch {}
  return Math.round(s * 1e4) / 1e4;
}
const estTok = (s) => Math.ceil(String(s || "").length / 4);
/* runBatch(env, reqs, tag) -> [{ custom_id, ok, message }]: submit one Message Batch, poll to ended. */
async function runBatch(env, reqs, tag) {
  const b = await retry(() => E.batchCreate(env, reqs.map((r) => ({ custom_id: r.custom_id, params: r.params }))));
  console.log(`batch ${b.id}: ${reqs.length} requests submitted`);
  let st;
  for (;;) {
    st = await retry(() => E.batchGet(env, b.id));
    if (st.processing_status === "ended") break;
    process.stderr.write(`[${tag}] ${st.id} ${JSON.stringify(st.request_counts)}\n`);
    await new Promise((r) => setTimeout(r, 30000));
  }
  return retry(() => E.batchResults(env, st));
}
function ledgerRow(ledger, job, u, note) {
  const usd = E.usd(MODEL, u, true);
  const row = [new Date().toISOString().slice(0, 10), job, MODEL, u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    u.output_tokens, usd.toFixed(4), note].join("\t");
  fs.appendFileSync(ledger, row + "\n");
  return usd;
}

async function main(args = argv) {
  const cache = arg("--cache", "/tmp/links100-cache");
  const bank = arg("--bank", "/Users/diwakarkumar/prep-work/StewardMD-prep/prep/bank/v5");
  const out = arg("--out", "/tmp/links100-final");
  const ledger = arg("--ledger", "/tmp/links-100-spend.tsv");
  const sidecarPath = arg("--sidecar", path.join(ROOT, "prep/bank/rematch-links.json"));
  const cap = Number(arg("--cap", "20"));
  const spent = ledgerSpent(ledger);
  const catalog = lessonCatalog(ROOT, cache);
  const kbA = kbAliasMap(ROOT);
  const kbT = new Map(kbDocs(ROOT).map((d) => [d.id, d.name]));
  const drugIds = new Map(drugPhrases(drugLexicon(ROOT)).map((p) => [p.id, p.title]));
  const protoIds = new Map(protoDocs(ROOT).map((p) => [p.id, p.name]));
  const dicts = { lessonKeys: catalog.map((c) => c.key), lessonTitles: new Map(catalog.map((c) => [c.key, c.title])), kbAliases: kbA, kbTitles: kbT, drugIds, protoIds };

  let mods = unlinkedByModule({ root: ROOT, cache, bank, out });
  const want = arg("--modules", "all");
  if (want !== "all") { const set = new Set(want.split(",").map((s) => s.trim()).filter(Boolean)); mods = mods.filter((m) => set.has(m.mid)); }
  const top = Number(arg("--top", mods.length <= 40 ? String(mods.length) : "40"));
  mods = mods.slice(0, top);
  const items = mods.reduce((n, m) => n + m.items.length, 0);

  // Estimate ($0): map in/out + verify in/out, haiku batch prices.
  let mapIn = 0, verifyIn = 0;
  const mapLens = [];
  for (const m of mods) {
    const p = mapPrompt(m, m.items, catalog);
    mapIn += estTok(p.system) + estTok(p.user); mapLens.push(p.user.length);
  }
  const mapOut = items * 40;
  verifyIn = items * 90; // resolved-subset upper bound: item + proposal each
  const verifyOut = items * 8;
  const est = E.usd(MODEL, { input_tokens: mapIn + verifyIn, output_tokens: mapOut + verifyOut }, true);
  console.log(`modules: ${mods.length} (${items} unlinked items; cap $${cap}, spent $${spent})`);
  for (const m of mods.slice(0, 15)) console.log(`  ${String(m.items.length).padStart(5)} ${m.sid} ${m.mid}`);
  if (mods.length > 15) console.log(`  ... and ${mods.length - 15} more`);
  console.log(JSON.stringify({ modules: mods.length, items, estMapIn: mapIn, estVerifyIn: verifyIn, estTotalUsd: Math.round(est * 1e4) / 1e4 }));
  if (!has("--run")) return;
  if (spent + est > cap) { console.log(`over cap: spent $${spent} + est $${est.toFixed(4)} > $${cap}; trim --top/--modules and retry`); process.exit(2); }

  const env = loadEnv();
  const work = arg("--work", "/tmp/links100-lgen");
  fs.mkdirSync(work, { recursive: true });
  // Pass 1: map (chunked: a big module's whole answer never fits one max_tokens window).
  const mapReqs = [];
  mods.forEach((m, i) => {
    chunkItems(m.items).forEach((chunk, c) => {
      const p = mapPrompt(m, chunk, catalog);
      mapReqs.push({ custom_id: `r-${String(i).padStart(4, "0")}-${c}`, mid: m.mid, items: chunk, params: { model: MODEL, max_tokens: 8192, system: p.system, messages: [{ role: "user", content: p.user }] } });
    });
  });
  const mapRes = await runBatch(env, mapReqs, "links100-remap");
  const byId = new Map(mapReqs.map((r) => [r.custom_id, r]));
  const u1 = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let mapBad = 0;
  const resolved = []; // [{ mid, items, jobs:[{...resolved, q, key}] }]
  for (const r of mapRes) {
    const q = byId.get(r.custom_id);
    if (!q || !r.ok) { mapBad++; continue; }
    for (const k of Object.keys(u1)) u1[k] += (r.message.usage && r.message.usage[k]) || 0;
    const m = E.readMessage(r.message, MODEL);
    const parsed = parseMapResponse(m.json, q.items);
    if (!parsed || m.stop === "refusal") { mapBad++; continue; }
    const jobs = resolveTargets(parsed, dicts).map((j) => {
      const it = q.items.find((x) => x.id === j.id);
      return { ...j, q: it ? it.q : "", key: it ? it.key : "" };
    });
    if (jobs.length) resolved.push({ mid: q.mid, sid: mods.find((x) => x.mid === q.mid).sid, items: q.items, jobs });
  }
  const usd1 = ledgerRow(ledger, "links100-remap", u1, `batch map; ${mapReqs.length} modules; errors ${mapBad}; tools/prep-links-rematch.mjs`);
  // Pass 2: verify each resolved proposal against the item's tested concept.
  const verReqs = [];
  resolved.forEach((g, i) => {
    chunkItems(g.jobs, 150).forEach((chunk, c) => {
      const p = verifyPrompt({ mid: g.mid, sid: g.sid }, chunk);
      verReqs.push({ custom_id: `v-${String(i).padStart(4, "0")}-${c}`, g: { ...g, jobs: chunk }, params: { model: MODEL, max_tokens: 2048, system: p.system, messages: [{ role: "user", content: p.user }] } });
    });
  });
  const kept = {}; // itemId -> [{ k, id, title, c }]
  let verBad = 0;
  const u2 = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  if (verReqs.length) {
    const verRes = await runBatch(env, verReqs, "links100-reverify");
    const vById = new Map(verReqs.map((r) => [r.custom_id, r]));
    for (const r of verRes) {
      const q = vById.get(r.custom_id);
      if (!q || !r.ok) { verBad++; continue; }
      for (const k of Object.keys(u2)) u2[k] += (r.message.usage && r.message.usage[k]) || 0;
      const m = E.readMessage(r.message, MODEL);
      const keep = parseVerifyResponse(m.json, q.g.jobs);
      if (!keep || m.stop === "refusal") { verBad++; continue; }
      q.g.jobs.forEach((j, idx) => {
        if (!keep.has(idx + 1)) return;
        (kept[j.id] || (kept[j.id] = [])).push({ k: j.k, id: j.targetId, title: j.title, c: j.c });
      });
    }
  }
  const usd2 = ledgerRow(ledger, "links100-reverify", u2, `batch verify; ${verReqs.length} modules; errors ${verBad}; tools/prep-links-rematch.mjs`);
  // Merge into the sidecar (upsert by item id; never invent targets: only resolved + verified survive).
  const prev = readJ(sidecarPath) || { ver: 1, items: {} };
  let n = 0;
  for (const [id, links] of Object.entries(kept)) {
    const g = resolved.find((x) => x.jobs.some((j) => j.id === id));
    prev.items[id] = { mid: g ? g.mid : "", links, models: [MODEL], passes: 2, at: new Date().toISOString() };
    n++;
  }
  prev.ver = 1; prev.at = new Date().toISOString();
  writeJ(sidecarPath, prev);
  console.log(JSON.stringify({ written: n, of: items, spent: Math.round((spent + usd1 + usd2) * 1e4) / 1e4, mapErrors: mapBad, verifyErrors: verBad }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(argv).catch((e) => { console.error(e.message || e); process.exit(1); });
}
