/* test/kardia-paths.test.mjs - exam paths (kardia/paths.json) and Cases shelf.
 * Every id in paths.json must resolve to an existing lesson, Echo Lab view,
 * calculator, case or MCQ. Every case appears in exactly one shelf group.
 * British spelling, no dash characters in new app strings. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = function (p) { return JSON.parse(readFileSync(join(ROOT, p), "utf8")); };

const pathsDoc = read("kardia/paths.json");
const learnIndex = read("kardia/learn/index.json");
const viewsDoc = read("kardia/views.json");
const casesIndex = read("kardia/cases/index.json");
const helpers = require("../kardia-paths.js");

const lessonIds = new Set(Object.keys(learnIndex.lessons));
const viewIds = new Set(viewsDoc.views.map(function (v) { return v.id; }));
const caseIds = new Set(casesIndex.cases.map(function (c) { return c.id; }));

/* Calculator ids live in the ES5 data file; read them the way the app does. */
const calcSrc = readFileSync(join(ROOT, "kardia-calc-data.js"), "utf8");
const calcIds = new Set(Array.from(calcSrc.matchAll(/"id":\s*"([^"]+)"/g)).map(function (m) { return m[1]; }));

const mcqIds = new Set();
for (const topic of ["views", "tee", "pocus", "measurements", "doppler", "knobology", "pathology", "ecg"]) {
  for (const it of read("kardia/decks/mcq/" + topic + ".json").items) mcqIds.add(it.id);
}

test("paths.json holds exactly the four exam paths, marked ai_drafted", function () {
  assert.equal(pathsDoc.review, "ai_drafted");
  assert.deepEqual(pathsDoc.paths.map(function (p) { return p.id; }),
    ["aortic-stenosis", "lv-function-ef", "right-heart-pressure", "pocus-trauma-fast"]);
});

test("every path has 5 to 8 steps, mixes lesson, view and calc, and ends with case then 10 MCQs", function () {
  for (const p of pathsDoc.paths) {
    assert.ok(p.steps.length >= 5 && p.steps.length <= 8, p.id + " step count " + p.steps.length);
    const types = p.steps.map(function (s) { return s.type; });
    assert.ok(types.includes("lesson"), p.id + " needs a lesson");
    assert.ok(types.includes("view"), p.id + " needs an Echo Lab view");
    assert.ok(types.includes("calc"), p.id + " needs a calculator");
    assert.equal(types[types.length - 2], "case", p.id + " must end case then questions");
    assert.equal(types[types.length - 1], "mcq", p.id + " must end with questions");
    assert.equal(p.steps[p.steps.length - 1].ids.length, 10, p.id + " needs exactly 10 MCQs");
  }
});

test("every id in paths.json resolves to an existing lesson, view, calculator, case or MCQ", function () {
  for (const p of pathsDoc.paths) {
    for (const s of p.steps) {
      if (s.type === "lesson") assert.ok(lessonIds.has(s.id), p.id + " missing lesson " + s.id);
      else if (s.type === "view") assert.ok(viewIds.has(s.id), p.id + " missing view " + s.id);
      else if (s.type === "calc") assert.ok(calcIds.has(s.id), p.id + " missing calculator " + s.id);
      else if (s.type === "case") assert.ok(caseIds.has(s.id), p.id + " missing case " + s.id);
      else if (s.type === "mcq") for (const id of s.ids) assert.ok(mcqIds.has(id), p.id + " missing MCQ " + id);
      else assert.fail(p.id + " unknown step type " + s.type);
    }
  }
});

test("every case appears in exactly one Cases shelf group", function () {
  const groups = helpers.groupCases(casesIndex.cases);
  assert.deepEqual(groups.map(function (g) { return g.id; }),
    ["chest-pain", "breathlessness", "shock", "murmur", "trauma", "other"]);
  const seen = [];
  for (const g of groups) for (const c of g.cases) seen.push(c.id);
  assert.equal(seen.length, casesIndex.cases.length, "grouped count must equal case count");
  assert.equal(new Set(seen).size, seen.length, "no case in two groups");
  assert.deepEqual(seen.slice().sort(), casesIndex.cases.map(function (c) { return c.id; }).sort());
});

test("shelf shows difficulty and expected minutes for every case, never a file id", function () {
  for (const c of casesIndex.cases) {
    assert.ok(["Core", "Intermediate", "Advanced", "Focused"].includes(helpers.difficultyLabel(c)), c.id);
    const mins = helpers.expectedMinutes(c);
    assert.ok(Number.isInteger(mins) && mins >= 10 && mins <= 30, c.id + " minutes " + mins);
  }
});

test("path progress counts done steps and points at the first undone step", function () {
  const p = pathsDoc.paths[0];
  assert.deepEqual(helpers.pathProgress(p, null), { done: 0, total: p.steps.length, current: 0, complete: false });
  const mid = helpers.pathProgress(p, { done: { 0: 1, 1: 1 }, step: 2 });
  assert.equal(mid.done, 2); assert.equal(mid.current, 2); assert.equal(mid.complete, false);
  const full = {}; p.steps.forEach(function (s, i) { full[i] = 1; });
  assert.equal(helpers.pathProgress(p, { done: full }).complete, true);
});

test("loader ships the paths module and the paths file is in the www data copy", function () {
  const loader = readFileSync(join(ROOT, "kardia-loader.js"), "utf8");
  assert.ok(loader.includes('"kardia-paths.js"'), "loader must load kardia-paths.js");
  assert.ok(loader.includes('"kardia-paths.css"'), "loader must load kardia-paths.css");
  const build = readFileSync(join(ROOT, "scripts/build-www.sh"), "utf8");
  assert.ok(build.includes('cp -R kardia/.'), "www build must copy the kardia data folder (paths.json)");
});

test("new app strings use British spelling with no dash characters", function () {
  const src = readFileSync(join(ROOT, "kardia-paths.js"), "utf8");
  assert.ok(!/[\u2013\u2014]/.test(src), "no em or en dash in kardia-paths.js");
  assert.ok(!/\b(organize|behavior|center|edema|hemoglobin)\b/i.test(src), "British spelling in kardia-paths.js");
  for (const p of pathsDoc.paths) {
    assert.ok(!/[\u2013\u2014]/.test(p.title + p.sub), "no dash in path text " + p.id);
  }
});
