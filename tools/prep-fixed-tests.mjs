#!/usr/bin/env node
// Pre-built common tests (owner 2026-10-11): the same ready-made papers for every student, listed in the Tests tab,
// not assembled per student. Dev-only, never shipped. $0 AI.
//
// For each exam profile (FMGE, NEET-PG, INI-CET, NEET-SS, USMLE Step 1) and each format (grand, part, mini,
// subject mini, topic, daily10 sets, image-based, PYQ-based) this calls the ONE assembler (prep-assess.js
// assemble(), never a second one) with fixed seeds and writes immutable versioned papers:
//
//   <out>/index.json                          the listing the Tests tab reads (uploaded last, short cache)
//   <out>/<exam>/<format>/<paperId>.json     one paper: question locators + metadata, no question text
//
// served from R2 prep-bank/v1/tests/ through /api/prep/bank/ (functions/api/prep/bank/[[path]].js TESTS_RE).
// Upload with the bank uploader (manifest/index last, like everything there):
//   node tools/prep-upload-bank.mjs --dir <out> --as v1/tests [--yes] --no-ids
// (papers hold IDs only, so the share-ID index needs no rebuild).
//
// RUN (dry run first: no upload, no writes outside --cache/--out)
//   node tools/prep-fixed-tests.mjs fetch [--cache ~/prep-data/fixed-tests/cache] [--api URL] [--jobs 8]
//   node tools/prep-fixed-tests.mjs census [--cache ...]            eligible pools per exam and format; no writes
//   node tools/prep-fixed-tests.mjs build [--cache ...] [--out ...] [--dry] [--exam ID] [--format F]
//   node tools/prep-fixed-tests.mjs verify [--cache ...] [--out ...]
//   node tools/prep-fixed-tests.mjs report [--out ...]              markdown to stdout (per exam/format counts)
//
// Rules. Only eligible questions (assembler eligible(): no flag, not withdrawn, no quality blocker; disputed keys
// out) enter a paper; there is no item-quality sidecar on the server yet, so no status filter applies, and --quality
// <dir> takes one when it exists. The blueprint is honoured (official quotas shrink, never borrow); no duplicate id
// or stem inside a paper (the assembler guarantees it); grand papers overlap as little as possible (per-exam usage
// is tracked and passed as the assembler's soft `recent` preference, so fresh questions come first). Gaps are never
// filled with unrelated questions: a refused paper is recorded as a shortfall and fewer papers ship. Papers are
// immutable: an existing paper file is never overwritten (identical rebuilds are skipped byte-identical, changed
// content under an old id is an error), and numbering continues past existing papers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const need = createRequire(import.meta.url);
const A = need(path.join(ROOT, "prep-assess.js"));
const PURE = need(path.join(ROOT, "prep.js"));

export const TESTS_VER = "v1";
export const PAPER_SCHEMA = "prep/fixed-paper/v1";
// The five exams of the owner request (ini-ss is a profile but not a common-tests exam).
export const EXAMS = [
  { profile: "fmge", tab: "fmge", branch: "mbbs", tag: "fmge", all: true },
  { profile: "neet-pg", tab: "neet-pg", branch: "mbbs", tag: "neet-pg" },
  { profile: "ini-cet", tab: "neet-pg", branch: "mbbs", tag: "ini-cet" },
  { profile: "neet-ss", tab: "neet-ss", branch: "ss-medicine", tag: "neet-ss" },
  { profile: "usmle-step1", tab: "usmle", branch: "mbbs", tag: "usmle" },
];
export const FORMATS = ["grand", "part", "mini", "subject_mini", "topic", "daily10", "image", "pyq"];
// Papers requested per format. Topic papers are one per major topic (TOP_PER_SUBJECT biggest per subject,
// at least TOPIC_MIN bank questions); subject minis per subject.
export const ASK = { grand: 15, part: 5, mini: 15, subject_mini: 2, topic: 1, daily10: 15, image: 5, pyq: 5 };
export const TOPIC_MIN = 50;          // a "major" topic: the TOP_PER_SUBJECT biggest topics per subject (mixed group excluded)
export const TOP_PER_SUBJECT = 5;   // ... with at least TOPIC_MIN bank questions each
export const SET_COUNT = 20;          // subject mini, topic, image and PYQ sets
export const DEFAULT_API = "https://stewardmd.in/api/prep/bank/";
export const DEFAULT_CACHE = path.join(os.homedir(), "prep-data", "fixed-tests", "cache");

/* ---------- taxonomy, versions, scope (mirrors prep.js subjectsOf/bvOf) ---------- */
export function loadTaxonomy(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, "prep", "taxonomy.json"), "utf8"));
}
export function appVersions(root = ROOT) {
  const src = fs.readFileSync(path.join(root, "prep.js"), "utf8");
  const ver = /VER = G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(src)[1];
  const pyq = /PYQ_VER = G\.SMD_PREP_PYQ_VER \|\| "(v\d+)"/.exec(src)[1];
  return { ver, pyq };
}
export function bvOf(tax, ver, sid) {
  for (const b of tax.branches) for (const s of b.subjects) if (s.id === sid) return s.bv || ver;
  return ver;
}
export function subjectName(tax, sid) {
  for (const b of tax.branches) for (const s of b.subjects) if (s.id === sid) return (s.name && s.name.en) || sid;
  return sid;
}
// Subjects in a common-tests exam's scope (exam tags in prep/taxonomy.json, like the app's subjectsOf).
export function scopeSubjects(tax, exam) {
  const out = [];
  for (const b of tax.branches) {
    if (b.id !== exam.branch) continue;
    for (const s of b.subjects) if (exam.all || !s.ex || s.ex.indexOf(exam.tag) >= 0) out.push(s.id);
  }
  return out;
}
export function examLabel(profileId) {
  const p = A.profile(profileId);
  return p ? p.name : profileId;
}

/* ---------- paper ids, titles, seeds ---------- */
const NN = (n) => String(n).padStart(2, "0");
export function paperIdFor(exam, format, key, n) {
  if (format === "grand") return `${exam}-grand-${NN(n)}`;
  if (format === "part") return `${exam}-part${key}-${NN(n)}`;
  if (format === "mini") return `${exam}-mini-${NN(n)}`;
  if (format === "subject_mini") return `${exam}-sub-${key}-${n}`;
  if (format === "topic") return `${exam}-topic-${String(key).replace("|", "-")}`;
  if (format === "daily10") return `${exam}-daily10-${NN(n)}`;
  if (format === "image") return `${exam}-image-${NN(n)}`;
  if (format === "pyq") return `${exam}-pyq-${NN(n)}`;
  throw new Error("unknown format " + format);
}
export function paperTitle(exam, format, key, n, label) {
  const E = examLabel(exam);
  if (format === "grand") return `${E} Grand Test ${NN(n)}`;
  if (format === "part") return `${E} Part ${key} Test ${NN(n)}`;
  if (format === "mini") return `${E} Section Test ${NN(n)}`;
  if (format === "subject_mini") return `${E} ${label} Test ${n}`;
  if (format === "topic") return `${label} Test`;
  if (format === "daily10") return `${E} Daily 10 Set ${NN(n)}`;
  if (format === "image") return `${E} Image Test ${NN(n)}`;
  if (format === "pyq") return `${E} PYQ Set ${NN(n)} (recall)`;
  throw new Error("unknown format " + format);
}
export function seedFor(exam, format, key, n) {
  return `fixed-tests/${TESTS_VER}/${exam}/${format}/${key || "all"}/${NN(n)}`;
}
// A paper's assembly plan: { asmType, profile, opts }. Part 2 runs through a derived profile whose part-2 sections
// are relabelled part 1, so the assembler's own "part" path builds them (labels stay 2A/2B/2C in the record).
export function planFor(profileId, format, key) {
  const p = A.profile(profileId);
  if (!p) throw new Error("no profile " + profileId);
  if (format === "grand" || format === "mini" || format === "daily10") return { asmType: format, profile: p, opts: {} };
  if (format === "part") {
    if (!p.format.parts) return null;
    if (String(key) === "1") return { asmType: "part", profile: p, opts: {} };
    const secs = p.format.sections.filter((s) => String(s.part) === String(key));
    if (!secs.length) return null;
    const d = JSON.parse(JSON.stringify(p));
    d.format.sections = secs.map((s) => ({ ...s, part: 1 }));
    d.format.questions = secs.reduce((a, s) => a + s.questions, 0);
    d.format.duration_min = secs.reduce((a, s) => a + s.minutes, 0);
    return { asmType: "part", profile: d, opts: {} };
  }
  if (format === "subject_mini") return { asmType: "subject_mini", profile: p, opts: { count: SET_COUNT, subjects: [key] } };
  if (format === "topic") {
    const [sid, mid] = String(key).split("|");
    return { asmType: "topic", profile: p, opts: { count: SET_COUNT, subjects: [sid], modules: [mid] } };
  }
  if (format === "image") return { asmType: "custom", profile: p, opts: { count: SET_COUNT, image: true } };
  if (format === "pyq") return { asmType: "custom", profile: p, opts: { count: SET_COUNT, pyq: true } };
  throw new Error("unknown format " + format);
}
export function scopeFor(tax, exam, format, key) {
  const E = examLabel(exam);
  if (format === "part") return `Part ${key} · all ${E} subjects`;
  if (format === "subject_mini") return subjectName(tax, key);
  if (format === "topic") return String(key).split("|")[1];
  if (format === "pyq") return "NEET-PG recall 2017-2025";
  if (format === "image") return `Image questions · all ${E} subjects`;
  if (format === "daily10") return `Mixed subjects · ${E} pace and marking`;
  if (format === "mini") return `One section · all ${E} subjects`;
  return `All ${E} subjects`;
}

/* ---------- fetch: live bank modules + PYQ into a disk cache (resumable) ---------- */
async function getJSON(url, tries = 4) {
  let err = null;
  for (let t = 1; t <= tries; t++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) { err = e; await new Promise((r) => setTimeout(r, 800 * t)); }
  }
  throw err;
}
function readCache(f) {
  try { const j = JSON.parse(fs.readFileSync(f, "utf8")); return j && typeof j === "object" ? j : null; } catch { return null; }
}
// Every module file the build reads: non-mixed topics with questions (the Tests 2 scope), per subject bank version.
export async function fetchBank({ cache = DEFAULT_CACHE, api = DEFAULT_API, jobs = 8, log = () => {} } = {}) {
  api = api.replace(/\/?$/, "/");
  const tax = loadTaxonomy(), { ver, pyq } = appVersions();
  const subjects = [...new Set(EXAMS.flatMap((e) => scopeSubjects(tax, e)))].sort();
  const want = [];
  for (const sid of subjects) {
    const bv = bvOf(tax, ver, sid);
    const ixP = `${bv}/${sid}/index.json`, ixF = path.join(cache, ixP);
    let ix = readCache(ixF);
    if (!ix || !Array.isArray(ix.topics)) { ix = await getJSON(api + ixP); fs.mkdirSync(path.dirname(ixF), { recursive: true }); fs.writeFileSync(ixF, JSON.stringify(ix)); }
    for (const t of ix.topics || []) {
      if (t.group === "mixed" || !(t.count > 0)) continue;
      want.push({ rel: `${bv}/${sid}/mcq/${t.id}.json`, sid, mid: t.id });
    }
  }
  let done = 0, fetched = 0;
  const one = async (w) => {
    const f = path.join(cache, w.rel);
    const hit = readCache(f);
    if (!hit || !Array.isArray(hit.items)) {
      const j = await getJSON(api + w.rel);
      if (!j || !Array.isArray(j.items)) throw new Error("no items in " + w.rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(j));
      fetched++;
    }
    if (++done % 200 === 0) log(`  ${done}/${want.length} modules`);
  };
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => { while (i < want.length) await one(want[i++]); }));
  // PYQ recall papers (the items file the live index names).
  const pyqIx = await getJSON(api + `${pyq}/pyq/index.json`);
  const pyqF = path.join(cache, `${pyq}/pyq`, pyqIx.file);
  let pyqFetched = 0;
  if (!readCache(pyqF)) {
    const j = await getJSON(api + `${pyq}/pyq/` + pyqIx.file);
    fs.mkdirSync(path.dirname(pyqF), { recursive: true });
    fs.writeFileSync(pyqF, JSON.stringify(j));
    pyqFetched = 1;
  }
  fs.writeFileSync(path.join(cache, "pyq-index.json"), JSON.stringify(pyqIx));
  log(`bank cache: ${want.length} module files (+PYQ), ${fetched + pyqFetched} fetched, ${want.length - fetched} reused`);
  return { subjects, modules: want.length };
}

/* ---------- load: slim pools per subject, exactly what assemble() reads ---------- */
const slim = (it, s, m) => ({ id: it.id, q: it.q, o: it.o, a: it.a, flags: it.flags, img: it.img, stack: it.stack, d: it.d, vh: it.vh, ex: it.ex, _s: s, _m: m });
export function loadSubject(cache, tax, ver, sid) {
  const bv = bvOf(tax, ver, sid);
  const ix = readCache(path.join(cache, `${bv}/${sid}/index.json`));
  if (!ix) throw new Error("not fetched: " + sid + " (run fetch first)");
  const lists = [];
  for (const t of ix.topics || []) {
    if (t.group === "mixed" || !(t.count > 0)) continue;
    const j = readCache(path.join(cache, `${bv}/${sid}/mcq/${t.id}.json`));
    if (!j) throw new Error("not fetched: " + sid + "/" + t.id);
    lists.push({ s: sid, m: t.id, items: (j.items || []).map((it) => slim(it, sid, t.id)) });
  }
  return { bv, lists };
}
// USMLE papers draw vignettes per module exactly like the app (prep.js poolFor); other exams pass every item
// through and let eligible() decide.
export function examLists(cache, tax, ver, exam) {
  const out = [], bank = {};
  for (const sid of scopeSubjects(tax, exam)) {
    const { bv, lists } = loadSubject(cache, tax, ver, sid);
    (bank[bv] || (bank[bv] = [])).push(sid);
    for (const l of lists) out.push(exam.profile === "usmle-step1" ? { ...l, items: PURE.poolFor(l.items, "usmle") } : l);
  }
  Object.values(bank).forEach((v) => v.sort());
  return { lists: out, bank };
}
export function loadPyq(cache, pyqVer) {
  const ix = readCache(path.join(cache, "pyq-index.json"));
  if (!ix) throw new Error("PYQ not fetched (run fetch first)");
  const keep = {};
  for (const p of ix.papers || []) {
    if (p.exam !== "neet-pg" || p.kind !== "recall" || !(p.year >= 2017)) continue; // AIPGMEE: topic sets only, never a timed paper
    for (const id of p.items || []) keep[id] = 1;
  }
  const j = readCache(path.join(cache, `${pyqVer}/pyq`, ix.file));
  if (!j) throw new Error("PYQ items not fetched");
  return { lists: [{ s: "pyq", m: "mix", items: (j.items || []).filter((it) => keep[it.id]).map((it) => slim(it, "pyq", "mix")) }], papers: (ix.papers || []).filter((p) => p.exam === "neet-pg" && !(p.year < 2017)).map((p) => p.id) };
}
export function loadQuality(dir) {
  const out = {};
  if (!dir) return out;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) Object.assign(out, A.readQuality(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
  return out;
}
// Eligible pool sizes per subject (assembler eligible() + the format's own filters), for census and shortfalls.
export function poolSizes(lists, opts = {}) {
  const sizes = {};
  for (const l of lists) {
    let n = 0;
    for (const it of l.items) {
      if (A.eligible(it, { quality: opts.quality }, opts.asmType)) continue;
      if (opts.image && !A.hasImage(it)) continue;
      n++;
    }
    sizes[l.s] = (sizes[l.s] || 0) + n;
  }
  return sizes;
}

/* ---------- build: one paper is one assembler call with a fixed seed ---------- */
export function majorTopics(cache, tax, ver, exam) {
  const out = [];
  for (const sid of scopeSubjects(tax, exam)) {
    const ix = readCache(path.join(cache, `${bvOf(tax, ver, sid)}/${sid}/index.json`));
    const ts = [];
    for (const t of (ix && ix.topics) || []) {
      if (t.group === "mixed" || !(t.count >= TOPIC_MIN)) continue;
      ts.push({ sid, mid: t.id, title: (t.title && t.title.en) || t.id, count: t.count });
    }
    ts.sort((a, b) => b.count - a.count || (a.mid < b.mid ? -1 : 1));
    out.push(...ts.slice(0, TOP_PER_SUBJECT));
  }
  return out.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : a.mid < b.mid ? -1 : 1));
}
// buildPaper: assemble + wrap as a paper. Returns { paper } or { shortfall }. used ({id:1}) is the per-exam usage
// map: passed as the assembler's soft `recent` so fresh questions come first, then credited with the paper's ids.
export function buildPaper(tax, examId, format, key, n, bankLists, bankVers, used, quality, createdAt, label) {
  const plan = planFor(examId, format, key);
  if (!plan) return { shortfall: { id: paperIdFor(examId, format, key, n), reason: `format ${format} does not apply to ${examId}` } };
  const seed = seedFor(examId, format, String(key || "all"), n);
  const opts = { ...plan.opts, seed, recent: used, quality };
  const r = A.assemble(plan.profile, plan.asmType, opts, bankLists);
  const id = paperIdFor(examId, format, key, n);
  if (!r.ok) return { shortfall: { id, reason: r.refused || "refused", requested: r.requested, eligible: countEligible(bankLists, plan, quality) } };
  for (const it of r.items) used[String(it.id)] = 1;
  const name = label || (format === "subject_mini" ? subjectName(tax, key) : String(key));
  const paper = {
    schema: PAPER_SCHEMA, id, v: 1, exam: examId, format,
    title: paperTitle(examId, format, key, n, name),
    count: r.count, duration_sec: r.duration_sec, scope: scopeFor(tax, examId, format, key), seed,
    profile: { id: plan.profile.id, version: plan.profile.version }, test_type: plan.asmType,
    blueprint: { id: r.blueprint.id, version: r.blueprint.version },
    planned: r.planned, actual: r.actual, deviations: r.deviations,
    sections: r.sections ? r.sections.map((s) => ({ id: s.id, label: s.label, n: s.n, sec: s.sec, from: s.from, to: s.to })) : null,
    bank: bankVers, createdAt,
    items: r.items.map((it) => [it._s, it._m, String(it.id)]),
  };
  if (r.reduced) paper.reduced_from = r.requested;
  return { paper };
}
function countEligible(bankLists, plan, quality) {
  let n = 0;
  for (const l of bankLists) {
    if (plan.opts.subjects && plan.opts.subjects.indexOf(l.s) < 0) continue;
    if (plan.opts.modules && plan.opts.modules.indexOf(l.m) < 0) continue;
    for (const it of l.items) {
      if (A.eligible(it, { quality }, plan.asmType)) continue;
      if (plan.opts.image && !A.hasImage(it)) continue;
      n++;
    }
  }
  return n;
}
// Full request list for one exam: [format, key, n] in build order (grands first, so they get first pick).
// startAt {"<exam>/<format>": n} continues NN numbering past existing papers (new papers, new IDs).
export function requestList(tax, cache, ver, exam, onlyFormat, startAt = {}) {
  const req = [];
  const fmts = onlyFormat ? [onlyFormat] : FORMATS;
  const parts = (A.profile(exam.profile) || {}).format || {};
  for (const f of fmts) {
    if (f === "part" && !parts.parts) continue;
    if (f === "pyq" && exam.profile !== "neet-pg") continue;
    if (f === "grand" || f === "mini" || f === "daily10" || f === "image" || f === "pyq") {
      const from = (startAt[`${exam.profile}/${f}`] || 0) + 1;
      for (let n = from; n < from + ASK[f]; n++) req.push([f, "all", n]);
    } else if (f === "part") {
      const ps = [...new Set((parts.sections || []).map((s) => String(s.part || "1")))].sort();
      for (const p of ps) {
        const from = (startAt[`${exam.profile}/part`] || 0) + 1;
        for (let n = from; n < from + ASK.part; n++) req.push(["part", p, n]);
      }
    } else if (f === "subject_mini") {
      for (const sid of scopeSubjects(tax, exam)) for (let n = 1; n <= ASK.subject_mini; n++) req.push(["subject_mini", sid, n]);
    } else if (f === "topic") {
      for (const t of majorTopics(cache, tax, ver, exam)) req.push(["topic", `${t.sid}|${t.mid}`, 1]);
    }
  }
  return req;
}
export function topicTitle(cache, tax, ver, sid, mid) {
  const ix = readCache(path.join(cache, `${bvOf(tax, ver, sid)}/${sid}/index.json`));
  for (const t of (ix && ix.topics) || []) if (t.id === mid) return (t.title && t.title.en) || mid;
  return mid;
}
export function buildExam({ tax, cache, ver, pyqVer, exam, quality = {}, createdAt, onlyFormat = null, startAt = {}, priorUsed = [], log = () => {} }) {
  const { lists, bank } = examLists(cache, tax, ver, exam);
  const pyq = exam.profile === "neet-pg" ? loadPyq(cache, pyqVer) : null;
  const used = {};
  for (const id of priorUsed) used[id] = 1;
  const papers = [], shortfalls = [];
  for (const [format, key, n] of requestList(tax, cache, ver, exam, onlyFormat, startAt)) {
    const bankLists = format === "pyq" ? pyq.lists : lists;
    const bankVers = format === "pyq" ? { [pyqVer + "/pyq"]: ["pyq"] } : bank;
    // Topic titles come from the live index.
    const label = format === "topic" ? topicTitle(cache, tax, ver, key.split("|")[0], key.split("|")[1]) : undefined;
    const r = buildPaper(tax, exam.profile, format, key, n, bankLists, bankVers, used, quality, createdAt, label);
    if (r.paper) {
      if (label) r.paper.scope = label;
      papers.push(r.paper);
    } else shortfalls.push({ exam: exam.profile, format, key, ...r.shortfall });
    if ((papers.length + shortfalls.length) % 25 === 0) log(`  ${exam.profile}: ${papers.length} papers, ${shortfalls.length} shortfalls`);
  }
  return { papers, shortfalls };
}

/* ---------- write: never overwrite a published paper ---------- */
export function paperPath(out, paper) {
  return path.join(out, paper.exam, paper.format, paper.id + ".json");
}
export function samePaper(a, b) {
  const strip = (p) => { const c = { ...p }; delete c.createdAt; return JSON.stringify(c); };
  return strip(a) === strip(b);
}
// Highest used NN per (exam, format) already on disk, so numbering continues (topic papers are one per topic).
export function startNumbers(out) {
  const start = {};
  if (!fs.existsSync(out)) return start;
  for (const exam of fs.readdirSync(out).filter((d) => fs.statSync(path.join(out, d)).isDirectory())) {
    for (const format of fs.readdirSync(path.join(out, exam)).filter((d) => fs.statSync(path.join(out, exam, d)).isDirectory())) {
      for (const f of fs.readdirSync(path.join(out, exam, format)).filter((f) => f.endsWith(".json"))) {
        const m = /-(\d{2,})\.json$/.exec(f);
        if (m) { const k = `${exam}/${format}`; start[k] = Math.max(start[k] || 0, Number(m[1])); }
      }
    }
  }
  return start;
}
export function writePapers(out, papers) {
  let wrote = 0, kept = 0;
  const conflicts = [];
  for (const paper of papers) {
    const f = paperPath(out, paper);
    if (fs.existsSync(f)) {
      const prev = JSON.parse(fs.readFileSync(f, "utf8"));
      if (samePaper(prev, paper)) { kept++; continue; }
      conflicts.push(paper.id);
      continue;
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(paper, null, 1) + "\n");
    wrote++;
  }
  if (conflicts.length) throw new Error(`refusing to overwrite ${conflicts.length} published papers with different content (new papers need new IDs): ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? "..." : ""}`);
  return { wrote, kept };
}
export function buildIndex(out, papers) {
  const rows = papers.map((p) => ({ id: p.id, exam: p.exam, format: p.format, title: p.title, count: p.count, duration_sec: p.duration_sec, scope: p.scope, path: `${p.exam}/${p.format}/${p.id}.json`, profile: p.profile.version, createdAt: p.createdAt }));
  rows.sort((a, b) => (a.exam < b.exam ? -1 : a.exam > b.exam ? 1 : a.format < b.format ? -1 : a.format > b.format ? 1 : a.id < b.id ? -1 : 1));
  const idx = { v: 1, tests: TESTS_VER, updated: new Date().toISOString(), papers: rows };
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(idx, null, 1) + "\n");
  return idx;
}
export function readOut(out) {
  const papers = [];
  if (!fs.existsSync(out)) return papers;
  for (const exam of fs.readdirSync(out).filter((d) => d !== "index.json" && fs.statSync(path.join(out, d)).isDirectory())) {
    for (const format of fs.readdirSync(path.join(out, exam)).filter((d) => fs.statSync(path.join(out, exam, d)).isDirectory())) {
      for (const f of fs.readdirSync(path.join(out, exam, format)).filter((f) => f.endsWith(".json"))) {
        papers.push(JSON.parse(fs.readFileSync(path.join(out, exam, format, f), "utf8")));
      }
    }
  }
  return papers;
}

/* ---------- validate + verify ---------- */
export function validatePaper(p) {
  const e = [];
  if (p.schema !== PAPER_SCHEMA) e.push("schema");
  if (p.v !== 1) e.push("v");
  if (!/^[a-z0-9-]+$/.test(p.id || "")) e.push("id");
  if (FORMATS.indexOf(p.format) < 0) e.push("format");
  if (!p.title || !p.scope || !p.seed) e.push("title/scope/seed");
  if (!Array.isArray(p.items) || !p.items.length) e.push("items");
  if (p.count !== (p.items || []).length) e.push(`count ${p.count} != items ${p.items && p.items.length}`);
  const seen = {};
  for (const t of p.items || []) {
    if (!Array.isArray(t) || t.length !== 3 || t.some((x) => typeof x !== "string" || !x)) { e.push("triple"); break; }
    if (seen[t[2]]) { e.push("duplicate " + t[2]); break; }
    seen[t[2]] = 1;
  }
  if (p.sections) {
    const n = p.sections.reduce((a, s) => a + s.n, 0);
    if (n !== p.count) e.push(`sections add up to ${n}, not ${p.count}`);
  }
  if (!p.profile || !p.profile.id || !p.profile.version) e.push("profile");
  if (!p.blueprint || !p.blueprint.id) e.push("blueprint");
  if (!Array.isArray(p.deviations)) e.push("deviations");
  return e;
}
// verify: every paper validates, every id resolves in the cache, the index lists exactly the papers on disk.
export function verify({ cache, out, log = () => {} }) {
  const tax = loadTaxonomy(), { ver, pyq } = appVersions();
  const papers = readOut(out);
  const errors = [];
  const have = {};
  for (const sid of [...new Set(EXAMS.flatMap((e) => scopeSubjects(tax, e)))]) {
    const bv = bvOf(tax, ver, sid);
    const ix = readCache(path.join(cache, `${bv}/${sid}/index.json`));
    for (const t of (ix && ix.topics) || []) {
      if (t.group === "mixed" || !(t.count > 0)) continue;
      const j = readCache(path.join(cache, `${bv}/${sid}/mcq/${t.id}.json`));
      for (const it of (j && j.items) || []) have[String(it.id)] = `${sid}|${t.id}`;
    }
  }
  const pyqIx = readCache(path.join(cache, "pyq-index.json"));
  const pyqJ = pyqIx && readCache(path.join(cache, `${pyq}/pyq`, pyqIx.file));
  for (const it of (pyqJ && pyqJ.items) || []) have[String(it.id)] = "pyq|mix";
  for (const p of papers) {
    for (const x of validatePaper(p)) errors.push(`${p.id}: ${x}`);
    for (const t of p.items || []) {
      if (!have[t[2]]) errors.push(`${p.id}: missing ${t[2]}`);
      else if (have[t[2]] !== `${t[0]}|${t[1]}` && t[0] !== "pyq") errors.push(`${p.id}: moved ${t[2]} (${t[0]}|${t[1]} now ${have[t[2]]})`);
    }
  }
  const idx = readCache(path.join(out, "index.json"));
  const onDisk = new Set(papers.map((p) => p.id)), listed = new Set(((idx && idx.papers) || []).map((r) => r.id));
  for (const p of papers) if (!listed.has(p.id)) errors.push(`index: ${p.id} on disk but not listed`);
  for (const id of listed) if (!onDisk.has(id)) errors.push(`index: ${id} listed but not on disk`);
  // grand overlap: the largest shared-question share between any two grand papers of an exam.
  const overlap = {};
  for (const exam of EXAMS.map((e) => e.profile)) {
    const gs = papers.filter((p) => p.exam === exam && p.format === "grand");
    let worst = 0;
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
      const a = new Set(gs[i].items.map((t) => t[2]));
      let sh = 0;
      for (const t of gs[j].items) if (a.has(t[2])) sh++;
      worst = Math.max(worst, sh / Math.max(1, gs[i].items.length));
    }
    if (gs.length > 1) overlap[exam] = Math.round(worst * 1000) / 10;
  }
  log(`verified ${papers.length} papers, ${errors.length} errors`);
  return { papers: papers.length, errors, overlap };
}

/* ---------- report ---------- */
export function reportMd({ papers, shortfalls, overlap, bankCounts }) {
  const L = ["# Fixed common tests: coverage report", ""];
  const byEF = {};
  for (const p of papers) { const k = `${p.exam} / ${p.format}`; (byEF[k] || (byEF[k] = { built: 0, reduced: [] })).built++; if (p.reduced_from) byEF[k].reduced.push(`${p.id} (${p.count}/${p.reduced_from})`); }
  const bySF = {};
  for (const s of shortfalls) { const k = `${s.exam} / ${s.format}`; ((bySF[k] || (bySF[k] = []))).push(s); }
  L.push(`Built ${papers.length} papers, ${shortfalls.length} shortfalls.`);
  if (overlap && Object.keys(overlap).length) L.push(`Worst grand-test pair overlap: ${Object.entries(overlap).map(([e, o]) => `${e} ${o}%`).join(", ")}.`);
  L.push("");
  for (const e of EXAMS.map((x) => x.profile)) {
    L.push(`## ${examLabel(e)}`);
    for (const f of FORMATS) {
      const b = byEF[`${e} / ${f}`], s = bySF[`${e} / ${f}`] || [];
      if (!b && !s.length) continue;
      L.push(`- ${f}: ${b ? b.built : 0} built${s.length ? `, ${s.length} short` : ""}${b && b.reduced.length ? ` (reduced: ${b.reduced.join("; ")})` : ""}`);
      const reasons = [...new Set(s.map((x) => x.reason))];
      for (const r of reasons.slice(0, 3)) L.push(`  - shortfall: ${r}`);
    }
    L.push("");
  }
  if (bankCounts) {
    L.push("## Bank pools (eligible questions at build time)", "");
    for (const [e, sizes] of Object.entries(bankCounts)) {
      const tot = Object.values(sizes).reduce((a, n) => a + n, 0);
      L.push(`- ${e}: ${tot} eligible (${Object.entries(sizes).map(([s, n]) => `${s} ${n}`).join(", ")})`);
    }
    L.push("");
  }
  return L.join("\n");
}

/* ---------- CLI ---------- */
const arg = (argv, k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0] || "build";
  const cache = arg(argv, "--cache", DEFAULT_CACHE);
  const out = arg(argv, "--out", path.join(path.dirname(cache), "papers", TESTS_VER));
  const log = (m) => console.log(m);
  if (cmd === "fetch") {
    await fetchBank({ cache, api: arg(argv, "--api", DEFAULT_API), jobs: Number(arg(argv, "--jobs", 8)) || 8, log });
    return;
  }
  const tax = loadTaxonomy(), { ver, pyq } = appVersions();
  const quality = loadQuality(arg(argv, "--quality", null));
  if (cmd === "census") {
    for (const exam of EXAMS) {
      const { lists } = examLists(cache, tax, ver, exam);
      const tot = poolSizes(lists, {});
      const n = Object.values(tot).reduce((a, x) => a + x, 0);
      const img = Object.values(poolSizes(lists, { image: true })).reduce((a, x) => a + x, 0);
      const topics = majorTopics(cache, tax, ver, exam).length;
      console.log(`${exam.profile}: subjects=${scopeSubjects(tax, exam).length} eligible=${n} image=${img} major_topics=${topics}`);
    }
    const pq = loadPyq(cache, pyq);
    console.log(`pyq pool (neet-pg recall 2017+): ${poolSizes(pq.lists, {}).pyq || 0} eligible`);
    return;
  }
  if (cmd === "build") {
    const dry = argv.includes("--dry");
    const onlyExam = arg(argv, "--exam", null), onlyFormat = arg(argv, "--format", null);
    // Numbering continues past existing papers unless --start restarts it (rebuilds then skip as identical).
    const startAt = argv.includes("--start") ? {} : startNumbers(out);
    const prior = readOut(out);
    const createdAt = new Date().toISOString();
    const papers = [], shortfalls = [], bankCounts = {};
    for (const exam of EXAMS.filter((e) => !onlyExam || e.profile === onlyExam)) {
      const { lists } = examLists(cache, tax, ver, exam);
      bankCounts[exam.profile] = poolSizes(lists, {});
      const priorUsed = prior.filter((p) => p.exam === exam.profile).flatMap((p) => p.items.map((t) => t[2]));
      const r = buildExam({ tax, cache, ver, pyqVer: pyq, exam, quality, createdAt, onlyFormat, startAt, priorUsed, log });
      papers.push(...r.papers);
      shortfalls.push(...r.shortfalls);
      log(`${exam.profile}: ${r.papers.length} papers, ${r.shortfalls.length} shortfalls`);
    }
    if (dry) {
      log(`dry run: ${papers.length} papers would build, ${shortfalls.length} shortfalls; nothing written`);
      return { papers, shortfalls };
    }
    const w = writePapers(out, papers);
    const idx = buildIndex(out, readOut(out));
    log(`wrote ${w.wrote}, kept ${w.kept} identical; index lists ${idx.papers.length}`);
    const v = verify({ cache, out, log });
    if (v.errors.length) { console.error(v.errors.slice(0, 20).join("\n")); process.exitCode = 1; }
    // Beside the version folder, not inside it: everything under out/ uploads to R2 as-is.
    fs.writeFileSync(path.join(path.dirname(out), "report-input.json"), JSON.stringify({ shortfalls, overlap: v.overlap, bankCounts }, null, 1));
    return { papers, shortfalls };
  }
  if (cmd === "verify") {
    const v = verify({ cache, out, log });
    if (v.errors.length) { console.error(v.errors.slice(0, 10).join("\n")); process.exit(1); }
    return;
  }
  if (cmd === "report") {
    const papers = readOut(out);
    let extra = { shortfalls: [], overlap: {}, bankCounts: null };
    try { extra = JSON.parse(fs.readFileSync(path.join(path.dirname(out), "report-input.json"), "utf8")); } catch {}
    process.stdout.write(reportMd({ papers, shortfalls: extra.shortfalls, overlap: extra.overlap, bankCounts: extra.bankCounts }));
    return;
  }
  throw new Error("unknown command: " + cmd + " (fetch|census|build|verify|report)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });

