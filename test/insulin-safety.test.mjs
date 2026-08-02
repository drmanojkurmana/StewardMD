/* test/insulin-safety.test.mjs - pure insulin safety evaluation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../insulin-safety.js";

test("hypoglycemia is critical and interrupts", () => {
  const w = S.evaluate({}, { glucose: 60 }, { rounded: 2 });
  const hypo = w.find(x => x.id === "hypoglycemia");
  assert.ok(hypo);
  assert.equal(hypo.severity, "critical");
  assert.equal(hypo.interrupt, true);
});

test("severe hyperglycemia warns about ketones", () => {
  const w = S.evaluate({}, { glucose: 360 }, { rounded: 8 });
  assert.ok(w.find(x => x.id === "severe_hyper"));
});

test("max bolus exceeded is critical", () => {
  const w = S.evaluate({ maxBolus: 10 }, { glucose: 300 }, { rounded: 14 });
  const mx = w.find(x => x.id === "max_bolus");
  assert.equal(mx.severity, "critical");
});

test("IOB stacking is flagged", () => {
  const w = S.evaluate({}, { glucose: 200, iob: 3 }, { rounded: 5 });
  assert.ok(w.find(x => x.id === "stacking"));
});

test("pediatric, pregnancy, renal, hepatic each produce a warning", () => {
  const w = S.evaluate({ age: 8, pregnancy: true, renal: true, hepatic: true }, { glucose: 180 }, { rounded: 4 });
  ["pediatric", "pregnancy", "renal", "hepatic"].forEach(id => assert.ok(w.find(x => x.id === id), id));
});

test("missing glucose is flagged as warning", () => {
  const w = S.evaluate({}, { glucose: NaN }, { rounded: null });
  assert.ok(w.find(x => x.id === "missing_input"));
});

test("results are sorted most-severe first", () => {
  const w = S.evaluate({ age: 8 }, { glucose: 55 }, { rounded: 2 });
  assert.equal(w[0].severity, "critical");
});
