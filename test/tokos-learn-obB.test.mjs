// Tokós Learn, Obstetrics MBBS units ob7 to ob12: schema, bilingual, media and diagram rules.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = path.join(root, "tokos/learn");
const D = createRequire(import.meta.url)(path.join(root, "ophthalmos-data.js"));
const UNITS = ["ob7", "ob8", "ob9", "ob10", "ob11", "ob12"];
const TOPICS = ["ob-antenatal", "ob-labour", "ob-medical", "ob-haemorrhage", "ob-hypertension", "ob-fetal", "ob-puerperium", "ob-early", "ob-operative"];
const EMDASH = String.fromCharCode(0x2014);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const units = UNITS.map((u) => readJson(path.join(L, "units", u + ".json")));
const glossary = {}; units.forEach((u) => Object.assign(glossary, u.glossary));
const media = {};
UNITS.forEach((u) => readJson(path.join(L, "media", "credits-" + u + ".json")).items.forEach((m) => { media[m.id] = m; }));
const lessons = units.flatMap((u) => u.lessons.map((id) => readJson(path.join(L, "lessons", id + ".json"))));

function walk(v, fn, where = "") {
  if (v && typeof v === "object") {
    if (typeof v.en === "string") fn(v, where);
    Object.entries(v).forEach(([k, x]) => walk(x, fn, where + "/" + k));
  }
}
const files = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)) : []);

test("every unit lists lesson files that exist, in its own namespace", () => {
  units.forEach((u) => {
    assert.ok(u.lessons.length >= 5, u.id + " has at least 5 lessons");
    assert.equal(u.level, "mbbs");
    u.lessons.forEach((id) => assert.ok(id.startsWith(u.id + "-"), id + " prefixed by " + u.id));
  });
  const listed = new Set(units.flatMap((u) => u.lessons));
  const onDisk = UNITS.flatMap((u) => files(path.join(L, "lessons"), new RegExp("^" + u + "-.*\\.json$"))).map((f) => path.basename(f, ".json"));
  assert.deepEqual([...listed].sort(), onDisk.sort());
});

test("every lesson passes validateLesson", () => {
  lessons.forEach((l) => assert.deepEqual(D.validateLesson(l, glossary, media), [], l.id));
});

test("lessons are drafted, sourced, linked to practice and have 2 or 3 checks", () => {
  lessons.forEach((l) => {
    assert.ok(["ai_drafted", "reviewed"].includes(typeof l.review === "object" ? l.review.status : l.review), l.id);
    if (typeof l.review === "object") assert.ok(l.review.verify.length && l.review.verify.every((v) => typeof v === "string" && v.length > 10), l.id + " verify");
    assert.equal(l.level, "mbbs", l.id);
    assert.ok(l.sources.length >= 1 && l.sources.every((s) => typeof s === "string" && s.length > 20), l.id + " sources");
    assert.ok(TOPICS.includes(l.test.mcqTopic), l.id + " mcqTopic");
    assert.ok(l.check.length >= 2 && l.check.length <= 3, l.id + " checks");
    assert.ok(l.minutes >= 4 && l.minutes <= 7, l.id + " minutes");
    (l.competencies || []).forEach((c) => assert.match(c, /^OG\d+\.\d+$/, l.id));
  });
});

test("every learner string has Hindi with ASCII numerals", () => {
  lessons.concat(units).forEach((o) => walk(o, (v, w) => {
    assert.ok(typeof v.hi === "string" && v.hi.trim(), (o.id || "") + w + " needs hi");
    assert.doesNotMatch(v.hi, /[०-९]/, (o.id || "") + w + " Devanagari digit");
  }));
  Object.entries(glossary).forEach(([id, t]) => { assert.ok(t.term.hi && t.def.hi, id); assert.match(id, /^[a-z0-9-]+$/); });
});

test("glossary terms a lesson lists are defined, and every defined term is used", () => {
  const used = new Set();
  lessons.forEach((l) => {
    l.glossary.forEach((g) => { assert.ok(glossary[g], l.id + " " + g); used.add(g); });
    JSON.stringify(l).replace(/\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g, (m, g) => { used.add(g); return m; });
  });
  Object.keys(glossary).forEach((g) => assert.ok(used.has(g), "unused glossary term " + g));
});

test("no em-dash in any content file", () => {
  const dirs = [["lessons", /\.json$/], ["units", /\.json$/], ["diagrams", /\.svg$/], ["media", /\.json$/]];
  UNITS.forEach((u) => dirs.forEach(([d, re]) => files(path.join(L, d), re).filter((f) => path.basename(f).startsWith(d === "media" ? "credits-" + u : u)).forEach((f) => {
    assert.ok(!fs.readFileSync(f, "utf8").includes(EMDASH), f + " has an em-dash");
  })));
});

test("diagrams: root has width, height and viewBox matching the lesson, and no text", () => {
  lessons.forEach((l) => {
    if (l.see.img) return;
    const f = path.join(L, l.see.diagram);
    const svg = fs.readFileSync(f, "utf8");
    const root = svg.match(/<svg\b[^>]*>/)[0];
    const w = +root.match(/\swidth="(\d+)"/)[1], h = +root.match(/\sheight="(\d+)"/)[1];
    const vb = root.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(vb, l.id + " viewBox");
    assert.deepEqual([w, h], [+vb[1], +vb[2]], l.id);
    assert.deepEqual([l.see.w, l.see.h], [w, h], l.id + " see.w/h");
    assert.doesNotMatch(svg, /<text\b|<tspan\b|<foreignObject|<script/i, l.id + " must not contain text");
    assert.ok(l.see.hotspots.length >= 3, l.id + " hotspots");
  });
});

test("every media file has a credit with an open licence", () => {
  UNITS.forEach((u) => {
    const dir = path.join(L, "media", u);
    const items = readJson(path.join(L, "media", "credits-" + u + ".json")).items;
    const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
    onDisk.forEach((f) => assert.ok(items.some((m) => m.file === u + "/" + f || m.file === f), u + "/" + f + " lacks a credit"));
    items.forEach((m) => {
      assert.ok(["CC0", "Public domain", "CC BY 4.0", "CC BY 3.0", "CC BY 2.0", "CC BY-SA 4.0", "CC BY-SA 3.0", "CC BY-SA 2.0", "ODC-BY"].includes(m.licence) || m.route === "original", m.id);
      assert.ok(m.author && m.source && m.alt && m.caption, m.id);
    });
  });
});
