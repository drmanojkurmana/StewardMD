// Tokós 2.0 Learn content, Obstetrics MBBS units ob1 to ob6: schema, media credits, SVG and text rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../ophthalmos-data.js");

const LEARN = "tokos/learn";
const UNIT_IDS = ["ob1", "ob2", "ob3", "ob4", "ob5", "ob6"];
const MCQ = ["ob-antenatal", "ob-labour", "ob-medical", "ob-haemorrhage", "ob-hypertension", "ob-fetal", "ob-puerperium", "ob-early", "ob-operative",
  "gy-menstrual", "gy-infection", "gy-benign", "gy-oncology", "gy-fertility", "gy-contraception", "gy-urogyn", "gy-anatomy"];
const SIMS = ["labour", "pph", "eclampsia", "shoulder", "breech", "twins", "collapse"];
const TOOLS = ["edd", "bishop", "mgso4", "antid", "dipsi", "apgar", "efw", "weightgain", "vbac", "ganzoni", "rmi", "meows", "mec"];
const CLINICS = ["ctg", "fetal-planes", "hc-biometry"];
const LICENCES = /^(CC0|CC BY \d\.\d|CC BY-SA \d\.\d|ODC-BY( \d\.\d)?|Public domain|Original, MAIKNOWLEDGE LLP|Original, StewardMD)$/;
const EM_DASH = String.fromCharCode(8212);

const rj = (p) => JSON.parse(readFileSync(p, "utf8"));
const units = UNIT_IDS.filter((u) => existsSync(`${LEARN}/units/${u}.json`)).map((u) => rj(`${LEARN}/units/${u}.json`));
const lessonFiles = existsSync(`${LEARN}/lessons`) ? readdirSync(`${LEARN}/lessons`).filter((f) => /^ob[1-6]-.+\.json$/.test(f)) : [];
const lessons = lessonFiles.map((f) => rj(`${LEARN}/lessons/${f}`));
const glossary = {};
units.forEach((u) => Object.assign(glossary, u.glossary));
const media = {};
UNIT_IDS.forEach((u) => {
  const p = `${LEARN}/media/credits-${u}.json`;
  if (existsSync(p)) rj(p).items.forEach((i) => (media[i.id] = i));
});

function walk(o, fn, path = "") {
  if (Array.isArray(o)) o.forEach((v, i) => walk(v, fn, `${path}[${i}]`));
  else if (o && typeof o === "object") {
    fn(o, path);
    Object.keys(o).forEach((k) => walk(o[k], fn, `${path}.${k}`));
  }
}

test("units: each of ob1..ob6 exists, lists real lessons, and has a bilingual glossary", () => {
  assert.equal(units.length, UNIT_IDS.length, "all six units present");
  const seen = {};
  units.forEach((u) => {
    assert.ok(u.title.en && u.title.hi, u.id + " title");
    assert.equal(u.level, "mbbs");
    assert.ok(u.lessons.length >= 5, u.id + " has at least 5 lessons");
    u.lessons.forEach((id) => {
      assert.ok(id.startsWith(u.id + "-"), id + " is prefixed by its unit");
      assert.ok(existsSync(`${LEARN}/lessons/${id}.json`), id + " file missing");
    });
    Object.entries(u.glossary).forEach(([id, g]) => {
      assert.match(id, /^[a-z0-9-]+$/);
      assert.ok(!seen[id], "glossary term defined twice: " + id);
      seen[id] = 1;
      ["term", "def"].forEach((k) => {
        assert.ok(g[k] && g[k].en && g[k].hi, id + "." + k + " needs en and hi");
      });
    });
  });
  const listed = new Set(units.flatMap((u) => u.lessons));
  lessonFiles.forEach((f) => assert.ok(listed.has(f.replace(/\.json$/, "")), f + " is not listed in any unit"));
});

test("every lesson passes validateLesson with the merged glossary and media map", () => {
  assert.ok(lessons.length >= 30, "expect about 5 or more lessons per unit, got " + lessons.length);
  lessons.forEach((l) => assert.deepEqual(D.validateLesson(l, glossary, media), [], l.id));
});

test("lessons: unit, review, minutes, checks, sources, hotspots, competencies, test links", () => {
  lessons.forEach((l) => {
    const u = units.find((x) => x.lessons.includes(l.id));
    assert.ok(u && l.unit === u.id, l.id + " unit mismatch");
    assert.ok(l.id.startsWith(l.unit + "-"), l.id + " prefix");
    assert.equal(l.level, "mbbs");
    assert.ok(["ai_drafted", "reviewed"].includes(l.review && typeof l.review === "object" ? l.review.status : l.review), l.id);
    assert.ok(l.minutes >= 4 && l.minutes <= 7, l.id + " minutes 4 to 7");
    assert.ok(l.check.length >= 2 && l.check.length <= 3, l.id + " needs 2 to 3 check questions");
    assert.ok(l.sources.length >= 1 && l.sources.every((s) => typeof s === "string" && s.length > 20), l.id + " sources");
    assert.ok(l.see.hotspots.length >= 3 && l.see.hotspots.length <= 10, l.id + " hotspots");
    assert.ok(Array.isArray(l.competencies) && l.competencies.length >= 1 && l.competencies.every((c) => /^OG\d+\.\d+$/.test(c)), l.id + " competencies");
    assert.ok(MCQ.includes(l.test.mcqTopic), l.id + " mcqTopic");
    if (l.test.sim) assert.ok(SIMS.includes(l.test.sim), l.id + " sim");
    if (l.test.tool) assert.ok(TOOLS.includes(l.test.tool), l.id + " tool");
    if (l.test.clinic) assert.ok(CLINICS.includes(l.test.clinic), l.id + " clinic");
    l.check.forEach((c) => assert.ok(c.o.length >= 3, l.id + " needs 3 or more options"));
    // the right answer must not always be the same slot
  });
  const slots = new Set(lessons.flatMap((l) => l.check.map((c) => c.a)));
  assert.ok(slots.size >= 3, "correct answers should vary between options");
});

test("every learner string has Hindi, and Hindi keeps ASCII numerals", () => {
  lessons.concat(units).forEach((l) => {
    walk(l, (o, p) => {
      if (typeof o.en === "string") {
        assert.ok(typeof o.hi === "string" && o.hi.trim().length > 0, `${l.id}${p} needs hi`);
        assert.ok(!/[०-९]/.test(o.hi), `${l.id}${p} has Devanagari digits`);
      }
    });
  });
});

test("no em-dash in lessons, units, credits or diagrams", () => {
  const files = [
    ...lessonFiles.map((f) => `${LEARN}/lessons/${f}`),
    ...UNIT_IDS.map((u) => `${LEARN}/units/${u}.json`),
    ...UNIT_IDS.map((u) => `${LEARN}/media/credits-${u}.json`),
    ...(existsSync(`${LEARN}/diagrams`) ? readdirSync(`${LEARN}/diagrams`).filter((f) => /^ob[1-6]-.+\.svg$/.test(f)).map((f) => `${LEARN}/diagrams/${f}`) : []),
  ].filter(existsSync);
  assert.ok(files.length > 30);
  files.forEach((f) => assert.ok(!readFileSync(f, "utf8").includes(EM_DASH), f + " contains an em-dash"));
});

test("every diagram is a sized, text-free SVG whose viewBox matches the lesson", () => {
  lessons.forEach((l) => {
    if (!l.see.diagram) return;
    const p = `${LEARN}/${l.see.diagram}`;
    assert.ok(existsSync(p), p + " missing");
    assert.ok(l.see.diagram.startsWith(`diagrams/${l.unit}-`), l.id + " diagram is prefixed by its unit");
    const svg = readFileSync(p, "utf8");
    const root = /<svg\b[^>]*>/.exec(svg)[0];
    const w = /\swidth="(\d+)"/.exec(root), h = /\sheight="(\d+)"/.exec(root), vb = /\sviewBox="0 0 (\d+) (\d+)"/.exec(root);
    assert.ok(w && h && vb, p + " needs width, height and viewBox");
    assert.equal(+w[1], +vb[1]);
    assert.equal(+h[1], +vb[2]);
    assert.equal(l.see.w, +vb[1], l.id + " see.w");
    assert.equal(l.see.h, +vb[2], l.id + " see.h");
    assert.ok(!/<text\b|<tspan\b|<script\b|<foreignObject\b|<image\b/i.test(svg), p + " has text, script or an external image");
    assert.ok(!/\son[a-z]+=/.test(svg), p + " has an event handler");
  });
});

test("diagram files all belong to a lesson (no strays)", () => {
  if (!existsSync(`${LEARN}/diagrams`)) return;
  const used = new Set(lessons.flatMap((l) => [
    l.see.diagram && l.see.diagram.replace("diagrams/", ""),
    ...(l.see.more || []).map((m) => m + ".svg")
  ]).filter(Boolean));
  readdirSync(`${LEARN}/diagrams`).filter((f) => /^ob[1-6]-.+\.svg$/.test(f)).forEach((f) => assert.ok(used.has(f), f + " is unused"));
});

test("every media file has a permitted-licence credit, and every credit has its file", () => {
  UNIT_IDS.forEach((u) => {
    const cp = `${LEARN}/media/credits-${u}.json`;
    assert.ok(existsSync(cp), cp + " missing");
    const c = rj(cp);
    assert.equal(c.unit, u);
    const dir = `${LEARN}/media/${u}`;
    const files = existsSync(dir) ? readdirSync(dir) : [];
    const credited = new Set(c.items.map((i) => i.file));
    files.forEach((f) => assert.ok(credited.has(`${u}/${f}`), `${dir}/${f} has no credit`));
    c.items.forEach((i) => {
      assert.ok(existsSync(`${LEARN}/media/${i.file}`), i.file + " missing");
      assert.match(i.licence, LICENCES, i.id + " licence");
      assert.ok(i.alt && i.alt.en && i.alt.hi && i.caption && i.caption.en && i.caption.hi, i.id + " alt and caption");
      assert.ok(i.w > 0 && i.h > 0, i.id + " size");
      if (i.route !== "original") assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(i.source || "") && i.author, i.id + " needs a Commons source page and author");
    });
  });
});
