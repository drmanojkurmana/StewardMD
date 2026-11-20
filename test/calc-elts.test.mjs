// ELTS (Pfirrmann, Leukemia 2016): known answers, risk bands, blank-input guard.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || {
  addEventListener() {}, getElementById() { return null; }, querySelector() { return null; },
  createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
  head: { appendChild() {} }, body: { appendChild() {} },
};
createRequire(import.meta.url)("../calculators.js");
const elts = window.MEDCALC._calcs.find((c) => c.id === "elts");

test("ELTS is registered with its reference", () => {
  assert.ok(elts);
  assert.match(elts.ref, /Pfirrmann/);
});

test("ELTS known answers and risk bands", () => {
  // 50 y, no spleen, 0 blasts, platelets 300: 0.3125 + 0.4104 / sqrt(0.3) = 1.0618
  let r = elts.compute({ age: 50, spleen: 0, blasts: 0, plt: 300 });
  assert.equal(r.v, 1.0618); assert.match(r.i, /^Low risk/);
  // 60 y, spleen 5, blasts 1, platelets 400: 0.54 + 0.3075 + 0.1052 + 0.6489 = 1.6016
  r = elts.compute({ age: 60, spleen: 5, blasts: 1, plt: 400 });
  assert.equal(r.v, 1.6016); assert.match(r.i, /^Intermediate risk/);
  // 70 y, spleen 10, blasts 3, platelets 500: 0.8575 + 0.615 + 0.3156 + 0.5804 = 2.3685
  r = elts.compute({ age: 70, spleen: 10, blasts: 3, plt: 500 });
  assert.equal(r.v, 2.3685); assert.match(r.i, /^High risk/);
});

test("ELTS never scores on a blank or impossible input", () => {
  assert.ok(elts.compute({ age: 50, spleen: NaN, blasts: 0, plt: 300 }).err);
  assert.ok(elts.compute({ age: 50, spleen: 0, blasts: 0, plt: 0 }).err);
});
