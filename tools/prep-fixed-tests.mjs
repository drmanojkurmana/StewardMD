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
//   node tools/prep-fixed-tests.mjs build [--cache ...] [--out ...] [--dry] [--exam ID] [--format F] [--subjects-only]
// (--subjects-only with --format image: subject image papers only, no general ones; numbering still continues)
//   node tools/prep-fixed-tests.mjs verify [--cache ...] [--out ...]
//   node tools/prep-fixed-tests.mjs report [--out ...]              markdown to stdout (per exam/format counts)
//
// Rules. Only eligible questions (assembler eligible(): no flag, not withdrawn, no quality blocker; disputed keys
// out) enter a paper; the item-quality sidecar (tools/prep-quality.mjs) applies when present (--quality <dir>
// overrides; --quality none disables). Pools are bank modules plus their overlay files, merged like the app's
// mergeOverlay (bank first, unseen overlay ids appended, sets in sorted order); a paper records the overlay sets
// its items came from (paper.overlays { subject: [sets] }) so the Tests tab resolves them. The blueprint is
// honoured (official quotas shrink, never borrow); no duplicate id
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
// The common-tests exams (ini-ss is a profile but not a common-tests exam).
// neet-ss carries ssAll: its papers cover every ss-* branch (one paper per group), not just ss-medicine.
export const EXAMS = [
  { profile: "fmge", tab: "fmge", branch: "mbbs", tag: "fmge", all: true },
  { profile: "neet-pg", tab: "neet-pg", branch: "mbbs", tag: "neet-pg" },
  { profile: "ini-cet", tab: "neet-pg", branch: "mbbs", tag: "ini-cet" },
  { profile: "neet-ss", tab: "neet-ss", branch: "ss-medicine", tag: "neet-ss", ssAll: true },
  { profile: "usmle-step1", tab: "usmle", branch: "mbbs", tag: "usmle" },
  { profile: "usmle-step2-ck", tab: "usmle", branch: "mbbs", tag: "usmle-step2-ck" },
  { profile: "plab-1", tab: "plab", branch: "uk", tag: "plab-1" },
  { profile: "mrcs-part-a", tab: "mrcs", branch: "uk", tag: "mrcs-part-a" },
  { profile: "amc-mcq", tab: "amc", branch: "intl", tag: "amc-mcq" },
  { profile: "mccqe-1", tab: "mccqe", branch: "intl", tag: "mccqe-1" },
  { profile: "mrcp-part1", tab: "mrcp", branch: "mrcp", tag: "mrcp-part1" },
  { profile: "mrcp-part2-written", tab: "mrcp", branch: "mrcp", tag: "mrcp-part2-written" },
];
export const FORMATS = ["grand", "part", "mini", "subject_mini", "topic", "daily10", "image", "pyq"];
// Papers requested per format. Topic papers are one per major topic (TOP_PER_SUBJECT biggest per subject,
// at least TOPIC_MIN bank questions); subject minis per subject.
export const ASK = { grand: 15, part: 5, mini: 15, subject_mini: 2, topic: 1, daily10: 15, image: 5, pyq: 5 };
// Per-exam overrides (papers per format; topicCount/topicMin size topic papers for smaller pools).
export const EXAM_CFG = {
  "usmle-step2-ck": { grand: 6, mini: 6, daily10: 10, subject_mini: 2, topic: 1, image: 2, topicCount: 10, topicMin: 10 },
};
export const askFor = (profile, f) => ((EXAM_CFG[profile] || {})[f] != null ? EXAM_CFG[profile][f] : ASK[f]);
// Exam-owned pool tags (profile bank.pool): pooled exams draw only their tagged items; other exams' papers
// drop them. Mirrors the Tests tab dropForeign (prep-tests.js).
export function bankPool(profileId) { const p = A.profile(profileId); return (p && p.bank && p.bank.pool) || null; }
export function allPoolTags() {
  const out = {};
  for (const id of A.profileIds()) { const q = A.profile(id); if (q && q.bank && q.bank.pool) out[q.bank.pool] = 1; }
  return out;
}
export function dropForeign(items, pt, tags = allPoolTags()) {
  if (!Object.keys(tags).length) return items;
  return (items || []).filter((it) => {
    if (!it.ex || !it.ex.length) return true;
    let home = false, foreign = false;
    for (const t of it.ex) if (tags[t]) { if (t === pt) home = true; else foreign = true; }
    return home || !foreign;
  });
}
export const TOPIC_MIN = 50;          // a "major" topic: the TOP_PER_SUBJECT biggest topics per subject (mixed group excluded)
export const TOP_PER_SUBJECT = 5;   // ... with at least TOPIC_MIN bank questions each
export const SET_COUNT = 20;          // subject mini, topic, image and PYQ sets
export const IMG_SUB2 = 80;             // a subject with >= 80 eligible image items gets two image papers ...
export const IMG_SUB1 = 22;             // ... >= 22 gets one; below that, its items only join the general image papers
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
// An exam with ssAll covers every ss-* branch (NEET-SS groups live across them).
export function scopeSubjects(tax, exam) {
  const out = [];
  for (const b of tax.branches) {
    if (b.id !== exam.branch && !(exam.ssAll && b.id.indexOf("ss-") === 0)) continue;
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
  if (format === "image") return key === "all" ? `${E} Image Test ${NN(n)}` : `${E} ${label} Image Test ${NN(n)}`;
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
    const tc = (EXAM_CFG[profileId] || {}).topicCount || SET_COUNT;
    return { asmType: "topic", profile: p, opts: { count: tc, subjects: [sid], modules: [mid] } };
  }
  if (format === "image") return key && key !== "all"
    ? { asmType: "custom", profile: p, opts: { count: SET_COUNT, image: true, subjects: [key] } }
    : { asmType: "custom", profile: p, opts: { count: SET_COUNT, image: true } };
  if (format === "pyq") return { asmType: "custom", profile: p, opts: { count: SET_COUNT, pyq: true } };
  throw new Error("unknown format " + format);
}
export function scopeFor(tax, exam, format, key) {
  const E = examLabel(exam);
  if (format === "part") return `Part ${key} · all ${E} subjects`;
  if (format === "subject_mini") return subjectName(tax, key);
  if (format === "topic") return String(key).split("|")[1];
  if (format === "pyq") return "NEET-PG recall 2017-2025";
  if (format === "image") return key === "all" ? `Image questions · all ${E} subjects` : `Image questions · ${subjectName(tax, key)}`;
  if (format === "daily10") return `Mixed subjects · ${E} pace and marking`;
  if (format === "mini") return `One section · all ${E} subjects`;
  return `All ${E} subjects`;
}

/* ---------- overlays: extra MCQs outside the bank modules (prep.js loadOverlay) ---------- */
// Committed per-module counts (tools/prep-overlay-counts.mjs): sets[set][subject][module] = items.
export function overlaySets(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "prep", "bank", "overlay-counts.json"), "utf8")).sets || {}; } catch { return {}; }
}
// Every overlay module file for exam-scope subjects, sets and modules sorted (deterministic merge order).
export function overlayFiles(tax, sets = overlaySets()) {
  const scope = new Set(EXAMS.flatMap((e) => scopeSubjects(tax, e)));
  const out = [];
  for (const set of Object.keys(sets).sort()) {
    for (const sid of Object.keys(sets[set] || {}).sort()) {
      if (!scope.has(sid)) continue;
      for (const mid of Object.keys(sets[set][sid] || {}).sort()) out.push({ set, sid, mid });
    }
  }
  return out;
}
export function overlayCached(cache) {
  let n = 0;
  const top = path.join(cache, "overlay");
  if (!fs.existsSync(top)) return 0;
  for (const set of fs.readdirSync(top)) {
    const sp = path.join(top, set);
    if (!fs.statSync(sp).isDirectory()) continue;
    for (const sid of fs.readdirSync(sp)) {
      const sidp = path.join(sp, sid);
      if (!fs.statSync(sidp).isDirectory()) continue;
      n += fs.readdirSync(sidp).filter((f) => f.endsWith(".json")).length;
    }
  }
  return n;
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
// Subjects whose live module index 404s (taxonomy lists them, the bank serves no file): the pool simply lacks
// those items. Recorded in the cache so loadSubject tells them apart from subjects never fetched.
export function skippedSubjects(cache) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cache, "skipped-index.json"), "utf8"));
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
// Every module file the build reads: non-mixed topics with questions (the Tests 2 scope), per subject bank version.
// A missing module index (live 404) skips that subject with a warning instead of aborting the fetch.
export async function fetchBank({ cache = DEFAULT_CACHE, api = DEFAULT_API, jobs = 8, log = () => {}, _get = getJSON } = {}) {
  api = api.replace(/\/?$/, "/");
  const tax = loadTaxonomy(), { ver, pyq } = appVersions();
  const subjects = [...new Set(EXAMS.flatMap((e) => scopeSubjects(tax, e)))].sort();
  const want = [], skippedIdx = [];
  for (const sid of subjects) {
    const bv = bvOf(tax, ver, sid);
    const ixP = `${bv}/${sid}/index.json`, ixF = path.join(cache, ixP);
    let ix = readCache(ixF);
    if (!ix || !Array.isArray(ix.topics)) {
      try {
        ix = await _get(api + ixP);
      } catch (e) {
        if (!/HTTP 404/.test(String((e && e.message) || e))) throw e;
        skippedIdx.push(sid); // no live index: overlay-only subject, the pool follows the overlays
        continue;
      }
      fs.mkdirSync(path.dirname(ixF), { recursive: true }); fs.writeFileSync(ixF, JSON.stringify(ix));
    }
    for (const t of ix.topics || []) {
      if (t.group === "mixed" || !(t.count > 0)) continue;
      want.push({ rel: `${bv}/${sid}/mcq/${t.id}.json`, sid, mid: t.id });
    }
  }
  if (skippedIdx.length) {
    skippedIdx.sort();
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "skipped-index.json"), JSON.stringify(skippedIdx));
    log(`  WARNING: ${skippedIdx.length} subjects have no live module index (404, skipped; pool follows the overlays): ${skippedIdx.slice(0, 8).join(", ")}${skippedIdx.length > 8 ? "..." : ""}`);
  }
  let done = 0, fetched = 0;
  const one = async (w) => {
    const f = path.join(cache, w.rel);
    const hit = readCache(f);
    if (!hit || !Array.isArray(hit.items)) {
      const j = await _get(api + w.rel);
      if (!j || !Array.isArray(j.items)) throw new Error("no items in " + w.rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(j));
      fetched++;
    }
    if (++done % 200 === 0) log(`  ${done}/${want.length} modules`);
  };
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => { while (i < want.length) await one(want[i++]); }));
  // Overlay module files (union of the committed counts; image papers draw mostly from these).
  const ovWant = overlayFiles(tax);
  let ovFetched = 0;
  const skipped = [];
  const oneOv = async (w) => {
    const rel = `overlay/${w.set}/${w.sid}/${w.mid}.json`;
    const f = path.join(cache, rel);
    const hit = readCache(f);
    if (hit && Array.isArray(hit.items)) { done++; return; }
    try {
      const j = await _get(api + rel);
      if (!j || !Array.isArray(j.items)) throw new Error("no items in " + rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(j));
      ovFetched++;
    } catch (e) {
      if (!/HTTP 404/.test(String((e && e.message) || e))) throw e;
      skipped.push(rel); // counts list a file the bank no longer serves: the pool simply lacks those items
    }
    if (++done % 200 === 0) log(`  ${done}/${want.length + ovWant.length} modules`);
  };
  let k = 0;
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => { while (k < ovWant.length) await oneOv(ovWant[k++]); }));
  // Live manifest cross-check: sets the app serves but the committed counts do not know.
  try {
    const ptr = await _get(api + "overlay/maik/index.json");
    const live = new Set();
    for (const sid of Object.keys((ptr && ptr.sets) || {})) for (const s of ptr.sets[sid]) live.add(s);
    const known = new Set(Object.keys(overlaySets()));
    const missing = [...live].filter((s) => !known.has(s)).sort();
    if (missing.length) log(`  WARNING: live overlay sets missing from prep/bank/overlay-counts.json (pool lacks them): ${missing.join(", ")}`);
  } catch (e) { log(`  WARNING: live overlay manifest unreadable (${(e && e.message) || e}); pool follows the committed counts`); }
  if (skipped.length) log(`  WARNING: ${skipped.length} overlay files 404 (${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "..." : ""})`);
  // PYQ recall papers (the items file the live index names).
  const pyqIx = await _get(api + `${pyq}/pyq/index.json`);
  const pyqF = path.join(cache, `${pyq}/pyq`, pyqIx.file);
  let pyqFetched = 0;
  if (!readCache(pyqF)) {
    const j = await _get(api + `${pyq}/pyq/` + pyqIx.file);
    fs.mkdirSync(path.dirname(pyqF), { recursive: true });
    fs.writeFileSync(pyqF, JSON.stringify(j));
    pyqFetched = 1;
  }
  fs.writeFileSync(path.join(cache, "pyq-index.json"), JSON.stringify(pyqIx));
  log(`bank cache: ${want.length} module files (+PYQ), ${fetched + pyqFetched} fetched, ${want.length - fetched} reused; overlays: ${ovWant.length} files, ${ovFetched} fetched, ${skipped.length} skipped (404)`);
  return { subjects, modules: want.length, overlays: ovWant.length, ovFetched, ovSkipped: skipped.length, idxSkipped: skippedIdx };
}

/* ---------- load: slim pools per subject, exactly what assemble() reads ---------- */
const slim = (it, s, m, ov = null) => ({ id: it.id, q: it.q, o: it.o, a: it.a, flags: it.flags, img: it.img, stack: it.stack, d: it.d, vh: it.vh, ex: it.ex, _s: s, _m: m, _ov: ov });
export function loadSubject(cache, tax, ver, sid, sets = overlaySets()) {
  const bv = bvOf(tax, ver, sid);
  const ix = readCache(path.join(cache, `${bv}/${sid}/index.json`));
  // A skipped subject (live index 404, see fetchBank) has no bank lists; its pool is the overlays alone.
  if (!ix && skippedSubjects(cache).indexOf(sid) < 0) throw new Error("not fetched: " + sid + " (run fetch first)");
  const lists = [], byMid = {};
  for (const t of (ix && ix.topics) || []) {
    if (t.group === "mixed" || !(t.count > 0)) continue;
    const j = readCache(path.join(cache, `${bv}/${sid}/mcq/${t.id}.json`));
    if (!j) throw new Error("not fetched: " + sid + "/" + t.id);
    const l = { s: sid, m: t.id, items: (j.items || []).map((it) => slim(it, sid, t.id)) };
    lists.push(l);
    byMid[t.id] = l;
  }
  // Overlay items merge in like the app's mergeOverlay: bank items first, then overlay items whose id the
  // module (bank or an earlier set) does not have, sets in sorted order. Overlay-only modules join as new lists.
  const perMid = {};
  for (const set of Object.keys(sets).sort()) {
    const sm = (sets[set] || {})[sid];
    if (!sm) continue;
    for (const mid of Object.keys(sm)) {
      const j = readCache(path.join(cache, "overlay", set, sid, mid + ".json"));
      if (!j || !Array.isArray(j.items)) continue; // not fetched: the pool simply lacks those items
      (perMid[mid] || (perMid[mid] = [])).push({ set, items: j.items });
    }
  }
  for (const mid of Object.keys(perMid)) {
    let l = byMid[mid];
    if (!l) { l = { s: sid, m: mid, items: [] }; lists.push(l); byMid[mid] = l; }
    const seen = {};
    for (const it of l.items) seen[it.id] = 1;
    for (const { set, items } of perMid[mid]) {
      for (const it of items) {
        if (!it || it.id == null || seen[it.id]) continue;
        seen[it.id] = 1;
        l.items.push(slim(it, sid, mid, set));
      }
    }
  }
  return { bv, lists };
}
// USMLE papers draw vignettes per module exactly like the app (prep.js poolFor); other exams pass every item
// through and let eligible() decide. Pooled exams (bank.pool) draw their strict pool; every exam's papers drop
// items owned by another pool.
export function examLists(cache, tax, ver, exam, sets) {
  const out = [], bank = {};
  const pt = bankPool(exam.profile), tags = allPoolTags();
  for (const sid of scopeSubjects(tax, exam)) {
    const { bv, lists } = loadSubject(cache, tax, ver, sid, sets);
    (bank[bv] || (bank[bv] = [])).push(sid);
    for (const l of lists) {
      const items = pt ? PURE.poolFor(l.items, pt, null, true) : (exam.profile === "usmle-step1" ? PURE.poolFor(l.items, "usmle") : l.items);
      out.push({ ...l, items: dropForeign(items, pt, tags) });
    }
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
export function poolCounts(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "prep", "bank", "overlay-counts.json"), "utf8")).pools || {}; } catch { return {}; }
}
export function majorTopics(cache, tax, ver, exam) {
  const out = [];
  const pt = bankPool(exam.profile), pools = pt ? (poolCounts()[pt] || {}) : null;
  const sets = overlaySets();
  const min = (EXAM_CFG[exam.profile] || {}).topicMin || TOPIC_MIN;
  for (const sid of scopeSubjects(tax, exam)) {
    const ix = readCache(path.join(cache, `${bvOf(tax, ver, sid)}/${sid}/index.json`));
    const ts = [], seenMid = {};
    for (const t of (ix && ix.topics) || []) {
      const n = pools ? ((pools[sid] || {})[t.id] || 0) : t.count;
      if (t.group === "mixed" || !(n >= min)) continue;
      seenMid[t.id] = 1;
      ts.push({ sid, mid: t.id, title: (t.title && t.title.en) || t.id, count: n });
    }
    // Overlay-only subjects have no live index: their pool modules still get topic papers (titled by module id).
    if (pools && pools[sid]) for (const mid of Object.keys(pools[sid])) {
      const n = pools[sid][mid] || 0;
      if (seenMid[mid] || !(n >= min)) continue;
      seenMid[mid] = 1;
      ts.push({ sid, mid, title: mid, count: n });
    }
    // New overlay modules (books, gap fills) no index or pool knows: summed committed counts, same threshold.
    const ovCounts = {};
    for (const set of Object.keys(sets).sort()) {
      const sm = (sets[set] || {})[sid];
      if (!sm) continue;
      for (const mid of Object.keys(sm)) ovCounts[mid] = (ovCounts[mid] || 0) + (sm[mid] || 0);
    }
    for (const mid of Object.keys(ovCounts)) {
      if (seenMid[mid] || !(ovCounts[mid] >= min)) continue;
      ts.push({ sid, mid, title: mid, count: ovCounts[mid] });
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
  // diverse: the concept-key selector spreads a paper across distinct concepts inside each blueprint quota.
  const opts = { ...plan.opts, seed, recent: used, quality, diverse: true };
  const r = A.assemble(plan.profile, plan.asmType, opts, bankLists);
  const id = paperIdFor(examId, format, key, n);
  if (!r.ok) return { shortfall: { id, reason: r.refused || "refused", requested: r.requested, eligible: countEligible(bankLists, plan, quality) } };
  for (const it of r.items) used[String(it.id)] = 1;
  const name = label || ((format === "subject_mini" || (format === "image" && key !== "all")) ? subjectName(tax, key) : String(key));
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
  // Overlay sets the paper's items came from ({ subject: [sets] }, sorted): the Tests tab merges these files
  // when the bank file lacks an item. Omitted when every item is a bank item.
  const ov = {};
  for (const it of r.items) {
    if (!it._ov) continue;
    const l = ov[it._s] || (ov[it._s] = []);
    if (l.indexOf(it._ov) < 0) l.push(it._ov);
  }
  Object.values(ov).forEach((v) => v.sort());
  if (Object.keys(ov).length) paper.overlays = ov;
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
// Subjects with enough eligible image items for their own papers: [{ sid, n }] (IMG_SUB2/IMG_SUB1).
export function imageSubjects(cache, tax, ver, exam, sets) {
  const { lists } = examLists(cache, tax, ver, exam, sets);
  const sizes = poolSizes(lists, { image: true });
  return Object.keys(sizes)
    .filter((s) => (sizes[s] || 0) >= IMG_SUB1)
    .map((s) => ({ sid: s, n: (sizes[s] || 0) >= IMG_SUB2 ? 2 : 1 }))
    .sort((a, b) => (a.sid < b.sid ? -1 : 1));
}
// Full request list for one exam: [format, key, n] in build order (grands first, so they get first pick).
// startAt {"<exam>/<format>": n} continues NN numbering past existing papers (new papers, new IDs).
// haveIds (paper ids already published) skips fixed-key papers (subject_mini, topic): existing papers are never
// rebuilt, so a grown bank yields papers only for new subjects and topics. Image papers share one NN numbering
// per exam: ASK.image general papers, then the subject papers.
export function requestList(tax, cache, ver, exam, onlyFormat, startAt = {}, subjectsOnly = false, haveIds = null) {
  const req = [];
  const push = (f, key, n) => {
    if (haveIds && haveIds.has(paperIdFor(exam.profile, f, key, n))) return;
    req.push([f, key, n]);
  };
  const fmts = onlyFormat ? [onlyFormat] : FORMATS;
  const parts = (A.profile(exam.profile) || {}).format || {};
  for (const f of fmts) {
    if (f === "part" && !parts.parts) continue;
    if (f === "pyq" && exam.profile !== "neet-pg") continue;
    if (f === "grand" || f === "mini" || f === "daily10" || f === "pyq") {
      const from = (startAt[`${exam.profile}/${f}`] || 0) + 1;
      for (let n = from; n < from + askFor(exam.profile, f); n++) push(f, "all", n);
    } else if (f === "image") {
      let n = (startAt[`${exam.profile}/image`] || 0) + 1;
      if (!subjectsOnly) for (let k = 0; k < askFor(exam.profile, "image"); k++) push("image", "all", n++);
      for (const { sid, n: cnt } of imageSubjects(cache, tax, ver, exam)) for (let k = 0; k < cnt; k++) push("image", sid, n++);
    } else if (f === "part") {
      const ps = [...new Set((parts.sections || []).map((s) => String(s.part || "1")))].sort();
      for (const p of ps) {
        const from = (startAt[`${exam.profile}/part`] || 0) + 1;
        for (let n = from; n < from + askFor(exam.profile, "part"); n++) push("part", p, n);
      }
    } else if (f === "subject_mini") {
      for (const sid of scopeSubjects(tax, exam)) for (let n = 1; n <= askFor(exam.profile, "subject_mini"); n++) push("subject_mini", sid, n);
    } else if (f === "topic") {
      for (const t of majorTopics(cache, tax, ver, exam)) push("topic", `${t.sid}|${t.mid}`, 1);
    }
  }
  return req;
}
export function topicTitle(cache, tax, ver, sid, mid) {
  const ix = readCache(path.join(cache, `${bvOf(tax, ver, sid)}/${sid}/index.json`));
  for (const t of (ix && ix.topics) || []) if (t.id === mid) return (t.title && t.title.en) || mid;
  return mid;
}
export function buildExam({ tax, cache, ver, pyqVer, exam, quality = {}, createdAt, onlyFormat = null, startAt = {}, priorUsed = [], subjectsOnly = false, haveIds = null, log = () => {} }) {
  const { lists, bank } = examLists(cache, tax, ver, exam);
  const pyq = exam.profile === "neet-pg" ? loadPyq(cache, pyqVer) : null;
  const used = {};
  for (const id of priorUsed) used[id] = 1;
  const papers = [], shortfalls = [];
  for (const [format, key, n] of requestList(tax, cache, ver, exam, onlyFormat, startAt, subjectsOnly, haveIds)) {
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
// On-disk/R2 directory per format. subject_mini lives at subject-mini (dash): the bank route rejects
// underscores, so subject_mini/ papers 404 even when uploaded (owner 2026-10-14: 302 indexed, 0 served).
export function formatDir(format) {
  return format === "subject_mini" ? "subject-mini" : format;
}
export function paperPath(out, paper) {
  return path.join(out, paper.exam, formatDir(paper.format), paper.id + ".json");
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
  const rows = papers.map((p) => ({ id: p.id, exam: p.exam, format: p.format, title: p.title, count: p.count, duration_sec: p.duration_sec, scope: p.scope, path: `${p.exam}/${formatDir(p.format)}/${p.id}.json`, profile: p.profile.version, createdAt: p.createdAt }));
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
  const have = {}; // id -> ["subject|module", ...]: one id may be served from two modules (both triples resolve)
  const mark = (id, where) => { const l = have[id] || (have[id] = []); if (l.indexOf(where) < 0) l.push(where); };
  for (const sid of [...new Set(EXAMS.flatMap((e) => scopeSubjects(tax, e)))]) {
    const bv = bvOf(tax, ver, sid);
    const ix = readCache(path.join(cache, `${bv}/${sid}/index.json`));
    for (const t of (ix && ix.topics) || []) {
      if (t.group === "mixed" || !(t.count > 0)) continue;
      const j = readCache(path.join(cache, `${bv}/${sid}/mcq/${t.id}.json`));
      for (const it of (j && j.items) || []) mark(String(it.id), `${sid}|${t.id}`);
    }
  }
  const pyqIx = readCache(path.join(cache, "pyq-index.json"));
  const pyqJ = pyqIx && readCache(path.join(cache, `${pyq}/pyq`, pyqIx.file));
  for (const it of (pyqJ && pyqJ.items) || []) mark(String(it.id), "pyq|mix");
  for (const { set, sid, mid } of overlayFiles(tax)) {
    const j = readCache(path.join(cache, "overlay", set, sid, mid + ".json"));
    for (const it of (j && j.items) || []) if (it && it.id != null) mark(String(it.id), `${sid}|${mid}`);
  }
  for (const p of papers) {
    for (const x of validatePaper(p)) errors.push(`${p.id}: ${x}`);
    for (const t of p.items || []) {
      const locs = have[t[2]];
      if (!locs) errors.push(`${p.id}: missing ${t[2]}`);
      else if (t[0] !== "pyq" && locs.indexOf(`${t[0]}|${t[1]}`) < 0) errors.push(`${p.id}: moved ${t[2]} (${t[0]}|${t[1]} not served; now ${locs.join(", ")})`);
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

/* ---------- census: eligible pools per exam, with gaps reported not skipped ---------- */
export function censusExam(cache, tax, ver, exam, quality = {}) {
  const { lists } = examLists(cache, tax, ver, exam);
  const tot = poolSizes(lists, { quality });
  const eligible = Object.values(tot).reduce((a, x) => a + x, 0);
  const imgSizes = poolSizes(lists, { image: true, quality });
  const image = Object.values(imgSizes).reduce((a, x) => a + x, 0);
  const imageBySubject = Object.entries(imgSizes).filter(([, x]) => x > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const scope = scopeSubjects(tax, exam);
  const skipped = skippedSubjects(cache).filter((s) => scope.indexOf(s) >= 0);
  const zeroSubs = scope.filter((s) => !(tot[s] > 0)).sort();
  return {
    profile: exam.profile, subjects: scope.length, eligible, image, imageBySubject,
    topics: majorTopics(cache, tax, ver, exam).length, skipped, zeroSubs,
  };
}
// Every exam/format gap as a warning line: zero eligible pools are reported, never silently skipped.
export function censusWarnings(c) {
  const w = [];
  if (c.skipped.length) w.push(`no live module index (404, overlay-only pool): ${c.skipped.join(", ")}`);
  if (!c.eligible) w.push("no eligible questions at all: every format will shortfall");
  if (c.eligible && !c.image) w.push("no eligible image pool: image papers will shortfall");
  if (c.eligible && !c.topics) w.push("no major topics: topic papers will shortfall");
  if (c.zeroSubs.length) w.push(`${c.zeroSubs.length} subjects with zero eligible pool: ${c.zeroSubs.slice(0, 8).join(", ")}${c.zeroSubs.length > 8 ? "..." : ""}`);
  return w;
}
// auditCoverage: exam/format pairs with an eligible pool but neither papers nor shortfalls are silently
// skipped gaps. censusByExam: { exam: { eligible, image, topics } }. Returns gap strings.
export function auditCoverage(papers, shortfalls, censusByExam) {
  const have = {}, short = {};
  for (const p of papers) have[`${p.exam}/${p.format}`] = 1;
  for (const s of shortfalls) short[`${s.exam}/${s.format}`] = 1;
  const gaps = [];
  for (const [exam, c] of Object.entries(censusByExam)) {
    if (!c.eligible) continue;
    for (const f of FORMATS) {
      if (f === "pyq" && exam !== "neet-pg") continue;
      if (f === "part" && !(A.profile(exam) || {}).format.parts) continue;
      const pool = f === "image" ? c.image : f === "topic" ? c.topics : c.eligible;
      if (pool && !have[`${exam}/${f}`] && !short[`${exam}/${f}`]) gaps.push(`${exam}/${f}: eligible pool (${pool}) but no papers and no shortfalls`);
    }
  }
  return gaps;
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
  // The sidecar applies by default (requires_review/rejected/retired stay out of papers); --quality none skips it.
  let qdir = arg(argv, "--quality", null);
  if (qdir === "none") qdir = null;
  else if (!qdir) qdir = [path.join(ROOT, "prep", "quality", "v1"), path.join(os.homedir(), "prep-data", "quality", "out", "v1")].find((d) => fs.existsSync(d)) || null;
  const quality = loadQuality(qdir);
  if (qdir) log(`quality sidecar: ${Object.keys(quality).length} records from ${qdir}`);
  if (cmd === "census") {
    for (const exam of EXAMS) {
      const c = censusExam(cache, tax, ver, exam, quality);
      console.log(`${exam.profile}: subjects=${c.subjects} eligible=${c.eligible} image=${c.image} major_topics=${c.topics}`);
      for (const [s, x] of c.imageBySubject) console.log(`  image ${s}: ${x}`);
      for (const w of censusWarnings(c)) console.log(`  WARNING: ${w}`);
    }
    const pq = loadPyq(cache, pyq);
    const pyqN = poolSizes(pq.lists, { quality }).pyq || 0;
    console.log(`pyq pool (neet-pg recall 2017+): ${pyqN} eligible`);
    if (!pyqN) console.log("  WARNING: pyq pool is empty: neet-pg PYQ papers will shortfall");
    return;
  }
  if (cmd === "build") {
    const dry = argv.includes("--dry");
    const onlyExam = arg(argv, "--exam", null), onlyFormat = arg(argv, "--format", null);
    const subjectsOnly = argv.includes("--subjects-only");
    if (subjectsOnly && onlyFormat !== "image") throw new Error("--subjects-only needs --format image");
    if ((!onlyFormat || onlyFormat === "image") && !overlayCached(cache)) throw new Error("no overlay files in the cache (run fetch first): image papers would shortfall");
    // Numbering continues past existing papers unless --start restarts it (rebuilds then skip as identical).
    const startAt = argv.includes("--start") ? {} : startNumbers(out);
    const prior = readOut(out);
    const haveIds = new Set(prior.map((p) => p.id)); // fixed-key papers already published are never rebuilt
    const createdAt = new Date().toISOString();
    const papers = [], shortfalls = [], bankCounts = {}, censusByExam = {};
    for (const exam of EXAMS.filter((e) => !onlyExam || e.profile === onlyExam)) {
      const { lists } = examLists(cache, tax, ver, exam);
      bankCounts[exam.profile] = poolSizes(lists, { quality });
      const c = censusExam(cache, tax, ver, exam, quality);
      censusByExam[exam.profile] = c;
      for (const w of censusWarnings(c)) log(`  WARNING ${exam.profile}: ${w}`);
      const priorUsed = prior.filter((p) => p.exam === exam.profile).flatMap((p) => p.items.map((t) => t[2]));
      const r = buildExam({ tax, cache, ver, pyqVer: pyq, exam, quality, createdAt, onlyFormat, startAt, priorUsed, subjectsOnly, haveIds, log });
      papers.push(...r.papers);
      shortfalls.push(...r.shortfalls);
      log(`${exam.profile}: ${r.papers.length} papers, ${r.shortfalls.length} shortfalls`);
    }
    for (const g of auditCoverage(prior.concat(papers), shortfalls, censusByExam)) log(`  WARNING coverage gap: ${g}`);
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

