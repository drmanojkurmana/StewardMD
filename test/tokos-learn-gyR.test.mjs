// Tokos 2.0 Learn: Gynaecology Resident units gyr1 to gyr8 (validation, glossary, media, SVG rules).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../ophthalmos-data.js");
const url = (p) => new URL(p, import.meta.url);
const read = (p) => fs.readFileSync(url(p), "utf8");
const LEARN = "../tokos/learn/";
const ALL = ["gyr1", "gyr2", "gyr3", "gyr4", "gyr5", "gyr6", "gyr7", "gyr8"];
const UNITS = process.env.GYR_UNITS ? process.env.GYR_UNITS.split(",") : ALL;
const MCQ = ["ob-antenatal", "ob-labour", "ob-medical", "ob-haemorrhage", "ob-hypertension", "ob-fetal", "ob-puerperium", "ob-early", "ob-operative",
  "gy-menstrual", "gy-infection", "gy-benign", "gy-oncology", "gy-fertility", "gy-contraception", "gy-urogyn", "gy-anatomy"];
const EXPLORERS = ["mechanism", "cycle", "palm-coein", "popq", "ovarian-triage", "cervical-screening"];
const TOOLS = ["edd", "bishop", "mgso4", "antid", "dipsi", "apgar", "efw", "weightgain", "vbac", "ganzoni", "rmi", "meows", "mec"];
const DEVANAGARI = /[ऀ-ॿ]/;
const links = (s) => [...String(s).matchAll(/\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1]);

const units = UNITS.map((u) => ({ id: u, file: `${LEARN}units/${u}.json`, U: JSON.parse(read(`${LEARN}units/${u}.json`)) }));
const glossary = {};
for (const { U } of units) for (const [k, v] of Object.entries(U.glossary)) glossary[k] = v;
const lessons = [];
for (const { id, U } of units) for (const lid of U.lessons) {
  const raw = read(`${LEARN}lessons/${lid}.json`);
  lessons.push({ unit: id, id: lid, raw, L: JSON.parse(raw) });
}
const credits = {};
for (const u of UNITS) for (const it of JSON.parse(read(`${LEARN}media/credits-${u}.json`)).items) credits[it.id] = it;

function pairs(v, path = "", out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => pairs(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    if ("en" in v || "hi" in v) out.push({ path, v });
    else for (const [k, x] of Object.entries(v)) pairs(x, path ? `${path}.${k}` : k, out);
  }
  return out;
}
function wellFormed(svg) {
  const stack = [];
  for (const m of svg.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (!close) stack.push(name);
    else if (stack.pop() !== name) return false;
  }
  return stack.length === 0;
}
// Flesch-Kincaid grade (same method as Ophthalmos dev/learn-readability.mjs), English prose only.
function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const g = w.match(/[aeiouy]+/g);
  return Math.max(1, g ? g.length : 1);
}
function fk(texts) {
  let words = 0, sents = 0, syl = 0;
  for (const t of texts) {
    const s = t.trim(); if (!s) continue;
    sents += Math.max(1, (s.match(/[.!?]+(\s|$)/g) || []).length + (/[.!?]$/.test(s) ? 0 : 1));
    for (const w of s.split(/\s+/)) { const n = syllables(w); if (n) { words++; syl += n; } }
  }
  return words ? 0.39 * (words / sents) + 11.8 * (syl / words) - 15.59 : 0;
}
const SKIP = new Set(["sources", "credit", "label", "o", "title"]);
function englishTexts(L) {
  const out = [];
  const walk = (v) => {
    if (v && typeof v === "object") {
      if (typeof v.en === "string" && typeof v.hi === "string") out.push(v.en);
      else for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) walk(x);
    }
  };
  walk(L);
  return out.map((t) => t.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, sh) => sh || (glossary[id] ? glossary[id].term.en : id)));
}

test("eight units, resident level, 3 to 6 lessons each, ids prefixed by the unit", () => {
  assert.equal(units.length, UNITS.length);
  if (!process.env.GYR_UNITS) assert.equal(units.length, 8);
  for (const { id, U } of units) {
    assert.equal(U.id, id);
    assert.equal(U.level, "resident");
    assert.ok(U.title.en && DEVANAGARI.test(U.title.hi), `${id} title`);
    assert.ok(U.lessons.length >= 3 && U.lessons.length <= 6, `${id}: ${U.lessons.length} lessons`);
    for (const lid of U.lessons) assert.ok(lid.startsWith(id + "-"), `${lid} prefix`);
  }
  const ids = lessons.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  const onDisk = fs.readdirSync(url(`${LEARN}lessons`)).filter((f) => new RegExp("^(" + UNITS.join("|") + ")-.*\\.json$").test(f)).map((f) => f.replace(/\.json$/, ""));
  assert.deepEqual([...onDisk].sort(), [...ids].sort());
});

test("every lesson passes D.validateLesson with the merged glossary and media map", () => {
  for (const { id, L } of lessons) {
    assert.deepEqual(D.validateLesson(L, glossary, credits), [], id);
  }
});

test("schema extras: level, unit, review, checks, hotspots, test links, sources", () => {
  const keys = ["id", "unit", "level", "minutes", "review", "title", "idea", "see", "why", "spot", "todo", "remember", "check", "test", "glossary", "sources"];
  for (const { unit, id, L } of lessons) {
    for (const k of Object.keys(L)) assert.ok(keys.includes(k), `${id}: unknown key ${k}`);
    for (const k of keys) assert.ok(k in L, `${id}: missing ${k}`);
    assert.equal(L.unit, unit); assert.equal(L.level, "resident"); assert.equal(L.review, "ai_drafted");
    assert.ok(Number.isInteger(L.minutes) && L.minutes >= 3 && L.minutes <= 8, id);
    assert.ok(L.why.steps.length >= 3 && L.spot.length >= 2 && L.todo.length >= 1, id);
    assert.ok(L.see.hotspots.length >= 3, `${id} hotspots`);
    assert.equal(L.check.length, 3, id);
    for (const c of L.check) {
      assert.ok(c.o.length >= 2 && c.o.length <= 5, id);
      assert.equal(new Set(c.o.map((o) => o.en)).size, c.o.length, `${id} duplicate option`);
    }
    assert.ok(MCQ.includes(L.test.mcqTopic), `${id} mcqTopic`);
    if (L.test.explorer) assert.ok(EXPLORERS.includes(L.test.explorer), `${id} explorer`);
    if (L.test.tool) assert.ok(TOOLS.includes(L.test.tool), `${id} tool`);
    assert.ok(L.sources.length >= 2 && L.sources.every((s) => typeof s === "string" && s.length > 20), `${id} sources`);
    assert.ok(/\b(19|20)\d\d\b/.test(L.sources.join(" ")), `${id}: sources carry a year`);
  }
});

test("English and Hindi everywhere; glossary links match across languages and the lesson glossary list is exact", () => {
  for (const { id, raw, L } of lessons) {
    for (const { path, v } of pairs(L)) {
      assert.deepEqual(Object.keys(v).sort(), ["en", "hi"], `${id} ${path}`);
      assert.ok(v.en.trim() && v.hi.trim() && DEVANAGARI.test(v.hi), `${id} ${path}`);
      assert.deepEqual(links(v.en).sort(), links(v.hi).sort(), `${id} ${path}: glossary links differ`);
    }
    const inText = new Set(links(raw));
    for (const t of inText) assert.ok(glossary[t], `${id}: [[${t}]] undefined`);
    assert.deepEqual([...new Set(L.glossary)].sort(), [...inText].sort(), `${id}: glossary list`);
  }
  const used = new Set(lessons.flatMap(({ L }) => L.glossary));
  const seen = {};
  for (const { id, U } of units) for (const [t, x] of Object.entries(U.glossary)) {
    assert.ok(used.has(t), `${id}: term ${t} used by no lesson`);
    assert.ok(x.term.en && DEVANAGARI.test(x.term.hi) && x.def.en && DEVANAGARI.test(x.def.hi), `glossary ${t}`);
    assert.ok(!/^gyr\d/.test(t) && /^[a-z0-9-]+$/.test(t), `term id ${t}`);
    const k = x.term.en.toLowerCase(); assert.ok(!seen[k], `${t} and ${seen[k]} define "${k}"`); seen[k] = t;
  }
});

test("no em-dash in any gyr file, and English sentences stay short and readable", () => {
  const files = [];
  for (const u of UNITS) files.push(`${LEARN}units/${u}.json`, `${LEARN}media/credits-${u}.json`);
  for (const { id } of lessons) files.push(`${LEARN}lessons/${id}.json`);
  for (const f of fs.readdirSync(url(`${LEARN}diagrams`)).filter((n) => new RegExp("^(" + UNITS.join("|") + ")-").test(n))) files.push(`${LEARN}diagrams/${f}`);
  for (const f of files) assert.ok(!read(f).includes("—"), `${f}: em-dash`);
  const grades = [];
  for (const { id, L } of lessons) {
    const texts = englishTexts(L);
    for (const t of texts) for (const s of t.split(/(?<=[.!?])\s+/)) {
      const w = s.split(/\s+/).filter(Boolean).length;
      assert.ok(w <= 24, `${id}: ${w}-word sentence: ${s}`);
    }
    grades.push(fk(texts));
  }
  const mean = grades.reduce((a, b) => a + b, 0) / grades.length;
  assert.ok(mean <= 11, `mean Flesch-Kincaid grade ${mean.toFixed(1)}`);
});

test("diagrams: own SVG, no text or embedded content, viewBox matches the lesson, small, well-formed, credited", () => {
  const used = new Set();
  for (const { id, L } of lessons) {
    const s = L.see;
    assert.ok(s.diagram && !s.img, `${id}: original diagram expected`);
    used.add(s.diagram);
    const svg = read(LEARN + s.diagram);
    assert.match(svg.trim(), /^<svg\s[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, s.diagram);
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    assert.ok(vb && +vb[1] === s.w && +vb[2] === s.h, `${s.diagram}: viewBox ${vb && vb[0]} vs see.w/h ${s.w}x${s.h}`);
    assert.match(svg, /^<svg[^>]*\swidth="\d+"[^>]*\sheight="\d+"/, `${s.diagram} width/height`);
    assert.ok(!/<text[\s>]/i.test(svg), `${s.diagram}: <text>`);
    assert.ok(!/<(script|image|foreignObject)[\s>]/i.test(svg) && !/href=/i.test(svg) && !/\son[a-z]+=/i.test(svg), `${s.diagram}: embedded content`);
    assert.ok(wellFormed(svg), `${s.diagram} not well formed`);
    assert.ok(svg.length < 40000, `${s.diagram}: ${svg.length} bytes`);
    assert.ok(s.credit.startsWith("Original diagram"), id);
    for (const h of s.hotspots) assert.ok(h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1, `${id} hotspot`);
  }
  for (const f of fs.readdirSync(url(`${LEARN}diagrams`)).filter((n) => new RegExp("^(" + UNITS.join("|") + ")-").test(n))) assert.ok(used.has(`diagrams/${f}`), `unused diagram ${f}`);
});

test("credits: every diagram and media file has an original or permitted-licence entry", () => {
  const OK = /^(Original, MAIKNOWLEDGE LLP|CC0|CC BY \d\.\d|CC BY-SA \d\.\d|ODC-BY[\w. -]*|Public domain)$/;
  for (const u of UNITS) {
    const C = JSON.parse(read(`${LEARN}media/credits-${u}.json`));
    assert.equal(C.v, 1);
    for (const it of C.items) {
      assert.ok(it.id.startsWith(u + "-"), `${it.id} prefix`);
      assert.ok(OK.test(it.licence), `${it.id}: licence ${it.licence}`);
      assert.ok(it.alt.en && DEVANAGARI.test(it.alt.hi) && it.caption.en && DEVANAGARI.test(it.caption.hi), `${it.id} alt/caption`);
      assert.ok(it.file && it.route && it.author, `${it.id}`);
      assert.ok(fs.existsSync(url(`${LEARN}media/${it.file}`)), `${it.id}: file ${it.file} missing`);
      if (it.route !== "original") assert.ok(it.source, `${it.id}: source url`);
    }
    const dir = url(`${LEARN}media/${u}/`);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) assert.ok(C.items.some((it) => it.file === `${u}/${f}`), `media/${u}/${f} has no credits entry`);
  }
  for (const { id, L } of lessons) assert.ok(Object.values(credits).some((it) => it.file === `../${L.see.diagram}`), `${id}: diagram has no credits entry`);
});
