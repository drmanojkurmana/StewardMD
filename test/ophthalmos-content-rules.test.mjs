// Ophthalmós content rules (owner, 2026-10-08; ophthalmos/CONTENT-RULES.md) checked over every lesson, notes.json,
// tracks.json, the glossary and the user-facing strings in ophthalmos-*.js:
//   R1  "world" never stands in for the visual field (en "world", hi "दुनिया") outside a lesson's analogy block;
//       no "relay knot" for the lateral geniculate nucleus.
//   R3  every listed abbreviation that is not a glossary link is expanded at its first use per lesson / note / track
//       / glossary entry: "relative afferent pupillary defect (RAPD)" or "RAPD (relative afferent pupillary defect)".
//       Glossary links ([[lgn]]) are expanded by the renderer and are skipped here.
//   R4  no em or en dash anywhere.
//   R5  a lesson that teaches a field defect (hemianopia, quadrantanopia, scotoma, field defect, tunnel vision) has
//       a valid "fields" block.
//   R9  the clearest vague placeholders ("two arteries", "carries one eye", "some nerves"...) are not used.
// Run: node --test test/ophthalmos-content-rules.test.mjs
// OPH_RULES_REPORT=<file> also writes every violation, one per line, to that file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEARN = join(ROOT, "ophthalmos/learn");
const D = createRequire(import.meta.url)(join(ROOT, "ophthalmos-data.js"));
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

// Abbreviations an author must write out at first use (brief R3). Glossary-linked ones are expanded by the renderer.
export const ABBR = ["IOP", "RAPD", "VA", "BCVA", "OCT", "FFA", "AMD", "ARMD", "DR", "NPDR", "PDR", "CSME", "DME", "CRAO", "CRVO", "BRAO", "BRVO",
  "RP", "POAG", "PACG", "NTG", "AC", "PC", "IOL", "SICS", "MSICS", "PHACO", "LASIK", "PRK", "INO", "IIH", "NAION", "AAION", "GCA", "ONTT",
  "MOG", "ROP", "RD", "PVD", "VKC", "HSV", "HZO", "TB", "HLA", "LGN", "OD", "OS", "RPE", "ICDR", "ETROP", "VEGF", "PRP", "CDR", "SLT", "PCO"];
// Keys that are not reader-facing prose (ids, file paths, citations, flags, field pattern names).
const SKIP = new Set(["id", "unit", "level", "minutes", "review", "reviewNote", "diagram", "img", "file", "more", "credit", "deckItem", "test", "glossary",
  "sources", "source", "reference", "licence", "licenceNote", "author", "route", "le", "re", "lesion", "deck", "modality", "w", "h", "x", "y", "a",
  "topic", "v", "verify", "access", "levels", "foundation", "of", "kind", "changes", "reviewed", "thumbs", "scene"]);

// Text of an object in reading order, split by language: {en: [..], hi: [..], any: [..]}; analogy text kept apart.
function texts(obj) {
  const out = { en: [], hi: [], any: [], analogyEn: [], analogyHi: [] };
  (function walk(v, inAnalogy) {
    if (typeof v === "string") { out.any.push(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, inAnalogy)); return; }
    if (!v || typeof v !== "object") return;
    if (typeof v.en === "string" && Object.keys(v).every((k) => k === "en" || k === "hi")) {
      (inAnalogy ? out.analogyEn : out.en).push(v.en);
      if (typeof v.hi === "string") (inAnalogy ? out.analogyHi : out.hi).push(v.hi);
      return;
    }
    for (const k of Object.keys(v)) if (!SKIP.has(k)) walk(v[k], inAnalogy || k === "analogy");
  })(obj, false);
  return out;
}
const unlink = (s) => s.replace(/\[\[[a-z0-9-]+(?:\|[^\]]+)?\]\]/g, " ");
// Is the first use of abbr in s (one screen's text, in order) expanded? "full form (ABBR)", "(..., ABBR)", "ABBR (full form)".
function firstUseExpanded(s, abbr) {
  const re = new RegExp("(^|[^A-Za-z0-9])" + abbr + "(?![A-Za-z0-9])", "g");
  const m = re.exec(s);
  if (!m) return null;
  const i = m.index + m[1].length, before = s.slice(Math.max(0, i - 160), i), after = s.slice(i + abbr.length);
  const open = before.lastIndexOf("("), close = before.lastIndexOf(")");
  if (open > close) return true;
  if (/^\s*\(/.test(after)) return true;
  return false;
}
function abbrIssues(where, lang, list) {
  const s = list.map(unlink).join("\n"), out = [];
  for (const a of ABBR) if (firstUseExpanded(s, a) === false) out.push(`R3 ${where} [${lang}]: "${a}" is not expanded at first use`);
  return out;
}
const WORLD_EN = /\bworld\b/i, WORLD_HI = /दुनिया/;
const VAGUE_EN = [/\btwo arteries\b/i, /\bcarr(?:y|ies) one eye\b/i, /\bsome (?:nerves|arteries|muscles|drugs)\b/i, /\brelay knot\b/i, /\bone of two arteries\b/i];
const VAGUE_HI = [/दो धमनि/, /एक आँख ले जा/, /कुछ नसें/];
const DASH = /[–—]/;
const FIELD_WORDS = /hemianopia|quadrantanopia|scotoma|field defect|tunnel vision/i;

function screenIssues(where, obj) {
  const t = texts(obj), out = [];
  t.en.forEach((s) => { if (WORLD_EN.test(s)) out.push(`R1 ${where} [en]: "world" for the visual field: ${s.slice(0, 120)}`); });
  t.hi.forEach((s) => { if (WORLD_HI.test(s)) out.push(`R1 ${where} [hi]: "दुनिया" for the visual field: ${s.slice(0, 120)}`); });
  t.en.concat(t.analogyEn).forEach((s) => VAGUE_EN.forEach((re) => { if (re.test(s)) out.push(`R9 ${where} [en]: vague "${s.match(re)[0]}": ${s.slice(0, 120)}`); }));
  t.hi.concat(t.analogyHi).forEach((s) => VAGUE_HI.forEach((re) => { if (re.test(s)) out.push(`R9 ${where} [hi]: vague "${s.match(re)[0]}": ${s.slice(0, 120)}`); }));
  out.push(...abbrIssues(where, "en", t.en.concat(t.analogyEn)), ...abbrIssues(where, "hi", t.hi.concat(t.analogyHi)));
  return out;
}

const glossary = readJSON(join(LEARN, "glossary.json"));
const media = {}; readJSON(join(LEARN, "media/credits.json")).items.forEach((m) => { media[m.id] = m; });
const lessonFiles = readdirSync(join(LEARN, "lessons")).filter((f) => f.endsWith(".json")).sort();
const ALL = [];
const record = (list) => { ALL.push(...list); return list; };

test("R1, R3, R9: every lesson", () => {
  const bad = [];
  for (const f of lessonFiles) bad.push(...record(screenIssues("lesson " + f.replace(/\.json$/, ""), readJSON(join(LEARN, "lessons", f)))));
  assert.deepEqual(bad, []);
});
test("R5: every lesson that teaches a field defect has a valid fields block", () => {
  const bad = [];
  for (const f of lessonFiles) {
    const l = readJSON(join(LEARN, "lessons", f)), t = texts(l);
    if (!t.en.concat(t.analogyEn).some((s) => FIELD_WORDS.test(s))) continue;
    if (!l.fields) bad.push(`R5 lesson ${l.id}: teaches a field defect but has no "fields" block`);
    else {
      const e = D.validateLesson(l, glossary.terms, media).filter((x) => /^fields/.test(x));
      if (e.length) bad.push(`R5 lesson ${l.id}: fields block invalid: ${e.join("; ")}`);
    }
  }
  assert.deepEqual(record(bad), []);
});
test("R1, R3, R9: notes.json (each note is a screen)", () => {
  const bad = [];
  for (const n of readJSON(join(ROOT, "ophthalmos/notes.json")).notes) bad.push(...screenIssues("note " + n.id, n));
  assert.deepEqual(record(bad), []);
});
test("R1, R3, R9: tracks.json (each clinic is a screen)", () => {
  const bad = [];
  for (const tr of readJSON(join(ROOT, "ophthalmos/tracks.json")).tracks) bad.push(...screenIssues("track " + tr.id, tr));
  assert.deepEqual(record(bad), []);
});
test("R1, R3, R9: glossary definitions (each entry is a screen; its own abbreviation is in its title)", () => {
  const bad = [];
  for (const [id, g] of Object.entries(glossary.terms)) bad.push(...screenIssues("glossary " + id, { term: { en: D.glossFull(g, "en") || g.term.en, hi: D.glossFull(g, "hi") || g.term.hi }, def: g.def }));
  assert.deepEqual(record(bad), []);
});
test("R3: every glossary abbreviation term has abbr and a full form in English and Hindi", () => {
  const bad = Object.entries(glossary.terms).filter(([, g]) => /[A-Z]{2,}/.test(g.term.en) && !(g.abbr === true && g.full && g.full.en && g.full.hi)).map(([id]) => `R3 glossary ${id}: abbreviation without abbr/full`);
  assert.deepEqual(record(bad), []);
});
test("R3: every glossary acronym renders a full first-use form that holds its short form", () => {
  const bad = [];
  for (const [id, g] of Object.entries(glossary.terms)) {
    if (!/[A-Z]{2,}/.test(g.term.en)) continue;
    const en = D.glossFull(g, "en"), hi = D.glossFull(g, "hi"), a = D.glossAbbr(g);
    const core = (a.match(/[A-Za-z]*[A-Z]{2,}[\w:-]*/) || [a])[0]; // "OCT" of "OCT scan", "Nd:YAG" of "Nd:YAG laser capsulotomy"
    if (!en || !en.includes(core) || !/[a-z]{4,}/.test(en.replace(core, ""))) bad.push(`R3 glossary ${id}: first use "${en}" is not a written-out full form of ${core}`);
    if (!hi || !hi.includes(core) || !/[ऀ-ॿ]/.test(hi)) bad.push(`R3 glossary ${id}: Hindi first use "${hi}" lacks the Hindi words or ${core}`);
  }
  assert.deepEqual(record(bad), []);
});
test("every [[term]] link in the lessons and the glossary resolves to a glossary entry", () => {
  const bad = [], re = /\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g;
  for (const f of lessonFiles) for (const m of readFileSync(join(LEARN, "lessons", f), "utf8").matchAll(re)) if (!glossary.terms[m[1]]) bad.push(`lesson ${f}: unknown glossary term [[${m[1]}]]`);
  assert.deepEqual(record(bad), []);
});
test("R4: no em or en dash in any Ophthalmós content or script", () => {
  const files = lessonFiles.map((f) => join(LEARN, "lessons", f)).concat([join(LEARN, "glossary.json"), join(LEARN, "media/credits.json"),
    join(ROOT, "ophthalmos/notes.json"), join(ROOT, "ophthalmos/tracks.json")],
  readdirSync(ROOT).filter((f) => /^ophthalmos[\w-]*\.(js|css)$/.test(f)).map((f) => join(ROOT, f)));
  const bad = files.filter((p) => DASH.test(readFileSync(p, "utf8"))).map((p) => "R4 " + p.slice(ROOT.length + 1) + ": em or en dash");
  assert.deepEqual(record(bad), []);
});
test("R1, R9: user-facing strings in ophthalmos-*.js", () => {
  const bad = [];
  for (const f of readdirSync(ROOT).filter((x) => /^ophthalmos[\w-]*\.js$/.test(x))) {
    const src = readFileSync(join(ROOT, f), "utf8");
    // string literals only (comments may discuss the rule itself)
    const strs = src.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) || [];
    strs.forEach((s) => {
      if (WORLD_EN.test(s) || WORLD_HI.test(s)) bad.push(`R1 ${f}: ${s.slice(0, 120)}`);
      VAGUE_EN.concat(VAGUE_HI).forEach((re) => { if (re.test(s)) bad.push(`R9 ${f}: ${s.slice(0, 120)}`); });
    });
  }
  assert.deepEqual(record(bad), []);
});
test("the field pattern model draws every pattern from the patient's view", () => {
  const A = (p, e, u, v) => D.fieldAlpha(p, e, u, v, 1.5).d;
  assert.equal(A("temporal", "L", 0.2, 0.5), 1); assert.equal(A("temporal", "L", 0.8, 0.5), 0); // left eye: outer = left
  assert.equal(A("temporal", "R", 0.8, 0.5), 1); assert.equal(A("temporal", "R", 0.2, 0.5), 0); // right eye: outer = right
  assert.equal(A("nasal", "L", 0.8, 0.5), 1); assert.equal(A("nasal", "R", 0.2, 0.5), 1);
  assert.equal(A("sup-left", "L", 0.2, 0.2), 1); assert.equal(A("sup-left", "L", 0.2, 0.8), 0);
  assert.equal(A("inf-right", "R", 0.8, 0.8), 1); assert.equal(A("altitudinal-inf", "L", 0.5, 0.9), 1);
  assert.equal(A("tunnel", "L", 0.5, 0.5), 0); assert.equal(A("tunnel", "L", 0.05, 0.05), 1);
  assert.equal(A("central", "R", 0.5, 0.5), 1); assert.equal(A("central", "R", 0.1, 0.5), 0);
  assert.equal(A("left-half-sparing", "L", 0.49, 0.5), 0); assert.equal(A("left-half-sparing", "L", 0.1, 0.5), 1);
  assert.ok(A("blind-spot", "L", 0.5 - 0.25 / 1.5, 0.52) > 0.9 && A("blind-spot", "R", 0.5 + 0.25 / 1.5, 0.52) > 0.9); // temporal to fixation
  assert.ok(A("arcuate-sup", "L", 0.5, 0.3) > 0.9 && A("arcuate-sup", "L", 0.5, 0.7) === 0);
  assert.equal(D.fieldAlpha("blur", "L", 0.5, 0.5, 1.5).b, 1);
  for (const p of D.FIELD_PATTERNS) for (const e of ["L", "R"]) { const r = D.fieldAlpha(p, e, 0.3, 0.6, 1.5); assert.ok(r.d >= 0 && r.d <= 1 && r.b >= 0 && r.b <= 1, p); }
  // both eyes open: bitemporal keeps the centre with no seam and loses the outer crescents; homonymous stays lost
  for (let u = 0.2; u <= 0.8; u += 0.01) assert.equal(D.fieldBoth("temporal", "temporal", u, 0.5, 1.5).d, 0);
  assert.equal(D.fieldBoth("temporal", "temporal", 0.02, 0.5, 1.5).d, 1);
  assert.equal(D.fieldBoth("left-half", "left-half", 0.3, 0.5, 1.5).d, 1);
  assert.equal(D.fieldBoth("full", "blind", 0.5, 0.5, 1.5).d, 0);
});

test.after(() => {
  if (process.env.OPH_RULES_REPORT) writeFileSync(process.env.OPH_RULES_REPORT, ALL.join("\n") + (ALL.length ? "\n" : ""));
});
