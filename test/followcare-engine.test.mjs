// FollowCare AI — Recovery Engine unit tests (Phase 1, hardened after adversarial review).
// Green now REQUIRES the global hard-red probes answered 'no' (you can't say "recovering well" without
// confirming no red-flag symptoms). Includes regression tests for every review finding.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
load("followcare-pathways.js"); load("followcare-engine.js");
const PW = globalThis.FollowCarePathways, ENG = globalThis.FollowCareEngine;
const G0 = { g_chestpain: "no", g_breathless_rest: "no", g_syncope: "no", g_confusion: "no", g_bleeding: "no", g_seizure: "no", g_stroke_fast: "no", g_anaphylaxis: "no", g_selfharm: "no" };
const clean = o => Object.assign({}, G0, o);
const assess = (id, ans, opts) => ENG.assess(id, ans, opts);

test("modules load + 9 pathways + 9 global red flags", () => {
  assert.equal(PW.list().length, 9);
  assert.equal(PW.GLOBAL_RED.length, 9);   // review #5: was 5, now includes seizure/stroke/anaphylaxis/self-harm
});

test("GREEN: recovering, all red-flag probes negative, adherent → green/high", () => {
  const r = assess("pneumonia", clean({ overall: "better", fever: "no", fever_days: 0, cough: 1, breathless: 0, spo2: 98, meds_taken: "taken" }), { previousScore: 95 });
  assert.equal(r.escalation, "green");
  assert.equal(r.confidence, "high");
  assert.ok(r.recoveryScore >= 90, "score " + r.recoveryScore);
  assert.equal(r.readmissionRisk, "low");
});

test("RED: low SpO2 (bare number) → red + very_high", () => {
  const r = assess("pneumonia", clean({ overall: "same", breathless: 1, spo2: 88, meds_taken: "taken" }));
  assert.equal(r.escalation, "red");
  assert.equal(r.readmissionRisk, "very_high");
});

test("REGRESSION #1: SpO2 with a unit ('88%') still fires RED (not false green)", () => {
  const r = assess("pneumonia", clean({ overall: "better", fever: "no", breathless: 1, spo2: "88%", meds_taken: "taken" }));
  assert.equal(r.escalation, "red", "escalation was " + r.escalation);
  assert.ok(r.reasons.some(x => /SpO/i.test(x)));
});

test("REGRESSION #1 (opposite): implausible/blank SpO2 does NOT fire a false red flag → review, not red", () => {
  const zero = assess("pneumonia", clean({ overall: "better", fever: "no", breathless: 0, spo2: 0, meds_taken: "taken" }));
  assert.notEqual(zero.escalation, "red", "SpO2 0 must not be a false emergency");
  assert.ok(zero.invalidInputs.includes("spo2") && zero.needsReview);
  const blank = assess("pneumonia", clean({ overall: "better", fever: "no", breathless: 0, spo2: "   ", meds_taken: "taken" }));
  assert.notEqual(blank.escalation, "red");
});

test("REGRESSION #1: unit-bearing numerics escalate correctly (HTN '180/100', HF '2.5 kg', pain '9/10')", () => {
  assert.equal(assess("hypertension", clean({ overall: "same", crisis: "no", sbp: "180/100", meds_taken: "taken" })).escalation, "orange");
  assert.equal(assess("heart_failure", clean({ overall: "same", weight_delta: "2.5 kg", orthopnea: 1, edema: 1, breathless: 1, meds_taken: "taken" })).escalation, "orange");
  assert.equal(assess("post_op", clean({ overall: "same", wound: "healing", fever: "no", pain: "9/10", mobility: "yes", meds_taken: "taken" })).escalation, "orange");
});

test("REGRESSION #2: hard-red yes/no is trimmed/normalized ('Yes ', 'y', ' discharge ')", () => {
  assert.equal(assess("diabetes", clean({ overall: "better", hypo_severe: "no", hypo: "no", hyper: "no", glucose: 120, meds_taken: "taken", g_chestpain: "Yes " })).escalation, "red");
  assert.equal(assess("diabetes", clean({ overall: "better", hypo_severe: "no", hypo: "no", hyper: "no", glucose: 120, meds_taken: "taken", g_seizure: "y" })).escalation, "red");
  assert.equal(assess("post_op", clean({ overall: "same", wound: " discharge ", fever: "no", pain: 4, mobility: "yes", meds_taken: "taken" })).escalation, "orange");
});

test("ORANGE: missed medication → orange", () => {
  const r = assess("pneumonia", clean({ overall: "same", fever: "no", breathless: 1, spo2: 97, meds_taken: "skipped" }));
  assert.equal(r.escalation, "orange");
});

test("REGRESSION #4: graded deterioration lowers score before the hard cutoff (SpO2 92-94)", () => {
  const s98 = assess("pneumonia", clean({ overall: "same", fever: "no", breathless: 0, spo2: 98, meds_taken: "taken" })).recoveryScore;
  const s93 = assess("pneumonia", clean({ overall: "same", fever: "no", breathless: 0, spo2: 93, meds_taken: "taken" })).recoveryScore;
  assert.ok(s93 < s98, "SpO2 93 (" + s93 + ") should score below 98 (" + s98 + ")");
});

test("REGRESSION #5: a FAST/stroke global probe escalates any pathway to red", () => {
  assert.equal(assess("diabetes", clean({ overall: "better", hypo_severe: "no", hypo: "no", hyper: "no", glucose: 120, meds_taken: "taken", g_stroke_fast: "yes" })).escalation, "red");
  assert.equal(assess("hypertension", clean({ overall: "better", crisis: "no", sbp: 130, meds_taken: "taken", g_anaphylaxis: "yes" })).escalation, "red");
});

test("REGRESSION #6: HF severe edema → orange even without a weight reading", () => {
  const r = assess("heart_failure", clean({ overall: "same", edema: 3, orthopnea: 1, breathless: 1, meds_taken: "taken" }));
  assert.equal(r.escalation, "orange");
});

test("REGRESSION #8/10: diabetes glucose tiers + AKI anuria (red) vs reduced (orange)", () => {
  assert.equal(assess("diabetes", clean({ overall: "same", hypo_severe: "no", hypo: "no", hyper: "no", glucose: 45, meds_taken: "taken" })).escalation, "red");
  assert.equal(assess("diabetes", clean({ overall: "same", hypo_severe: "no", hypo: "no", hyper: "no", glucose: 320, meds_taken: "taken" })).escalation, "orange");
  assert.equal(assess("aki", clean({ overall: "same", urine: "none", swelling: "no", breathless: 0, nausea: "no", meds_taken: "taken" })).escalation, "red");
  assert.equal(assess("aki", clean({ overall: "same", urine: "reduced", swelling: "no", breathless: 0, nausea: "no", meds_taken: "taken" })).escalation, "orange");
});

test("MISSING data never leaves a false Green; blocks Green + lowers confidence", () => {
  const r = assess("pneumonia", { overall: "better" });   // nothing else, no global probes
  assert.equal(r.redFlags.filter(f => f.level === "red").length, 0);
  assert.notEqual(r.confidence, "high");
  assert.notEqual(r.escalation, "green");
});

test("CONFIDENCE low on inconsistent answers ('better' but red flag)", () => {
  const r = assess("pneumonia", clean({ overall: "better", fever: "no", breathless: 3, spo2: 99, meds_taken: "taken" }));
  assert.equal(r.escalation, "red");
  assert.equal(r.confidence, "low");
});

test("TREND: large drop vs previous score → declining/critical (+bumps level)", () => {
  const r = assess("pneumonia", clean({ overall: "worse", fever: "yes", fever_days: 2, cough: 3, breathless: 2, spo2: 94, meds_taken: "skipped" }), { previousScore: 90 });
  assert.ok(["declining", "critical"].includes(r.trend), "trend " + r.trend);
});

test("REGRESSION #3: isRecovered enforces needAfebrile + needImproving (fails closed)", () => {
  const ans = clean({ overall: "better", fever: "no", fever_days: 0, cough: 0, breathless: 0, spo2: 99, meds_taken: "taken" });
  const good = assess("pneumonia", ans, { previousScore: 96 });
  assert.equal(ENG.isRecovered("pneumonia", good, 14, { pathways: PW, answers: ans }), true);
  // still febrile → not recovered despite green
  const feb = clean({ overall: "better", fever: "yes", fever_days: 1, cough: 0, breathless: 0, spo2: 99, meds_taken: "taken" });
  const gFeb = assess("pneumonia", feb, { previousScore: 96 });
  assert.equal(ENG.isRecovered("pneumonia", gFeb, 14, { pathways: PW, answers: feb }), false, "febrile must not auto-complete");
  // dengue still febrile at day 10 → not recovered (review's headline dengue bug)
  const dAns = clean({ overall: "better", warning_bleed: "no", warning_abdo: "no", warning_vomit: "no", warning_lethargy: "no", fever: "yes", hydration: "yes" });
  const dR = assess("dengue", dAns, { previousScore: 96 });
  assert.equal(ENG.isRecovered("dengue", dR, 10, { pathways: PW, answers: dAns }), false);
  // declining trend → not recovered even if green + score ok
  const decl = assess("pneumonia", ans, { previousScore: 100 });   // 100→~98 = stable... force declining:
  const decl2 = Object.assign({}, decl, { trend: "declining" });
  assert.equal(ENG.isRecovered("pneumonia", decl2, 14, { pathways: PW, answers: ans }), false);
});

test("REGRESSION #19: missed check-in escalates (never stays at prior risk)", () => {
  assert.equal(ENG.assessMissed("pneumonia", 1).escalation, "yellow");
  assert.equal(ENG.assessMissed("pneumonia", 3).escalation, "orange");
});

test("DETERMINISM + unknown pathway", () => {
  const input = clean({ overall: "same", fever: "yes", breathless: 2, spo2: 93, meds_taken: "skipped" });
  assert.deepEqual(assess("pneumonia", input), assess("pneumonia", input));
  assert.equal(assess("not_a_disease", {}), null);
});
