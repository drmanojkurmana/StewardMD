import { test } from "node:test";
import assert from "node:assert/strict";
import Profile from "../clinix-profile.js";

/* createSkillProfile -------------------------------------------------------- */

test("createSkillProfile initializes the default error taxonomy at level 1", () => {
  const p = Profile.createSkillProfile();
  assert.equal(p.version, 1);
  assert.equal(p.adaptiveLevel, 1);
  assert.deepEqual(p.skills, {});
  assert.deepEqual(p.encounters, []);
  assert.deepEqual(Object.keys(p.errorTaxonomy).sort(), [
    "incorrectDifferential",
    "incorrectMurmur",
    "investigationMisuse",
    "missedJVP",
    "missedRedFlags",
    "poorNeuroSequence",
    "repeatedVivaMistakes",
    "safetyOmissions"
  ].sort());
  for (const k of Object.keys(p.errorTaxonomy)) assert.equal(p.errorTaxonomy[k], 0);
});

test("createSkillProfile preserves existing data", () => {
  const p = Profile.createSkillProfile({ adaptiveLevel: 3, errorTaxonomy: { missedJVP: 2 } });
  assert.equal(p.adaptiveLevel, 3);
  assert.equal(p.errorTaxonomy.missedJVP, 2);
  assert.equal(p.errorTaxonomy.incorrectMurmur, 0);
});

/* recordEncounter ----------------------------------------------------------- */

test("recordEncounter increments error taxonomy counters", () => {
  const p = Profile.createSkillProfile();
  Profile.recordEncounter(p, {
    caseId: "c1", score: 70, verdict: "pass",
    errors: [{ category: "missedJVP" }, { category: "missedJVP" }, { category: "incorrectMurmur" }]
  });
  assert.equal(p.errorTaxonomy.missedJVP, 2);
  assert.equal(p.errorTaxonomy.incorrectMurmur, 1);
  assert.equal(p.errorTaxonomy.safetyOmissions, 0);
  assert.equal(p.encounters.length, 1);
  assert.equal(p.encounters[0].caseId, "c1");
});

test("recordEncounter ignores unknown error categories", () => {
  const p = Profile.createSkillProfile();
  Profile.recordEncounter(p, { caseId: "c1", score: 70, errors: [{ category: "not_a_category" }] });
  assert.equal(p.errorTaxonomy.not_a_category, undefined);
  assert.equal(p.encounters.length, 1);
});

test("recordEncounter updates skill mastery scores", () => {
  const p = Profile.createSkillProfile();
  Profile.recordEncounter(p, {
    caseId: "c1", score: 60, verdict: "pass",
    testedSkills: { jvp: { success: false }, murmur: { success: true } }
  });
  assert.equal(p.skills.jvp.attempts, 1);
  assert.equal(p.skills.jvp.correct, 0);
  assert.equal(p.skills.jvp.score, 0);
  assert.equal(p.skills.murmur.score, 100);
  Profile.recordEncounter(p, { caseId: "c2", score: 80, testedSkills: { jvp: { success: true } } });
  assert.equal(p.skills.jvp.attempts, 2);
  assert.equal(p.skills.jvp.correct, 1);
  assert.equal(p.skills.jvp.score, 50);
});

test("recordEncounter recalculates adaptive difficulty", () => {
  const p = Profile.createSkillProfile();
  assert.equal(p.adaptiveLevel, 1);
  Profile.recordEncounter(p, { caseId: "c1", score: 95, verdict: "pass" });
  assert.equal(p.adaptiveLevel, 2); // avg >= 50 lifts out of guided learning
});

/* detectWeaknesses ---------------------------------------------------------- */

test("detectWeaknesses returns empty for a clean profile", () => {
  assert.deepEqual(Profile.detectWeaknesses(Profile.createSkillProfile()), []);
});

test("detectWeaknesses flags taxonomy counts at threshold, sorted by severity", () => {
  const p = Profile.createSkillProfile();
  Profile.recordEncounter(p, {
    caseId: "c1", score: 60,
    errors: [{ category: "missedJVP" }, { category: "missedJVP" }]
  });
  Profile.recordEncounter(p, {
    caseId: "c2", score: 55,
    errors: [
      { category: "incorrectMurmur" }, { category: "incorrectMurmur" },
      { category: "incorrectMurmur" }, { category: "incorrectMurmur" }
    ]
  });
  const w = Profile.detectWeaknesses(p);
  assert.ok(w.length >= 2);
  assert.equal(w[0].category, "incorrectMurmur"); // frequency 4 sorts first
  assert.equal(w[0].severity, "high");
  assert.equal(w[1].category, "missedJVP");
  assert.equal(w[1].severity, "moderate");
});

test("detectWeaknesses flags low-mastery skills after repeated attempts", () => {
  const p = Profile.createSkillProfile();
  Profile.recordEncounter(p, { caseId: "c1", score: 40, testedSkills: { jvp: { success: false } } });
  Profile.recordEncounter(p, { caseId: "c2", score: 40, testedSkills: { jvp: { success: false } } });
  const w = Profile.detectWeaknesses(p);
  assert.ok(w.some((x) => x.skillId === "jvp" && x.severity === "high"));
});

/* generatePracticePlan ------------------------------------------------------ */

test("generatePracticePlan returns proficient maintenance when no weaknesses", () => {
  const plan = Profile.generatePracticePlan(Profile.createSkillProfile());
  assert.equal(plan.status, "proficient");
  assert.ok(Array.isArray(plan.plan) && plan.plan.length > 0);
});

test("missedJVP weakness yields the 3-tier JVP remediation plan", () => {
  const p = Profile.createSkillProfile();
  Profile.recordEncounter(p, {
    caseId: "c1", score: 60, errors: [{ category: "missedJVP" }, { category: "missedJVP" }]
  });
  const plan = Profile.generatePracticePlan(p);
  assert.equal(plan.topWeakness.category, "missedJVP");
  assert.equal(plan.prescription.length, 3);
  assert.equal(plan.prescription[0].type, "micro_session");
  assert.equal(plan.prescription[0].durationMins, 5);
  assert.equal(plan.prescription[1].type, "osce_station");
  assert.equal(plan.prescription[1].durationMins, 7);
  assert.equal(plan.prescription[2].type, "reasoning_case");
  assert.equal(plan.prescription[2].durationMins, 12);
});

test("incorrectMurmur weakness yields the murmur remediation plan", () => {
  const p = Profile.createSkillProfile();
  Profile.recordEncounter(p, {
    caseId: "c1", score: 60,
    errors: [{ category: "incorrectMurmur" }, { category: "incorrectMurmur" }]
  });
  const plan = Profile.generatePracticePlan(p);
  assert.equal(plan.topWeakness.category, "incorrectMurmur");
  assert.equal(plan.prescription.length, 3);
  assert.ok(plan.prescription[0].title.toLowerCase().includes("murmur"));
  assert.equal(plan.prescription[2].caseId, "case.aortic_stenosis_severe");
});

/* calculateAdaptiveDifficulty ----------------------------------------------- */

test("calculateAdaptiveDifficulty adapts from level 1 to level 5", () => {
  assert.equal(Profile.calculateAdaptiveDifficulty(Profile.createSkillProfile()), 1);
  const poor = Profile.createSkillProfile();
  Profile.recordEncounter(poor, { caseId: "c1", score: 30 });
  assert.equal(Profile.calculateAdaptiveDifficulty(poor), 1); // guided learning

  const mid = Profile.createSkillProfile();
  Profile.recordEncounter(mid, { caseId: "c1", score: 70 });
  Profile.recordEncounter(mid, { caseId: "c2", score: 72 });
  assert.equal(Profile.calculateAdaptiveDifficulty(mid), 3); // blind patient mode

  const strong = Profile.createSkillProfile();
  for (let i = 0; i < 4; i++) Profile.recordEncounter(strong, { caseId: "c" + i, score: 92 });
  assert.equal(Profile.calculateAdaptiveDifficulty(strong), 5); // complex multi-morbidity
});

test("three strong encounters reach timed-OSCE level 4", () => {
  const p = Profile.createSkillProfile();
  for (let i = 0; i < 3; i++) Profile.recordEncounter(p, { caseId: "c" + i, score: 85 });
  assert.equal(p.adaptiveLevel, 4);
});
