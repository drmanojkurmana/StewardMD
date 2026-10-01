/* test/tokos-learn-gyA.test.mjs: Tokos 2.0 Learn content, Gynaecology MBBS units gy1 to gy6.
 *
 * Every lesson must pass the Ophthalmos Learn schema check (D.validateLesson) with the glossary and image
 * library of these six units only. Also: no em-dash or en-dash anywhere, every media file has a credit with a
 * permitted licence, every SVG has width, height and viewBox (matching the lesson's see.w / see.h) and no <text>.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../ophthalmos-data.js");
const ROOT = new URL("../tokos/learn/", import.meta.url).pathname;
const UNITS = ["gy1", "gy2", "gy3", "gy4", "gy5", "gy6"];
const MCQ = ["ob-antenatal", "ob-labour", "ob-medical", "ob-haemorrhage", "ob-hypertension", "ob-fetal", "ob-puerperium", "ob-early", "ob-operative",
  "gy-menstrual", "gy-infection", "gy-benign", "gy-oncology", "gy-fertility", "gy-contraception", "gy-urogyn", "gy-anatomy"];
const EXPLORERS = ["mechanism", "cycle", "palm-coein", "popq", "ovarian-triage", "cervical-screening"];
const LICENCES = /^(CC0|CC BY(-SA)? \d\.\d|ODC-BY 1\.0|Public domain|Original, MAIKNOWLEDGE LLP|Original, StewardMD)$/;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const units = {}, glossary = {}, media = {}, credits = {};
for (const u of UNITS) {
  units[u] = readJson(ROOT + "units/" + u + ".json");
  Object.assign(glossary, units[u].glossary);
  const cp = ROOT + "media/credits-" + u + ".json";
  credits[u] = existsSync(cp) ? readJson(cp) : { v: 1, items: [] };
  for (const it of credits[u].items) media[it.id] = it;
}
const lessonFiles = readdirSync(ROOT + "lessons").filter((f) => /^gy[1-6]-.*\.json$/.test(f));

test("each unit lists lessons that exist, and every gy lesson file is listed by its unit", () => {
  const listed = new Set();
  for (const u of UNITS) {
    assert.equal(units[u].id, u);
    assert.equal(units[u].level, "mbbs");
    assert.ok(units[u].title.en && units[u].title.hi, u + " title en+hi");
    assert.ok(units[u].lessons.length >= 5, u + " has at least 5 lessons");
    for (const id of units[u].lessons) {
      assert.ok(id.indexOf(u + "-") === 0, id + " prefixed with its unit");
      assert.ok(existsSync(ROOT + "lessons/" + id + ".json"), id + " file exists");
      listed.add(id + ".json");
    }
  }
  for (const f of lessonFiles) assert.ok(listed.has(f), f + " is listed in its unit");
});

test("every lesson passes D.validateLesson with the unit glossary and media", () => {
  for (const f of lessonFiles) {
    const l = readJson(ROOT + "lessons/" + f);
    assert.deepEqual(D.validateLesson(l, glossary, media), [], f);
    assert.equal(l.id + ".json", f);
    assert.equal(l.level, "mbbs");
    assert.ok(["ai_drafted", "reviewed"].includes(l.review && typeof l.review === "object" ? l.review.status : l.review), f + " review");
    assert.ok(MCQ.indexOf(l.test.mcqTopic) >= 0, f + " mcqTopic");
    if (l.test.explorer) assert.ok(EXPLORERS.indexOf(l.test.explorer) >= 0, f + " explorer id");
    assert.ok(l.check.length >= 2 && l.check.length <= 3, f + " has 2 to 3 check questions");
    assert.ok(l.sources.length >= 1, f + " has sources");
    assert.ok(l.minutes >= 4 && l.minutes <= 7, f + " 4 to 7 minutes");
  }
});

test("every learner string has Hindi, with ASCII numerals only", () => {
  const seen = [];
  const walk = (v, where) => {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof v.en === "string") {
      assert.ok(typeof v.hi === "string" && v.hi.trim(), where + " needs Hindi");
      assert.ok(!/[०-९]/.test(v.hi), where + " has Devanagari digits");
      seen.push(where);
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, where + "[" + i + "]"));
    else if (v && typeof v === "object") Object.keys(v).forEach((k) => { if (k !== "sources" && k !== "credit") walk(v[k], where + "." + k); });
  };
  for (const f of lessonFiles) walk(readJson(ROOT + "lessons/" + f), f);
  for (const u of UNITS) walk(units[u].title, u + ".title"), walk(units[u].glossary, u + ".glossary");
  assert.ok(seen.length > 500);
});

test("no em-dash or en-dash in lessons, units, diagrams or credits", () => {
  const files = [];
  for (const f of lessonFiles) files.push(ROOT + "lessons/" + f);
  for (const u of UNITS) { files.push(ROOT + "units/" + u + ".json"); if (existsSync(ROOT + "media/credits-" + u + ".json")) files.push(ROOT + "media/credits-" + u + ".json"); }
  for (const f of readdirSync(ROOT + "diagrams").filter((n) => /^gy[1-6]-/.test(n))) files.push(ROOT + "diagrams/" + f);
  for (const f of files) assert.ok(!/[–—]/.test(readFileSync(f, "utf8")), f + " has a dash");
});

test("every SVG has width, height, viewBox (matching the lesson) and no <text>", () => {
  const svgs = readdirSync(ROOT + "diagrams").filter((n) => /^gy[1-6]-.*\.svg$/.test(n));
  assert.ok(svgs.length >= 30);
  for (const f of svgs) {
    const s = readFileSync(ROOT + "diagrams/" + f, "utf8");
    const root = /<svg\b[^>]*>/.exec(s)[0];
    const w = /\swidth="(\d+)"/.exec(root), h = /\sheight="(\d+)"/.exec(root), vb = /viewBox="0 0 (\d+) (\d+)"/.exec(root);
    assert.ok(w && h && vb, f + " needs width, height, viewBox");
    assert.equal(w[1], vb[1], f); assert.equal(h[1], vb[2], f);
    assert.ok(!/<text\b/i.test(s), f + " must not contain <text>");
    assert.ok(!/<script|<foreignObject|\son[a-z]+=/i.test(s), f + " must be inert");
    const l = readJson(ROOT + "lessons/" + f.replace(/\.svg$/, ".json"));
    if (l.see.img) {
      assert.ok(l.see.more && l.see.more.includes(f.replace(/\.svg$/, "")));
    } else {
      assert.equal(l.see.diagram, "diagrams/" + f);
      assert.equal(l.see.w, +w[1]); assert.equal(l.see.h, +h[1]);
    }
  }
  for (const f of lessonFiles) {
    const l = readJson(ROOT + "lessons/" + f);
    if (l.see.diagram) assert.ok(existsSync(ROOT + l.see.diagram), f + " diagram file exists");
    if (l.see.img) assert.ok(existsSync(ROOT + l.see.img.replace(/^learn\//, "")), f + " img file exists");
  }
});

test("every media file has a credit with a permitted licence, and every credit has its file", () => {
  for (const u of UNITS) {
    const dir = ROOT + "media/" + u;
    const files = existsSync(dir) ? readdirSync(dir) : [];
    const byFile = new Set(credits[u].items.map((it) => it.file));
    for (const f of files) assert.ok(byFile.has(u + "/" + f), u + "/" + f + " has a credit entry");
    for (const it of credits[u].items) {
      assert.ok(existsSync(ROOT + "media/" + it.file), it.id + " file exists");
      assert.ok(LICENCES.test(it.licence), it.id + " licence " + it.licence);
      assert.ok(it.alt && it.alt.en && it.alt.hi && it.caption && it.caption.en && it.caption.hi, it.id + " alt and caption en+hi");
      assert.ok(it.w > 0 && it.h > 0, it.id + " size");
      if (it.route !== "original") assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(it.source) && it.author, it.id + " needs source and author");
      assert.ok(it.file.indexOf(u + "/") === 0 || /^real\/[a-z0-9-]+\.webp$/.test(it.file) || /^\.\.\/diagrams\/[a-z0-9-]+\.svg$/.test(it.file), it.id + " lives under its unit folder (or is a lesson diagram or realistic image)");
    }
  }
});

test("glossary terms are defined in these units and every term has a definition in both languages", () => {
  for (const k of Object.keys(glossary)) {
    assert.match(k, /^[a-z0-9-]+$/);
    const g = glossary[k];
    assert.ok(g.term.en && g.term.hi && g.def.en && g.def.hi, k);
  }
});
