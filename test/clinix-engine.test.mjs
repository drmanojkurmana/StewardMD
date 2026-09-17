import { test } from "node:test";
import assert from "node:assert/strict";
import Engine from "../clinix-engine.js";

/* Fixtures ------------------------------------------------------------------ */

function makeHFCase() {
  return {
    id: "case.hf.test",
    diseaseId: "congestive_heart_failure",
    correctDiagnosis: "Congestive heart failure",
    expectedDifferential: ["Heart failure", "COPD", "Pneumonia"],
    essentialInvestigations: ["ecg", "cxr"],
    initialVitals: { hr: 80, bpSystolic: 130, bpDiastolic: 85, rr: 18, spo2: 95, temp: 36.8, gcs: 15 },
    history: {
      cc: { cues: ["breathless", "dyspnea", "short of breath"], reply: "I get breathless walking uphill.", key: true },
      orthopnea: { cues: ["orthopnea", "pillows", "lying flat"], reply: "I sleep on three pillows.", key: true },
      chestPain: { cues: ["chest pain", "pressure"], reply: "No chest pain or pressure.", key: true },
      smoking: { cues: ["smok"], reply: "Never smoked.", key: false }
    },
    exam: {
      "auscultate:apex": { finding: "Pansystolic murmur at the apex radiating to the axilla.", essential: true },
      "auscultate:mitral": { finding: "Pansystolic murmur at the mitral area.", essential: false },
      "auscultate:aortic": { finding: "Harsh ejection systolic murmur at the aortic area.", essential: false },
      "auscultate:tricuspid": { finding: "Soft systolic murmur at the tricuspid area.", essential: false },
      jvp: { finding: "JVP elevated 5 cm above the sternal angle at 45 degrees.", essential: true },
      pulse: { finding: "Regular pulse, normal volume.", essential: false }
    },
    investigations: {
      ecg: { title: "ECG", indicated: true, result: "Sinus rhythm with left ventricular hypertrophy." },
      cxr: { title: "CXR", indicated: true, result: "Cardiomegaly with bat-wing pulmonary edema." },
      troponin: { title: "Troponin", indicated: false, result: "Negative.", note: "No chest pain syndrome; not indicated." }
    },
    positiveFindings: ["Elevated JVP", "Basal crackles", "Ankle edema"],
    importantNegatives: ["No chest pain", "No wheeze"],
    suggestedNextSteps: ["Start diuresis", "Bedside echocardiogram"]
  };
}

/* createCaseState ----------------------------------------------------------- */

test("createCaseState sets blind mode and copies initial vitals", () => {
  const s = Engine.createCaseState(makeHFCase(), { blind: true });
  assert.equal(s.blind, true);
  assert.equal(s.caseId, "case.hf.test");
  assert.equal(s.currentVitals.hr, 80);
  assert.equal(s.currentVitals.bpSystolic, 130);
  assert.equal(s.activeManeuver, "baseline");
  assert.equal(s.status, "in_progress");
  assert.deepEqual(s.maneuverHistory, []);
});

test("createCaseState defaults to non-blind with fallback patient", () => {
  const s = Engine.createCaseState({ id: "x" }, {});
  assert.equal(s.blind, false);
  assert.ok(s.patient && typeof s.patient.chiefComplaint === "string");
  assert.equal(typeof s.currentVitals.hr, "number");
});

test("currentVitals is an independent copy of initialVitals", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  s.currentVitals.hr = 999;
  assert.equal(s.initialVitals.hr, 80);
});

/* applyManeuver ------------------------------------------------------------- */

test("valsalva increases HR and drops SBP and DBP", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const out = Engine.applyManeuver(s, "valsalva");
  assert.equal(s.activeManeuver, "valsalva");
  assert.equal(out.vitals.hr, 94); // 80 + 14
  assert.equal(out.vitals.bpSystolic, 112); // 130 - 18
  assert.equal(out.vitals.bpDiastolic, 75); // 85 - 10
  assert.ok(s.currentVitals.hr > s.initialVitals.hr);
  assert.ok(s.currentVitals.bpSystolic < s.initialVitals.bpSystolic);
});

test("squatting drops HR and increases SBP and DBP", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const out = Engine.applyManeuver(s, "squatting");
  assert.equal(out.vitals.hr, 72); // 80 - 8
  assert.equal(out.vitals.bpSystolic, 146); // 130 + 16
  assert.equal(out.vitals.bpDiastolic, 97); // 85 + 12
});

test("handgrip increases SBP and DBP", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const out = Engine.applyManeuver(s, "handgrip");
  assert.equal(out.vitals.hr, 90); // 80 + 10
  assert.equal(out.vitals.bpSystolic, 152); // 130 + 22
  assert.equal(out.vitals.bpDiastolic, 101); // 85 + 16
  assert.ok(out.vitals.bpSystolic > s.initialVitals.bpSystolic);
  assert.ok(out.vitals.bpDiastolic > s.initialVitals.bpDiastolic);
});

test("standing raises HR and lowers SBP; unknown maneuver returns null", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const out = Engine.applyManeuver(s, "standing");
  assert.equal(out.vitals.hr, 96); // 80 + 16
  assert.equal(out.vitals.bpSystolic, 118); // 130 - 12
  assert.equal(Engine.applyManeuver(s, "bogus_maneuver"), null);
  assert.equal(s.activeManeuver, "standing"); // failed maneuver does not change state
});

test("maneuvers derive from initial vitals each time and record history", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.applyManeuver(s, "valsalva");
  Engine.applyManeuver(s, "handgrip");
  assert.equal(s.currentVitals.hr, 90); // from baseline 80, not cumulative 104
  assert.deepEqual(s.maneuverHistory, ["valsalva", "handgrip"]);
  Engine.applyManeuver(s, "baseline");
  assert.deepEqual(s.currentVitals, s.initialVitals);
});

/* executeExamAction --------------------------------------------------------- */

test("pulse exam returns authored finding; default adds rate", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const f = Engine.executeExamAction(s, "pulse");
  assert.equal(f.finding, "Regular pulse, normal volume.");
  const bare = Engine.createCaseState({ initialVitals: { hr: 80 } }, {});
  const d = Engine.executeExamAction(bare, "pulse");
  assert.ok(d.finding.toLowerCase().includes("pulse"));
  assert.equal(d.rate, 80);
});

test("jvp exam at baseline returns authored finding; hjr adds positive reflux", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const base = Engine.executeExamAction(s, "jvp");
  assert.ok(base.finding.includes("elevated 5 cm"));
  Engine.applyManeuver(s, "hjr");
  const hjr = Engine.executeExamAction(s, "jvp");
  assert.ok(hjr.finding.includes("positive hepatojugular reflux"));
  assert.ok(s.examRevealed["jvp"]);
});

test("edema, neuro, percuss and inspect return findings", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  assert.ok(Engine.executeExamAction(s, "edema").finding.length > 0);
  assert.ok(Engine.executeExamAction(s, "neuro").finding.length > 0);
  const perc = Engine.executeExamAction(s, "percuss");
  assert.ok(perc.finding.toLowerCase().includes("resonant"));
  assert.ok(Engine.executeExamAction(s, "inspect").finding.length > 0);
});

test("mitral murmur intensifies with handgrip", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.applyManeuver(s, "handgrip");
  const f = Engine.executeExamAction(s, "auscultate", "mitral");
  assert.ok(f.finding.includes("Pansystolic murmur at the mitral area."));
  assert.ok(f.finding.includes("increases by 1 to 2 grades"));
});

test("aortic murmur diminishes with valsalva and intensifies with squatting", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.applyManeuver(s, "valsalva");
  const v = Engine.executeExamAction(s, "auscultate", "aortic");
  assert.ok(v.finding.includes("diminishes markedly"));
  Engine.applyManeuver(s, "squatting");
  const q = Engine.executeExamAction(s, "auscultate", "aortic");
  assert.ok(q.finding.includes("intensifies with increased stroke volume"));
});

test("tricuspid murmur shows Carvallo sign on inspiration", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.applyManeuver(s, "inspiration");
  const f = Engine.executeExamAction(s, "auscultate", "tricuspid");
  assert.ok(f.finding.includes("Carvallo"));
});

test("authored maneuver override finding takes precedence", () => {
  const c = makeHFCase();
  c.exam["auscultate:apex@handgrip"] = { finding: "Apex murmur grade 4/6 on handgrip." };
  const s = Engine.createCaseState(c, {});
  Engine.applyManeuver(s, "handgrip");
  const f = Engine.executeExamAction(s, "auscultate", "apex");
  assert.equal(f.finding, "Apex murmur grade 4/6 on handgrip.");
});

/* askHistory ---------------------------------------------------------------- */

test("askHistory matches cues case-insensitively", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const hit = Engine.askHistory(s, "Do you get BREATHLESS walking uphill?");
  assert.equal(hit.recognized, true);
  assert.equal(hit.key, "cc");
  assert.ok(hit.reply.includes("breathless"));
  assert.equal(s.historyRevealed.cc, hit.reply);
});

test("askHistory prefers the longest matching cue across keys", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const hit = Engine.askHistory(s, "I smoke but mainly I feel breathless on exertion?");
  assert.equal(hit.recognized, true);
  assert.equal(hit.key, "cc"); // "breathless" (10 chars) beats rival cue "smok" (4 chars)
});

test("askHistory falls back on unmatched questions", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const miss = Engine.askHistory(s, "What is your favourite cricket team?");
  assert.equal(miss.recognized, false);
  assert.equal(miss.key, null);
  assert.ok(miss.reply.length > 0);
});

/* orderInvestigation -------------------------------------------------------- */

test("indicated investigation returns result with no penalty", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const ecg = Engine.orderInvestigation(s, "ecg");
  assert.equal(ecg.indicated, true);
  assert.ok(ecg.result.includes("hypertrophy"));
  assert.equal(s.penalties.length, 0);
});

test("unindicated investigation records a penalty", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const trop = Engine.orderInvestigation(s, "troponin");
  assert.equal(trop.indicated, false);
  assert.equal(s.penalties.length, 1);
  assert.equal(s.penalties[0].type, "unnecessary_test");
});

test("unknown investigation id is treated as unindicated with penalty", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const pet = Engine.orderInvestigation(s, "pet_scan");
  assert.ok(!pet.indicated);
  assert.equal(s.penalties.length, 1);
});

/* differential and reasoning ------------------------------------------------ */

test("evaluateReasoningChain flags missed history, missed exams and test misuse", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.askHistory(s, "Are you breathless?"); // 1 of 3 key items
  Engine.executeExamAction(s, "auscultate", "apex"); // 1 of 2 essential exams
  Engine.orderInvestigation(s, "troponin"); // unindicated
  const r = Engine.submitDifferential(s, ["Heart failure"], "orthopnea pattern");
  assert.deepEqual(s.differential, ["Heart failure"]);
  assert.equal(s.differentialJustification, "orthopnea pattern");
  assert.ok(r.score < 100);
  assert.ok(r.missedKeyHistory.includes("orthopnea"));
  assert.ok(r.missedEssentialExam.includes("jvp"));
  assert.ok(r.unnecessaryInvestigations.includes("troponin"));
  assert.ok(r.missedEssentialInvestigations.includes("ecg"));
  assert.ok(r.feedback.length >= 3);
});

test("complete workup yields a full reasoning score", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.askHistory(s, "Are you breathless?");
  Engine.askHistory(s, "How many pillows do you use?");
  Engine.askHistory(s, "Any chest pain?");
  Engine.executeExamAction(s, "auscultate", "apex");
  Engine.executeExamAction(s, "jvp");
  Engine.orderInvestigation(s, "ecg");
  Engine.orderInvestigation(s, "cxr");
  const r = Engine.submitDifferential(s, ["Heart failure", "COPD"], "full workup");
  assert.equal(r.score, 100);
  assert.deepEqual(r.feedback, []);
});

/* diagnosis and synthesis --------------------------------------------------- */

test("correct diagnosis produces a passing synthesis with findings", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.askHistory(s, "Are you breathless?");
  Engine.askHistory(s, "How many pillows?");
  Engine.askHistory(s, "Any chest pain?");
  Engine.executeExamAction(s, "auscultate", "apex");
  Engine.executeExamAction(s, "jvp");
  Engine.orderInvestigation(s, "ecg");
  Engine.orderInvestigation(s, "cxr");
  Engine.submitDifferential(s, ["Heart failure"], "classic");
  const syn = Engine.submitDiagnosis(s, "Congestive heart failure", "elevated JVP plus orthopnea");
  assert.equal(s.status, "completed");
  assert.equal(syn.isCorrect, true);
  assert.equal(syn.correctDiagnosis, "Congestive heart failure");
  assert.equal(syn.score, 100);
  assert.equal(syn.verdict, "excellent");
  assert.deepEqual(syn.positiveFindings, ["Elevated JVP", "Basal crackles", "Ankle edema"]);
  assert.deepEqual(syn.negativeFindings, ["No chest pain", "No wheeze"]);
});

test("incorrect diagnosis caps the score and verdicts incorrect_diagnosis", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.submitDifferential(s, ["Pneumonia"], "fever guess");
  const syn = Engine.submitDiagnosis(s, "Community acquired pneumonia", "crackles");
  assert.equal(syn.isCorrect, false);
  assert.ok(syn.score <= 45);
  assert.equal(syn.verdict, "incorrect_diagnosis");
});

test("correct diagnosis with gaps verdicts pass_with_gaps", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  Engine.submitDifferential(s, ["Heart failure"], "thin workup");
  const syn = Engine.submitDiagnosis(s, "Heart failure", "guess");
  assert.equal(syn.isCorrect, true);
  assert.equal(syn.verdict, "pass_with_gaps");
});

/* pulse profile ------------------------------------------------------------- */

test("getPulseProfile returns the Apple Watch schema", () => {
  const s = Engine.createCaseState(makeHFCase(), {});
  const p = Engine.getPulseProfile(s);
  assert.deepEqual(
    Object.keys(p).sort(),
    ["amplitude", "bpm", "condition", "decayTime", "disclaimer", "regularity", "rhythm", "riseTime", "s1Timing"].sort()
  );
  assert.equal(p.bpm, 80);
  assert.equal(p.rhythm, "regular");
  assert.equal(p.regularity, "regular");
  assert.equal(p.s1Timing, 0);
});

test("getPulseProfile maps afib, water-hammer and parvus characters", () => {
  const afib = Engine.createCaseState({ arrhythmia: "afib", initialVitals: { hr: 110 } }, {});
  const pa = Engine.getPulseProfile(afib);
  assert.equal(pa.rhythm, "atrial_fibrillation");
  assert.equal(pa.regularity, "irregularly_irregular");
  assert.equal(pa.condition, "afib");

  const ar = Engine.createCaseState({ pulseCharacter: "water_hammer" }, {});
  const pw = Engine.getPulseProfile(ar);
  assert.equal(pw.condition, "water_hammer");
  assert.ok(pw.amplitude > 1);

  const as = Engine.createCaseState({ valveLesion: "severe_aortic_stenosis" }, {});
  const ps = Engine.getPulseProfile(as);
  assert.equal(ps.condition, "parvus_et_tardus");
  assert.ok(ps.riseTime > 0.1);
});

test("getPulseProfile flags tachycardia and bradycardia by rate", () => {
  const fast = Engine.createCaseState({ initialVitals: { hr: 120 } }, {});
  assert.equal(Engine.getPulseProfile(fast).condition, "tachycardia");
  const slow = Engine.createCaseState({ initialVitals: { hr: 45 } }, {});
  assert.equal(Engine.getPulseProfile(slow).condition, "bradycardia");
});
