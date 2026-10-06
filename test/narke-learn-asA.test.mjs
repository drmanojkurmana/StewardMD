// Narkē Learn content, Anaesthesia MBBS units as1 to as5 (NMC AS1 to AS5): schema, competencies, media credits, SVG and text rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../specialty-data.js");

const LEARN = "narke/learn";
const UNIT_IDS = ["as1", "as2", "as3", "as4", "as5"];
const LESSON_RE = /^as[1-5]-.+\.json$/;
const SVG_RE = /^as[1-5]-.+\.svg$/;
const MCQ = ["airway", "iv-agents", "inhalational", "nmb", "local-regional", "monitoring-equipment", "preop", "fluids-blood", "pain",
  "icu-ventilation", "cpr", "special-populations", "basic-science", "general"];
const SIMS = ["bls", "als", "anaphylaxis", "paedarrest", "cico", "last", "mh", "highspinal", "laryngospasm", "bronchospasm", "haemorrhage", "aspiration"];
const TOOLS = ["asa", "maintenance-fluids", "fasting-deficit", "mabl", "la-maxdose", "paeds-ett", "dosing-weight", "stopbang", "apfel", "rcri", "pf-ratio", "airway-predict"];
const EXPLORERS = ["odc", "mac", "tof", "dermatomes", "ventilator", "circuit"];
// NMC 2018 Vol III, topics AS1 to AS5 (the full list of 46 codes lives with the lead; these are the ones these units own).
const AS_CODES = { AS1: 4, AS2: 2, AS3: 6, AS4: 7, AS5: 6 };
const OWNED = Object.entries(AS_CODES).flatMap(([t, n]) => Array.from({ length: n }, (_, i) => `${t}.${i + 1}`));
const LICENCE = "Original, MAIKNOWLEDGE LLP";
const DASHES = [String.fromCharCode(8212), String.fromCharCode(8211)];

const rj = (p) => JSON.parse(readFileSync(p, "utf8"));
const units = UNIT_IDS.filter((u) => existsSync(`${LEARN}/units/${u}.json`)).map((u) => rj(`${LEARN}/units/${u}.json`));
const lessonFiles = existsSync(`${LEARN}/lessons`) ? readdirSync(`${LEARN}/lessons`).filter((f) => LESSON_RE.test(f)) : [];
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

test("units: as1..as5 exist, list real lessons, and carry a bilingual glossary", () => {
  assert.equal(units.length, UNIT_IDS.length, "all five units present");
  const seen = {};
  units.forEach((u) => {
    assert.ok(u.title.en && u.title.hi, u.id + " title");
    assert.equal(u.level, "mbbs");
    assert.ok(u.lessons.length >= 4, u.id + " has at least 4 lessons");
    u.lessons.forEach((id) => {
      assert.ok(id.startsWith(u.id + "-"), id + " is prefixed by its unit");
      assert.ok(existsSync(`${LEARN}/lessons/${id}.json`), id + " file missing");
    });
    Object.entries(u.glossary).forEach(([id, g]) => {
      assert.match(id, /^[a-z0-9-]+$/);
      assert.ok(!seen[id], "glossary term defined twice: " + id);
      seen[id] = 1;
      ["term", "def"].forEach((k) => assert.ok(g[k] && g[k].en && g[k].hi, id + "." + k + " needs en and hi"));
    });
  });
  const listed = new Set(units.flatMap((u) => u.lessons));
  lessonFiles.forEach((f) => assert.ok(listed.has(f.replace(/\.json$/, "")), f + " is not listed in any unit"));
});

test("every lesson passes validateLesson with the merged glossary and media map", () => {
  assert.ok(lessons.length >= 25, "expect about 5 lessons per unit, got " + lessons.length);
  lessons.forEach((l) => assert.deepEqual(D.validateLesson(l, glossary, media), [], l.id));
});

test("lessons: unit, review with verify list, minutes, checks, sources, hotspots, test links", () => {
  lessons.forEach((l) => {
    const u = units.find((x) => x.lessons.includes(l.id));
    assert.ok(u && l.unit === u.id, l.id + " unit mismatch");
    assert.equal(l.level, "mbbs");
    assert.equal(l.review.status, "ai_drafted", l.id + " review");
    assert.ok(Array.isArray(l.review.verify) && l.review.verify.length >= 1, l.id + " verify list");
    assert.ok(l.minutes >= 4 && l.minutes <= 7, l.id + " minutes 4 to 7");
    assert.ok(l.check.length >= 2 && l.check.length <= 3, l.id + " needs 2 to 3 check questions");
    assert.ok(l.sources.length >= 2 && l.sources.every((s) => typeof s === "string" && s.length > 20), l.id + " sources");
    assert.ok(l.see.hotspots.length >= 3 && l.see.hotspots.length <= 7, l.id + " 3 to 7 hotspots");
    assert.ok(MCQ.includes(l.test.mcqTopic), l.id + " mcqTopic");
    if (l.test.sim) assert.ok(SIMS.includes(l.test.sim), l.id + " sim");
    if (l.test.tool) assert.ok(TOOLS.includes(l.test.tool), l.id + " tool");
    if (l.test.explorer) assert.ok(EXPLORERS.includes(l.test.explorer), l.id + " explorer");
  });
});

test("checks: one right answer, at least 4 options, no duplicates, similar option lengths, answer slot varies", () => {
  lessons.forEach((l) => l.check.forEach((c, i) => {
    const w = `${l.id} check ${i}`;
    assert.ok(c.o.length >= 4, w + " options");
    assert.ok(Number.isInteger(c.a) && c.a >= 0 && c.a < c.o.length, w + " answer index");
    assert.equal(new Set(c.o.map((o) => o.en.toLowerCase())).size, c.o.length, w + " duplicate options");
    const lens = c.o.map((o) => o.en.length), right = lens[c.a], longest = Math.max(...lens);
    assert.ok(!(right === longest && right > 2 * Math.max(...lens.filter((_, j) => j !== c.a))), w + " right answer stands out by length");
    c.o.forEach((o) => assert.ok(!/^(all|none) of the above$/i.test(o.en), w + " no all/none of the above"));
  }));
  const slots = new Set(lessons.flatMap((l) => l.check.map((c) => c.a)));
  assert.equal(slots.size, 4, "right answers use every option slot");
});

test("competencies: real AS codes, and every AS1 to AS5 competency is taught by a lesson", () => {
  const taught = new Set();
  lessons.forEach((l) => {
    assert.ok(Array.isArray(l.competencies) && l.competencies.length >= 1, l.id + " competencies");
    l.competencies.forEach((c) => {
      assert.ok(OWNED.includes(c), l.id + " unknown code " + c);
      assert.equal(c.split(".")[0].toLowerCase(), l.unit, l.id + " code " + c + " belongs to another unit");
      taught.add(c);
    });
  });
  OWNED.forEach((c) => assert.ok(taught.has(c), c + " is not taught by any lesson"));
});

test("every learner string has Hindi, and Hindi keeps ASCII numerals", () => {
  lessons.concat(units).forEach((l) => walk(l, (o, p) => {
    if (typeof o.en === "string") {
      assert.ok(typeof o.hi === "string" && o.hi.trim().length > 0, `${l.id}${p} needs hi`);
      assert.ok(!/[०-९]/.test(o.hi), `${l.id}${p} has Devanagari digits`);
      if (o.en.split(" ").length >= 4) assert.ok(/[ऀ-ॿ]/.test(o.hi), `${l.id}${p} hi has no Devanagari text`);
    }
  }));
});

test("no em or en dash in lessons, units, credits or diagrams", () => {
  const files = [
    ...lessonFiles.map((f) => `${LEARN}/lessons/${f}`),
    ...UNIT_IDS.map((u) => `${LEARN}/units/${u}.json`),
    ...UNIT_IDS.map((u) => `${LEARN}/media/credits-${u}.json`),
    ...(existsSync(`${LEARN}/diagrams`) ? readdirSync(`${LEARN}/diagrams`).filter((f) => SVG_RE.test(f)).map((f) => `${LEARN}/diagrams/${f}`) : []),
  ].filter(existsSync);
  assert.ok(files.length > 50);
  files.forEach((f) => {
    const s = readFileSync(f, "utf8");
    DASHES.forEach((d) => assert.ok(!s.includes(d), f + " contains a long dash"));
  });
});

test("diagrams: sized, text-free, script-free SVGs whose viewBox matches the lesson", () => {
  lessons.forEach((l) => {
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
    assert.ok(!/\son[a-z]+=|href=["']?https?:/i.test(svg), p + " has an event handler or external link");
  });
  const used = new Set(lessons.map((l) => l.see.diagram.replace("diagrams/", "")));
  readdirSync(`${LEARN}/diagrams`).filter((f) => SVG_RE.test(f)).forEach((f) => assert.ok(used.has(f), f + " is unused"));
});

test("media credits: one original credit per diagram, with alt and caption", () => {
  UNIT_IDS.forEach((u) => {
    const c = rj(`${LEARN}/media/credits-${u}.json`);
    assert.equal(c.unit, u);
    c.items.forEach((i) => {
      assert.ok(existsSync(`${LEARN}/media/${i.file}`), i.file + " missing");
      assert.equal(i.licence, LICENCE, i.id + " licence");
      assert.equal(i.route, "original", i.id + " route");
      assert.ok(i.alt && i.alt.en && i.alt.hi && i.caption && i.caption.en && i.caption.hi, i.id + " alt and caption");
      assert.ok(i.w > 0 && i.h > 0, i.id + " size");
    });
  });
  lessons.forEach((l) => assert.ok(media[l.id] && media[l.id].file === "../" + l.see.diagram, l.id + " has a credit for its diagram"));
});

test("resuscitation numbers match kb/clinical-protocols", () => {
  const kb = (id) => JSON.stringify(rj(`kb/clinical-protocols/${id}.json`));
  const adult = kb("adult-cardiac-arrest"), paed = kb("paediatric-cardiac-arrest"), neo = kb("neonatal-resuscitation"), last = kb("local-anaesthetic-systemic-toxicity");
  ["100 to 120", "at least 5 cm", "300 mg", "150 mg", "1 mg IV or IO"].forEach((s) => assert.ok(adult.includes(s), "adult kb has " + s));
  ["0.01 mg/kg", "2 J/kg", "4 J/kg", "5 mg/kg", "15:2"].forEach((s) => assert.ok(paed.includes(s), "paediatric kb has " + s));
  ["0.01 to 0.03 mg/kg", "3 compressions to 1 breath", "within 60 seconds"].forEach((s) => assert.ok(neo.includes(s), "neonatal kb has " + s));
  ["4.5 mg/kg (max 300 mg)", "7 mg/kg (max 500 mg)", "1.5 mL/kg", "12 mL/kg"].forEach((s) => assert.ok(last.includes(s), "LAST kb has " + s));
  const txt = (id) => JSON.stringify(rj(`${LEARN}/lessons/${id}.json`));
  assert.ok(txt("as2-bls-adult").includes("100 to 120") && txt("as2-bls-adult").includes("at least 5 cm"));
  assert.ok(txt("as2-als-adult").includes("300 mg") && txt("as2-als-adult").includes("150 mg"));
  assert.ok(txt("as2-als-child").includes("0.01 mg/kg") && txt("as2-als-child").includes("2 J/kg") && txt("as2-als-child").includes("5 mg/kg"));
  assert.ok(txt("as2-newborn").includes("0.01 to 0.03 mg/kg"));
  assert.ok(txt("as5-la-pharmacology").includes("3 mg/kg (max 200 mg)") && txt("as5-la-pharmacology").includes("US/ASRA") && txt("as5-la-pharmacology").includes("1.5 mL/kg"));
});
