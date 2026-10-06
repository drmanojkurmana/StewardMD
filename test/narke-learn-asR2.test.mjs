// Narkē Learn Resident units asr5 to asr8 (cardiac/thoracic/vascular, neuro and trauma, critical care, perioperative
// medicine and CRM): content contract, modelled on test/tokos-learn-obR.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../specialty-data.js");
const R = "narke/learn";
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const UNITS = ["asr5", "asr6", "asr7", "asr8"].filter((u) => existsSync(R + "/units/" + u + ".json"));
const units = UNITS.map((u) => json(R + "/units/" + u + ".json"));
const gloss = {};
units.forEach((u) => Object.assign(gloss, u.glossary));
const media = {};
UNITS.forEach((u) => json(R + "/media/credits-" + u + ".json").items.forEach((i) => { media[i.id] = i; }));
const lessons = [];
units.forEach((u) => u.lessons.forEach((id) => lessons.push(json(R + "/lessons/" + id + ".json"))));
const MCQ = ["airway", "iv-agents", "inhalational", "nmb", "local-regional", "monitoring-equipment", "preop", "fluids-blood", "pain",
  "icu-ventilation", "cpr", "special-populations", "basic-science", "general"];
const SIM = ["bls", "als", "anaphylaxis", "paedarrest", "cico", "last", "mh", "highspinal", "laryngospasm", "bronchospasm", "haemorrhage", "aspiration"];
const TOOL = ["asa", "maintenance-fluids", "fasting-deficit", "mabl", "la-maxdose", "paeds-ett", "dosing-weight", "stopbang", "apfel", "rcri", "pf-ratio", "airway-predict"];
const EXPLORER = ["odc", "mac", "tof", "dermatomes", "ventilator", "circuit"];
const CLINIC = ["capno", "monitor"];
const files = () => {
  const out = [];
  units.forEach((u) => {
    out.push(R + "/units/" + u.id + ".json", R + "/media/credits-" + u.id + ".json");
    u.lessons.forEach((id) => out.push(R + "/lessons/" + id + ".json"));
  });
  readdirSync(R + "/diagrams").filter((f) => /^asr[5-8]-/.test(f)).forEach((f) => out.push(R + "/diagrams/" + f));
  return out;
};
const bilingual = (o, acc = []) => {
  if (o && typeof o === "object") {
    if (typeof o.en === "string") acc.push(o);
    else Object.keys(o).forEach((k) => bilingual(o[k], acc));
  }
  return acc;
};

test("all four units exist with at least 4 resident, ai_drafted lessons", () => {
  assert.equal(units.length, 4);
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

test("2 to 3 check questions, sources, deeper text and known test links", () => {
  lessons.forEach((l) => {
    assert.ok(l.check.length >= 2 && l.check.length <= 3, l.id + " checks");
    assert.ok(l.sources.length >= 1);
    assert.ok(l.deeper && l.deeper.text && l.deeper.text.en && l.deeper.text.hi, l.id + " deeper");
    assert.ok(MCQ.includes(l.test.mcqTopic), l.id + " mcqTopic");
    if (l.test.sim) assert.ok(SIM.includes(l.test.sim), l.id + " sim");
    if (l.test.tool) assert.ok(TOOL.includes(l.test.tool), l.id + " tool");
    if (l.test.explorer) assert.ok(EXPLORER.includes(l.test.explorer), l.id + " explorer");
    if (l.test.clinic) assert.ok(CLINIC.includes(l.test.clinic), l.id + " clinic");
  });
});

test("competencies, where present, are NMC AS codes", () => {
  lessons.forEach((l) => (l.competencies || []).forEach((c) => assert.match(c, /^AS(10|[1-9])\.\d$/, l.id + " " + c)));
});

test("only terms defined in these units are linked, and glossary terms are defined in both languages", () => {
  lessons.forEach((l) => l.glossary.forEach((g) => assert.ok(gloss[g], l.id + " unknown term " + g)));
  Object.keys(gloss).forEach((k) => {
    assert.match(k, /^[a-z0-9-]+$/);
    assert.ok(gloss[k].term.en && gloss[k].term.hi && gloss[k].def.en && gloss[k].def.hi, k);
  });
});

test("Hindi for every learner string: Devanagari present, digits stay ASCII", () => {
  lessons.forEach((l) => bilingual(l).forEach((b) => {
    assert.ok(typeof b.hi === "string" && b.hi.trim().length > 0, l.id + " missing hi for " + b.en.slice(0, 40));
    assert.doesNotMatch(b.hi + b.en, /[०-९]/, l.id + " Devanagari digit");
  }));
  units.forEach((u) => {
    assert.ok(u.title.hi);
    Object.values(u.glossary).forEach((g) => { assert.doesNotMatch(g.def.hi + g.term.hi, /[०-९]/); });
  });
});

test("no em dash or en dash in any file", () => {
  files().forEach((f) => assert.doesNotMatch(readFileSync(f, "utf8"), /[–—]/, f));
});

test("every diagram has an original credit entry, matching size and no text or script in the SVG", () => {
  lessons.forEach((l) => {
    const item = media[l.see.diagram.replace(/^diagrams\//, "").replace(/\.svg$/, "")];
    assert.ok(item, l.id + " diagram not credited");
    assert.equal(item.route, "original");
    assert.match(item.licence, /MAIKNOWLEDGE LLP/);
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
