// Specialty engine tools and drills: the generic form renderer's input checks and the drill runner's walk, against
// the contract's tool and drill model interfaces (fixture models in test/fixtures/specialty-fixture/fixture-models.js).
// The Ophthalmós tools test pins its own calculator models; each specialty pins its models in test/<host>-tool-<id>.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const T = require("../specialty-tools.js");
const C = require("../specialty-core.js");
const { tool, drill } = require("./fixtures/specialty-fixture/fixture-models.js");

test("parseNum: a true minus, a decimal comma and spaces; anything else is NaN", () => {
  assert.equal(T.parseNum("−2.5"), -2.5);
  assert.equal(T.parseNum(" 3,5 "), 3.5);
  assert.equal(T.parseNum("12"), 12);
  assert.equal(T.parseNum(7), 7);
  assert.ok(Number.isNaN(T.parseNum("")));
  assert.ok(Number.isNaN(T.parseNum("1e3")));
  assert.ok(Number.isNaN(T.parseNum("12 kg")));
});

test("checkInput: number range and required, select options, bool, date; errors are bilingual", () => {
  const [a, , mode, flag, on] = tool.inputs;
  assert.deepEqual(T.checkInput(a, "4"), { v: 4 });
  assert.equal(T.checkInput(a, "").err.en, "Enter first number.");
  assert.ok(T.checkInput(a, "").err.hi);
  assert.match(T.checkInput(a, "101").err.en, /Use 0 to 100 u/);
  assert.match(T.checkInput(a, "x").err.en, /Enter a number/);
  assert.deepEqual(T.checkInput(Object.assign({}, a, { required: false }), ""), { v: null });
  assert.deepEqual(T.checkInput(mode, "double"), { v: "double" });
  assert.ok(T.checkInput(mode, "triple").err);
  assert.deepEqual(T.checkInput(flag, true), { v: true });
  assert.deepEqual(T.checkInput(on, "2026-09-29"), { v: "2026-09-29" });
  assert.ok(T.checkInput(on, "2026-02-31").err, "not a real date");
});

test("validateTool: the fixture tool meets the contract; a broken one lists every fault", () => {
  assert.deepEqual(T.validateTool(tool), []);
  const bad = Object.assign({}, tool, { kind: "calc", sources: [], inputs: [{ id: "a", type: "slider" }, { id: "a", type: "number", label: { en: "A" } }], compute: null, examples: [], review: "approved" });
  const e = T.validateTool(bad).join("\n");
  for (const m of [/kind: tool/, /sources: at least one/, /inputs\[0\]\.type/, /inputs\[0\]\.label/, /inputs\[1\]\.id: duplicate a/, /compute: a function/, /examples: at least one/, /review/]) assert.match(e, m);
});

test("runExamples: every pinned example matches compute", () => {
  const r = T.runExamples(tool);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  const wrong = Object.assign({}, tool, { examples: [{ values: { a: 1, b: 1 }, expect: 3 }] });
  assert.equal(T.runExamples(wrong)[0].ok, false);
  assert.equal(T.runExamples(Object.assign({}, tool, { examples: [{ values: { a: 1, b: 1 }, expect: 2.4, tol: 0.5 }] }))[0].ok, true, "tol");
  const str = Object.assign({}, tool, { compute: () => ({ ok: true, value: "2026-10-06", label: { en: "EDD" } }), examples: [{ values: {}, expect: "2026-10-06" }] });
  assert.equal(T.runExamples(str)[0].ok, true, "a string value such as a date");
  const obj = Object.assign({}, tool, { examples: [{ values: { a: 20, b: 10.5, mode: "double", flag: true }, expect: { value: 61.9, label: "Sum" }, tol: 0.2 }] });
  assert.equal(T.runExamples(obj)[0].ok, true, "expect as {value, label}: tol on numbers, an English string against a bilingual label");
});

test("validateDrill: stages, options, next ids and reachability", () => {
  assert.deepEqual(T.validateDrill(drill), []);
  const bad = JSON.parse(JSON.stringify(drill));
  bad.score = drill.score;
  bad.stages[0].options[0].next = "nowhere";
  bad.stages[2].options[0].correct = false;
  bad.stages.push({ id: "s1", prompt: { en: "dup" }, options: [] });
  const e = T.validateDrill(bad).join("\n");
  for (const m of [/stages\[0\]\.options\[0\]\.next: unknown stage nowhere/, /stages\[2\]: needs a correct option/, /stages\[3\]\.id: duplicate s1/, /stages\[3\]\.options: at least one/]) assert.match(e, m);
  assert.match(T.validateDrill(Object.assign({}, drill, { score: null })).join(), /score: a function/);
});

test("nextStage: option.next, else the following stage; \"end\" or the last stage finishes", () => {
  const o = (s, id) => drill.stages.find((x) => x.id === s).options.find((x) => x.id === id);
  assert.equal(T.nextStage(drill, "s1", o("s1", "o1")), "s2");
  assert.equal(T.nextStage(drill, "s2", o("s2", "o3")), null, "next: end");
  assert.equal(T.nextStage(drill, "s2", o("s2", "o4")), "s3");
  assert.equal(T.nextStage(drill, "s3", o("s3", "o5")), null, "last stage");
  assert.equal(T.nextStage({ stages: [{ id: "a", options: [] }, { id: "b", options: [] }] }, "a", {}), "b", "no next: the following stage");
});

test("drill grade: a critical miss or under half is Again; all right is Easy", () => {
  assert.equal(T.drillGrade({ pct: 100, criticalMisses: [] }), C.EASY);
  assert.equal(T.drillGrade({ pct: 90, criticalMisses: [] }), C.GOOD);
  assert.equal(T.drillGrade({ pct: 60, criticalMisses: [] }), C.HARD);
  assert.equal(T.drillGrade({ pct: 40, criticalMisses: [] }), C.AGAIN);
  assert.equal(T.drillGrade({ pct: 100, criticalMisses: ["o1"] }), C.AGAIN);
  const s = drill.score({ choices: [{ stage: "s1", option: "o2", atSec: 5 }, { stage: "s2", option: "o3", atSec: 9 }] });
  assert.deepEqual([s.pct, s.criticalMisses], [50, ["o1"]]);
});

test("timeLeft counts down from the limit and never goes below zero", () => {
  assert.equal(T.timeLeft(120, 1000, 1000 + 30500), 90);
  assert.equal(T.timeLeft(120, 0, 999999), 0);
  assert.equal(T.timeLeft(0, 0, 5000), null, "no limit");
});
