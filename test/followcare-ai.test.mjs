// FollowCare AI — Phase 2 adaptive layer unit tests (deterministic).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
load("followcare-pathways.js"); load("followcare-engine.js"); load("followcare-ai.js");
const PW = globalThis.FollowCarePathways, ENG = globalThis.FollowCareEngine, AI = globalThis.FollowCareAI;

const R = (esc, extra) => Object.assign({ escalation: esc, trend: "stable", recoveryScore: 80, readmissionRisk: "low", confidence: "high", reasons: [], redFlags: [] }, extra || {});

test("nextInterval: sooner when declining/concerning, normal when stable, stretched when improving", () => {
  assert.equal(AI.nextInterval(R("red"), PW.get("pneumonia"), 3).deltaHours, 0);
  assert.equal(AI.nextInterval(R("orange"), PW.get("pneumonia"), 3).deltaHours, 12);
  assert.equal(AI.nextInterval(R("yellow"), PW.get("pneumonia"), 3).deltaHours, 24);
  assert.equal(AI.nextInterval(R("green"), PW.get("pneumonia"), 3).dayOffset, 5);           // next scheduled day
  const imp = AI.nextInterval(R("green", { trend: "improving", recoveryScore: 92 }), PW.get("pneumonia"), 3);
  assert.equal(imp.dayOffset, 7);                                                            // stretched past day 5
});

test("riskPercent: explainable mapping, bounded, trend-adjusted", () => {
  assert.ok(AI.riskPercent(R("red", { readmissionRisk: "very_high" })) >= 90);
  assert.ok(AI.riskPercent(R("green", { readmissionRisk: "low", trend: "improving" })) < 15);
  assert.ok(AI.riskPercent(R("orange", { readmissionRisk: "moderate", confidence: "low" })) > AI.riskPercent(R("orange", { readmissionRisk: "moderate" })));
  assert.ok(AI.riskPercent(R("red", { readmissionRisk: "very_high", trend: "critical" })) <= 99);
});

test("appointmentRec: red/orange->earlier, yellow/review->teleconsult, improving-well->none", () => {
  assert.equal(AI.appointmentRec(R("red")), "earlier_review");
  assert.equal(AI.appointmentRec(R("orange")), "earlier_review");
  assert.equal(AI.appointmentRec(R("yellow")), "teleconsult");
  assert.equal(AI.appointmentRec(R("green", { needsReview: true })), "teleconsult");
  assert.equal(AI.appointmentRec(R("green", { trend: "improving", recoveryScore: 90 })), "none");
});

test("doctorSummary: 30-second card with score, risk %, reasons, recommendation", () => {
  const s = AI.doctorSummary(R("orange", { reasons: ["Fever ↑", "Missed antibiotics"], readmissionRisk: "moderate" }), { disease: "Pneumonia" });
  assert.equal(s.recoveryScore, 80);
  assert.ok(s.riskPercent > 0);
  assert.deepEqual(s.reasons, ["Fever ↑", "Missed antibiotics"]);
  assert.match(s.recommendation, /24 hours/);
  assert.equal(s.disease, "Pneumonia");
});

test("recommendation: safe, never prescriptive — red advises urgent evaluation", () => {
  assert.match(AI.recommendation(R("red")), /urgent/i);
  assert.ok(!/change|stop|start .*antibiotic/i.test(AI.recommendation(R("orange"))));   // never a therapy change
});

test("medicationFollowUp: only when a dose was missed; side-effects flags the doctor (no drug change)", () => {
  assert.equal(AI.medicationFollowUp({ meds_taken: "taken" }), null);
  const f = AI.medicationFollowUp({ meds_taken: "skipped" });
  assert.equal(f.ask.id, "meds_reason");
  assert.equal(AI.medicationFollowUp({ meds_taken: "skipped", meds_reason: "forgot" }).action, "reminder");
  assert.equal(AI.medicationFollowUp({ meds_taken: "skipped", meds_reason: "side_effects" }).action, "notify_doctor");
  assert.equal(AI.medicationFollowUp({ meds_taken: "unavailable", meds_reason: "unavailable" }).action, "contact_hospital");
});

test("adaptiveProbes: surfaces the med-reason follow-up when a dose was skipped", () => {
  const probes = AI.adaptiveProbes("pneumonia", { meds_taken: "skipped" }, { pathways: PW });
  assert.ok(probes.some(q => q.id === "meds_reason"));
  // once answered, it is not asked again
  const none = AI.adaptiveProbes("pneumonia", { meds_taken: "skipped", meds_reason: "forgot" }, { pathways: PW });
  assert.ok(!none.some(q => q.id === "meds_reason"));
});

test("determinism", () => {
  const a = AI.doctorSummary(R("orange", { reasons: ["x"] }));
  const b = AI.doctorSummary(R("orange", { reasons: ["x"] }));
  assert.deepEqual(a, b);
});
