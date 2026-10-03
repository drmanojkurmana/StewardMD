/* test/maik-brain-prefill.test.mjs — MaiKBrain "calculator run" step gets real inputs (flag
 * smd_calc_prefill), and only when every input was stated. Before this, plan() never set inputs,
 * so execute() always returned computed:null (kb/ai/maik-brain.js:316).
 * node --test test/maik-brain-prefill.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = {};
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), addEventListener() {},
  getElementById: () => null, querySelector: () => null, body: { appendChild() {}, classList: { add() {}, remove() {} } }, head: { appendChild() {} } };
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
["calculators.js", "clinical-params.js", "calc-prefill.js", "kb/ai/maik-brain.js"].forEach((f) =>
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
const B = globalThis.MaiKBrain;

const resolved = (raw) => ({ decision: "answer", query: { raw, norm: B._norm(raw) }, primary: null, intent: null, context: {} });
const calcStep = (p) => p.steps.find((s) => s.source === "calculator");

test("flag OFF: old behaviour (values hide the name, and nothing is computed)", () => {
  delete store.smd_calc_prefill;
  const p = B.plan(resolved("calculate curb65 score 78 yo confused rr 32 bp 88/50 urea 9"));
  const s = calcStep(p);
  assert.ok(!s || s.args.inputsById === undefined);
  const named = B.plan(resolved("calculate curb65 score"));
  const calc = B.execute(named, resolved("x")).evidence.find((e) => e.source === "calculator");
  assert.equal(calc.data[0].computed, null);
});

test("flag ON, every input stated: the calculator computes", () => {
  store.smd_calc_prefill = "1";
  const r = resolved("calculate curb65 score 78 yo confused rr 32 bp 88/50 urea 9");
  const p = B.plan(r);
  const s = calcStep(p);
  assert.deepEqual(s.args.inputsById.curb65, { conf: true, urea: true, rr: true, bp: true, age: true });
  const calc = B.execute(p, r).evidence.find((e) => e.source === "calculator");
  assert.equal(calc.data[0].computed.value, 5);
});

test("flag ON, inputs missing: no inputs, so no partial score is presented as complete", () => {
  store.smd_calc_prefill = "1";
  const p = B.plan(resolved("calculate curb65 score 78 yo rr 32"));
  assert.equal(calcStep(p).args.inputsById, undefined);
});
