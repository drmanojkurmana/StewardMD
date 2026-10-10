import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../ophthalmos-data.js");
const R = "tokos/learn";
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const UNITS = ["obr1", "obr2", "obr3", "obr4", "obr5", "obr6", "obr7", "obr8"].filter((u) => existsSync(R + "/units/" + u + ".json"));
const units = UNITS.map((u) => json(R + "/units/" + u + ".json"));
const gloss = {};
units.forEach((u) => Object.assign(gloss, u.glossary));
const media = {};
UNITS.forEach((u) => json(R + "/media/credits-" + u + ".json").items.forEach((i) => { media[i.id] = i; }));
const lessons = [];
units.forEach((u) => u.lessons.forEach((id) => lessons.push(json(R + "/lessons/" + id + ".json"))));
const MCQ = ["ob-antenatal", "ob-labour", "ob-medical", "ob-haemorrhage", "ob-hypertension", "ob-fetal", "ob-puerperium", "ob-early", "ob-operative"];
const SIM = ["labour", "pph", "eclampsia", "shoulder", "breech", "twins", "collapse", "cardiac", "cerclage", "consent", "fgr"];
const CLINIC = ["ctg", "fetal-planes", "hc-biometry"];
const TOOL = ["edd", "bishop", "mgso4", "antid", "dipsi", "apgar", "efw", "weightgain", "vbac", "ganzoni", "rmi", "meows", "mec"];
const files = () => {
  const out = [];
  units.forEach((u) => {
    out.push(R + "/units/" + u.id + ".json", R + "/media/credits-" + u.id + ".json");
    u.lessons.forEach((id) => out.push(R + "/lessons/" + id + ".json"));
  });
  readdirSync(R + "/diagrams").filter((f) => /^obr[1-8]-/.test(f)).forEach((f) => out.push(R + "/diagrams/" + f));
  return out;
};
const strings = (o, acc = []) => {
  if (typeof o === "string") acc.push(o);
  else if (o && typeof o === "object") Object.keys(o).forEach((k) => strings(o[k], acc));
  return acc;
};
const bilingual = (o, acc = []) => {
  if (o && typeof o === "object") {
    if (typeof o.en === "string") acc.push(o);
    else Object.keys(o).forEach((k) => bilingual(o[k], acc));
  }
  return acc;
};

test("every obR unit exists with lessons and only resident, ai_drafted lessons", () => {
  assert.ok(units.length >= 1);
  units.forEach((u) => {
    assert.equal(u.level, "resident");
    assert.ok(u.lessons.length >= 4, u.id + " needs at least 4 lessons");
    u.lessons.forEach((id) => assert.ok(id.startsWith(u.id + "-"), id + " must be prefixed by " + u.id));
  });
  lessons.forEach((l) => {
    assert.equal(l.level, "resident");
    assert.ok(["ai_drafted", "reviewed"].includes(l.review && typeof l.review === "object" ? l.review.status : l.review));
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
    if (l.test.clinic) assert.ok(CLINIC.includes(l.test.clinic), l.id + " clinic");
    if (l.test.tool) assert.ok(TOOL.includes(l.test.tool), l.id + " tool");
  });
});

test("only terms defined in the obR units are linked, and unit glossary terms are defined in both languages", () => {
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

test("no em-dash in any obR file", () => {
  files().forEach((f) => assert.ok(!readFileSync(f, "utf8").includes("—"), f + " has an em-dash"));
});

test("every diagram has an original credit entry, matching size and no text or script in the SVG", () => {
  lessons.forEach((l) => {
    if (l.see.img) {
      assert.ok(existsSync(`${R}/media/${l.see.img.replace(/^learn\/media\//, "")}`), l.id + " img exists");
      const realItem = media[l.id + "-real"];
      assert.ok(realItem, l.id + "-real credited");
      assert.equal(realItem.route, "original");
      l.see.hotspots.forEach((h) => assert.ok(h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1));
      return;
    }
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
    l.see.hotspots.forEach((h) => assert.ok(h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1));
  });
});

test("every credited diagram is used by a lesson", () => {
  const used = new Set(lessons.flatMap((l) => [
    l.see.diagram,
    ...(l.see.more || []).map((m) => `diagrams/${m}.svg`),
    l.see.img ? l.see.img.replace(/^learn\/media\//, "") : null
  ]).filter(Boolean));
  Object.values(media).forEach((m) => assert.ok(used.has(m.file), m.id + " unused"));
});
