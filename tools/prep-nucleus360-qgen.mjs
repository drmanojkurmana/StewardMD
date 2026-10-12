#!/usr/bin/env node
/* Nucleus360 gap-fill driver (owner 2026-10-12, PR b): build grounding sources per
 * pre-built topic, dry-run the cost, submit Batch qgen jobs, poll them, collect the
 * passed items and write the spend ledger. Question text never enters git: sources
 * and work files live in /tmp and ~/prep-data/qgen/ (outside the repo).
 *
 *   node tools/prep-nucleus360-qgen.mjs --sources    fetch bank context, write /tmp/n360-src/<id>.md
 *   node tools/prep-nucleus360-qgen.mjs --estimate   dry-run every topic, total must stay <= $7 batch
 *   node tools/prep-nucleus360-qgen.mjs --submit     submit Batch jobs (records /tmp/n360-jobs.json)
 *   node tools/prep-nucleus360-qgen.mjs --poll       resume all jobs until done (snapshots gen usage)
 *   node tools/prep-nucleus360-qgen.mjs --collect    match passed items to gaps, ledger + kept-items manifest
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const N = require(path.join(ROOT, "prep-nucleus360.js"));
const E = await import(pathToFileURL(path.join(ROOT, "functions/_prep-qgen.js")).href);
const QGEN = (await import(pathToFileURL(path.join(ROOT, "tools/prep-qgen.mjs")).href));

const SRC = "/tmp/n360-src", BANK = "/tmp/n360-bank", JOBS = "/tmp/n360-jobs.json";
const WORK = process.env.PREP_QGEN_WORK || path.join(os.homedir(), "prep-data", "qgen");
function qgenEnv() {
  const e = { ...process.env, PREP_QGEN_WORK: WORK };
  try {
    if (!e.CLOUDFLARE_API_TOKEN) e.CLOUDFLARE_API_TOKEN = fs.readFileSync(os.homedir() + "/.config/stewardmd/cloudflare.env", "utf8").replace(/\s+/g, "");
  } catch (x) {}
  return e;
}
const API = "https://stewardmd.in/api/prep/bank/";
const BUDGET_BATCH = 7; // USD; owner cap is $8, keep $1 headroom for a repair round
const argv = process.argv.slice(2);
const say = (...a) => console.log(...a);

function topics() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "prep", "nucleus360", "topics.json"), "utf8")).topics;
}
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.json();
}
async function moduleItems(s, m) {
  const c = path.join(BANK, s + "-" + m + ".json");
  if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8")).items || [];
  const j = await getJSON(API + "v5/" + s + "/mcq/" + m + ".json");
  fs.mkdirSync(BANK, { recursive: true });
  fs.writeFileSync(c, JSON.stringify({ items: j.items || [] }));
  return j.items || [];
}
function trimItem(it, max) {
  const o = (it.o || []).join(" / ");
  let s = "Q: " + (it.q || "") + "\nA: " + o + "\nWhy: " + (it.exp || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}
/* want(topic) -> [{ concept, k }]: 1 new MCQ per text gap, 2 for core gaps. img gaps need images: skipped. */
export function want(topic) {
  const tiers = Object.fromEntries((topic.outline || []).map((c) => [c.id, c.tier]));
  return (topic.coverage.gaps || []).filter((g) => g !== "img").map((g) => {
    const c = (topic.outline || []).find((x) => x.id === g) || { id: g, title: g };
    return { concept: c, k: tiers[g] === "core" ? 2 : 1 };
  });
}
export function countFor(topic) { return want(topic).reduce((a, w) => a + w.k, 0); }

/* Grounding source for one topic: chapter context from approved bank items of the
 * covered concepts (2 each, trimmed) + the named gap concepts with quotas. Where
 * NICE covers a point NICE wins; India/US guidance must be labelled as such. */
export async function buildSource(topic) {
  let items = [];
  for (const [s, m] of topic.modules || []) {
    try { items = items.concat(await moduleItems(s, m)); }
    catch (e) { say("  offline module skipped: " + s + "/" + m); }
  }
  const matched = N.matchConcepts(topic.outline, items, topic.type);
  const ctx = [];
  for (const c of topic.outline || []) {
    if ((topic.coverage.gaps || []).includes(c.id)) continue;
    for (const id of (matched.assign[c.id] || []).slice(0, 2)) {
      const it = items.find((x) => x.id === id);
      if (it) ctx.push("[" + c.title + "]\n" + trimItem(it, 520));
    }
  }
  const gaps = want(topic);
  const head = ["# " + topic.title + " (Nucleus360 gap-fill; exam: NEET-PG)",
    "Clinical guideline precedence: where NICE covers a point, NICE wins; India/US guidance must be labelled as such.",
    "Write single-best-answer clinical MCQs with 4 options, a blind-checkable key, a reasoning-pattern explanation and verified references only.",
    "",
    "## Concepts with NO approved question yet: write the quota for EACH",
    ...gaps.map((w) => "- " + w.concept.title + " [" + w.concept.id + ", " + (w.concept.tier || "?") + "]: " + w.k + " new MCQ(s)"),
    "",
    "## Approved chapter context (same chapter; do not copy these stems)",
    ""].join("\n");
  let text = head + ctx.join("\n\n---\n");
  if (text.length > 30000) text = text.slice(0, 30000);
  fs.mkdirSync(SRC, { recursive: true });
  const f = path.join(SRC, topic.id + ".md");
  fs.writeFileSync(f, text);
  return { file: f, chars: text.length, n: countFor(topic), ctxItems: ctx.length };
}

function bankArgs(topic) {
  return (topic.modules || []).map(([s, m]) => "v5/" + s + "/mcq/" + m + ".json").join(",");
}
function toks(s) { return String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []; }
/* Focused repair source: for each still-missing gap (guide gaps excluded: they need
 * curated guideline sources, not chapter vocabulary), the top-overlap bank items as
 * vocabulary plus a write-only-these quota. */
export async function buildRepairSource(topic, missing) {
  let items = [];
  for (const [s, m] of topic.modules || []) {
    try { items = items.concat(await moduleItems(s, m)); }
    catch (e) {}
  }
  const scored = items.map((it) => {
    const tk = toks([it.q, (it.o || []).join(" "), it.exp].join(" "));
    return { it, tk };
  });
  const secs = [];
  for (const cid of missing) {
    const c = (topic.outline || []).find((x) => x.id === cid) || { id: cid, title: cid };
    const gw = new Set(toks(c.title).filter((w) => w.length > 2));
    const ranked = scored.map((s) => ({ s, n: s.tk.filter((w) => w.length > 2 && gw.has(w)).length }))
      .sort((a, b) => b.n - a.n).slice(0, 5);
    secs.push("## Write 2 new MCQs ONLY on: " + c.title + " [" + cid + "]",
      "Chapter vocabulary (do not copy these stems):",
      ...ranked.map((r) => "- " + trimItem(r.s.it, 380)));
  }
  const head = ["# " + topic.title + " (Nucleus360 repair; exam: NEET-PG)",
    "Clinical guideline precedence: where NICE covers a point, NICE wins; India/US guidance must be labelled as such.",
    "Write single-best-answer clinical MCQs with 4 options, a blind-checkable key, a reasoning-pattern explanation and verified references only.",
    "Every question must test one of the gap concepts below. Do not write questions on any other concept.",
    ""].join("\n");
  const text = (head + "\n" + secs.join("\n")).slice(0, 30000);
  const f = path.join(SRC, "r2-" + topic.id + ".md");
  fs.writeFileSync(f, text);
  return { file: f, chars: text.length, n: missing.length * 2 };
}

async function cmdRepair() {
  const gap = JSON.parse(fs.readFileSync("/tmp/n360-gapfill.json", "utf8"));
  const missByTopic = Object.fromEntries(gap.cov.map((c) => [c.id, c.missing.filter((m) => m !== "guide")]));
  // Topics whose job yielded nothing at all: all their text gaps are missing.
  for (const t of topics()) {
    if (!(t.id in missByTopic)) missByTopic[t.id] = want(t).filter((w) => w.concept.id !== "guide").map((w) => w.concept.id);
  }
  const jobs = JSON.parse(fs.readFileSync(JOBS, "utf8"));
  const cfg = E.qgenConfig({ ANTHROPIC_API_KEY: "x".repeat(20), PREP_QGEN_ON: "1" });
  let tb = 0;
  for (const t of topics()) {
    const missing = missByTopic[t.id] || [];
    let key = t.id + "#r2", k = 2;
    while (jobs[key]) { k++; key = t.id + "#r" + k; }
    if (!missing.length || k > 3) continue;
    const r = await buildRepairSource(t, missing);
    const est = QGEN.estimateJob(QGEN.plan({ text: fs.readFileSync(r.file, "utf8"), n: r.n, chunkChars: 40000 }), cfg);
    tb += est.batch;
    const [s, m] = (t.modules || [])[0] || ["medicine", "med-misc"];
    const out = runQgen(["--source", r.file, "--topic", "Nucleus360 repair " + t.title, "--count", String(r.n),
      "--exam", "neet-pg", "--subject", s, "--module", m, "--bank", bankArgs(t),
      "--env", os.homedir() + "/.config/stewardmd/anthropic.env", "--run"]);
    say(t.title + " repair " + r.n + " Qs batch $" + est.batch.toFixed(4) + " -> " + out.trim().split("\n").slice(-1));
    const jm = out.match(/Job (\w+)/);
    if (jm) jobs[key] = { job: jm[1], stage: "gen", genUsage: null, topic: t.id };
    fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
  }
  say("repair batch estimate total: $" + tb.toFixed(4));
}

async function cmdSources() {
  for (const t of topics()) {
    const w = want(t);
    if (!w.length) { say(t.title + ": no text gaps, skipped"); continue; }
    const r = await buildSource(t);
    say(t.title + ": " + r.n + " Qs, " + r.ctxItems + " context items, " + r.chars + " chars -> " + r.file);
  }
}

async function cmdEstimate() {
  const cfg = E.qgenConfig({ ANTHROPIC_API_KEY: "x".repeat(20), PREP_QGEN_ON: "1" });
  let tb = 0, td = 0, tn = 0;
  for (const t of topics()) {
    const n = countFor(t);
    if (!n) continue;
    const f = path.join(SRC, t.id + ".md");
    if (!fs.existsSync(f)) { say("missing source (run --sources): " + t.id); process.exit(2); }
    const parts = QGEN.plan({ text: fs.readFileSync(f, "utf8"), n, chunkChars: 40000 });
    const est = QGEN.estimateJob(parts, cfg);
    tb += est.batch; td += est.direct; tn += est.questions;
    say(t.title + ": " + n + " Qs in " + parts.length + " part(s), batch $" + est.batch.toFixed(4) + ", direct $" + est.direct.toFixed(4));
  }
  say("TOTAL: " + tn + " Qs, batch $" + tb.toFixed(4) + ", direct $" + td.toFixed(4) + " (cap: batch <= $" + BUDGET_BATCH + ")");
  if (tb > BUDGET_BATCH) { say("OVER BUDGET: shrink quotas and re-run."); process.exit(1); }
}

function runQgen(args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/prep-qgen.mjs"), ...args], { encoding: "utf8", env: qgenEnv() });
  return (r.stdout || "") + (r.stderr || "");
}

async function cmdSubmit() {
  const jobs = fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, "utf8")) : {};
  for (const t of topics()) {
    const n = countFor(t);
    if (!n || jobs[t.id]) continue;
    const [s, m] = (t.modules || [])[0] || ["medicine", "med-misc"];
    const out = runQgen(["--source", path.join(SRC, t.id + ".md"), "--topic", "Nucleus360 " + t.title, "--count", String(n),
      "--exam", "neet-pg", "--subject", s, "--module", m, "--bank", bankArgs(t),
      "--env", os.homedir() + "/.config/stewardmd/anthropic.env", "--run"]);
    say(t.title + " -> " + out.trim().split("\n").slice(-2).join(" | "));
    const jm = out.match(/Job (\w+)/);
    if (jm) jobs[t.id] = { job: jm[1], stage: "gen", genUsage: null };
    fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
  }
  say("jobs recorded in " + JOBS);
}

async function cmdPoll() {
  const jobs = JSON.parse(fs.readFileSync(JOBS, "utf8"));
  let pending = true, rounds = 0;
  while (pending && rounds < 120) {
    rounds++; pending = false;
    for (const [tid, j] of Object.entries(jobs)) {
      if (j.stage === "done") continue;
      pending = true;
      const jf = path.join(WORK, j.job, "job.json");
      const out = runQgen(["--resume", j.job, "--env", os.homedir() + "/.config/stewardmd/anthropic.env"]);
      say(tid + ": " + out.trim().split("\n").slice(-1));
      if (fs.existsSync(jf)) {
        const jj = JSON.parse(fs.readFileSync(jf, "utf8"));
        if (jj.stage === "verify" && !j.genUsage) { j.genUsage = jj.usage; fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1)); }
        if (jj.stage === "done") j.stage = "done";
      }
    }
    if (pending) await new Promise((r) => setTimeout(r, 180000));
  }
  fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
  say(pending ? "still pending after " + rounds + " rounds" : "all jobs done");
}

/* Kept items: passed every gate (qg.v ok/approved), matched to a gap concept, at most
 * the quota per gap; exact-stem duplicates against the bank are dropped. */
async function cmdCollect() {
  const jobs = JSON.parse(fs.readFileSync(JOBS, "utf8"));
  const byTopic = {};
  for (const [key, j] of Object.entries(jobs)) {
    const tid = j.topic || key;
    (byTopic[tid] || (byTopic[tid] = [])).push(j);
  }
  const kept = {}, stats = {};
  for (const t of topics()) {
    const js = byTopic[t.id] || [];
    if (!js.length) continue;
    const bankStems = new Set();
    for (const [s, m] of t.modules || []) {
      try { for (const it of await moduleItems(s, m)) if (it.q) bankStems.add(E.stemHash(it.q)); } catch (e) {}
    }
    let passed = [];
    for (const j of js) {
      const f = path.join(WORK, j.job, "items.json");
      if (!fs.existsSync(f)) continue;
      const jj = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const it of jj.items || []) {
        if (it && it.q && it.qg && (it.qg.v === "ok" || it.qg.approved) && !bankStems.has(E.stemHash(it.q))) {
          bankStems.add(E.stemHash(it.q));
          passed.push(it);
        }
      }
    }
    const matched = N.matchConcepts(t.outline, passed.map((it, i) => ({ id: "g" + i, q: it.q, o: it.o, exp: it.exp, x: it.x })), t.type);
    const quotas = Object.fromEntries(want(t).map((w) => [w.concept.id, w.k]));
    const use = [];
    for (const [cid, ids] of Object.entries(matched.assign)) {
      const cap = quotas[cid] || 3; // gap quota, else depth extras for covered concepts
      for (const id of ids.slice(0, cap)) {
        const it = passed[Number(id.slice(1))];
        use.push({ ...it, sid: (t.modules[0] || ["medicine"])[0], t: (t.modules[0] || ["medicine", "med-misc"])[1], concept: cid, n360: t.id });
      }
    }
    kept[t.id] = use;
    stats[t.id] = "passed:" + passed.length + " kept:" + use.length;
    say(t.title + " " + stats[t.id]);
  }
  fs.writeFileSync("/tmp/n360-kept.json", JSON.stringify(kept, null, 1));
  const cov = Object.entries(kept).map(([tid, arr]) => {
    const t = topics().find((x) => x.id === tid);
    const hit = new Set(arr.map((x) => x.concept));
    return { id: tid, gaps: want(t).map((w) => w.concept.id), filled: [...hit], missing: want(t).map((w) => w.concept.id).filter((c) => !hit.has(c)) };
  });
  fs.writeFileSync("/tmp/n360-gapfill.json", JSON.stringify({ stats, cov }, null, 1));
  say("kept total: " + Object.values(kept).flat().length + " (see /tmp/n360-gapfill.json)");
}

/* Spend ledger to /tmp/topic-a-to-z-spend.tsv: date, job, model, input_tokens,
 * output_tokens, cost_usd, note. Real usage from each job file; per-phase rows
 * where the poll snapshotted the gen->verify transition, otherwise one combined
 * row (never split by estimate). */
async function cmdLedger() {
  const jobs = JSON.parse(fs.readFileSync(JOBS, "utf8"));
  const rows = [];
  const day = new Date().toISOString().slice(0, 10);
  for (const [key, j] of Object.entries(jobs)) {
    const jf = path.join(WORK, j.job, "job.json");
    if (!fs.existsSync(jf)) { rows.push([day, j.job, "?", 0, 0, 0, key + ": no job file"]); continue; }
    const jj = JSON.parse(fs.readFileSync(jf, "utf8"));
    const u = jj.usage || {};
    const sub = (a, b) => ({ inTok: (a.inTok || 0) - (b.inTok || 0), outTok: (a.outTok || 0) - (b.outTok || 0), usd: Math.round(((a.usd || 0) - (b.usd || 0)) * 1e6) / 1e6 });
    if (j.genUsage && jj.stage === "done") {
      const v = sub(u, j.genUsage);
      rows.push([day, j.job, "claude-sonnet-5-5", j.genUsage.inTok || 0, j.genUsage.outTok || 0, j.genUsage.usd || 0, key + " gen"]);
      rows.push([day, j.job, "claude-haiku-5-5", v.inTok, v.outTok, v.usd, key + " blind verify"]);
    } else {
      rows.push([day, j.job, "sonnet-5-5+haiku-5-5", u.inTok || 0, u.outTok || 0, u.usd || 0, key + " gen+verify total" + (jj.stage === "done" ? "" : " (" + jj.stage + ")")]);
    }
  }
  fs.writeFileSync("/tmp/topic-a-to-z-spend.tsv", "date\tjob\tmodel\tinput_tokens\toutput_tokens\tcost_usd\tnote\n" + rows.map((r) => r.join("\t")).join("\n") + "\n");
  const total = rows.reduce((a, r) => a + Number(r[5] || 0), 0);
  say("ledger: " + rows.length + " rows, real total $" + total.toFixed(4) + " (cap $8) -> /tmp/topic-a-to-z-spend.tsv");
}

const cmd = argv[0];
if (cmd === "--sources") await cmdSources();
else if (cmd === "--estimate") await cmdEstimate();
else if (cmd === "--submit") await cmdSubmit();
else if (cmd === "--poll") await cmdPoll();
else if (cmd === "--collect") await cmdCollect();
else if (cmd === "--repair") await cmdRepair();
else if (cmd === "--ledger") await cmdLedger();
else { say("usage: --sources | --estimate | --submit | --poll | --collect | --repair | --ledger"); process.exit(2); }

