// Tokós 2.0 Learn content, Gynaecology MBBS units gy7 to gy12 (branch feat/tokos2-gyB).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../ophthalmos-data.js");
const ROOT = "tokos/learn";
const UNITS = process.env.GYB_UNITS ? process.env.GYB_UNITS.split(",") : ["gy7", "gy8", "gy9", "gy10", "gy11", "gy12"]; // env override for partial runs only
const TOPICS = ["gy-menstrual", "gy-infection", "gy-benign", "gy-oncology", "gy-fertility", "gy-contraception", "gy-urogyn", "gy-anatomy"];
const EXPLORERS = ["mechanism", "cycle", "palm-coein", "popq", "ovarian-triage", "cervical-screening"];
const TOOLS = ["edd", "bishop", "mgso4", "antid", "dipsi", "apgar", "efw", "weightgain", "vbac", "ganzoni", "rmi", "meows", "mec"];
const OK_LICENCE = /^(CC0|CC BY 4\.0|CC BY 3\.0|CC BY 2\.0|CC BY-SA 4\.0|CC BY-SA 3\.0|CC BY-SA 2\.0|ODC-BY 1\.0|Public domain|Original, MAIKNOWLEDGE LLP|Original, StewardMD)$/;
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

const units = UNITS.map((u) => readJSON(`${ROOT}/units/${u}.json`));
const glossary = {};
units.forEach((u) => Object.assign(glossary, u.glossary));
const media = {};
UNITS.forEach((u) => readJSON(`${ROOT}/media/credits-${u}.json`).items.forEach((m) => { media[m.id] = m; }));
const lessons = [];
units.forEach((u) => u.lessons.forEach((id) => lessons.push({ unit: u.id, id, l: readJSON(`${ROOT}/lessons/${id}.json`) })));

const walk = (v, fn, path = "") => {
  if (typeof v === "string") fn(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${path}[${i}]`));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => walk(v[k], fn, `${path}.${k}`));
};

test("six units, 3 to 10 lessons each, at least 30 lessons, ids prefixed by the unit id", () => {
  assert.equal(units.length, UNITS.length);
  if (!process.env.GYB_UNITS) assert.equal(units.length, 6);
  units.forEach((u) => {
    assert.ok(u.lessons.length >= 3 && u.lessons.length <= 10, u.id + " lesson count");
    assert.equal(u.level, "mbbs");
    assert.ok(u.title.en && u.title.hi);
    u.lessons.forEach((id) => assert.ok(id.startsWith(u.id + "-"), id));
  });
  if (!process.env.GYB_UNITS) assert.ok(lessons.length >= 30);
});

test("every lesson passes validateLesson with the merged glossary and media map", () => {
  lessons.forEach(({ id, unit, l }) => {
    assert.equal(l.id, id);
    assert.equal(l.unit, unit);
    assert.deepEqual(D.validateLesson(l, glossary, media), [], id);
  });
});

test("review is ai_drafted, minutes 4 to 7, 2 to 3 checks, sources present, test links are known ids", () => {
  lessons.forEach(({ id, l }) => {
    assert.ok(["ai_drafted", "reviewed"].includes(l.review && typeof l.review === "object" ? l.review.status : l.review), id);
    assert.ok(l.minutes >= 4 && l.minutes <= 7, id + " minutes");
    assert.ok(l.check.length >= 2 && l.check.length <= 3, id + " checks");
    assert.ok(l.sources.length >= 1, id + " sources");
    assert.ok(TOPICS.includes(l.test.mcqTopic), id + " mcqTopic");
    if (l.test.explorer) assert.ok(EXPLORERS.includes(l.test.explorer), id + " explorer");
    if (l.test.tool) assert.ok(TOOLS.includes(l.test.tool), id + " tool");
    assert.ok(l.see.hotspots.length >= 3, id + " hotspots");
    assert.ok(Array.isArray(l.competencies) && l.competencies.length >= 1, id + " competencies");
    l.competencies.forEach((c) => assert.match(c, /^OG\d+\.\d+$/, id + " competency code"));
  });
});

test("required tool and explorer links exist in the right units", { skip: !!process.env.GYB_UNITS }, () => {
  const has = (u, k, v) => lessons.some((x) => x.unit === u && x.l.test[k] === v);
  assert.ok(has("gy8", "tool", "mec"));
  assert.ok(has("gy10", "explorer", "cervical-screening"));
  assert.ok(has("gy11", "explorer", "ovarian-triage"));
  assert.ok(has("gy11", "tool", "rmi"));
});

test("every learner string has Hindi (Devanagari) and no em-dash anywhere", () => {
  lessons.forEach(({ id, l }) => {
    const bad = [];
    (function chk(v, path) {
      if (Array.isArray(v)) v.forEach((x, i) => chk(x, path + "[" + i + "]"));
      else if (v && typeof v === "object") {
        if (typeof v.en === "string") { if (!v.hi || (!/[\u0900-\u097f]/.test(v.hi) && v.hi.length > 24)) bad.push(path); } // a short acronym or number may stay in Latin script
        else Object.keys(v).forEach((k) => chk(v[k], path + "." + k));
      }
    })({ ...l, sources: undefined, glossary: undefined, test: undefined }, id);
    assert.deepEqual(bad, [], "missing Hindi");
  });
  units.forEach((u) => Object.keys(u.glossary).forEach((k) => {
    assert.ok(/^[a-z0-9-]+$/.test(k));
    assert.ok(/[\u0900-\u097f]/.test(u.glossary[k].term.hi + u.glossary[k].def.hi), k);
  }));
  const files = [];
  UNITS.forEach((u) => files.push(`${ROOT}/units/${u}.json`, `${ROOT}/media/credits-${u}.json`));
  lessons.forEach(({ id }) => files.push(`${ROOT}/lessons/${id}.json`));
  readdirSync(`${ROOT}/diagrams`).filter((f) => UNITS.some((u) => f.startsWith(u + "-"))).forEach((f) => files.push(`${ROOT}/diagrams/${f}`));
  files.forEach((f) => assert.ok(!/\u2014/.test(readFileSync(f, "utf8")), "em-dash in " + f));
});

test("Hindi keeps clinical numerals in ASCII (no Devanagari digits)", () => {
  lessons.forEach(({ id, l }) => walk(l, (s, p) => assert.ok(!/[\u0966-\u096f]/.test(s), id + p)));
});

test("every glossary link and every listed glossary id is defined in gy7 to gy12", () => {
  lessons.forEach(({ id, l }) => {
    walk({ ...l, sources: undefined }, (s) => {
      D.glossParts(s).forEach((p) => { if (p.term) assert.ok(glossary[p.term], id + " links " + p.term); });
    });
    l.glossary.forEach((g) => assert.ok(glossary[g], id + " lists " + g));
  });
});

test("diagrams: file exists, width height viewBox present and equal to see.w and see.h, no <text>", () => {
  lessons.forEach(({ id, l }) => {
    if (l.see.img) {
      assert.ok(existsSync(`${ROOT}/${l.see.img.replace(/^learn\//, "")}`), l.see.img);
      return;
    }
    const f = `${ROOT}/${l.see.diagram}`;
    assert.ok(existsSync(f), f);
    const s = readFileSync(f, "utf8");
    const root = /<svg\b[^>]*>/.exec(s)[0];
    const w = /\swidth="(\d+)"/.exec(root), h = /\sheight="(\d+)"/.exec(root), vb = /viewBox="0 0 (\d+) (\d+)"/.exec(root);
    assert.ok(w && h && vb, f + " needs width, height, viewBox");
    assert.equal(+w[1], l.see.w, id);
    assert.equal(+h[1], l.see.h, id);
    assert.equal(+vb[1], l.see.w);
    assert.equal(+vb[2], l.see.h);
    assert.ok(!/<text\b/i.test(s), f + " has <text>");
    assert.ok(!/<(script|style|foreignObject|image)\b/i.test(s), f + " has script/style/image");
  });
});

test("every media file has a credit entry with a permitted licence; every credit points at a file", () => {
  UNITS.forEach((u) => {
    const dir = `${ROOT}/media/${u}`;
    const items = readJSON(`${ROOT}/media/credits-${u}.json`).items;
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => statSync(`${dir}/${f}`).isFile()) : [];
    files.forEach((f) => assert.ok(items.some((m) => m.file === `${u}/${f}`), `no credit for ${dir}/${f}`));
    items.forEach((m) => {
      assert.ok(existsSync(`${ROOT}/media/${m.file}`), m.file);
      assert.match(m.licence, OK_LICENCE, m.id);
      assert.ok(m.alt && m.alt.en && m.alt.hi && m.caption && m.author, m.id);
      if (m.route !== "original") assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(m.source), m.id + " source");
    });
  });
});
