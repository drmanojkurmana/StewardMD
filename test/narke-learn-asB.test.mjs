// Narkē Learn content, Anaesthesia MBBS units as6 to as10: schema, NMC coverage, media credits, SVG and text rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "../tools/tokos-learn-index.mjs";

const require = createRequire(import.meta.url);
const D = require("../specialty-data.js");

const LEARN = "narke/learn";
const UNIT_IDS = ["as6", "as7", "as8", "as9", "as10"];
const UNIT_RE = /^as(6|7|8|9|10)-.+\.(json|svg)$/;
// NMC CBME UG curriculum Vol III (2018), Anaesthesiology AS6 to AS10.
const NMC = ["AS6.1", "AS6.2", "AS6.3", "AS7.1", "AS7.2", "AS7.3", "AS7.4", "AS7.5", "AS8.1", "AS8.2", "AS8.3", "AS8.4", "AS8.5",
  "AS9.1", "AS9.2", "AS9.3", "AS9.4", "AS10.1", "AS10.2", "AS10.3", "AS10.4"];
const MCQ = ["airway", "iv-agents", "inhalational", "nmb", "local-regional", "monitoring-equipment", "preop", "fluids-blood", "pain",
  "icu-ventilation", "cpr", "special-populations", "basic-science", "general"];
const TOOLS = ["asa", "maintenance-fluids", "fasting-deficit", "mabl", "la-maxdose", "paeds-ett", "dosing-weight", "stopbang", "apfel", "rcri", "pf-ratio", "airway-predict"];
const SIMS = ["bls", "als", "anaphylaxis", "paedarrest", "cico", "last", "mh", "highspinal", "laryngospasm", "bronchospasm", "haemorrhage", "aspiration"];
const EXPLORERS = ["odc", "mac", "tof", "dermatomes", "ventilator", "circuit"];
const CLINICS = ["capno", "monitor"];
const LICENCES = /^(CC0|CC BY \d\.\d|CC BY-SA \d\.\d|ODC-BY( \d\.\d)?|Public domain|Original, MAIKNOWLEDGE LLP|Original, StewardMD)$/;
const DASHES = [String.fromCharCode(8212), String.fromCharCode(8211)];

const rj = (p) => JSON.parse(readFileSync(p, "utf8"));
const units = UNIT_IDS.filter((u) => existsSync(`${LEARN}/units/${u}.json`)).map((u) => rj(`${LEARN}/units/${u}.json`));
const lessonFiles = existsSync(`${LEARN}/lessons`) ? readdirSync(`${LEARN}/lessons`).filter((f) => UNIT_RE.test(f)) : [];
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

test("units: each of as6..as10 exists, lists real lessons, and has a bilingual glossary", () => {
  assert.equal(units.length, UNIT_IDS.length, "all five units present");
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

test("the Learn index builder accepts these units without errors", () => {
  const mine = build(LEARN).errors.filter((e) => /\bas(6|7|8|9|10)\b/.test(e));
  assert.deepEqual(mine, []);
});

test("every NMC competency AS6.1 to AS10.4 is taught by at least one lesson", () => {
  const taught = new Set(lessons.flatMap((l) => l.competencies));
  NMC.forEach((c) => assert.ok(taught.has(c), c + " has no lesson"));
  lessons.forEach((l) => l.competencies.forEach((c) => assert.ok(NMC.includes(c), l.id + " lists " + c + " outside AS6 to AS10")));
});

test("lessons: unit, review, minutes, checks, sources, hotspots, test links", () => {
  lessons.forEach((l) => {
    const u = units.find((x) => x.lessons.includes(l.id));
    assert.ok(u && l.unit === u.id, l.id + " unit mismatch");
    assert.ok(l.id.startsWith(l.unit + "-"), l.id + " prefix");
    assert.equal(l.level, "mbbs");
    assert.equal(l.review && l.review.status, "ai_drafted", l.id + " review status");
    assert.ok(Array.isArray(l.review.verify) && l.review.verify.length >= 1, l.id + " review.verify lists claims to check");
    assert.ok(l.minutes >= 4 && l.minutes <= 7, l.id + " minutes 4 to 7");
    assert.ok(l.check.length >= 2 && l.check.length <= 3, l.id + " needs 2 to 3 check questions");
    assert.ok(l.sources.length >= 1 && l.sources.every((s) => typeof s === "string" && s.length > 20), l.id + " sources");
    assert.ok(l.see.hotspots.length >= 3 && l.see.hotspots.length <= 10, l.id + " hotspots");
    assert.ok(MCQ.includes(l.test.mcqTopic), l.id + " mcqTopic");
    if (l.test.tool) assert.ok(TOOLS.includes(l.test.tool), l.id + " tool");
    if (l.test.sim) assert.ok(SIMS.includes(l.test.sim), l.id + " sim");
    if (l.test.explorer) assert.ok(EXPLORERS.includes(l.test.explorer), l.id + " explorer");
    if (l.test.clinic) assert.ok(CLINICS.includes(l.test.clinic), l.id + " clinic");
    l.check.forEach((c, i) => {
      assert.ok(c.o.length >= 3, l.id + " needs 3 or more options");
      const lens = c.o.map((o) => o.en.length);
      assert.ok(Math.max(...lens) <= 2.6 * Math.min(...lens), `${l.id} check ${i}: options of very different lengths`);
      assert.equal(new Set(c.o.map((o) => o.en)).size, c.o.length, `${l.id} check ${i}: duplicate options`);
    });
    // every [[term]] used in the lesson is in its glossary list and defined in a unit
    const used = JSON.stringify(l).match(/\[\[([a-z0-9-]+)\]\]/g) || [];
    used.forEach((m) => {
      const t = m.slice(2, -2);
      assert.ok(l.glossary.includes(t), l.id + " uses [[" + t + "]] without listing it");
      assert.ok(glossary[t], l.id + " term " + t + " undefined");
    });
  });
  const slots = new Set(lessons.flatMap((l) => l.check.map((c) => c.a)));
  assert.ok(slots.size >= 4, "correct answers should vary between options");
});

test("every learner string has Hindi with ASCII numerals, and English sentences are 20 words or fewer", () => {
  lessons.concat(units).forEach((l) => {
    walk(l, (o, p) => {
      if (typeof o.en === "string") {
        assert.ok(typeof o.hi === "string" && o.hi.trim().length > 0, `${l.id}${p} needs hi`);
        assert.ok(!/[०-९]/.test(o.hi), `${l.id}${p} has Devanagari digits`);
        o.en.split(/(?<=[.!?])\s+/).forEach((s) => assert.ok(s.split(/\s+/).length <= 20, `${l.id}${p}: long sentence: ${s}`));
      }
    });
  });
});

test("no em or en dash in lessons, units, credits or diagrams", () => {
  const files = [
    ...lessonFiles.map((f) => `${LEARN}/lessons/${f}`),
    ...UNIT_IDS.map((u) => `${LEARN}/units/${u}.json`),
    ...UNIT_IDS.map((u) => `${LEARN}/media/credits-${u}.json`),
    ...(existsSync(`${LEARN}/diagrams`) ? readdirSync(`${LEARN}/diagrams`).filter((f) => UNIT_RE.test(f)).map((f) => `${LEARN}/diagrams/${f}`) : []),
  ].filter(existsSync);
  assert.ok(files.length >= 60);
  files.forEach((f) => {
    const s = readFileSync(f, "utf8");
    DASHES.forEach((d) => assert.ok(!s.includes(d), f + " contains a dash character"));
  });
});

test("every diagram is a sized, text-free SVG whose viewBox matches the lesson", () => {
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
    assert.ok(!/\son[a-z]+=/.test(svg), p + " has an event handler");
  });
});

test("diagram files all belong to a lesson (no strays)", () => {
  const used = new Set(lessons.map((l) => l.see.diagram.replace("diagrams/", "")));
  readdirSync(`${LEARN}/diagrams`).filter((f) => UNIT_RE.test(f)).forEach((f) => assert.ok(used.has(f), f + " is unused"));
});

test("every diagram has an original-licence credit in its unit file", () => {
  UNIT_IDS.forEach((u) => {
    const cp = `${LEARN}/media/credits-${u}.json`;
    assert.ok(existsSync(cp), cp + " missing");
    const c = rj(cp);
    assert.equal(c.unit, u);
    c.items.forEach((i) => {
      assert.ok(existsSync(`${LEARN}/media/${i.file}`), i.file + " missing");
      assert.match(i.licence, LICENCES, i.id + " licence");
      assert.equal(i.licence, "Original, MAIKNOWLEDGE LLP");
      assert.equal(i.route, "original");
      assert.ok(i.alt && i.alt.en && i.alt.hi && i.caption && i.caption.en && i.caption.hi, i.id + " alt and caption");
      assert.ok(i.w > 0 && i.h > 0, i.id + " size");
    });
    const credited = new Set(c.items.map((i) => i.file.replace("../", "")));
    lessons.filter((l) => l.unit === u).forEach((l) => assert.ok(credited.has(l.see.diagram), l.see.diagram + " has no credit"));
  });
});

test("doses quoted match the kb clinical protocols", () => {
  const kb = (id) => readFileSync(`kb/clinical-protocols/${id}.json`, "utf8");
  const text = (id) => JSON.stringify(rj(`${LEARN}/lessons/${id}.json`));
  // naloxone titration (opioid-overdose), paracetamol and morphine (icu-sedation), FFP and furosemide (blood-transfusion), sepsis targets
  assert.ok(kb("opioid-overdose").includes("start 0.04 mg IV") && text("as6-airway-breathing").includes("0.04 mg IV"));
  assert.ok(kb("icu-sedation-analgesia-delirium").includes("1 g IV or orally every 6 hours (maximum 4 g/day)") && text("as8-analgesic-drugs").includes("maximum 4 g a day"));
  assert.ok(kb("icu-sedation-analgesia-delirium").includes("2 to 4 mg IV every 1 to 2 hours") && text("as8-analgesic-drugs").includes("2 to 4 mg IV every 1 to 2 hours"));
  assert.ok(kb("blood-transfusion").includes("15 mL/kg IV") && text("as9-blood-products").includes("15 mL/kg"));
  assert.ok(kb("blood-transfusion").includes("furosemide 20 to 40 mg") && text("as9-blood-products").includes("furosemide 20 to 40 mg"));
  assert.ok(kb("sepsis-septic-shock").includes("30 mL/kg") && text("as7-admission-discharge").includes("30 mL/kg crystalloid"));
  assert.ok(kb("sepsis-septic-shock").includes("0.5 mL/kg/h") && text("as7-icu-monitoring").includes("0.5 mL/kg/h"));
});
