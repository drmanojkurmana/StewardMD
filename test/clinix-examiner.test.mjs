import { test } from "node:test";
import assert from "node:assert/strict";
import Engine from "../clinix-engine.js";
import Examiner from "../clinix-examiner.js";

/* Fixtures ------------------------------------------------------------------ */

function makeStateWith(over) {
  const base = {
    id: "case.viva.test",
    history: {},
    exam: Object.assign({
      jvp: { finding: "JVP elevated 5 cm above the sternal angle." },
      pulse: { finding: "Regular pulse, normal volume." },
      percuss: { finding: "Resonant note throughout all lung zones." }
    }, (over && over.exam) || {}),
    investigations: {}
  };
  const s = Engine.createCaseState(base, {});
  for (const key of Object.keys(base.exam)) {
    const parts = key.split(":");
    Engine.executeExamAction(s, parts[0], parts[1]);
  }
  s.differential = (over && over.differential) || ["Heart failure"];
  s.finalDiagnosis = (over && over.finalDiagnosis) || "";
  return s;
}

/* session lifecycle --------------------------------------------------------- */

test("createVivaSession initializes an active session", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  assert.equal(v.caseId, "case.viva.test");
  assert.equal(v.turnIndex, 0);
  assert.equal(v.status, "active");
  assert.equal(v.score, 100);
  assert.deepEqual(v.history, []);
  assert.deepEqual(v.contradictionsFound, []);
  assert.deepEqual(v.safetyAlerts, []);
});

/* question progression ------------------------------------------------------ */

test("viva progresses findings -> differential -> maneuver -> investigations -> safety", () => {
  const s = makeStateWith({}); // coherent HF case: no contradiction at turn 2
  const v = Examiner.createVivaSession(s);
  const types = [];
  for (let i = 0; i < 5; i++) {
    const q = Examiner.getNextQuestion(v, s);
    assert.ok(q, "expected a question at turn " + i);
    assert.equal(q.turn, i);
    types.push(q.type);
    Examiner.evaluateAnswer(v, q, "Supported by the examination; urgent ECG, monitor overnight.");
  }
  assert.deepEqual(types, [
    "findings_summary",
    "differential_rationale",
    "dynamic_maneuver",
    "investigation_priority",
    "red_flags_safety"
  ]);
});

test("turn 1 question names the learner's top differential", () => {
  const s = makeStateWith({ differential: ["Aortic stenosis"] });
  const v = Examiner.createVivaSession(s);
  Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "summary answer");
  const q = Examiner.getNextQuestion(v, s);
  assert.equal(q.type, "differential_rationale");
  assert.ok(q.question.includes("Aortic stenosis"));
});

test("turn 2 raises a contradiction challenge when findings clash", () => {
  const s = makeStateWith({
    exam: { jvp: { finding: "JVP not visibly elevated, waveform normal." } },
    differential: ["Heart failure"]
  });
  const v = Examiner.createVivaSession(s);
  Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "a");
  Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "b");
  const q = Examiner.getNextQuestion(v, s);
  assert.equal(q.type, "contradiction_challenge");
  assert.equal(v.contradictionsFound.length, 1);
});

test("viva ends with null after the safety turn", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  for (let i = 0; i < 5; i++) Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "safe answer");
  assert.equal(Examiner.getNextQuestion(v, s), null);
  assert.equal(v.status, "completed");
});

/* contradiction detection --------------------------------------------------- */

test("heart failure claimed with normal JVP is flagged", () => {
  const s = makeStateWith({
    exam: { jvp: { finding: "JVP not visibly elevated, waveform normal." } },
    differential: ["Heart failure"]
  });
  const c = Examiner.checkContradictions(s);
  assert.ok(c);
  assert.equal(c.type, "jvp_heart_failure_mismatch");
  assert.ok(c.question.includes("Heart Failure"));
  assert.ok(c.expectedExplanation.length > 0);
});

test("aortic stenosis claimed with bounding pulse is flagged", () => {
  const s = makeStateWith({
    exam: { pulse: { finding: "Bounding water-hammer pulse, collapsing character." } },
    differential: ["Aortic stenosis"]
  });
  const c = Examiner.checkContradictions(s);
  assert.ok(c);
  assert.equal(c.type, "pulse_as_mismatch");
});

test("COPD claimed with stony dull percussion is flagged", () => {
  const s = makeStateWith({
    exam: { percuss: { finding: "Stony dull note at the right base with absent breath sounds." } },
    differential: ["COPD with infective exacerbation"]
  });
  const c = Examiner.checkContradictions(s);
  assert.ok(c);
  assert.equal(c.type, "percussion_copd_mismatch");
});

test("coherent findings produce no contradiction", () => {
  assert.equal(Examiner.checkContradictions(makeStateWith({})), null);
});

/* answer evaluation --------------------------------------------------------- */

test("empty answer scores zero as an omission", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  const r = Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "");
  assert.equal(r.verdict, "incomplete");
  assert.equal(r.score, 0);
});

test("unsafe discharge on the safety turn fails safety and alerts", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  let q;
  for (let i = 0; i < 5; i++) {
    q = Examiner.getNextQuestion(v, s);
    if (i < 4) Examiner.evaluateAnswer(v, q, "safe supervised answer");
  }
  assert.equal(q.type, "red_flags_safety");
  const r = Examiner.evaluateAnswer(v, q, "discharge home without stabilization");
  assert.equal(r.score, 0);
  assert.equal(r.isSafe, false);
  assert.equal(v.safetyAlerts.length, 1);
  assert.equal(v.turnIndex, 5);
});

test("unsafe discharge on the investigation turn is also penalized", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  for (let i = 0; i < 3; i++) Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "safe");
  const q = Examiner.getNextQuestion(v, s);
  assert.equal(q.type, "investigation_priority");
  const r = Examiner.evaluateAnswer(v, q, "no investigations needed, discharge home");
  assert.equal(r.isSafe, false);
});

/* final scorecard ----------------------------------------------------------- */

test("flawless viva finalizes with honours", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  for (let i = 0; i < 5; i++) {
    Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "thorough safe answer with ECG and monitoring");
  }
  const card = Examiner.finalizeViva(v);
  assert.equal(card.totalScore, 100);
  assert.equal(card.maxScore, 100);
  assert.equal(card.verdict, "honours");
  assert.equal(card.turnsCompleted, 5);
});

test("safety failure caps the scorecard at fail_safety", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  for (let i = 0; i < 4; i++) Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "safe");
  Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "discharge home without stabilization");
  const card = Examiner.finalizeViva(v);
  assert.equal(card.verdict, "fail_safety");
  assert.ok(card.totalScore <= 45);
  assert.equal(card.safetyAlerts.length, 1);
});

test("silent viva fails on knowledge", () => {
  const s = makeStateWith({});
  const v = Examiner.createVivaSession(s);
  for (let i = 0; i < 5; i++) Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "");
  // Empty answers are scored as omissions without advancing turns; scorecard reflects no completed turns.
  const card = Examiner.finalizeViva(v);
  assert.equal(card.turnsCompleted, 0);
  assert.equal(card.verdict, "fail_knowledge");
});
