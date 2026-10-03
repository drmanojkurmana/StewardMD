/* test/calc-prefill.test.mjs — parsed values onto real MEDCALC calculators (calc-prefill.js).
 * node --test test/calc-prefill.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), addEventListener() {},
  getElementById: () => null, querySelector: () => null, body: { appendChild() {}, classList: { add() {}, remove() {} } }, head: { appendChild() {} } };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
["calculators.js", "clinical-params.js", "calc-prefill.js"].forEach((f) =>
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
const M = globalThis.MEDCALC, F = globalThis.SMD_CALC_PREFILL;
const pf = (id, q) => F.forText(id, q, { calc: M.get(id) });

test("CrCl: all four inputs, calculator computes 33 mL/min", () => {
  const r = pf("crcl", "crcl 72F 58kg cr 1.4");
  assert.deepEqual(r.prefill, { age: 72, wt: 58, scr: 1.4, sex: "f" });
  assert.deepEqual(r.notStated, []);
  assert.equal(M.run("crcl", r.prefill).value, 33);
});

test("CURB-65 thresholds from explicit values only", () => {
  const full = pf("curb65", "78 year old, confused, RR 32, BP 88/50, urea 9");
  assert.deepEqual(full.prefill, { conf: true, urea: true, rr: true, bp: true, age: true });
  const partial = pf("curb65", "78 yo RR 32");
  assert.deepEqual(partial.prefill, { rr: true, age: true });
  assert.equal(partial.notStated.length, 3, "confusion, urea and BP are listed as not stated, not filled as no");
  const neg = pf("curb65", "64 yo, not confused, RR 18, BP 130/80, urea 5");
  assert.deepEqual(neg.prefill, { conf: false, urea: false, rr: false, bp: false, age: false });
});

test("qSOFA: GCS below 15 counts as altered mentation", () => {
  assert.deepEqual(pf("qsofa", "RR 24 BP 96/60 GCS 13").prefill, { rr: true, ams: true, sbp: true });
});

test("MELD 3.0 inputs in the calculator's own units", () => {
  const r = pf("meld3", "bili 3.2 inr 1.8 creat 2.1 na 128 alb 2.9 female");
  assert.deepEqual(r.prefill, { bili: 3.2, creat: 2.1, inr: 1.8, na: 128, alb: 2.9, sex: "f" });
  assert.deepEqual(r.notStated, ["≥2 haemodialysis / 24 h CVVHD in the past week"]);
});

test("past, family and ambiguous values never prefill", () => {
  assert.equal(pf("crcl", "crcl 60 yo male 70 kg, creatinine was 1.4 last month, now 2.1").prefill.scr, 2.1);
  const fam = F.build(M.get("crcl"), globalThis.SMD_CPARAMS.parse("father had creatinine 3.1, 60 yo male 70 kg"));
  assert.equal(fam.prefill.scr, undefined);
  const amb = F.build(M.get("crcl"), globalThis.SMD_CPARAMS.parse("wt 58 kg, weight 62 kg, 60 yo male, cr 1"));
  assert.equal(amb.prefill.wt, undefined);
});

test("nothing usable: forText returns null", () => {
  assert.equal(pf("crcl", "crcl"), null);
});
