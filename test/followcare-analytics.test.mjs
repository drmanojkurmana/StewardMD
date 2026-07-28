// FollowCare AI — Phase 3 Hospital Command Center analytics unit tests (pure).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });
load("followcare-analytics.js");
const A = globalThis.FollowCareAnalytics;
const NOW = Date.UTC(2026, 6, 15, 9, 0, 0), DAY = 86400000;

const eps = [
  { episodeId: "1", disease: "Pneumonia", specialty: "Respiratory", status: "escalated", escalation: "red", risk: "very_high", riskPercent: 90, score: 38, needsReview: true, nextDueMs: NOW + DAY, lastDayDone: 3, createdMs: NOW - 3 * DAY },
  { episodeId: "2", disease: "Pneumonia", specialty: "Respiratory", status: "active", escalation: "orange", risk: "moderate", riskPercent: 50, score: 56, appointment: "earlier_review", nextDueMs: NOW + 2 * DAY, lastDayDone: 2, createdMs: NOW - 4 * DAY },
  { episodeId: "3", disease: "Pneumonia", specialty: "Respiratory", status: "recovered", escalation: "green", risk: "low", riskPercent: 10, score: 92, recoveredMs: NOW - 12 * 3600000, createdMs: NOW - 11 * DAY, lastDayDone: 14 },
  { episodeId: "4", disease: "Heart Failure", specialty: "Cardiology", status: "recovered", escalation: "green", risk: "low", riskPercent: 12, score: 88, recoveredMs: NOW - 10 * DAY, createdMs: NOW - 40 * DAY, lastDayDone: 30 },
  { episodeId: "5", disease: "Heart Failure", specialty: "Cardiology", status: "active", escalation: "yellow", risk: "moderate", riskPercent: 48, score: 70, appointment: "teleconsult", nextDueMs: NOW + DAY, lastDayDone: 5, createdMs: NOW - 5 * DAY },
];

test("commandCenter: counts active / need-review / high-risk / teleconsult / recovered-today", () => {
  const c = A.commandCenter(eps, NOW);
  assert.equal(c.active, 3);            // escalated + 2 active
  assert.equal(c.highRisk, 1);          // episode 1 (90%)
  assert.equal(c.needReview, 2);        // red + orange
  assert.ok(c.teleconsultSuggested >= 1);   // ep5 (yellow + teleconsult)
  assert.equal(c.recoveredToday, 1);    // episode 3 recovered 12h ago
});

test("smartQueue: sickest first (red, then orange, then risk)", () => {
  const ids = A.smartQueue(eps).map(e => e.episodeId);
  assert.equal(ids[0], "1");            // red
  assert.equal(ids[1], "2");            // orange
});

test("rollup: status + review + critical + high-risk", () => {
  const r = A.rollup(eps);
  assert.equal(r.total, 5);
  assert.equal(r.recovered, 2);
  assert.equal(r.critical, 1);          // one red
  assert.equal(r.highRisk, 1);
});

test("byDepartment: groups by specialty", () => {
  const d = A.byDepartment(eps);
  assert.equal(d.Respiratory.total, 3);
  assert.equal(d.Cardiology.total, 2);
});

test("byDisease: recovered % + avg recovery days", () => {
  const dz = A.byDisease(eps);
  assert.equal(dz.Pneumonia.total, 3);
  assert.equal(dz.Pneumonia.recovered, 1);
  assert.equal(dz.Pneumonia.recoveredPct, 33);
  assert.ok(dz["Heart Failure"].avgRecoveryDays === 30);   // ep4: created 40d ago, recovered 10d ago = 30d
});

test("quality: completion + escalation rate; readmission is null (needs ADT feed)", () => {
  const q = A.quality(eps);
  assert.equal(q.followUpCompletionPct, 40);   // 2 of 5 terminal
  assert.ok(q.escalationRatePct >= 40);
  assert.equal(q.readmission7dPct, null);
  assert.match(q._note, /ADT/);
});

test("executive: top-line index + engagement, readmissionReduction null", () => {
  const e = A.executive(eps);
  assert.ok(e.patientEngagementPct >= 80);     // all have a completed check-in
  assert.equal(e.readmissionReductionPct, null);
});

test("insights: templated, decision-support strings", () => {
  const big = [];
  for (let i = 0; i < 6; i++) big.push({ disease: "Pneumonia", specialty: "Respiratory", status: "active", escalation: "orange", risk: "high", riskPercent: 75, createdMs: NOW });
  const ins = A.insights(big);
  assert.ok(ins.some(s => /Pneumonia/.test(s)));
  assert.ok(A.insights([]).length >= 1);       // never empty
});

test("digest: morning summary numbers", () => {
  const d = A.digest(eps, NOW);
  assert.equal(d.highRisk, 1);
  assert.equal(d.newRecoveries, 1);
});

test("benchmark: this-vs-last deltas", () => {
  const b = A.benchmark(eps, eps.slice(0, 2));
  assert.equal(typeof b.followUpCompletion.now, "number");
  assert.ok("delta" in b.avgRecoveryDays);
});

test("csv: header + non-PHI rows only (no phone/name)", () => {
  const c = A.csv(eps);
  assert.match(c.split("\n")[0], /episodeId,disease,specialty,status/);
  assert.equal(c.split("\n").length, 6);       // header + 5
  assert.ok(!/phone|name|mrn/i.test(c));
});
