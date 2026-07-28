// FollowCare AI — Phase 4 (integration) + Phase 5 (recovery intelligence) unit tests. Pure/deterministic.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
load("followcare-pathways.js"); load("followcare-diagnosis.js"); load("followcare-integration.js"); load("followcare-intel.js");
const INT = globalThis.FollowCareIntegration, INTEL = globalThis.FollowCareIntel, PW = globalThis.FollowCarePathways;

// ---- Phase 4: integration ---------------------------------------------------------------
test("P4 diagnosisToPathway: maps free-text discharge diagnoses to pathways (delegates to DiagnosisMapper)", () => {
  assert.equal(INT.diagnosisToPathway("Community acquired pneumonia"), "pneumonia");
  assert.equal(INT.diagnosisToPathway("CHF exacerbation"), "heart_failure");
  assert.equal(INT.diagnosisToPathway("s/p laparotomy"), "post_op");
  assert.equal(INT.diagnosisToPathway("NSTEMI", "I21.4"), "acs");       // ICD-10 honoured when present
  assert.equal(INT.diagnosisToPathway("something unmapped"), "generic"); // Generic fallback, never null/blocked
});

test("P4 fromDischargeCSV: parses rows, maps diagnosis, reports unmapped/invalid", () => {
  const csv = [
    "Name,Mobile,Diagnosis,Discharge Date,MRN",
    'Ramesh Kumar,+91 98765 43210,Pneumonia,2026-07-10,MRN001',
    '"Devi, S",9876500000,Heart Failure,2026-07-11,MRN002',
    "Bad Row,123,Pneumonia,2026-07-10,MRN003",          // phone too short → skipped
    "No Dx,9876511111,Broken Leg,2026-07-10,MRN004"      // diagnosis unmapped → Generic (still enrolls)
  ].join("\n");
  const r = INT.fromDischargeCSV(csv);
  assert.equal(r.rows.length, 3);                        // unmapped no longer blocks enrolment
  assert.equal(r.rows[0].pathwayId, "pneumonia");
  assert.equal(r.rows[0].phone, "919876543210");
  assert.equal(r.rows[1].pathwayId, "heart_failure");
  assert.equal(r.rows[2].pathwayId, "generic");          // Broken Leg → safe Generic fallback
  assert.equal(r.errors.length, 1);                      // only the invalid-phone row is skipped
});

test("P4 toFHIR: emits a transaction Bundle with CarePlan + Observations + RiskAssessment, no PHI", () => {
  const ep = { episodeId: "ep1", disease: "Pneumonia", pathwayId: "pneumonia", status: "active", risk: "moderate" };
  const tl = [{ dayOffset: 1, score: 70, escalation: "yellow", redFlags: [] }, { dayOffset: 3, score: 55, escalation: "orange", redFlags: [{ reason: "Low SpO₂" }] }];
  const b = INT.toFHIR(ep, tl, { emrPatientId: "P123", recommendation: "Review within 24 hours." });
  assert.equal(b.resourceType, "Bundle");
  assert.ok(b.entry.some(e => e.resource.resourceType === "CarePlan"));
  assert.equal(b.entry.filter(e => e.resource.resourceType === "Observation").length, 2);
  assert.ok(b.entry.some(e => e.resource.resourceType === "RiskAssessment"));
  assert.ok(b.entry.some(e => e.resource.resourceType === "Communication"));
  assert.ok(!/phone|9876|name/i.test(JSON.stringify(b)));   // no patient identifiers in the payload
});

test("P4 evalRules: default automation maps events to de-duped actions", () => {
  const rules = INT.defaultRules();
  assert.deepEqual(INT.evalRules(rules, { type: "assessment", escalation: "red" }).sort(), ["advise_urgent_care", "notify_doctor"]);
  assert.ok(INT.evalRules(rules, { type: "assessment", escalation: "orange" }).includes("book_teleconsult"));
  assert.ok(INT.evalRules(rules, { type: "assessment", escalation: "green", risk: "very_high" }).includes("book_teleconsult"));
  assert.deepEqual(INT.evalRules(rules, { type: "missed", missedCount: 3 }).sort(), ["create_nurse_task", "notify_doctor", "send_reminder"]);
  assert.deepEqual(INT.evalRules(rules, { type: "assessment", escalation: "green" }), []);
});

// ---- Phase 5: recovery intelligence -----------------------------------------------------
test("P5 expectedScore: monotonic curve rising toward 100 by the follow-up horizon", () => {
  const pw = PW.get("pneumonia");
  const d1 = INTEL.expectedScore(pw, 1), d14 = INTEL.expectedScore(pw, 14);
  assert.ok(d14 > d1);
  assert.ok(d14 >= 95);
});

test("P5 recoveryTwin: expected vs actual gap + status", () => {
  const pw = PW.get("pneumonia");
  const behind = INTEL.recoveryTwin(pw, 10, { recoveryScore: 54, reasons: ["Fever ↑", "Missed antibiotics"] });
  assert.ok(behind.gap < -10);
  assert.equal(behind.status, "behind");
  assert.equal(behind.onTrack, false);
  const ok = INTEL.recoveryTwin(pw, 10, { recoveryScore: 95, reasons: [] });
  assert.equal(ok.status, "on_track");
});

test("P5 predictDeterioration: sustained drop + amber → higher likelihood, explained", () => {
  const hist = [{ dayOffset: 1, score: 90 }, { dayOffset: 3, score: 78 }, { dayOffset: 5, score: 60 }];
  const p = INTEL.predictDeterioration(hist, { escalation: "orange", readmissionRisk: "high", trend: "declining", redFlags: [] }, PW.get("pneumonia"));
  assert.ok(["moderate", "high"].includes(p.likelihood), p.likelihood);
  assert.ok(p.reasons.length >= 2);
  assert.ok(p.windowHours >= 72);
  // a stable improving patient → minimal
  const calm = INTEL.predictDeterioration([{ dayOffset: 1, score: 80 }, { dayOffset: 3, score: 88 }], { escalation: "green", readmissionRisk: "low", trend: "improving", redFlags: [] });
  assert.ok(["minimal", "low"].includes(calm.likelihood));
});

test("P5 predictDeterioration: current red short-circuits to high/urgent", () => {
  const p = INTEL.predictDeterioration([], { escalation: "red" });
  assert.equal(p.likelihood, "high");
  assert.equal(p.windowHours, 24);
});

test("P5 preventionPlan: explainable, suggestion-only actions (never an order/therapy change)", () => {
  const plan = INTEL.preventionPlan({ escalation: "orange", readmissionRisk: "high", reasons: ["Missed antibiotics"], redFlags: [{ reason: "Medication not taken" }] }, "pneumonia");
  assert.ok(plan.actions.length >= 1);
  assert.ok(plan.actions.some(a => /teleconsult|review/i.test(a)));
  assert.ok(!plan.actions.some(a => /\b(stop|start|change)\b.*(antibiotic|dose|medicine)/i.test(a)));  // no therapy change
});
