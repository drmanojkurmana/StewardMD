#!/usr/bin/env node
// NEET-SS Medical Oncology previous-year questions: CSV -> PYQ items + analysis. Dev-only, never shipped.
//   node tools/pyq-ss-build.mjs <question-database.csv> [outDir=prep/pyq-ss/out]
// COPYRIGHT: the repo is public. Question text never enters git: outDir is gitignored (/prep/pyq-ss/) and goes to R2
// under v5/pyq-ss/ (gated like every other bank path). Owner rule 2026-11-06: no source (publisher, channel, faculty,
// video title or link) appears in any item, label or note, so every such field is dropped or replaced by a neutral label.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SUBJECT = "ss-medical-oncology";
// Session text in the CSV -> neutral paper (year + set). Matched by the session's year and part words only.
const SESSIONS = [
  [/Medical Oncology I \(/, "2025", 1], [/Medical Oncology II \(/, "2025", 2], [/2025 Medical Oncology Recall/, "2025", 3],
  [/2024.*Part 1/, "2024", 1], [/2024.*Part 2/, "2024", 2], [/2024.*Part 3/, "2024", 3]
];
// Names that must never reach the app (checked on every output string; the build fails if one survives).
export const BANNED = /marrow\s+(?:super|ss\b|sp|i{1,2}\b|20\d\d|part|video|recall|session|platform|faculty)|doctutorial|doc tutorial|youtube|youtu\.be|vijay|hemanth|dr\.? ?[a-z]+ (?:sir|ma'?am)|https?:\/\//i;

export function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.length > 1 || row[0]) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^﻿/, ""));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] || ""])));
}

// Provenance tags the extractor left in stems ("[Directly audible from slide]") and any named source in prose.
export function scrub(s) {
  return String(s || "")
    .replace(/\s*\[(?:Directly|Recall stem)[^\]]*\]/gi, "")
    .replace(/^\s*\[[^\]]*(?:Logged|Recall Topic)[^\]]*\]:?\s*/i, "")
    .replace(/(?:^|\s)Logged for[^:]*:\s*/gi, " ")
    .replace(/\s*\((?:as )?(?:discussed|mentioned|said|taught|recalled) (?:by|in|on|from)[^)]*(?:marrow|doctutorial|vijay|hemanth|video|session|faculty)[^)]*\)/gi, "")
    .replace(/(^|[.:]\s+)(?:As|According to|Per) Dr\.? [A-Z][a-z]+(?: summari[sz]es| notes| says| explains| states)?,? ?([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\b(?:as|according to|per) Dr\.? [A-Z][a-z]+(?: summari[sz]es| notes| says| explains| states)?,? ?/g, "")
    .replace(/^\W*\d\d:\d\d(?::\d\d)?\)?:?\s*/, "")
    .replace(/\s*\((?:MCQ \d+ )?at \d\d:\d\d(?::\d\d)?\)/g, "")
    .replace(/(?:Quoting|Quoted|Citing)\s+([A-Za-z' ]+?)\s+verbatim from Dr\.? [A-Z][a-z]+'?s? slides?:/g, "$1:")
    .replace(/\bDr\.? [A-Z][a-z]+'s\b/g, "the")
    .replace(/\s{2,}/g, " ").trim();
}
// A row that only logs a slide the extractor could not read (no real question): never shown.
const placeholder = (r) => /^\s*\[(?:Incomplete|Deferred)|placeholder/i.test(r.Question_Stem + " " + r.Specific_Subtopic);
const seeded = (id) => { let h = parseInt(crypto.createHash("sha1").update(id).digest("hex").slice(0, 8), 16); return () => (h = (h * 1664525 + 1013904223) >>> 0) / 4294967296; };

// The export lists the right option first almost every time (257 of 288 are "A"); shuffle it per item, deterministically,
// unless an option refers to the others ("All of the above").
export function shuffleOptions(id, opts, a) {
  if (opts.some((o) => /\b(above|none of|both|all of|neither)\b/i.test(o))) return { o: opts, a, perm: [0, 1, 2, 3] };
  const rnd = seeded(id), idx = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return { o: idx.map((k) => opts[k]), a: idx.indexOf(a), perm: [0, 1, 2, 3].map((old) => idx.indexOf(old)) };
}

// "Option A is correct" in the explanation must follow the shuffled position: old letter -> new letter.
export function remapLetters(text, perm) {
  const L = "ABCD";
  return text.replace(/\b(Options?|Choices?)\s+((?:[A-D](?:\s*(?:,|and|&|or|\/)\s*)?)+)(?![A-Za-z])/g, (m, w, ls) => w + " " + ls.replace(/[A-D]/g, (c) => L[perm[L.indexOf(c)]]));
}
export function buildItems(rows) {
  const items = [];
  rows.filter((r) => !placeholder(r)).forEach((r) => {
    const m = SESSIONS.find((s) => s[0].test(r.Source_Video_Session));
    if (!m) throw new Error("unknown session for " + r.Question_Number);
    const year = m[1], set = m[2], src = "neet-ss-onc-" + year + "-s" + set, n = parseInt(r.Question_Number.replace(/\D/g, ""), 10);
    const id = "pyqss-" + year + "-s" + set + "-" + n;
    const L = (/Option\s+([A-D])/i.exec(r.Correct_Answer) || [])[1];
    if (!L) throw new Error("no key for " + r.Question_Number);
    const raw = [r.Option_A, r.Option_B, r.Option_C, r.Option_D].map((o) => scrub(o).replace(/^[A-D][.)]\s*/, ""));
    const { o, a, perm } = shuffleOptions(id, raw, "ABCD".indexOf(L.toUpperCase()));
    items.push({
      id, exam: "neet-ss", year: +year, kind: "recall", src, n, subject: SUBJECT, ts: SUBJECT, q: scrub(r.Question_Stem), o, a,
      exp: remapLetters(scrub(r.Detailed_Explanation), perm), kp: remapLetters(scrub(r.High_Yield_Takeaway), perm), ref: scrub(r.Standard_Reference),
      dom: scrub(r.Topic_Domain), site: scrub(r.Cancer_Site), topic: scrub(r.Specific_Subtopic), concept: scrub(r.Core_Concept),
      rep: /repeat|concordant|exact/i.test(r.Recurrence_And_Repeat_Notes) ? 1 : 0,
      pyq: [{ exam: "neet-ss", year: +year, session: "set-" + set, kind: "recall", src, n }]
    });
  });
  return items;
}

export function papersOf(items) {
  const by = {};
  items.forEach((it) => { (by[it.src] = by[it.src] || { id: it.src, exam: "neet-ss", year: it.year, session: "set-" + it.src.split("-s").pop(), kind: "recall", n: 0, items: [] }); by[it.src].n++; by[it.src].items.push(it.id); });
  return Object.values(by).sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
}

const tier = (pct) => (pct >= 12 ? 1 : pct >= 5 ? 2 : 3);
// Topic frequency, importance tier and must-do topics. "Must do" = a subtopic asked 2+ times or asked in both years or marked repeated.
export function analyse(items) {
  const total = items.length, doms = {};
  items.forEach((it) => {
    const d = (doms[it.dom] = doms[it.dom] || { name: it.dom, n: 0, y: { 2025: 0, 2024: 0 }, topics: {} });
    d.n++; d.y[it.year]++;
    const t = (d.topics[it.topic] = d.topics[it.topic] || { name: it.topic, n: 0, y: { 2025: 0, 2024: 0 }, rep: 0, ids: [], kp: it.kp });
    t.n++; t.y[it.year]++; t.rep += it.rep; t.ids.push(it.id);
  });
  const domains = Object.values(doms).map((d) => {
    const topics = Object.values(d.topics).map((t) => ({ ...t, must: t.n >= 2 || (t.y[2025] && t.y[2024]) || t.rep > 0 })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const pct = +(100 * d.n / total).toFixed(1);
    return { name: d.name, n: d.n, y2025: d.y[2025], y2024: d.y[2024], pct, tier: tier(pct), topics };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const concepts = {}; items.forEach((it) => { concepts[it.concept] = (concepts[it.concept] || 0) + 1; });
  const mustDo = domains.flatMap((d) => d.topics.filter((t) => t.must).map((t) => ({ dom: d.name, name: t.name, n: t.n, y2025: t.y[2025], y2024: t.y[2024], rep: t.rep, kp: t.kp, ids: t.ids }))).sort((a, b) => b.n - a.n);
  return { total, y2025: items.filter((i) => i.year === 2025).length, y2024: items.filter((i) => i.year === 2024).length, domains, concepts, mustDo };
}

/* Topic -> the Learn lesson that teaches it (owner 2026-11-07: tapping a topic must open its lesson). TF-IDF cosine of the
 * topic's name, key point, questions and explanations against each lesson's title and step text; best lesson wins.
 * lessons: [{ id, text }]. Returns { id, score } or null. shortcut: lexical match, upgrade to a curated map if a link is wrong. */
const tokens = (s) => String(s || "").toLowerCase().replace(/<[^>]+>/g, " ").match(/[a-z0-9]{3,}/g) || [];
export function lessonIndex(lessons) {
  const df = {}, docs = lessons.map((l) => { const tf = {}; tokens(l.text).forEach((w) => { tf[w] = (tf[w] || 0) + 1; }); Object.keys(tf).forEach((w) => { df[w] = (df[w] || 0) + 1; }); return { id: l.id, tf }; });
  const idf = (w) => Math.log((lessons.length + 1) / ((df[w] || 0) + 1));
  const vec = (tf) => { const v = {}; let n = 0; for (const w in tf) { v[w] = (1 + Math.log(tf[w])) * idf(w); n += v[w] * v[w]; } return { v, n: Math.sqrt(n) || 1 }; };
  const L = docs.map((d) => ({ id: d.id, ...vec(d.tf) }));
  return (text) => {
    const tf = {}; tokens(text).forEach((w) => { tf[w] = (tf[w] || 0) + 1; });
    const q = vec(tf); let best = null;
    for (const l of L) { let dot = 0; for (const w in q.v) if (l.v[w]) dot += q.v[w] * l.v[w]; const s = dot / (q.n * l.n); if (!best || s > best.score) best = { id: l.id, score: +s.toFixed(3) }; }
    return best;
  };
}
export function attachLessons(analysis, items, lessons) {
  const find = lessonIndex(lessons), byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const textOf = (t) => [t.name, t.name, t.kp].concat((t.ids || []).map((id) => byId[id] && [byId[id].q, byId[id].exp].join(" "))).join(" ");
  const seen = {};
  analysis.domains.forEach((d) => d.topics.forEach((t) => { const b = find(textOf(t)); if (b) { t.les = b.id; seen[d.name + "|" + t.name] = b.id; } }));
  analysis.mustDo.forEach((t) => { const id = seen[t.dom + "|" + t.name]; if (id) t.les = id; });
  return analysis;
}

export function assertClean(obj) {
  const s = JSON.stringify(obj), m = BANNED.exec(s);
  if (m) throw new Error("source name survived the scrub: " + s.slice(Math.max(0, m.index - 60), m.index + 60));
}

if (process.argv[1] && process.argv[1].endsWith("pyq-ss-build.mjs")) {
  const [csv, out = "prep/pyq-ss/out"] = process.argv.slice(2);
  if (!csv) { console.error("usage: node tools/pyq-ss-build.mjs <csv> [outDir]"); process.exit(1); }
  const items = buildItems(parseCsv(fs.readFileSync(csv, "utf8")));
  const LD = "prep/lessons/v1", lessons = fs.readdirSync(LD).filter((f) => /^son-.*\.json$/.test(f)).map((f) => {
    const l = JSON.parse(fs.readFileSync(path.join(LD, f), "utf8"));
    return { id: f.replace(/\.json$/, ""), text: [l.title, l.title].concat((l.steps || []).map((s) => s.tx)).join(" ") };
  });
  const papers = papersOf(items), analysis = attachLessons(analyse(items), items, lessons);
  const body = JSON.stringify({ v: 1, items }), h8 = crypto.createHash("sha1").update(body).digest("hex").slice(0, 8), file = "items-" + h8 + ".json";
  const index = { v: 1, papers, file, analysis };
  assertClean(index); assertClean(items);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, file), body); fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index));
  console.log(`${items.length} items, ${papers.length} papers, ${analysis.domains.length} domains -> ${out}/${file}`);
}
