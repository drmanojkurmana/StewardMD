/* The pure rules of the support services: diet validation and what may be served when, the steriliser release
 * rule and recall scope, housekeeping turnaround, vehicle fitness and the mortuary release checklist. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dietOrderFrom, dietAt, mealInstant } from "../functions/_wardsynq/diet.js";
import { loadRelease, recallScope, setFrom } from "../functions/_wardsynq/cssd.js";
import { turnaround, boardTasks, bedTaskId } from "../functions/_wardsynq/housekeeping.js";
import { vehicleFitness } from "../functions/_wardsynq/ambulance.js";
import { releaseMissing, mlcOf } from "../functions/_wardsynq/mortuary.js";

test("diet: one consistency for an oral diet, NBM alone or as a closed window, a tube feed needs its regimen", () => {
  assert.equal(dietOrderFrom({ types: ["diabetic"] }).error, "consistency_required");
  assert.equal(dietOrderFrom({ types: ["normal", "soft"] }).error, "consistency_required");
  assert.equal(dietOrderFrom({ types: ["tube-feed", "soft"] }).error, "tube_feed_with_oral");
  assert.equal(dietOrderFrom({ types: ["tube-feed", "renal"], tubeFeed: { route: "NG" } }).error, "regimen_required");
  assert.equal(dietOrderFrom({ types: ["nbm"], nbm: { from: "2026-09-16T18:30:00Z" } }).error, "nbm_reason_required");
  assert.equal(dietOrderFrom({ types: ["soft"], nbm: { from: "2026-09-16T18:30:00Z", reason: "OT" } }).error, "nbm_until_required");
  assert.equal(dietOrderFrom({ types: ["pizza"] }).error, "unknown_diet_type");
  assert.ok(dietOrderFrom({ types: ["tube-feed", "renal"], tubeFeed: { route: "PEG", regimen: "200 mL 4-hourly" } }).order);
});

test("diet: what the kitchen may serve at an instant", () => {
  const o = { version: 2, status: "active", ...dietOrderFrom({ types: ["soft"], nbm: { from: "2026-09-17T00:00:00Z", until: "2026-09-17T12:00:00Z", reason: "OT" } }).order };
  assert.equal(dietAt(o, Date.parse("2026-09-16T19:00:00Z")).state, "diet", "dinner before the NBM window");
  assert.equal(dietAt(o, Date.parse("2026-09-17T07:00:00Z")).state, "nbm", "breakfast inside it");
  assert.equal(dietAt(o, Date.parse("2026-09-17T13:00:00Z")).state, "diet", "the diet resumes after it");
  const nbm = { status: "active", ...dietOrderFrom({ types: ["nbm"], nbm: { from: "2026-09-17T00:00:00Z", until: "2026-09-18T00:00:00Z", reason: "OT" } }).order };
  assert.equal(dietAt(nbm, Date.parse("2026-09-18T01:00:00Z")).state, "no-diet", "after NBM alone there is no diet, never a guessed one");
  assert.equal(dietAt(null, 0).state, "no-diet");
  assert.equal(dietAt({ ...o, status: "stopped" }, 0).state, "stopped");
  assert.equal(mealInstant("2026-09-16", "lunch", { lunch: "12:30" }, 330), Date.parse("2026-09-16T07:00:00Z"));
  assert.equal(mealInstant("2026-09-16", "tea", { lunch: "12:30" }, 330), null);
});

test("CSSD: release needs CI pass and BI pass, or a recorded release without BI; recall names what a load reached", () => {
  assert.equal(loadRelease({ chemicalIndicator: "pass", biologicalIndicator: "pending" }).reason, "biological_indicator_pending");
  assert.equal(loadRelease({ chemicalIndicator: "pass", biologicalIndicator: "pass" }).ok, true);
  assert.equal(loadRelease({ chemicalIndicator: "pass", biologicalIndicator: "not-used" }).ok, false);
  assert.equal(loadRelease({ chemicalIndicator: "pass", biologicalIndicator: "not-used", releasedWithoutBi: { by: "x" } }).withoutBi, true);
  assert.equal(loadRelease({ chemicalIndicator: "fail", biologicalIndicator: "pass" }).reason, "load_failed");
  const scope = recallScope("L1", [
    { id: "a", state: "stored", setName: "A", sterilised: { loadId: "L1" } },
    { id: "b", state: "issued", setName: "B", sterilised: { loadId: "L1" }, issued: { to: "OT", caseId: "k1", patientId: "p1" } },
    { id: "c", state: "stored", setName: "C", sterilised: { loadId: "L2" } },
  ]);
  assert.deepEqual(scope.cycles, ["a", "b"]);
  assert.deepEqual(scope.reached.map((r) => r.caseId), ["k1"]);
  assert.equal(setFrom({ name: "S", items: [{ name: "x", count: 0 }] }).error, "bad_item");
});

test("housekeeping: a cleaning bed is an open task at once; turnaround is measured and leaves untimed tasks out", () => {
  const beds = [{ id: "b1", wardId: "w", name: "1", state: "cleaning", stateSince: 1000, active: true }, { id: "b2", wardId: "w", name: "2", state: "available", active: true }];
  const tasks = boardTasks(beds, [{ id: "w", name: "Medical A" }], [], 2000);
  assert.deepEqual(tasks.map((t) => [t.id, t.virtual, t.wardName]), [[bedTaskId(beds[0]), true, "Medical A"]]);
  const r = turnaround([
    { state: "inspected", kind: "bed-clean", wardName: "A", requestedAt: "2026-09-16T10:00:00Z", finishedAt: "2026-09-16T10:30:00Z", inspectedAt: "2026-09-16T10:45:00Z" },
    { state: "inspected", kind: "bed-clean", wardName: "A", requestedAt: null, finishedAt: "2026-09-16T11:00:00Z", inspectedAt: "2026-09-16T11:10:00Z" },
    { state: "finished", kind: "spill", requestedAt: "2026-09-16T10:00:00Z" },
  ], Date.parse("2026-09-16T00:00:00Z"), Date.parse("2026-09-17T00:00:00Z"));
  assert.equal(r.inspected, 2);
  assert.deepEqual([r.byKind[0].toFinished.medianMinutes, r.byKind[0].toInspected.medianMinutes, r.byKind[0].untimed], [30, 45, 1]);
});

test("ambulance fitness and the mortuary release checklist", () => {
  const now = Date.parse("2026-09-16T00:00:00Z");
  assert.deepEqual(vehicleFitness({ fitnessExpiry: "2026-09-15", insuranceExpiry: "2026-10-01" }, now), { ok: false, expired: ["fitnessExpiry"], dueSoon: ["insuranceExpiry"] });
  assert.equal(vehicleFitness({ fitnessExpiry: "2027-01-01", insuranceExpiry: "2027-01-01", active: false }, now).ok, false);
  assert.deepEqual(mlcOf({ mlc: false }, { medicoLegal: true }), { flag: true, source: "Encounter.medicoLegal" });
  assert.deepEqual(mlcOf({}, null), { flag: null, source: null });
  const full = { to: "police", receiverName: "SI Rao", idProofType: "police-id", idProofNumber: "123", bodyIdentified: true, documents: { deathCertificate: true, policeNoc: true, postMortemReport: true } };
  assert.deepEqual(releaseMissing({ mlc: { flag: true }, postMortem: { required: "yes" }, belongings: [] }, full), []);
  assert.deepEqual(releaseMissing({ mlc: { flag: true }, postMortem: { required: "yes" }, belongings: [] }, { ...full, documents: { deathCertificate: true } }), ["police_noc", "post_mortem_report"]);
});
