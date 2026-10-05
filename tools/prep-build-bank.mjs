#!/usr/bin/env node
// PrepNucleus Layer A bank builder. Dev-only, never shipped. $0 AI. Plan: vault/plans/PrepNucleus.md section 5.1.
//
// Builds the shared question bank for every MBBS subject in prep/taxonomy/ from MedMCQA (the same pinned source and
// licence as the Tokós bank, see tools/tokos-build-mcq.mjs for GET THE DATA). Superspecialty subjects (medmcqa: null)
// get an empty index here; tools/prep-fill.mjs fills them.
//
// RUN
//   MEDMCQA_DIR=<dir> node tools/prep-build-bank.mjs [--subject <id>] [--out prep/bank/v1]
//   Optional first: MEDMCQA_DIR=<dir> python3 tools/prep-embed.py   (module classifier by meaning; without it the
//   mapping uses keywords only and more items land in "Mixed practice")
//
// Pipeline per subject (taxonomy order): keep subject -> clean HTML and whitespace -> repair dropped "rt" letters ->
// drop broken / keyless / figure-dependent items -> explanation flags -> de-duplicate within the subject and across
// subjects (first subject in taxonomy order keeps it) -> textbook-reference scrub -> module mapping -> difficulty ->
// USMLE vignette tag -> write.
//
// OUT (per subject)  prep/bank/v1/<subject>/index.json            engine index (bundled with the app)
//                    prep/bank/v1/<subject>/mcq/<module>.json     one per module (served from R2, not committed)
//                    prep/bank/v1/<subject>/search.json           search index (R2)
//     (all)          prep/taxonomy.json                           the tree the app draws (bundled)
//                    prep/bank/v1/manifest.json                   subjects, counts, bytes
//                    prep/build/report.json                       per subject and per module counts, shortfall
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SOURCE as MEDMCQA_SOURCE, FLAG_LEGEND as TOK_FLAGS, cleanText, normKey, buildRepair, cleanExplanation, difficulty, expFlags, IMAGE_REF } from "./tokos-build-mcq.mjs";
import { buildSearch } from "./tokos-build-mcq-search.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TAX_DIR = path.join(ROOT, "prep", "taxonomy");
export const BUILD_DIR = path.join(ROOT, "prep", "build");
const SKIP_SUBJECTS = new Set(["Dental", "Unknown"]);

// Subjects in this order; anything else in prep/taxonomy/ follows alphabetically within its branch.
export const ORDER = {
  mbbs: ["anatomy", "physiology", "biochemistry", "pathology", "pharmacology", "microbiology", "forensic-medicine",
    "community-medicine", "ophthalmology", "ent", "medicine", "surgery", "obstetrics-gynaecology", "paediatrics",
    "orthopaedics", "dermatology", "psychiatry", "anaesthesia", "radiology"],
  "ss-medicine": ["ss-general-medicine", "ss-cardiology", "ss-neurology", "ss-nephrology", "ss-gastroenterology",
    "ss-hepatology", "ss-endocrinology", "ss-haematology", "ss-medical-oncology", "ss-rheumatology-immunology",
    "ss-pulmonology", "ss-infectious-diseases", "ss-critical-care", "ss-biostatistics"],
};
export const BRANCHES = [{ id: "mbbs", name: { en: "MBBS" } }, { id: "ss-medicine", name: { en: "SS Medicine" } }];
export const EXAMS = ["neet-pg", "ini-cet", "neet-ss", "usmle"];
// Fill targets by module size (plan 6.1): the reference tier before a source pack exists.
export const TARGET = { s: 15, m: 40, l: 80 };

export const FLAG_LEGEND = {
  ...TOK_FLAGS,
  disputed: { en: "An independent blind solve chose a different answer than the key", hi: "स्वतंत्र जाँच ने उत्तर-कुंजी से अलग उत्तर चुना" },
};

// ---------------------------------------------------------------------------------------------------------------------
// Taxonomy
const ID_RE = /^[a-z0-9-]+$/;
export function validateSubject(s) {
  const e = [], ids = new Set();
  if (!s || !ID_RE.test(s.id || "")) e.push("id");
  if (!/^[a-z]{2,4}$/.test(s.code || "")) e.push("code");
  if (!BRANCHES.some((b) => b.id === s.branch)) e.push("branch " + s.branch);
  if (!s.title) e.push("title");
  if (!Array.isArray(s.exams) || !s.exams.length || s.exams.some((x) => !EXAMS.includes(x))) e.push("exams");
  if (!Array.isArray(s.sections) || !s.sections.length) e.push("sections");
  for (const sec of s.sections || []) {
    if (!ID_RE.test(sec.id || "") || ids.has(sec.id)) e.push("section id " + sec.id);
    ids.add(sec.id);
    if (!sec.title) e.push("section title " + sec.id);
    for (const m of sec.modules || []) {
      if (!ID_RE.test(m.id || "") || !m.id.startsWith(s.code + "-") || ids.has(m.id)) e.push("module id " + m.id);
      ids.add(m.id);
      if (!m.title) e.push("module title " + m.id);
      if (!TARGET[m.size]) e.push("module size " + m.id);
      if (typeof m.scope !== "string" || m.scope.split(/\s+/).length < 5) e.push("module scope " + m.id);
    }
    if (!(sec.modules || []).length) e.push("empty section " + sec.id);
  }
  if (/[–—]/.test(JSON.stringify(s))) e.push("em or en dash");
  return e;
}
export function loadTaxonomy(dir = TAX_DIR) {
  const subjects = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const errs = [];
  const seen = new Set();
  for (const s of subjects) {
    for (const x of validateSubject(s)) errs.push(`${s.id}: ${x}`);
    for (const sec of s.sections || []) for (const m of sec.modules || []) { if (seen.has(m.id)) errs.push(`duplicate module id across subjects ${m.id}`); seen.add(m.id); }
  }
  if (errs.length) throw new Error("taxonomy invalid:\n  " + errs.join("\n  "));
  const rank = (s) => { const l = ORDER[s.branch] || []; const i = l.indexOf(s.id); return (BRANCHES.findIndex((b) => b.id === s.branch)) * 1000 + (i < 0 ? 500 : i); };
  return subjects.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
}
export const mixedId = (s) => `${s.code}-mixed`;
export function modulesOf(s) {
  const out = [];
  for (const sec of s.sections) for (const m of sec.modules) out.push({ ...m, section: sec.id });
  return out;
}
// The tree the app draws (bundled). Scope terms stay in the build: they are for classification only.
export function taxonomyForApp(subjects) {
  return {
    v: 1,
    branches: BRANCHES.map((b) => ({
      id: b.id, name: b.name,
      subjects: subjects.filter((s) => s.branch === b.id).map((s) => ({
        id: s.id, code: s.code, name: { en: s.title }, ex: s.exams, medmcqa: s.medmcqa || null,
        sections: s.sections.map((sec) => ({ id: sec.id, name: { en: sec.title }, modules: sec.modules.map((m) => ({ id: m.id, name: { en: m.title }, size: m.size })) })),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Textbook-reference scrub (owner, 2026-09-24: no textbook as source and no page numbers anywhere). MedMCQA
// explanations end in "Ref: Park 23rd ed, pg 396", "(Ref. Harrison 19/e, p 1342)", "Reference: page 834 SRB's manual
// 5th edition" and the like. Whole reference clauses are removed; stray locators (edition, page, chapter) too.
// Gene and protein names are safe: "p53", "p24 antigen" have no dot or space before the digits, and a bare "p"
// locator is only removed inside a reference clause or after an edition.
// Case is spelled out, never an "i" flag: "2 The" must not read as "2 + th + e", and "Harrison 22e" is an edition only
// when the "e" touches the digits.
const ED = String.raw`\d{1,2}(?:\s*(?:st|nd|rd|th|ST|ND|RD|TH))?(?:\s*\/\s*[eE]\b|[eE]\b|\s*(?:[eE][dD](?:[nN]\b\.?|\b\.?|(?=[a-z]?\d|p\b|p\.))|[eE]dition\b|EDITION\b))`;
const PAGE = String.raw`(?:pg|page|pages|pp?\.)\s*(?:no\.?|num\.?|number)?\s*[:\-]*\s*\d{1,4}(?:[a-z]\d+)?(?:\s*[-,&]\s*\d{1,4}(?:[a-z]\d+)?)*`;
const CHAP = String.raw`(?:chapter|chap\.?|ch\.)\s*\d{1,4}`;
// Inside a reference clause a bare "p 1342" is a page too (a space, never "p53"), and numbers chained right after a
// locator ("6th ed., 732", "pg 576, 578") belong to it.
const LOC_RE = new RegExp(`(?:${ED}|${PAGE}|${CHAP}|\\bp\\s+\\d{1,4}\\b|\\b\\d{2,4}\\s*[-/]\\s*\\d{1,4}\\b)(?:\\s*[,;&/.]?\\s*[a-z]?\\d{1,4}(?:\\s*-\\s*\\d{1,4})?\\b)*`, "gi");
// A marker may be glued to the word before it ("fitsRef.:", "EnalaprilREF:"): capitalised forms match without a boundary.
const MARK_RE = /(?:\(\s*|\[\s*)?(?:\b(?:ref(?:erences?|er)?|source)\b|(?<=[a-z0-9)\]])(?:Ref|REF|Reference|REFERENCE)\b)\s*[.:\-]*\s*/gi;
// Survivors the exit test counts (plan 5.1, tightened so gene names such as p53 never count).
export const REF_SURVIVOR = new RegExp(`${ED}|(?:\\b[Rr]ef|R[Ee][Ff])(?:erence|ERENCE)?s?\\s*[.:\\-]|\\b(?:[Pp][Gg]|[Pp]age|PAGE)\\s*(?:no\\.?\\s*)?\\d|\\b[Pp][Pp]?\\.\\s*\\d|\\b(?:[Cc]hapter|CHAPTER|[Cc]hap\\.?|Ch\\.)\\s*\\d`);

function endOfRef(t, from) {
  // A reference clause runs from its marker to the last locator that follows within reach (each next locator no
  // more than 90 characters after the previous one). With no locator it is the book name: cut at the next sentence
  // end, line break or 80 characters, whichever comes first.
  let end = -1, last = from;
  LOC_RE.lastIndex = from;
  let m;
  while ((m = LOC_RE.exec(t)) && m.index - last <= 90 && m.index - from <= 220) { end = m.index + m[0].length; last = end; }
  if (end < 0) {
    const rest = t.slice(from, from + 80);
    const stop = rest.search(/[.;]\s+[A-Z(#*]|\n/);
    end = from + (stop >= 0 ? stop + 1 : rest.length);
  }
  if (t[end] === ")" || t[end] === "]") end++;
  return end;
}
export function scrubRefs(text) {
  let t = String(text == null ? "" : text);
  if (!t) return t;
  // 1) clauses that start with a reference marker
  let out = "", at = 0, m;
  MARK_RE.lastIndex = 0;
  while ((m = MARK_RE.exec(t))) {
    const word = m[0].replace(/[^a-z]/gi, "").toLowerCase();
    // "refer to the pharmacokinetics" in prose is not a citation unless a locator follows quickly
    const after = t.slice(MARK_RE.lastIndex, MARK_RE.lastIndex + 120);
    const looksRef = /^(ref|reference|references|source)$/.test(word) ? true : new RegExp(`${ED}|${PAGE}`, "i").test(after);
    if (!looksRef) continue;
    const end = endOfRef(t, MARK_RE.lastIndex);
    out += t.slice(at, m.index);
    at = end; MARK_RE.lastIndex = end;
  }
  t = out + t.slice(at);
  // 2) bracketed editions without a marker: "(252-BDC-3- 4th edition)", "(Robbins 9th/e p. 123)"
  t = t.replace(new RegExp(`[(\\[][^()\\[\\]]{0,120}${ED}[^()\\[\\]]{0,80}[)\\]]`, "gi"), " ");
  // 3) stray edition + locator runs: "Harrison 20th edition pg 96e2", "Page 1886, Nelson Textbook"
  t = t.replace(new RegExp(`(?:[A-Z][A-Za-z'&;.]*\\s+){0,6}${ED}(?:\\s*[,;:/]?\\s*(?:${PAGE}|${CHAP}))*`, "g"), " ");
  t = t.replace(new RegExp(`\\b${PAGE}\\b(?:\\s*(?:,|of)?\\s*(?:[A-Z][A-Za-z'&;.]*\\s*){1,8})?`, "gi"), " ");
  t = t.replace(new RegExp(`\\b${CHAP}\\b`, "gi"), " ");
  // tidy: orphan brackets, doubled punctuation, spaces
  t = t.replace(/\(\s*[,.;:\-]*\s*\)|\[\s*[,.;:\-]*\s*\]/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/([,;:])\1+/g, "$1")
    .replace(/^[\s,.;:\-]+/, "").replace(/\s{2,}/g, " ").trim();
  // last pass: a sentence that still carries a locator goes (zero survivors is the exit criterion)
  if (REF_SURVIVOR.test(t)) {
    const parts = t.split(/(?<=[.!?])\s+(?=[A-Z0-9(#*])/);
    t = parts.filter((x) => !REF_SURVIVOR.test(x)).join(" ").trim();
    // a split inside a locator ("p. 13031") can rejoin into one; remove what is left of it directly
    t = t.replace(new RegExp(`(?:${REF_SURVIVOR.source})[\\w./-]*`, "g"), " ").replace(/\s{2,}/g, " ").trim();
  }
  return t.length < 12 ? "" : t;
}

// ---------------------------------------------------------------------------------------------------------------------
// Module mapping
function termRe(term) {
  const t = term.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  if (t.length < 3) return null;
  // plural / adjectival endings: "aneurysm" matches "aneurysms"; short abbreviations stay exact
  return new RegExp(`(?:^|[^a-z0-9])${t}(?:s|es)?(?![a-z0-9])`, "i");
}
export function compileModules(subject) {
  return modulesOf(subject).map((m) => {
    const terms = [...new Set(m.scope.split(/[,;]/).map((x) => x.trim()).filter(Boolean))];
    return { id: m.id, section: m.section, size: m.size, res: terms.map(termRe).filter(Boolean), title: termRe(m.title) };
  });
}
// Keyword score as the Tokós tool: stem 3, key option 2, topic_name 2, explanation 1 each (at most 3).
export function lexScore(mod, it) {
  let s = 0, e = 0;
  for (const re of mod.res) {
    if (re.test(it.q)) s += 3;
    if (re.test(it.key)) s += 2;
    if (it.topic && re.test(it.topic)) s += 2;
    if (re.test(it.exp)) e++;
  }
  if (mod.title && it.topic && mod.title.test(it.topic)) s += 3;
  return s + Math.min(e, 3);
}
// Embedding cosine (x1000) to module ids, from prep/build/embed-<subject>.json; null when absent.
export function loadEmbed(subjectId) {
  const p = path.join(BUILD_DIR, `embed-${subjectId}.json`);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    model: j.model, revision: j.revision,
    get: (id) => { const a = j.a[id]; return a ? [[j.modules[a[0]], a[1] / 1000], [j.modules[a[2]], a[3] / 1000]] : null; },
    // best module across every MBBS subject (prep-embed.py "x"); null with an older file
    x: (id) => { const x = j.x && j.x[id]; return x ? [j.all[x[0]], x[1] / 1000] : null; },
  };
}
// Decide: with embeddings, the better of the two embedding candidates plus a keyword bonus, unless keywords alone
// point clearly elsewhere; without, keywords. Weak signal on both -> the subject's "Mixed practice" module.
// moveCos / moveMargin: an item whose best module in its own subject scores under moveCos goes to another subject's
// module that scores at least moveCos and beats it by moveMargin (MedMCQA files some items under the wrong subject).
// Measured on a blind-labelled 120-item Anatomy sample (2026-10-05): every item under 0.61 was one the labeller could
// not place in Anatomy at all.
export const MAP = { minCos: 0.6, lexWeight: 0.012, lexClear: 9, minLex: 3, moveCos: 0.62, moveMargin: 0.03 };
export function mapItem(mods, it, emb) {
  let bestLex = null, bestLexS = 0;
  for (const m of mods) { const s = lexScore(m, it); if (s > bestLexS) { bestLex = m.id; bestLexS = s; } }
  const cand = emb ? emb : null;
  if (cand) {
    const scored = cand.map(([id, cos]) => {
      const m = mods.find((x) => x.id === id);
      return { id, cos, s: cos + MAP.lexWeight * Math.min(m ? lexScore(m, it) : 0, 15) };
    }).sort((a, b) => b.s - a.s);
    const top = scored[0];
    if (bestLex && bestLexS >= MAP.lexClear && !scored.some((x) => x.id === bestLex) && bestLexS * MAP.lexWeight > top.s - top.cos + 0.05) return { id: bestLex, how: "keyword" };
    if (top.cos >= MAP.minCos || (top.s - top.cos) * (1 / MAP.lexWeight) >= MAP.minLex) return { id: top.id, how: "embed" };
    return bestLexS >= MAP.minLex ? { id: bestLex, how: "keyword" } : { id: null, how: "mixed" };
  }
  return bestLexS >= MAP.minLex ? { id: bestLex, how: "keyword" } : { id: null, how: "mixed" };
}

// Cross-subject moves. subjects in taxonomy order; byName: MedMCQA subject name -> items; embeds: subject id -> loadEmbed.
// Returns { out: Set of item ids leaving their subject, into: Map subject id -> [{ item, module }] }.
export function planMoves(subjects, byName, embeds) {
  const owner = new Map();
  for (const s of subjects) for (const m of modulesOf(s)) owner.set(m.id, s.id);
  const out = new Set(), into = new Map();
  for (const s of subjects) {
    const emb = embeds[s.id];
    if (!s.medmcqa || !emb || !emb.x) continue;
    for (const it of byName.get(s.medmcqa) || []) {
      const own = emb.get(it.id), x = emb.x(it.id);
      if (!own || !x) continue;
      const to = owner.get(x[0]);
      if (!to || to === s.id || own[0][1] >= MAP.moveCos || x[1] < MAP.moveCos || x[1] - own[0][1] < MAP.moveMargin) continue;
      out.add(it.id);
      if (!into.has(to)) into.set(to, []);
      into.get(to).push({ item: it, module: x[0] });
    }
  }
  return { out, into };
}

// ---------------------------------------------------------------------------------------------------------------------
// USMLE-style vignette (plan 5.1): age-led or "presents / is brought / complains", at least 25 words.
const AGE_LEAD = /^\s*(?:a|an)\s+\d{1,3}[- ]?(?:year|yr|month|day|week)s?[- ]old\b/i;
const PRESENTS = /\b(?:presents|presented|is brought|was brought|complains|complained)\b/i;
export function isVignette(q) { return (AGE_LEAD.test(q) || PRESENTS.test(q)) && String(q).split(/\s+/).length >= 25; }

// ---------------------------------------------------------------------------------------------------------------------
export function readRows(dir) {
  const base = process.env.MEDMCQA_COP_BASE === "1" ? 1 : 0;
  const files = fs.existsSync(path.join(dir, "train.jsonl")) ? ["train.jsonl", "validation.jsonl"] : ["train.json", "dev.json"];
  const rows = [];
  for (const fn of files) {
    const p = path.join(dir, fn);
    if (!fs.existsSync(p)) throw new Error(`missing ${p}; see GET THE DATA in tools/tokos-build-mcq.mjs`);
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (SKIP_SUBJECTS.has(r.subject_name)) continue;
      rows.push({ ...r, cop: typeof r.cop === "number" ? r.cop - base : -1 });
    }
  }
  return rows;
}

// The "rt" repair over all subjects needs guards the single-subject Tokós build did not (see buildRepair): measured on
// MedMCQA, without them "is" became "rtis" in about half the questions.
export const REPAIR = { maxRatio: 20, shortLen: 4, shortRatio: 3, keep: ["hyperopia", "hyperopic", "poland", "ape", "stale", "pay", "dive", "pos", "poo", "ales",
  "hu", "ave", "cove", "tumo", "agi", "wav", "opa", "bein", "mael", "heao"] };
// Clean, repair, drop, flag. The repair vocabulary is built over every kept subject so rare words are attested.
export function prepare(rows) {
  const pre = rows.map((r) => ({ id: r.id, subject: r.subject_name, cop: r.cop, q: cleanText(r.question), o: [r.opa, r.opb, r.opc, r.opd].map(cleanText), exp: cleanText(r.exp), topic: cleanText(r.topic_name) }));
  const rep = buildRepair(pre.flatMap((r) => [r.q, ...r.o, r.exp, r.topic]), REPAIR);
  const drop = { brokenQuestion: 0, noValidKey: 0, brokenOptions: 0, imageRef: 0 };
  const out = [];
  for (const r of pre) {
    r.q = rep.apply(r.q); r.o = r.o.map(rep.apply); r.exp = rep.apply(r.exp); r.topic = rep.apply(r.topic);
    if (!r.q || r.q.length < 10) { drop.brokenQuestion++; continue; }
    if (!(r.cop >= 0 && r.cop <= 3)) { drop.noValidKey++; continue; }
    if (r.o.some((o) => !o || /^[-.\s]*$/.test(o)) || new Set(r.o.map(normKey)).size !== 4) { drop.brokenOptions++; continue; }
    if (IMAGE_REF.test(r.q) || IMAGE_REF.test(r.exp)) { drop.imageRef++; continue; }
    const key = r.o[r.cop];
    out.push({ id: r.id, subject: r.subject, q: r.q, o: r.o, a: r.cop, key, rawExp: r.exp, exp: cleanExplanation(r.exp, key), topic: r.topic, flags: new Set(expFlags(r.exp, r.o, r.cop)) });
  }
  return { items: out, drop, repairWords: rep.fix.size };
}

// Within a subject: the Tokós clustering (same stem and same options or same key = one item; conflicting keys flagged).
export function dedupeSubject(items) {
  const byStem = new Map();
  for (const it of items) { const k = normKey(it.q); if (!byStem.has(k)) byStem.set(k, []); byStem.get(k).push(it); }
  const kept = [], st = { removed: 0, keyConflicts: 0, stemConflicts: 0 };
  const optSet = (it) => it.o.map(normKey).sort().join("|");
  const better = (a, b) => (a.flags.size - b.flags.size) || (b.exp.length - a.exp.length) || (a.id < b.id ? -1 : 1);
  for (const [stem, group] of byStem) {
    const clusters = [];
    for (const it of group.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const c = clusters.find((cl) => optSet(cl[0]) === optSet(it) || (stem.length >= 25 && normKey(cl[0].key) === normKey(it.key)));
      if (c) c.push(it); else clusters.push([it]);
    }
    const reps = [];
    for (const cl of clusters) {
      cl.sort(better);
      st.removed += cl.length - 1;
      if (cl.some((m) => normKey(m.key) !== normKey(cl[0].key))) { cl[0].flags.add("dup-key"); st.keyConflicts++; }
      reps.push(cl[0]);
    }
    if (reps.length > 1) for (const a of reps) for (const b of reps) {
      if (a === b || normKey(a.key) === normKey(b.key)) continue;
      if ((b.o.some((o) => normKey(o) === normKey(a.key)) || a.o.some((o) => normKey(o) === normKey(b.key))) && !a.flags.has("dup-stem")) { a.flags.add("dup-stem"); st.stemConflicts++; }
    }
    kept.push(...reps);
  }
  return { kept, st };
}
// Across subjects: an item whose stem and option set were already kept by an earlier subject is dropped here.
export const crossKey = (it) => normKey(it.q) + "#" + it.o.map(normKey).sort().join("|");

// items may carry `module` (moved in from another subject by planMoves): that module is used as is.
export function buildSubject(subject, items, seen, emb) {
  const { kept, st } = dedupeSubject(items);
  const mods = compileModules(subject);
  const ids = new Set(mods.map((m) => m.id));
  const how = { embed: 0, keyword: 0, mixed: 0, moved: 0 };
  let cross = 0, scrubbed = 0, usmle = 0;
  const out = [];
  for (const it of kept.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ck = crossKey(it);
    if (seen.has(ck)) { cross++; continue; }
    seen.add(ck);
    const exp = scrubRefs(it.exp);
    if (exp !== it.exp) scrubbed++;
    const mapped = it.module && ids.has(it.module) ? { id: it.module, how: "moved" } : mapItem(mods, { q: it.q, key: it.key, exp, topic: it.topic }, emb ? emb.get(it.id) : null);
    how[mapped.how]++;
    const t = mapped.id && ids.has(mapped.id) ? mapped.id : mixedId(subject);
    const o = { id: it.id, q: it.q, o: it.o, a: it.a, exp, t, d: difficulty(it.q), prov: "LIC" };
    if (it.flags.size) o.flags = [...it.flags].sort();
    if (subject.exams.includes("usmle") && isVignette(it.q)) { o.ex = ["usmle"]; usmle++; }
    out.push(o);
  }
  return { items: out, stats: { ...st, crossDupes: cross, scrubbed, usmle, map: how } };
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function subjectIndex(subject, items) {
  // count = items the app shows (flagged or disputed keys are excluded until cleared); all = every item in the file.
  const counts = { total: 0, all: items.length, d1: 0, d2: 0, d3: 0, flagged: 0 };
  const per = {}, all = {}, us = {};
  for (const it of items) {
    all[it.t] = (all[it.t] || 0) + 1;
    if (it.flags && it.flags.length) { counts.flagged++; continue; }
    counts.total++; counts["d" + it.d]++; per[it.t] = (per[it.t] || 0) + 1;
    if (it.ex) us[it.t] = (us[it.t] || 0) + 1;
  }
  const topics = [];
  const row = (id, title, group, size, target) => ({ id, title, group, count: per[id] || 0, all: all[id] || 0, usmle: us[id] || 0, file: `mcq/${id}.json`, size, target, lic: all[id] ? "MIT" : null, cite: all[id] ? "MedMCQA" : null });
  for (const sec of subject.sections) for (const m of sec.modules) topics.push(row(m.id, { en: m.title }, sec.id, m.size, TARGET[m.size]));
  if (all[mixedId(subject)]) topics.push(row(mixedId(subject), { en: "Mixed practice" }, "mixed", "m", 0));
  const src = subject.medmcqa ? { ...MEDMCQA_SOURCE, modifications: `Filtered to ${subject.medmcqa}; HTML and whitespace cleaned; the source's dropped 'rt' letters restored; duplicates (within and across subjects), keyless and figure-dependent items removed; textbook references and page locators removed from explanations; mapped to PrepNucleus modules; difficulty tagged.` }
    : { source: "stewardmd", licence: "StewardMD", citation: "StewardMD PrepNucleus", modifications: "AI-generated, auto-checked (Layer B)" };
  return {
    id: subject.id, v: 1, ...src, subject: subject.medmcqa || null, branch: subject.branch, title: { en: subject.title }, ex: subject.exams,
    counts, usmle: items.filter((x) => x.ex).length, flagLegend: FLAG_LEGEND,
    groups: subject.sections.map((s) => ({ id: s.id, title: { en: s.title } })),
    topics,
  };
}

function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); const body = JSON.stringify(obj); fs.writeFileSync(p, body); return Buffer.byteLength(body); }

export function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const only = arg("--subject", null);
  const outDir = path.resolve(ROOT, arg("--out", "prep/bank/v1"));
  const subjects = loadTaxonomy();
  writeJson(path.join(ROOT, "prep", "taxonomy.json"), taxonomyForApp(subjects));
  const dir = process.env.MEDMCQA_DIR;
  if (!dir) { console.error("set MEDMCQA_DIR (see GET THE DATA in tools/tokos-build-mcq.mjs)"); process.exit(1); }
  const rows = readRows(dir);
  const prep = prepare(rows);
  const byName = new Map();
  for (const it of prep.items) { if (!byName.has(it.subject)) byName.set(it.subject, []); byName.get(it.subject).push(it); }
  const embeds = {};
  for (const s of subjects) if (s.medmcqa) embeds[s.id] = loadEmbed(s.id);
  const moves = planMoves(subjects, byName, embeds);
  const seen = new Set();
  const manifest = { v: 1, source: "medmcqa@" + MEDMCQA_SOURCE.sourceCommit, subjects: [] };
  const report = { read: rows.length, drop: prep.drop, repairWords: prep.repairWords, subjects: [], shortfall: [] };
  for (const s of subjects) {
    const sdir = path.join(outDir, s.id);
    const own = s.medmcqa ? (byName.get(s.medmcqa) || []).filter((it) => !moves.out.has(it.id)) : [];
    const items = own.concat((moves.into.get(s.id) || []).map((m) => ({ ...m.item, module: m.module })));
    const emb = s.medmcqa ? embeds[s.id] : null;
    const res = buildSubject(s, items, seen, emb);
    if (only && s.id !== only) continue;
    fs.rmSync(sdir, { recursive: true, force: true });
    const ix = subjectIndex(s, res.items);
    let bytes = writeJson(path.join(sdir, "index.json"), ix);
    const topics = [];
    for (const t of ix.topics) {
      const list = res.items.filter((x) => x.t === t.id);
      if (!list.length) continue;
      bytes += writeJson(path.join(sdir, t.file), { topic: t.id, items: list });
      topics.push({ id: t.id, items: list });
    }
    if (topics.length) bytes += writeJson(path.join(sdir, "search.json"), buildSearch(topics));
    const mods = ix.topics.filter((t) => t.group !== "mixed");
    const below = mods.filter((t) => t.count < t.target);
    manifest.subjects.push({ id: s.id, items: res.items.length, modules: mods.length, bytes, index: sha(fs.readFileSync(path.join(sdir, "index.json"))) });
    report.subjects.push({ id: s.id, read: items.length, movedOut: s.medmcqa ? (byName.get(s.medmcqa) || []).length - own.length : 0, kept: res.items.length, ...res.stats, modules: mods.length, empty: mods.filter((t) => !t.count).length, belowTarget: below.length, mixed: (ix.topics.find((t) => t.group === "mixed") || {}).count || 0, embed: emb ? emb.model : null, bytes });
    for (const t of below) report.shortfall.push({ subject: s.id, module: t.id, size: t.size, kept: t.count, target: t.target, fill: t.target - t.count });
    console.log(`${s.id.padEnd(28)} read ${String(items.length).padStart(6)} kept ${String(res.items.length).padStart(6)} modules ${String(mods.length).padStart(4)} below target ${String(below.length).padStart(4)} mixed ${String((ix.topics.find((t) => t.group === "mixed") || {}).count || 0).padStart(5)} ${(bytes / 1e6).toFixed(1)} MB`);
  }
  if (!only) writeJson(path.join(outDir, "manifest.json"), manifest);
  writeJson(path.join(BUILD_DIR, only ? `report-${only}.json` : "report.json"), report);
  fs.mkdirSync(path.join(ROOT, "prep", "fill"), { recursive: true });
  if (!only) writeJson(path.join(ROOT, "prep", "fill", "shortfall.json"), { v: 1, modules: report.shortfall });
  const tot = report.subjects.reduce((a, s) => a + s.kept, 0);
  console.log(`total kept ${tot}; shortfall ${report.shortfall.length} modules, ${report.shortfall.reduce((a, x) => a + x.fill, 0)} questions to fill`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
