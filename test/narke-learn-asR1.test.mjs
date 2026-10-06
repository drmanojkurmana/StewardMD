// Narkē Resident Learn units asr1 to asr4 (advanced airway, ultrasound-guided regional, obstetric, paediatric).
// Modelled on test/tokos-learn-obR.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../specialty-data.js");
const R = "narke/learn";
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const UNITS = ["asr1", "asr2", "asr3", "asr4"];
const units = UNITS.map((u) => json(R + "/units/" + u + ".json"));
const gloss = {};
units.forEach((u) => Object.assign(gloss, u.glossary));
const media = {};
UNITS.forEach((u) => json(R + "/media/credits-" + u + ".json").items.forEach((i) => { media[i.id] = i; }));
const lessons = [];
units.forEach((u) => u.lessons.forEach((id) => lessons.push(json(R + "/lessons/" + id + ".json"))));
// Shared ids fixed by the lead (Narkē brief).
const MCQ = ["airway", "iv-agents", "inhalational", "nmb", "local-regional", "monitoring-equipment", "preop", "fluids-blood", "pain",
  "icu-ventilation", "cpr", "special-populations", "basic-science", "general"];
const SIM = ["bls", "als", "anaphylaxis", "paedarrest", "cico", "last", "mh", "highspinal", "laryngospasm", "bronchospasm", "haemorrhage", "aspiration"];
const TOOL = ["asa", "maintenance-fluids", "fasting-deficit", "mabl", "la-maxdose", "paeds-ett", "dosing-weight", "stopbang", "apfel", "rcri", "pf-ratio", "airway-predict"];
const files = () => {
  const out = [];
  units.forEach((u) => {
    out.push(R + "/units/" + u.id + ".json", R + "/media/credits-" + u.id + ".json");
    u.lessons.forEach((id) => out.push(R + "/lessons/" + id + ".json"));
  });
  readdirSync(R + "/diagrams").filter((f) => /^asr[1-4]-/.test(f)).forEach((f) => out.push(R + "/diagrams/" + f));
  return out;
};
const bilingual = (o, acc = []) => {
  if (o && typeof o === "object") {
    if (typeof o.en === "string") acc.push(o);
    else Object.keys(o).forEach((k) => bilingual(o[k], acc));
  }
  return acc;
};

test("asr1 to asr4 exist, resident level, 4 or more lessons each, ai_drafted with claims to verify", () => {
  units.forEach((u) => {
    assert.equal(u.level, "resident");
    assert.ok(u.lessons.length >= 4, u.id + " needs at least 4 lessons");
    u.lessons.forEach((id) => assert.ok(id.startsWith(u.id + "-"), id + " must be prefixed by " + u.id));
  });
  lessons.forEach((l) => {
    assert.equal(l.level, "resident");
    assert.equal(l.review.status, "ai_drafted", l.id);
    assert.ok(Array.isArray(l.review.verify) && l.review.verify.length >= 1, l.id + " verify list");
    assert.ok(l.minutes >= 4 && l.minutes <= 7, l.id + " minutes");
  });
});

test("every lesson passes validateLesson with the merged glossary and media map", () => {
  lessons.forEach((l) => assert.deepEqual(D.validateLesson(l, gloss, media), [], l.id));
});

test("2 to 3 checks, sources, deeper text and known test links", () => {
  lessons.forEach((l) => {
    assert.ok(l.check.length >= 2 && l.check.length <= 3, l.id + " checks");
    assert.ok(l.sources.length >= 1);
    assert.ok(l.deeper && l.deeper.text && l.deeper.text.en && l.deeper.text.hi, l.id + " deeper");
    assert.ok(MCQ.includes(l.test.mcqTopic), l.id + " mcqTopic");
    if (l.test.sim) assert.ok(SIM.includes(l.test.sim), l.id + " sim");
    if (l.test.tool) assert.ok(TOOL.includes(l.test.tool), l.id + " tool");
    (l.competencies || []).forEach((c) => assert.match(c, /^AS([1-9]|10)\.\d$/, l.id + " competency"));
  });
});

test("linked terms are defined, and unit glossary terms are defined in both languages", () => {
  lessons.forEach((l) => l.glossary.forEach((g) => assert.ok(gloss[g], l.id + " unknown term " + g)));
  Object.keys(gloss).forEach((k) => {
    assert.match(k, /^[a-z0-9-]+$/);
    assert.ok(gloss[k].term.en && gloss[k].term.hi && gloss[k].def.en && gloss[k].def.hi, k);
  });
});

test("Hindi for every learner string, digits stay ASCII", () => {
  lessons.forEach((l) => bilingual(l).forEach((b) => {
    assert.ok(typeof b.hi === "string" && b.hi.trim().length > 0, l.id + " missing hi for " + b.en.slice(0, 40));
    assert.doesNotMatch(b.hi + b.en, /[०-९]/, l.id + " Devanagari digit");
  }));
  units.forEach((u) => {
    assert.ok(u.title.hi);
    Object.values(u.glossary).forEach((g) => assert.doesNotMatch(g.def.hi + g.term.hi, /[०-९]/));
  });
});

test("English sentences are 20 words or fewer", () => {
  [...lessons, ...units].forEach((x) => bilingual(x).forEach((b) => b.en.split(/(?<=[.!?])\s+/).forEach((s) =>
    assert.ok(s.split(/\s+/).length <= 20, (x.id || "") + " long sentence: " + s))));
});

test("no em dash or en dash in any asr1 to asr4 file", () => {
  files().forEach((f) => assert.doesNotMatch(readFileSync(f, "utf8"), /[–—]/, f));
});

test("every diagram is original, credited, sized to its viewBox, with no text or script", () => {
  lessons.forEach((l) => {
    const item = media[l.see.diagram.replace(/^diagrams\//, "").replace(/\.svg$/, "")];
    assert.ok(item, l.id + " diagram not credited");
    assert.equal(item.route, "original");
    assert.equal(item.licence, "Original, MAIKNOWLEDGE LLP");
    assert.equal(l.see.credit, "Original, MAIKNOWLEDGE LLP");
    assert.equal(item.file, l.see.diagram);
    assert.ok(item.alt.en && item.alt.hi && item.caption.en && item.caption.hi);
    const svg = readFileSync(R + "/" + l.see.diagram, "utf8");
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    assert.ok(vb, l.id + " viewBox");
    assert.equal(+vb[1], l.see.w);
    assert.equal(+vb[2], l.see.h);
    assert.match(svg, /<svg[^>]*\swidth="\d+"[^>]*\sheight="\d+"/);
    assert.doesNotMatch(svg, /<text\b|<tspan|<script|<foreignObject|<image|<style|\son[a-z]+=|href=/i, l.id + " forbidden SVG content");
    assert.ok(l.see.hotspots.length >= 3, l.id + " hotspots");
    l.see.hotspots.forEach((h) => assert.ok(h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1));
  });
});

test("every credited diagram is used by a lesson", () => {
  const used = new Set(lessons.map((l) => l.see.diagram));
  Object.values(media).forEach((m) => assert.ok(used.has(m.file), m.id + " unused"));
});

test("paediatric and neonatal resuscitation numbers match the kb protocols", () => {
  const pals = readFileSync("kb/clinical-protocols/paediatric-cardiac-arrest.json", "utf8");
  const nrp = readFileSync("kb/clinical-protocols/neonatal-resuscitation.json", "utf8");
  const l = json(R + "/lessons/asr4-resuscitation.json"), txt = JSON.stringify(l);
  ["0.01 mg/kg IV/IO", "max 1 mg", "15:2", "2 J/kg", "4 J/kg", "10 J/kg"].forEach((s) => { assert.ok(txt.includes(s), s); assert.ok(pals.includes(s), "kb " + s); });
  ["0.01 to 0.03 mg/kg", "3:1", "20 to 30 cmH2O", "30 to 60 breaths"].forEach((s) => { assert.ok(txt.includes(s), s); assert.ok(nrp.includes(s), "kb " + s); });
});
