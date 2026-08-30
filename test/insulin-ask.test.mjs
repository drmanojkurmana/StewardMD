/* insulin-ask.test.mjs - Ask MaiK slot extraction and calculator routing.
 * The contract under test: a sentence becomes SLOTS, the slots drive the REAL engine, and the
 * language model never produces a dose. Every case here runs with ZERO model calls.
 * Run: node --test test/insulin-ask.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = require(join(ROOT, "insulin-ask.js"));
const E = require(join(ROOT, "insulin-engine.js"));

// Run a question end to end the way the UI does: parse -> args -> the real engine function.
function run(q, defaults) {
  const p = A.parse(q);
  if (!p.mode || p.unresolved.length) return { parse: p, result: null };
  const fn = A.ENGINE_FN[p.mode];
  return { parse: p, result: E[fn](A.toEngineArgs(p, defaults)), fn };
}

/* ── The owner's example ── */

test("'pt sugar is 260, pregnant GDM 30 weeks, 68 kg' routes to correction with pregnancy applied", () => {
  const { parse: p, result: r, fn } = run("pt sugar is 260, she is pregnant with GDM at 30 weeks, 68 kg");
  assert.equal(p.mode, "correction");
  assert.equal(fn, "firstDoseCorrection");
  assert.equal(p.slots.glucose, 260);
  assert.equal(p.slots.weightKg, 68);
  assert.equal(p.ctx.pregnancy, true);
  assert.equal(p.ctx.trimester, 3, "30 weeks is the third trimester");
  assert.ok(r && r.rounded > 0, "a real dose comes out of the real engine");
  // pregnancy tightens the TARGET rather than scaling the dose - same rule as the manual screen
  assert.match(r.assumptions.join(" "), /Target 100 mg\/dL/);
});

/* ── Deterministic extraction across the ward vocabulary ── */

test("glucose synonyms and units", () => {
  assert.equal(A.parse("cbg 342").slots.glucose, 342);
  assert.equal(A.parse("rbs is 180").slots.glucose, 180);
  assert.equal(A.parse("grbs 250 mg/dl").slots.glucose, 250);
  assert.equal(A.parse("sugar 12 mmol").slots.glucose, 216, "mmol/L is converted, not misread");
});

test("a basal insulin by brand name is read as a basal dose, not a daily total", () => {
  const p = A.parse("on lantus 20 units, fasting 190");
  assert.equal(p.slots.curBasal, 20);
  assert.equal(p.slots.fasting, 190);
  assert.equal(p.mode, "titrate");
});

test("'on 40 units a day' is a total daily dose", () => {
  assert.equal(A.parse("he is on 40 units a day").slots.tdd, 40);
});

test("steroid drug and dose, with the drug named for conversion", () => {
  const p = A.parse("on dexamethasone 6 mg, 60 kg, sugars high");
  assert.equal(p.slots.steroidKind, "dexamethasone");
  assert.equal(p.slots.steroidMg, 6);
  assert.equal(p.ctx.steroids, true);
  assert.equal(p.dxType, "steroid");
  assert.equal(p.mode, "steroid");
});

test("comorbidity flags are picked up", () => {
  assert.equal(A.parse("ckd on dialysis, sugar 300").ctx.dialysis, true);
  assert.equal(A.parse("egfr 25, sugar 300").slots.egfr, 25);
  assert.equal(A.parse("known cirrhosis, sugar 250").ctx.hepatic, true);
  assert.equal(A.parse("a 9 year old child, 28 kg").ctx.pediatric, true);
});

test("trimester from weeks or from the word", () => {
  assert.equal(A.parse("pregnant 10 weeks").ctx.trimester, 1);
  assert.equal(A.parse("pregnant 20 weeks").ctx.trimester, 2);
  assert.equal(A.parse("pregnant, 3rd trimester").ctx.trimester, 3);
});

/* ── Routing to the right calculator ── */

test("each ward phrasing reaches its calculator", () => {
  const cases = [
    ["fasting is 190 on glargine 20 units", "titrate"],
    ["please write a sliding scale, 70 kg", "scale"],
    ["start insulin in this type 2 patient, 80 kg", "basalT2"],
    ["patient is nbm from midnight, on 24 units basal", "npo"],
    ["going for surgery tomorrow, on basal 20 units", "periop"],
    ["on a ryles tube feed, 70 kg", "nutrition"],
    ["coming off the insulin drip at 2 units/hour", "ivsc"],
    ["dka, 60 kg", "dka"],
    ["discharge planning, inpatient basal 30 units, hba1c 9.2", "discharge"],
    ["unwell at home with vomiting, on 40 units a day", "sick"],
    ["start mixtard, 60 kg", "premix"],
    ["45 g carbs and sugar 200, icr 10, isf 50", "combined"]
  ];
  for (const [q, mode] of cases) assert.equal(A.parse(q).mode, mode, q);
});

test("a bare high sugar is a correction", () => {
  assert.equal(A.parse("sugar 320 what do i give").mode, "correction");
});

/* ── The safety contract ── */

test("implausible numbers are refused rather than trusted", () => {
  assert.equal(A.parse("weight 900 kg").slots.weightKg, undefined);
  assert.equal(A.parse("sugar 99999").slots.glucose, undefined);
  assert.equal(A.parse("on 5000 units a day").slots.tdd, undefined);
});

test("a missing value is ASKED for, never assumed", () => {
  const p = A.parse("please write a sliding scale");     // no weight, no TDD
  assert.equal(p.mode, "scale");
  assert.deepEqual(p.unresolved, ["total daily dose or weight"]);
  assert.ok(p.confidence < 0.9);
  assert.equal(run("please write a sliding scale").result, null, "nothing is computed until it is supplied");
});

test("an empty or irrelevant question routes nowhere", () => {
  assert.equal(A.parse("").mode, null);
  assert.equal(A.parse("hello").mode, null);
  assert.equal(A.parse("").confidence, 0);
});

/* ── The LLM may fill blanks, never overrule or dose ── */

test("the prompt forbids the model from calculating a dose", () => {
  const prompt = A.llmPrompt("sugar 200");
  assert.match(prompt, /JSON only/i);
  assert.match(prompt, /Do NOT calculate an insulin dose/);
  assert.match(prompt, /Do NOT explain/);
  assert.ok(prompt.length < 1400, "the prompt stays small - this is slot filling, not reasoning");
});

test("the local parse always wins over the model", () => {
  const merged = A.applyLlm(A.parse("sugar 260, 68 kg"), { glucose: 999, weightKg: 20 });
  assert.equal(merged.slots.glucose, 260, "a parsed value is never overwritten");
  assert.equal(merged.slots.weightKg, 68);
});

test("the model can fill a genuine blank, and it is labelled as the model's", () => {
  const merged = A.applyLlm(A.parse("please write a sliding scale"), { weightKg: 70 });
  assert.equal(merged.slots.weightKg, 70);
  assert.ok(merged.fromLlm.includes("weightKg"));
  assert.ok(merged.matched.some(m => m.key === "weightKg" && m.llm === true),
    "a model-supplied value must be flagged so the clinician can see where it came from");
  assert.deepEqual(merged.unresolved, []);
});

test("out-of-range and unknown values from the model are dropped", () => {
  const merged = A.applyLlm(A.parse("please write a sliding scale"),
    { weightKg: 900, dose: 12, nonsense: "x", type: "banana" });
  assert.equal(merged.slots.weightKg, undefined, "an impossible weight is refused");
  assert.equal(merged.slots.dose, undefined, "the model cannot introduce a dose");
  assert.equal(merged.dxType, null, "an unknown type is refused");
});

test("a model task is accepted only if it names a real calculator", () => {
  assert.equal(A.applyLlm(A.parse("something vague"), { task: "invent_something" }).mode, null);
  assert.equal(A.applyLlm(A.parse("something vague"), { task: "sick", tdd: 40 }).mode, "sick");
});

test("applyLlm survives junk, null and non-objects", () => {
  const p = A.parse("sugar 200, isf 50");
  for (const junk of [null, undefined, "not json", 42, []]) {
    assert.equal(A.applyLlm(p, junk).slots.glucose, 200, "the local parse survives any model failure");
  }
});

/* ── The engine, not the model, produces every number ── */

test("every routable mode maps to a real engine function", () => {
  for (const mode of Object.keys(A.REQUIRES)) {
    const fn = A.ENGINE_FN[mode];
    assert.ok(fn, mode + " must name an engine function");
    assert.equal(typeof E[fn], "function", mode + " -> " + fn + " must exist on the engine");
  }
});

test("Ask and the manual screen agree on the same case", () => {
  const viaAsk = run("fasting is 190 on glargine 20 units, 70 kg").result;
  const manual = E.basalTitration({ currentDose: 20, fastingGlucose: 190, weightKg: 70 });
  assert.equal(viaAsk.rounded, manual.rounded);
  assert.equal(viaAsk.action, manual.action);
  assert.equal(viaAsk.rounded, 22);
});

test("a steroid question produces the engine's own NPH figure", () => {
  const viaAsk = run("on prednisolone 40 mg, 70 kg, sugars up").result;
  const manual = E.steroidCover({ weightKg: 70, steroid: "prednisolone", steroidMg: 40 });
  assert.equal(viaAsk.nph, manual.nph);
  assert.equal(viaAsk.nph, 28);
});

test("results reached through Ask keep their citation and their safety notes", () => {
  const r = run("on a ryles tube feed, 240 g carbs, 70 kg").result;
  assert.ok(r.refs.length && /ADA/.test(r.refs.join(" ")));
  assert.match(r.clinicalNotes.join(" "), /FEED STOPPING IS THE DANGER/i);
});
