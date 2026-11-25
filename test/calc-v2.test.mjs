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
const ipssR = window.MEDCALC._calcs.find((c) => c.id === "ipss_r");

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

test("IPSS-R exposes full cytogenetic criteria with point values", () => {
  assert.ok(ipssR);
  assert.deepEqual(ipssR.inputs[0].opts.map((o) => o.v), ["0", "1", "2", "3", "4"]);
  assert.match(ipssR.inputs[0].opts[0].t, /del\(11q\)/);
  assert.match(ipssR.inputs[0].opts[1].t, /normal karyotype.*del\(5q\).*del\(12p\).*del\(20q\)/);
  assert.match(ipssR.inputs[0].opts[4].t, /complex >3 abnormalities/);
});

test("IPSS-R sums all five domains and assigns the published risk bands", () => {
  const score = (cyto, blasts, hb, plt, anc) =>
    ipssR.compute({ cyto, blasts, hb, plt, anc });
  assert.match(score("0", "0", "0", "0", "0").i, /^Very low risk/);
  assert.equal(score("0", "0", "0", "0", "0").v, 0);
  assert.equal(score("1", "1", "1", "0.5", "0.5").v, 4);
  assert.match(score("4", "3", "1.5", "1", "0.5").i, /^Very high risk/);
  assert.equal(score("4", "3", "1.5", "1", "0.5").v, 10);
});
