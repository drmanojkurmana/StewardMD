#!/usr/bin/env node
// PrepNucleus Phase 1 key screen: a Batch blind solve of every Layer A bank item. Dev-only, never shipped.
// COSTS MONEY (Vertex Batch). Plan: vault/plans/PrepNucleus.md 5.1 (Screen), 6.2, 8.1, 11.
//
// RUN
//   node tools/prep-screen-keys.mjs --dry-run [--subject <id>] [--assume-items 170000]   token and cost estimate, zero calls
//   PREP_VERTEX_PROJECT=<gcp project> PREP_GCS_BUCKET=<bucket> node tools/prep-screen-keys.mjs [--subject <id>]
//       [--bank prep/bank/v1] [--tax prep/taxonomy] [--work prep/screen/v1] [--per 7] [--all] [--run <id>]
//       [--poll-sec 60] [--max-wait-min 1440] [--no-wait]
//   Location, model and auth: see tools/prep-vertex.mjs.
//
// What it does, per subject (one Batch job each):
//   every unflagged item of prep/bank/v1/<subject>/mcq/*.json (--all: flagged ones too), stem plus its options in a
//   seeded shuffled order, up to --per items a request through buildSolvePrompt (functions/_prep-core.js). The key is
//   never sent: only q and o reach the prompt builder. The pick is compared with o[a] (solveMatches):
//     agree      pick is the key                                   nothing changes
//     disputed   pick is clearly ANOTHER option of the item        flags += "disputed" (the app hides it like any flag)
//     unmatched  pick matches no option                            counted, not flagged (a formatting slip is not a
//     nopick     empty or malformed reply                          verdict on the key); counted, not flagged
//   Module files are rewritten with the flag, the subject's index.json is recomputed with prep-build-bank.mjs
//   subjectIndex (same counting rules as the build), and manifest.json's entry for the subject is refreshed.
//   prep/bank/v1/screen-<date>.json records the per-subject agreement rate for the report and the licence line.
// RESUMABLE: prep/screen/v1/state.json keeps each subject's Batch job id; <subject>.jsonl the submitted requests and
//   <subject>.out.json the picks. A re-run polls a submitted job, never resubmits it, and skips applied subjects.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PREP_LIMITS, buildSolvePrompt, normText, sanitizeSolve, parseModelJson, solveMatches, mulberry32, seedFrom } from "../functions/_prep-core.js";
import { loadTaxonomy, subjectIndex } from "./prep-build-bank.mjs";
import { createVertex, requestBody, promptTokens, costUsd, usdToInr, sumUsage, vertexConfig } from "./prep-vertex.mjs";
import { parseArgs, groupsOf, EST } from "./prep-fill.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
function writeJson(p, obj, pretty) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj)); }

/* shuffledView(item) -> { q, o }: the options in an order seeded by the item id. The key index is not part of it. */
export function shuffledView(it) {
  const rnd = mulberry32(seedFrom("screen:" + it.id)), o = it.o.slice();
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  return { q: it.q, o };
}
/* pickIndex(pick, options) -> index of the option the pick names, or -1. Exact after normText first; then the one
 * option that contains the pick or is contained in it. */
export function pickIndex(pick, o) {
  const p = normText(pick);
  if (!p) return -1;
  const ex = o.findIndex((x) => normText(x) === p);
  if (ex >= 0) return ex;
  const loose = o.map((x, i) => [normText(x), i]).filter(([x]) => x && (p.includes(x) || x.includes(p)));
  return loose.length === 1 ? loose[0][1] : -1;
}
/* verdict(pick, item) -> "agree" | "disputed" | "unmatched" | "nopick" */
export function verdict(pick, it) {
  if (!normText(pick)) return "nopick";
  if (solveMatches(pick, it)) return "agree";
  const i = pickIndex(pick, it.o);
  if (i === it.a) return "agree";
  return i >= 0 ? "disputed" : "unmatched";
}
/* screenItems(items, all) -> the items a screen sends: unflagged ones (all: every item), not already disputed. */
export function screenItems(items, all) {
  return items.filter((it) => !(it.flags || []).includes("disputed") && (all || !(it.flags && it.flags.length)));
}
export function linesFor(items, per) {
  return groupsOf(items, per).map((g, i) => ({ key: "s" + i, ids: g.map((x) => x.id), request: requestBody(buildSolvePrompt({ items: g.map(shuffledView) })) }));
}
function subjectFiles(bank, sid) {
  const dir = path.join(bank, sid, "mcq");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => ({ file: path.join(dir, f), json: readJson(path.join(dir, f), { items: [] }) }));
}
/* applyVerdicts(subject, bank, verdicts: Map id -> verdict) -> { disputed, files }: adds "disputed", rewrites the module
 * files that changed, recomputes index.json with subjectIndex and refreshes manifest.json's subject row. */
export function applyVerdicts(subject, bank, verdicts) {
  const files = subjectFiles(bank, subject.id);
  let disputed = 0, changed = 0;
  for (const f of files) {
    let touched = false;
    for (const it of f.json.items) {
      if (verdicts.get(it.id) !== "disputed" || (it.flags || []).includes("disputed")) continue;
      it.flags = [...new Set([...(it.flags || []), "disputed"])].sort();
      disputed++; touched = true;
    }
    if (touched) { writeJson(f.file, f.json); changed++; }
  }
  const items = files.flatMap((f) => f.json.items);
  const ix = subjectIndex(subject, items);
  const old = readJson(path.join(bank, subject.id, "index.json"), null);
  if (old && old.v) ix.v = old.v;
  writeJson(path.join(bank, subject.id, "index.json"), ix);
  const mp = path.join(bank, "manifest.json"), man = readJson(mp, null);
  if (man && Array.isArray(man.subjects)) {
    const row = man.subjects.find((s) => s.id === subject.id);
    if (row) {
      let bytes = 0;
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else bytes += fs.statSync(q).size; } };
      walk(path.join(bank, subject.id));
      row.bytes = bytes;
      row.index = crypto.createHash("sha256").update(fs.readFileSync(path.join(bank, subject.id, "index.json"))).digest("hex");
      writeJson(mp, man);
    }
  }
  return { disputed, files: changed, index: ix };
}

/* estimateItems(items, per, model) -> { requests, inTok, outTok, usd } at Batch price from the real prompts. */
export function estimateItems(items, per, model) {
  const lines = linesFor(items, per);
  let inTok = 0;
  for (const g of groupsOf(items, per)) inTok += promptTokens(buildSolvePrompt({ items: g.map(shuffledView) }));
  const outTok = items.length * EST.solveOut + lines.length * 5;
  return { items: items.length, requests: lines.length, inTok, outTok, usd: costUsd({ inTok, outTok }, model, { batch: true }) };
}
function sampleItems(root) {
  // A MedMCQA bank of the same shape for extrapolation when prep/bank is not built yet: the Tokós OBGYN bank.
  const dir = path.join(root, "tokos", "decks", "mcq");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").flatMap((f) => readJson(path.join(dir, f), { items: [] }).items || []);
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const root = deps.root || ROOT, log = deps.log || console.log;
  const R = (k, d) => path.resolve(root, args[k] || d);
  const bank = R("bank", "prep/bank/v1"), work = R("work", "prep/screen/" + path.basename(R("bank", "prep/bank/v1")));
  const subjects = loadTaxonomy(R("tax", "prep/taxonomy")).filter((s) => !args.subject || s.id === args.subject);
  if (args.subject && !subjects.length) throw new Error("unknown subject " + args.subject);
  const per = Math.max(1, Math.min(PREP_LIMITS.solve.maxItems, Number(args.per) || PREP_LIMITS.solve.maxItems));
  const all = args.flags.has("all");
  const cfg = { ...vertexConfig(deps.env || process.env), ...(deps.config || {}) };
  const stFile = path.join(work, "state.json");
  const state = readJson(stFile, null) || { v: 1, bank: path.basename(bank), run: args.run || "screen-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""), model: cfg.model, subjects: {} };
  const save = () => writeJson(stFile, state, true);

  if (args.flags.has("dry-run")) {
    log(`DRY RUN (no calls). Key screen of ${bank}, ${per} items a request, model ${cfg.model}, Batch price:`);
    let tot = { items: 0, requests: 0, inTok: 0, outTok: 0, usd: 0 };
    const rows = [];
    for (const s of subjects) {
      const items = screenItems(subjectFiles(bank, s.id).flatMap((f) => f.json.items), all);
      if (!items.length) continue;
      const e = estimateItems(items, per, cfg.model);
      rows.push({ subject: s.id, ...e });
      for (const k of Object.keys(tot)) tot[k] += e[k];
      log(`  ${s.id.padEnd(28)} ${String(e.items).padStart(6)} items ${String(e.requests).padStart(5)} requests  in ${e.inTok}  out ${e.outTok}  $${e.usd.toFixed(4)}`);
    }
    if (!rows.length) log("  no bank module files found (build the bank first with tools/prep-build-bank.mjs)");
    let assumed = null;
    if (args["assume-items"]) {
      const n = Number(args["assume-items"]);
      const sample = tot.items ? null : screenItems(sampleItems(root), all);
      const base = tot.items ? tot : sample && sample.length ? estimateItems(sample, per, cfg.model) : null;
      if (base && base.items) {
        const k = n / base.items;
        assumed = { items: n, inTok: Math.round(base.inTok * k), outTok: Math.round(base.outTok * k), usd: base.usd * k, from: tot.items ? "this bank" : `the Tokós OBGYN bank (${base.items} items)` };
        log(`  extrapolated to ${n} items from ${assumed.from}: in ${(assumed.inTok / 1e6).toFixed(2)}M out ${(assumed.outTok / 1e6).toFixed(2)}M  $${assumed.usd.toFixed(2)} (Rs ${Math.round(usdToInr(assumed.usd))})`);
      }
    }
    log(`  total ${tot.items} items: $${tot.usd.toFixed(4)} (Rs ${Math.round(usdToInr(tot.usd))})`);
    return { dryRun: true, rows, total: tot, assumed };
  }

  const vx = deps.vertex || createVertex({ env: deps.env, config: deps.config, fetch: deps.fetch, exec: deps.exec, sleep: deps.sleep, now: deps.now });
  const pollMs = (args["poll-sec"] != null ? Number(args["poll-sec"]) : 60) * 1000;
  const maxWaitMs = args.flags.has("no-wait") ? 0 : (args["max-wait-min"] != null ? Number(args["max-wait-min"]) : 1440) * 60000;
  const report = [];
  const pending = [];
  // submit every subject first so the jobs run in parallel, then collect
  for (const s of subjects) {
    const st = state.subjects[s.id] || (state.subjects[s.id] = {});
    if (st.status === "applied" || st.jobId) continue;
    const items = screenItems(subjectFiles(bank, s.id).flatMap((f) => f.json.items), all);
    if (!items.length) continue;
    const lines = linesFor(items, per);
    const inFile = path.join(work, s.id + ".jsonl");
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(inFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const job = await vx.batch.submit({ name: "screen/" + s.id, run: state.run, lines });
    Object.assign(st, { status: "submitted", items: items.length, requests: lines.length, ...job });
    save();
    log(`${s.id}: submitted ${items.length} items in ${lines.length} requests as ${job.jobId}`);
  }
  for (const s of subjects) {
    const st = state.subjects[s.id];
    if (!st || !st.jobId) continue;
    if (st.status === "applied") { report.push({ id: s.id, ...st.result }); continue; }
    const inFile = path.join(work, s.id + ".jsonl"), outFile = path.join(work, s.id + ".out.json");
    const lines = fs.readFileSync(inFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    let picks = st.status === "fetched" ? readJson(outFile, null) : null;
    if (!picks) {
      const info = await vx.batch.wait(st.jobId, { pollMs, maxWaitMs });
      if (info.pending) { pending.push(s.id); log(`${s.id}: job ${st.jobId} ${info.state}; re-run to resume`); continue; }
      if (info.state !== "JOB_STATE_SUCCEEDED" && info.state !== "JOB_STATE_PARTIALLY_SUCCEEDED") {
        st.status = "failed"; st.error = info.error || info.state; save();
        log(`${s.id}: job ${st.jobId} ended ${info.state}; delete subjects["${s.id}"] in ${stFile} to resubmit`);
        continue;
      }
      const before = vx.log.length;
      const res = await vx.batch.results(info, lines, { run: state.run, op: "screen" });
      picks = {};
      for (const l of lines) {
        const r = res.get(l.key);
        const ots = sanitizeSolve(parseModelJson(r ? r.text : ""), l.ids.length);
        l.ids.forEach((id, i) => { picks[id] = ots ? ots[i] : ""; });
      }
      writeJson(outFile, picks);
      Object.assign(st, { status: "fetched", usage: sumUsage(vx.log.slice(before), vx.cfg.model, { batch: true }) });
      save();
    }
    const byId = new Map(subjectFiles(bank, s.id).flatMap((f) => f.json.items).map((it) => [it.id, it]));
    const verdicts = new Map(), counts = { screened: 0, agree: 0, disputed: 0, unmatched: 0, nopick: 0 };
    for (const [id, pick] of Object.entries(picks)) {
      const it = byId.get(id);
      if (!it) continue;
      const v = verdict(pick, it);
      verdicts.set(id, v); counts.screened++; counts[v]++;
    }
    const ap = applyVerdicts(s, bank, verdicts);
    const judged = counts.screened - counts.nopick;
    const result = { ...counts, rate: judged ? Math.round((counts.agree / judged) * 10000) / 10000 : null, usd: st.usage ? st.usage.usd : 0 };
    Object.assign(st, { status: "applied", result, appliedAt: new Date().toISOString() });
    save();
    report.push({ id: s.id, ...result });
    log(`${s.id}: ${counts.agree} agree, ${counts.disputed} disputed (flagged), ${counts.unmatched} unmatched, ${counts.nopick} no pick; agreement ${result.rate == null ? "n/a" : (result.rate * 100).toFixed(1) + "%"}; ${ap.files} module files rewritten`);
  }
  if (report.length) {
    const day = new Date().toISOString().slice(0, 10);
    const p = path.join(bank, `screen-${day}.json`);
    const prev = readJson(p, { subjects: [] });
    const keep = prev.subjects.filter((x) => !report.some((r) => r.id === x.id));
    writeJson(p, { v: 1, date: day, run: state.run, model: state.model, bank: path.basename(bank), subjects: keep.concat(report).sort((a, b) => (a.id < b.id ? -1 : 1)) }, true);
    log(`wrote ${p}`);
  }
  return { report, pending };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
