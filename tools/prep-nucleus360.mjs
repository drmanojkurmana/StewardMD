#!/usr/bin/env node
/* Nucleus360 pre-build (owner 2026-10-12): concept outlines + bank matching for the top exam topics.
 *
 *   node tools/prep-nucleus360.mjs --list            top ~40 chapters from the chapter-yield file
 *   node tools/prep-nucleus360.mjs --build [--api <base>] [--out prep/nucleus360]
 *     resolves each topic to bank modules (taxonomy + bank indexes), the KB disease page and the lesson,
 *     builds the outline with prep-nucleus360.js, matches live bank items to concepts, and writes
 *     topics.json { topics: [{ id, title, subject, modules, kb, kbTitle, lesson, outline, match, coverage }] }.
 *     No question text goes into git: only outlines, item ids and honest counts. Gaps stay listed.
 *   node tools/prep-nucleus360.mjs --report           coverage table for the DONE report.
 *
 * The owner's example, Pancreatic adenocarcinoma, is always topic 1. The rest follow the combined
 * NEET-PG + INI-CET chapter yield (~/prep-data/assessment/external/dreampg/chapter-yield.json, third-party
 * inferred prioritisation, never republished: only ranks are read, counts are our own match results).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const N = require(path.join(ROOT, "prep-nucleus360.js"));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const API = arg("--api", "https://stewardmd.in/api/prep/bank/");
const OUT = arg("--out", path.join(ROOT, "prep", "nucleus360"));
const YIELD = path.join(os.homedir(), "prep-data", "assessment", "external", "dreampg", "chapter-yield.json");

const OWNER_FIRST = { id: "pancreatic-adenocarcinoma", title: "Pancreatic adenocarcinoma", aliases: ["CA pancreas", "cancer head of pancreas", "periampullary carcinoma"], want: ["surgery:sur-pancreas", "ss-gastroenterology:sgi-pancreatic-neoplasms", "ss-medical-oncology:son-pancreas"] };
/* Yield subject names -> bank subject ids. */
const SUBJECT_ALIAS = { spm: "community-medicine", psm: "community-medicine", patho: "pathology", pharm: "pharmacology", og: "obstetrics-gynaecology", ophthal: "ophthalmology", micro: "microbiology", biochem: "biochemistry", biochemistry: "biochemistry", physio: "physiology", physiology: "physiology", medicine: "medicine", surgery: "surgery", pediatrics: "paediatrics", paediatrics: "paediatrics", ortho: "orthopaedics", derma: "dermatology", psych: "psychiatry", anaes: "anaesthesia", anaesthesia: "anaesthesia", radio: "radiology", radiology: "radiology", ent: "ent", forensic: "forensic-medicine", anatomy: "anatomy" };

/* Curated chapter -> modules where spelling or scope defeats word overlap (checked against the bank index). */
const OVERRIDES = {
  "SPM :: Biostatistics": [["ss-biostatistics", "sbs-descriptive-probability"], ["ss-biostatistics", "sbs-hypothesis-tests"], ["ss-biostatistics", "sbs-study-design"]],
  "SPM :: Social Organisation": [["community-medicine", "cm-behavioural"]],
  "Radiology :: GI": [["radiology", "rad-gi"]],
  "Radiology :: RS": [["radiology", "rad-chest"]],
  "Micro :: Helminthology": [["community-medicine", "cm-helminths"]],
  "Micro :: Immunology": [["microbiology", "mic-immunodeficiency-transplant"], ["ss-general-medicine", "sgm-immunology-basics"]],
  "Patho :: Hemolytic Anemia": [["pathology", "pat-haemolytic-hereditary"], ["pathology", "pat-haemolytic-acquired"], ["medicine", "med-haemolytic"]],
  "Medicine :: Cerebrovascular diseases": [["medicine", "med-stroke"], ["ss-neurology", "sne-stroke-syndromes"]],
  "Medicine :: Arrythmias": [["medicine", "med-arrhythmias"]],
  "SPM :: Demography": [["community-medicine", "cm-demography"]],
  "Pharm :: Pharmacokinetics": [["pharmacology", "phm-pharmacokinetics"]],
  "Radiology :: Fundamentals of Radiology": [["radiology", "rad-chest"], ["radiology", "rad-musculoskeletal"], ["radiology", "rad-gi"]],
  "Physiology :: Respiratory Physiology": [["physiology", "phy-mechanics"], ["physiology", "phy-gas-transport"], ["physiology", "phy-regulation"]],
  "Patho :: Bleeding Disorders": [["pathology", "pat-platelet-disorders"], ["pathology", "pat-coagulation-disorders"]],
};
const STOP = new Set("disease diseases disorder disorders syndrome syndromes general basics basic clinical introduction principles misc miscellaneous approach common".split(" "));
const WORD_ALIAS = { arrythmias: "arrhythmias", gi: "gastrointestinal", helminthology: "helminths", demography: "demographic", organisation: "organization", biostatistics: "statistics" };
function normWord(w) {
  w = String(w || "").toLowerCase();
  w = w.replace(/haem/g, "hem").replace(/aemia/g, "emia").replace(/ischae/g, "ische").replace(/oesoph/g, "esoph").replace(/paed/g, "ped").replace(/behaviou/g, "behavio");
  if (WORD_ALIAS[w]) w = WORD_ALIAS[w];
  if (w.length > 4) { if (/ies$/.test(w)) w = w.slice(0, -3) + "y"; else if (/ses$/.test(w)) w = w.slice(0, -1); else if (/es$/.test(w)) w = w.slice(0, -2); else if (/s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1); }
  return w;
}
function toks(s) { return String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []; }
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.json();
}

/* ---------- yield: top chapters, NEET-PG + INI-CET combined, Diamond first ---------- */
export function topChapters(n = 40) {
  const y = JSON.parse(fs.readFileSync(YIELD, "utf8"));
  const score = {};
  for (const exam of Object.keys(y)) {
    for (const r of y[exam].rows || []) {
      const k = r.subject + " :: " + r.chapter;
      const w = r.tier === "Diamond" ? 0 : r.tier === "Gold" ? 1 : r.tier === "Silver" ? 2 : 3;
      const cur = score[k] || { subject: r.subject, chapter: r.chapter, w: 9, ranks: [] };
      cur.w = Math.min(cur.w, w);
      cur.ranks.push(r.rank);
      score[k] = cur;
    }
  }
  return Object.values(score).sort((a, b) => a.w - b.w || Math.min(...a.ranks) - Math.min(...b.ranks)).slice(0, n);
}

/* ---------- bank: subject/module indexes shipped with the app ---------- */
export function bankTopics() {
  const out = [];
  const vdir = path.join(ROOT, "prep", "bank");
  const vers = fs.readdirSync(vdir).filter((v) => /^v\d+$/.test(v));
  const seen = new Set();
  for (const v of vers) {
    for (const sid of fs.readdirSync(path.join(vdir, v))) {
      const ixP = path.join(vdir, v, sid, "index.json");
      if (!fs.existsSync(ixP) || seen.has(sid)) continue;
      seen.add(sid);
      try {
        const ix = JSON.parse(fs.readFileSync(ixP, "utf8"));
        for (const t of ix.topics || []) {
          const title = t.title && typeof t.title === "object" ? t.title.en : t.title;
          out.push({ subject: sid, module: t.id, title: title || t.id, count: t.count || 0 });
        }
      } catch { /* a broken index is skipped, never guessed */ }
    }
  }
  return out;
}

function overlap(a, b) {
  const A = new Set(toks(a).map(normWord).filter((w) => w.length > 2 && !STOP.has(w)));
  const B = new Set(toks(b).map(normWord).filter((w) => w.length > 2 && !STOP.has(w)));
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n;
}

/* chapter -> up to 3 bank modules. Word overlap on the chapter title, +5 when the module sits in the
   chapter's own subject (yield names aliased to bank ids); needs 2 shared words, or 1 inside the subject.
   One-word cross-subject hits (e.g. "diseases") are junk and are dropped. */
export function resolveModules(chapter, pool, subject) {
  const sid = SUBJECT_ALIAS[String(subject || "").toLowerCase()];
  const sidWords = new Set((sid || "").split(/[^a-z]+/).map(normWord).filter((w) => w.length > 2));
  const chapSet = new Set(toks(chapter).map(normWord).filter((w) => w.length > 2 && !STOP.has(w) && !sidWords.has(w)));
  return pool.map((t) => {
    const titSet = new Set(toks(t.title).map(normWord).filter((w) => w.length > 2 && !STOP.has(w) && !sidWords.has(w)));
    let w = 0;
    for (const x of chapSet) if (titSet.has(x)) w++;
    const s = w + (sid && t.subject === sid ? 5 : 0);
    return { t, w, s };
  })
    .filter((x) => x.w >= 2 || (sid && x.t.subject === sid && x.w >= 1))
    .sort((a, b) => b.s - a.s || b.t.count - a.t.count)
    .slice(0, 3).map((x) => x.t);
}

export function kbPages() {
  const dir = path.join(ROOT, "kb", "diseases");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return { file: f, id: d.id || f.replace(/\.json$/, ""), name: d.name || d.id || f };
    } catch { return null; }
  }).filter(Boolean);
}

export function lessonIndex() {
  try {
    const ix = JSON.parse(fs.readFileSync(path.join(ROOT, "prep", "lessons", "v1", "index.json"), "utf8"));
    return Object.entries(ix.modules || {}).map(([id, m]) => ({ id, title: m.title || id }));
  } catch { return []; }
}

export async function buildTopic(entry, pool, kbs, lessons) {
  const ovKey = entry.subject ? entry.subject + " :: " + (entry.chapter || "") : null;
  const mods = entry.want
    ? entry.want.map((w) => { const [s, m] = w.split(":"); return pool.find((t) => t.subject === s && t.module === m); }).filter(Boolean)
    : ovKey && OVERRIDES[ovKey]
      ? OVERRIDES[ovKey].map(([s, m]) => pool.find((t) => t.subject === s && t.module === m)).filter(Boolean)
      : resolveModules(entry.chapter || entry.title, pool, entry.subject);
  let kb = null, kbScore = 0;
  for (const k of kbs) {
    const s = overlap(entry.title, k.name);
    if (s > kbScore) { kbScore = s; kb = k; }
  }
  let lesson = null, lsScore = 0;
  for (const l of lessons) {
    const s = overlap(entry.title, l.title);
    if (s > lsScore) { lsScore = s; lesson = l; }
  }
  const topic = {
    id: entry.id || entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    title: entry.title,
    subject: mods[0] ? mods[0].subject : null,
    modules: mods.map((m) => [m.subject, m.module]),
    kb: kbScore >= 2 ? kb.id : null,
    kbTitle: kbScore >= 2 ? kb.name : null,
    lesson: lsScore >= 2 ? { id: lesson.id, title: lesson.title } : null,
    n: mods.reduce((a, m) => a + m.count, 0),
  };
  // Outline from the KB page fields (never invented) + lesson; items matched live below.
  let kbObj = null;
  if (topic.kb) {
    const hit = kbs.find((k) => k.id === topic.kb);
    if (hit) { try { kbObj = JSON.parse(fs.readFileSync(path.join(ROOT, "kb", "diseases", hit.file), "utf8")); } catch { kbObj = null; } }
  }
  const outline = N.outlineOf({ id: topic.id, title: topic.title, kb: kbObj, lesson: topic.lesson });
  let items = [];
  for (const [s, m] of topic.modules) {
    try {
      const f = await getJSON(API + "v5/" + s + "/mcq/" + m + ".json");
      for (const it of f.items || []) items.push(it);
    } catch (e) { /* offline or missing module: what exists is shown, gaps marked */ }
  }
  const type = N.typeOf({ title: topic.title });
  const matched = N.matchConcepts(outline, items, type);
  const cov = N.coverage(outline, matched.assign);
  return {
    ...topic,
    type,
    outline,
    match: Object.fromEntries(Object.entries(matched.assign).map(([k, v]) => [k, { n: v.length, items: v.slice(0, 20) }])),
    unassigned: matched.unassigned.length,
    fetched: items.length,
    coverage: { total: cov.total, covered: cov.covered, gaps: cov.gaps },
  };
}

const cmd = argv[0] || "--list";
if (cmd === "--list") {
  console.log("OWNER FIRST: " + OWNER_FIRST.title);
  topChapters(39).forEach((c, i) => console.log(String(i + 2).padStart(2) + ". [" + ["Diamond", "Gold", "Silver", "Bronze"][c.w] + "] " + c.subject + " :: " + c.chapter));
} else if (cmd === "--build") {
  const pool = bankTopics();
  const kbs = kbPages();
  const lessons = lessonIndex();
  const chapters = topChapters(39);
  const entries = [OWNER_FIRST, ...chapters.map((c) => ({ title: c.subject + ": " + c.chapter, chapter: c.chapter, subject: c.subject }))];
  const topics = [];
  for (const e of entries) {
    const t = await buildTopic(e, pool, kbs, lessons);
    topics.push(t);
    console.log(t.title + " | mods:" + t.modules.map((m) => m.join("/")).join(",") + " | fetched:" + t.fetched + " | coverage:" + t.coverage.covered + "/" + t.coverage.total + " | gaps:" + t.coverage.gaps.join(","));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "topics.json"), JSON.stringify({ v: 1, tool: "tools/prep-nucleus360.mjs", topics }, null, 1));
  console.log("wrote " + path.join(OUT, "topics.json"));
} else if (cmd === "--report") {
  const j = JSON.parse(fs.readFileSync(path.join(OUT, "topics.json"), "utf8"));
  let cov = 0, tot = 0, fetched = 0;
  for (const t of j.topics) { cov += t.coverage.covered; tot += t.coverage.total; fetched += t.fetched; }
  console.log("topics:" + j.topics.length + " concepts:" + cov + "/" + tot + " fetched items:" + fetched);
  for (const t of j.topics) console.log("- " + t.title + ": " + t.coverage.covered + "/" + t.coverage.total + " concepts, " + t.fetched + " bank items, gaps: " + (t.coverage.gaps.join(", ") || "none"));
}
