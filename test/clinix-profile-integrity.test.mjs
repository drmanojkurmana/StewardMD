/* test/clinix-profile-integrity.test.mjs - the profile must not alias, must not grow forever, and
 * generatePracticePlan must return one shape.
 *
 * Audit 2026-09-27: createSkillProfile kept the caller's skills/encounters objects, so recording an
 * encounter mutated the caller's stored data; encounters grew without bound; and the plan lived
 * under `plan` when proficient but `prescription` otherwise.
 *
 * node --test test/clinix-profile-integrity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Profile from "../clinix-profile.js";

test("createSkillProfile copies the caller's skills and encounters", () => {
  const stored = {
    skills: { jvp: { attempts: 1, correct: 1, score: 100, lastSeen: 1 } },
    encounters: [{ caseId: "a", score: 80, verdict: "pass", timestamp: 1 }]
  };
  const snapshot = JSON.stringify(stored);
  const p = Profile.createSkillProfile(stored);
  Profile.recordEncounter(p, { caseId: "b", score: 20, testedSkills: { jvp: { success: false }, murmur: { success: true } } });
  assert.equal(JSON.stringify(stored), snapshot, "the caller's object was mutated");
  assert.notEqual(p.skills, stored.skills);
  assert.notEqual(p.encounters, stored.encounters);
  assert.equal(p.skills.jvp.attempts, 2);
  assert.equal(p.encounters.length, 2);
});

test("the encounter log is capped", () => {
  const p = Profile.createSkillProfile();
  for (let i = 0; i < 260; i++) Profile.recordEncounter(p, { caseId: "c" + i, score: 70 });
  assert.equal(p.encounters.length, Profile.MAX_ENCOUNTERS);
  assert.ok(Profile.MAX_ENCOUNTERS <= 200);
  assert.equal(p.encounters[p.encounters.length - 1].caseId, "c259", "the newest is kept");
  const big = { encounters: Array.from({ length: 500 }, (_, i) => ({ caseId: "x" + i, score: 50 })) };
  assert.equal(Profile.createSkillProfile(big).encounters.length, Profile.MAX_ENCOUNTERS);
});

test("generatePracticePlan returns the same keys in every branch", () => {
  const proficient = Profile.generatePracticePlan(Profile.createSkillProfile());
  const weak = Profile.createSkillProfile({ errorTaxonomy: { missedJVP: 3 } });
  const other = Profile.createSkillProfile({ errorTaxonomy: { missedRedFlags: 3 } });
  for (const plan of [proficient, Profile.generatePracticePlan(weak), Profile.generatePracticePlan(other)]) {
    assert.ok(Array.isArray(plan.prescription) && plan.prescription.length > 0);
    assert.ok(Array.isArray(plan.plan) && plan.plan.length > 0);
    assert.deepEqual(plan.plan, plan.prescription);
    assert.ok(typeof plan.status === "string");
    assert.ok("topWeakness" in plan);
    assert.equal(typeof plan.recommendedDifficulty, "number");
  }
});
