import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

globalThis.window = globalThis.window || {};
globalThis.localStorage = { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.document = globalThis.document || {
  addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
  head: { appendChild() {} }, body: { appendChild() {}, classList: { add() {}, remove() {}, contains() { return false; } } },
};
createRequire(import.meta.url)("../calculators.js");
const V2 = window.MEDCALC._v2;
const oak = window.MEDCALC._calcs.find((c) => c.id === "chadsvasc");

test("calc v2 flag defaults on and turns off with 0", () => {
  localStorage.removeItem("smd_calc_v2");
  assert.equal(V2.on(), true);
  localStorage.setItem("smd_calc_v2", "0");
  assert.equal(V2.on(), false);
  localStorage.removeItem("smd_calc_v2");
});

test("scale draws only with an exact max and cut-off from the result", () => {
  const withCut = V2.scaleFor(oak, { v: 22, u: "/35", i: "Admit (score above 8). Higher risk." });
  assert.equal(withCut.max, 35);
  assert.deepEqual(withCut.cuts, [8]);
  const noCut = V2.scaleFor(oak, { v: 5, u: "points", i: "Some verdict." });
  assert.equal(noCut, null);
});

test("missing count ignores checks and counts blank numbers and selects", () => {
  const fake = { id: "x", inputs: [
    { id: "a", type: "number" }, { id: "s", type: "select", opts: [{ v: "m", t: "Male" }] }, { id: "c", type: "check" },
  ] };
  assert.equal(V2.missingCount(fake), 2);
});

test("Ask MaiK question carries inputs and result, never a patient name", () => {
  globalThis.window.ICU_STATE = { patient: { name: "Secret Name", age: 72, sex: "m" }, vitals: [{ ts: 1, hr: 95, sbp: 115 }], labs: { recent: {} }, src: {} };
  const q = V2.maikQuestion(oak);
  assert.match(q, /CHA/);
  assert.doesNotMatch(q, /Secret Name/);
  delete globalThis.window.ICU_STATE;
});
