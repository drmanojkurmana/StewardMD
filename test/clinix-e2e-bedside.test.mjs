import { test } from "node:test";
import assert from "node:assert/strict";
import Engine from "../clinix-engine.js";
import Examiner from "../clinix-examiner.js";
import Profile from "../clinix-profile.js";

/* End-to-end bedside simulation: blind heart-failure case, history to viva
 * to learner profile. Each step builds on the previous state, mirroring a
 * real learner session.
 */

function makeBedsideCase() {
  return {
    id: "case.e2e.hf",
    diseaseId: "congestive_heart_failure",
    correctDiagnosis: "Congestive heart failure",
    expectedDifferential: ["Heart failure", "COPD", "Anaemia"],
    essentialInvestigations: ["ecg", "cxr"],
    initialVitals: { hr: 92, bpSystolic: 138, bpDiastolic: 88, rr: 22, spo2: 93, temp: 37.0, gcs: 15 },
    history: {
      cc: { cues: ["breathless", "dyspnea", "breathing"], reply: "I get breathless on mild exertion.", key: true },
      orthopnea: { cues: ["orthopnea", "pillows", "lying flat"], reply: "I need three pillows to sleep.", key: true },
      chestPain: { cues: ["chest pain", "pressure", "tightness"], reply: "No chest pain.", key: true },
      edema: { cues: ["swelling", "swollen", "edema", "ankles"], reply: "My ankles swell by evening.", key: true }
    },
    exam: {
      inspect: { finding: "Mild respiratory distress, ankle edema present.", essential: true },
      "palpate:apex": { finding: "Apex beat displaced to the anterior axillary line, hyperdynamic.", essential: true },
      "auscultate:apex": { finding: "Pansystolic murmur at the apex with bibasal crackles.", essential: true },
      "auscultate:aortic": { finding: "Normal aortic sounds, no ejection murmur.", essential: false },
      jvp: { finding: "JVP elevated 6 cm above the sternal angle at 45 degrees.", essential: true }
    },
    investigations: {
      ecg: { title: "ECG", indicated: true, result: "Sinus tachycardia with LVH by voltage criteria." },
      cxr: { title: "CXR", indicated: true, result: "Cardiomegaly, upper-lobe diversion, Kerley B lines." }
    },
    positiveFindings: ["Elevated JVP", "Displaced hyperdynamic apex", "Bibasal crackles", "Ankle edema"],
    importantNegatives: ["No chest pain", "No wheeze", "No fever"],
    pulseCharacter: "normal"
  };
}

const SAFE_ANSWER = "Findings support cardiac failure; urgent ECG and CXR now, continuous monitoring overnight for pulmonary edema and arrhythmia.";

test("complete bedside chain: history to viva to learner profile", () => {
  // 1. Initialize blind patient case.
  const state = Engine.createCaseState(makeBedsideCase(), { blind: true });
  assert.equal(state.blind, true);
  assert.equal(state.status, "in_progress");

  // 2. History inquiries.
  const cc = Engine.askHistory(state, "What brings you in? Are you breathless?");
  const dyspnea = Engine.askHistory(state, "Tell me about the dyspnea on exertion.");
  const orth = Engine.askHistory(state, "How many pillows do you sleep on?");
  const cp = Engine.askHistory(state, "Any chest pain or tightness?");
  for (const h of [cc, dyspnea, orth, cp]) assert.equal(h.recognized, true);
  assert.equal(Object.keys(state.historyRevealed).length, 3); // cc asked twice, 3 keys revealed

  // 3. Physical examination.
  const inspection = Engine.executeExamAction(state, "inspect");
  const apex = Engine.executeExamAction(state, "palpate", "apex");
  const apexAusc = Engine.executeExamAction(state, "auscultate", "apex");
  const aorticAusc = Engine.executeExamAction(state, "auscultate", "aortic");
  const jvpBase = Engine.executeExamAction(state, "jvp");
  assert.ok(inspection.finding.includes("edema"));
  assert.ok(apex.finding.includes("displaced"));
  assert.ok(apexAusc.finding.includes("Pansystolic"));
  assert.ok(aorticAusc.finding.length > 0);
  assert.ok(jvpBase.finding.includes("elevated 6 cm"));

  // 4. Dynamic maneuver: HJR then re-check JVP for a positive reflux.
  Engine.applyManeuver(state, "hjr");
  const jvpHjr = Engine.executeExamAction(state, "jvp");
  assert.ok(jvpHjr.finding.includes("positive hepatojugular reflux"));
  Engine.applyManeuver(state, "baseline");

  // 5. Indicated investigations only (no contraindicated orders).
  const ecg = Engine.orderInvestigation(state, "ecg");
  const cxr = Engine.orderInvestigation(state, "cxr");
  assert.equal(ecg.indicated, true);
  assert.ok(cxr.result.includes("Kerley"));
  assert.deepEqual(state.penalties, []);

  // 6. Differential diagnosis.
  const reasoning = Engine.submitDifferential(
    state, ["Heart failure", "COPD", "Anaemia"], "orthopnea, edema and raised JVP point to cardiac failure"
  );
  assert.ok(reasoning.score >= 80);
  assert.deepEqual(reasoning.missedEssentialExam, []);

  // 7. Final diagnosis and synthesis.
  const synthesis = Engine.submitDiagnosis(state, "Congestive heart failure", "volume overload signs with LVH on ECG");
  assert.equal(synthesis.isCorrect, true);
  assert.equal(synthesis.verdict, "excellent");
  assert.equal(synthesis.score, 100);
  assert.ok(synthesis.positiveFindings.includes("Elevated JVP"));

  // Pulse profile stays well-formed through the whole chain.
  const pulse = Engine.getPulseProfile(state);
  assert.equal(pulse.bpm, 92); // baseline restored after clearManeuvers-equivalent reset
  assert.equal(pulse.condition, "normal");

  // 8. Dynamic viva examination over the completed case state.
  const viva = Examiner.createVivaSession(state);
  const seenTypes = [];
  for (let i = 0; i < 5; i++) {
    const q = Examiner.getNextQuestion(viva, state);
    assert.ok(q, "expected viva question at turn " + i);
    seenTypes.push(q.type);
    const r = Examiner.evaluateAnswer(viva, q, SAFE_ANSWER);
    assert.equal(r.isSafe, true);
  }
  assert.deepEqual(seenTypes, [
    "findings_summary", "differential_rationale", "dynamic_maneuver",
    "investigation_priority", "red_flags_safety"
  ]);
  const scorecard = Examiner.finalizeViva(viva);
  assert.equal(scorecard.verdict, "honours");
  assert.equal(scorecard.turnsCompleted, 5);

  // 9. Record the completed encounter into the learner profile.
  const profile = Profile.createSkillProfile();
  Profile.recordEncounter(profile, {
    caseId: state.caseId,
    score: synthesis.score,
    verdict: synthesis.verdict,
    testedSkills: {
      "skill.exam.cv.jvp": { success: true },
      "skill.exam.cv.auscultation": { success: true },
      "skill.reasoning.differential": { success: true }
    }
  });

  // 10. Chain success: synthesis verdict plus updated profile mastery.
  assert.equal(profile.encounters.length, 1);
  assert.equal(profile.encounters[0].caseId, "case.e2e.hf");
  assert.equal(profile.skills["skill.exam.cv.jvp"].score, 100);
  assert.equal(profile.skills["skill.reasoning.differential"].score, 100);
  assert.ok(profile.adaptiveLevel >= 2);
  assert.deepEqual(Profile.detectWeaknesses(profile), []);
});

test("e2e with unindicated test and missed steps still completes with gaps", () => {
  const state = Engine.createCaseState(makeBedsideCase(), { blind: true });
  Engine.askHistory(state, "Are you breathless?");
  Engine.executeExamAction(state, "auscultate", "apex");
  Engine.orderInvestigation(state, "ecg");
  Engine.orderInvestigation(state, "d_dimer"); // unknown id: unindicated, penalized
  Engine.submitDifferential(state, ["Heart failure"], "partial workup");
  const synthesis = Engine.submitDiagnosis(state, "Heart failure", "raised JVP");
  assert.equal(synthesis.isCorrect, true);
  assert.equal(synthesis.verdict, "pass_with_gaps");
  assert.ok(synthesis.unnecessaryActions.includes("d_dimer"));
  assert.ok(synthesis.missedExamSteps.length > 0);

  const profile = Profile.createSkillProfile();
  Profile.recordEncounter(profile, {
    caseId: state.caseId,
    score: synthesis.score,
    verdict: synthesis.verdict,
    errors: [{ category: "investigationMisuse" }, { category: "investigationMisuse" }],
    testedSkills: { "skill.ix.ordering": { success: false } }
  });
  const plan = Profile.generatePracticePlan(profile);
  assert.equal(plan.topWeakness.category, "investigationMisuse");
  assert.equal(plan.prescription.length, 3);
});
