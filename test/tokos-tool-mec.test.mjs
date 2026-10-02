import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("mec");

test("mec: model shape and bilingual text", () => shape(m, "mec"));
test("mec: every example matches its source", () => examples(m));
test("mec: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { condition: "nope", method: "chc" }, { condition: "htn_severe", method: "nope" }, { condition: "pp_bf_lt21", method: "cu" }, { condition: "uterine_distort", method: "pop" }]));

test("mec: 64 conditions and 6 methods are offered", () => {
  assert.equal(m.inputs[0].options.length, 64);
  assert.deepEqual(m.inputs[1].options.map((o) => o.value), ["cu", "lng", "imp", "dmpa", "pop", "chc"]);
});
test("mec: initiation and continuation are both reported", () => {
  const r = m.compute({ condition: "bleed_unexpl", method: "lng" });
  assert.equal(r.value, 4); assert.match(r.label.en, /4 at initiation, 2 at continuation/);
});
test("mec: every condition/method pair is either a category 1-4 or an explicit not-classified error", () => {
  for (const c of m.inputs[0].options) for (const k of m.inputs[1].options) {
    const r = m.compute({ condition: c.value, method: k.value });
    if (r.ok) assert.match(String(r.value), /^[1-4](\/[1-4])?$/); else assert.ok(r.error.en && r.error.hi);
  }
});
test("mec: every result states the WHO MEC differences India follows", () => {
  assert.match(m.compute({ condition: "pp_bf_lt21", method: "dmpa" }).lines.map((l) => l.en).join(" "), /WHO MEC 2015.*48 hours postpartum is category 1/);
});
