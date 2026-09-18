/* test/wardsynq-no-silent-empty-chart.test.mjs - R6-2: a read that FAILED never renders as a read
 * that came back empty.
 *
 * The bug this pins: every clinical read below was written `.catch(() => [])`, so a store hiccup
 * printed "No allergies are recorded for you" on the page a patient carries to the next hospital,
 * dropped a whole section off the chart check that a records officer signs against, and read a
 * patient's pre-authorisations as none recorded. R5-1 fixed the same swallow in break-glass.js and
 * migrate-inpatient.js; this is the same pattern applied to the chart, the chart check and the
 * pre-authorisation list.
 *
 * RecordService and the actor resolver are mocked so a NAMED resource type can be made to fail while
 * the others answer - which is the only way to see the difference between null and []. Authorization
 * itself is not what is under test here and is pinned where it is enforced (the router's capFor map,
 * test/neg-auth-ward-sensitive.test.mjs and test/neg-auth-remaining-routes.test.mjs).
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-no-silent-empty-chart.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const REAL_SERVICE = await import("../functions/_wardsynq/service.js");
const REAL_ACTOR = await import("../functions/_wardsynq/actor.js");

/* One store for every module under test. `fault` names the types whose read throws - a store that
 * answers some types and refuses others is exactly the state the swallowed catch used to hide. */
const store = { rows: {}, fault: new Set(), written: [] };
class StubService {
  async get(type, id) {
    if (store.fault.has(type)) throw new Error("store unavailable: " + type);
    return (store.rows[type] || []).find((r) => r.id === id) || null;
  }
  async byPatient(type, patientId) {
    if (store.fault.has(type)) throw new Error("store unavailable: " + type);
    return (store.rows[type] || []).filter((r) => r.patientId === patientId);
  }
  async history(type, id) { return (store.rows[type] || []).filter((r) => r.id === id); }
  async listAll(type) { return { rows: store.rows[type] || [], truncated: false }; }
  async listByStatus(type) { return store.rows[type] || []; }
  async put(record) { store.written.push(record); return { record: { ...record, version: 1 } }; }
}
mock.module("../functions/_wardsynq/service.js", { namedExports: { ...REAL_SERVICE, RecordService: StubService } });
mock.module("../functions/_wardsynq/actor.js", {
  namedExports: {
    ...REAL_ACTOR,
    resolveClinicalActor: async () => ({ tenant: { id: "t1" }, actor: { id: "dr-a" }, role: "doctor", source: "test" }),
  },
});

const { assemble, statements, clinicianWarnings, patientCopy, releaseToPatient } = await import("../functions/_wardsynq/patient-record.js");
const { chartCompletionQueue } = await import("../functions/_wardsynq/chart-completion.js");
const { claimsForPatient } = await import("../functions/_wardsynq/billing.js");

const PID = "pat-1";
const REQ = new Request("https://x/api/queue/ward/patient-copy");
const CTX = () => ({ migration: { mode: "native", tenantId: "t1" }, patientId: PID, actorDeps: {}, recordDeps: {} });

function seed() {
  store.fault = new Set();
  store.written = [];
  store.rows = {
    Patient: [{ id: PID, name: "A Patient", mrn: "MRN-1" }],
    Condition: [{ id: "c1", patientId: PID, code: "E11", display: "Type 2 diabetes", verificationStatus: "confirmed" }],
    AllergyIntolerance: [{ id: "a1", patientId: PID, substance: "Penicillin", reaction: "anaphylaxis", criticality: "high" }],
    MedicationOrder: [{ id: "m1", patientId: PID, drug: "Metformin", status: "active" }],
    DiagnosticReport: [{ id: "rep-1", patientId: PID, code: "Renal profile", status: "final", reportedAt: "2026-09-08T09:00:00.000Z" }],
    CriticalResultLoop: [],
    Appointment: [{ id: "ap-1", patientId: PID, startsAt: "2026-10-01T09:00:00.000Z" }],
    ClinicalNote: [],
  };
}

test("a chart section that could not be read is null and named, never an empty list", async () => {
  seed();
  store.fault.add("AllergyIntolerance");
  const doc = await assemble(new StubService(), PID, []);

  /* THE WHOLE POINT. [] would print "No allergies are recorded for you" on a page a patient carries
   * to the next hospital, off a read that never happened. */
  assert.equal(doc.allergies, null);
  assert.deepEqual(doc.unreadableTypes, ["AllergyIntolerance"]);
  // The types that DID answer are unaffected: one failure does not blank the chart.
  assert.equal(doc.diagnoses.length, 1);
  assert.equal(doc.medicines.length, 1);

  const say = statements(doc);
  assert.ok(say.some((s) => /could not be read/.test(s)), "the patient is told the page may be missing something");
  assert.ok(!say.some((s) => /no allergies/i.test(s)));
  const warn = clinicianWarnings(true, doc.unreadableTypes);
  assert.equal(warn.length, 1);
  assert.match(warn[0], /AllergyIntolerance could not be read/);
});

test("with the critical-result loops unreadable, NO result is released", async () => {
  seed();
  store.rows.CriticalResultLoop = [{ id: "l1", patientId: PID, state: "open", reportId: "rep-1" }];
  store.fault.add("CriticalResultLoop");
  const doc = await assemble(new StubService(), PID, []);
  /* A report is releasable only if no OPEN loop covers it. Unreadable loops used to mean "no loops",
   * which hands the patient the potassium of 7.2 this file's header is about. */
  assert.equal(doc.results, null);
  assert.equal(doc.withheldResults, null);
  assert.deepEqual(doc.unreadableTypes, ["CriticalResultLoop"]);
  assert.ok(statements(doc).some((s) => /results could not be read/.test(s)));
});

test("the patient-copy screen is given the unreadable types; the diagnoses are not counted from a list nobody read", async () => {
  seed();
  store.fault.add("Condition");
  const r = await patientCopy(REQ, {}, { ...CTX(), neverRelease: ["HIV serology"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unreadableTypes, ["Condition"]);
  assert.equal(r.document.diagnoses, null);
  // "we left three things out" and "there was nothing else" are different statements; neither is known here.
  assert.equal(r.document.excludedDiagnoses, null);
  assert.ok(r.clinicianWarnings.some((s) => /Condition could not be read/.test(s)));
});

test("A HANDOVER IS NOT RECORDED OFF A CHART THAT COULD NOT BE READ", async () => {
  seed();
  store.fault.add("AllergyIntolerance");
  const r = await releaseToPatient(REQ, {}, CTX());
  /* The receipt records allergyCount. Zero, taken from a read that failed, is a written and
   * answerable statement that this patient was handed a page with no allergies on it. */
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.error, "record_read_failed");
  assert.deepEqual(r.unreadableTypes, ["AllergyIntolerance"]);
  assert.equal(r.written, 0);
  assert.equal(store.written.length, 0, "nothing is written when the chart could not be read");

  // The same handover goes through once the store answers.
  seed();
  const ok = await releaseToPatient(REQ, {}, CTX());
  assert.equal(ok.ok, true);
  assert.equal(ok.written, 1);
  assert.equal(store.written[0].allergyCount, 1);
});

test("a chart check that could not run is UNKNOWN, not a chart with nothing outstanding", async () => {
  seed();
  store.rows.ClinicalNote = [{ id: "n1", patientId: PID, noteType: "ward-round", submittedAt: "2026-09-08T09:00:00.000Z" }];
  store.rows.SurgicalCase = [{ id: "s1", patientId: PID, stage: "signed-out", signedOutAt: "2026-09-08T09:00:00.000Z" }];
  store.fault.add("ClinicalNote");
  const rules = { "unsigned-notes": { responsibleRole: "doctor", dueAfterHours: 24 }, "operative-documentation": { responsibleRole: "surgeon", dueAfterHours: 24 } };
  const r = await chartCompletionQueue(REQ, {}, { ...CTX(), rules });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unknownSections.map((u) => u.type), ["unsigned-notes"]);
  assert.match(r.unknownSections[0].reason, /store unavailable/);
  // The type that could be read still runs: one failed section does not lose the rest of the check.
  assert.deepEqual(r.items.map((i) => i.type), ["operative-documentation"]);

  seed();
  store.rows.SurgicalCase = [];
  const clean = await chartCompletionQueue(REQ, {}, { ...CTX(), rules });
  assert.deepEqual(clean.unknownSections, [], "a chart that really is clean says nothing is unknown");
});

test("pre-authorisations that could not be read are null, and every payer rule that turns on one says it is unchecked", async () => {
  seed();
  store.rows.Claim = [{ id: "cl-1", patientId: PID, payerId: "pay-1", submittedAmount: 90000, at: "2026-09-08T09:00:00.000Z" }];
  store.rows.PreAuthorisation = [];
  store.fault.add("PreAuthorisation");
  const payers = [{ id: "pay-1", name: "A Payer", rules: { preauthRequiredAbove: 50000 } }];
  const r = await claimsForPatient(REQ, {}, { ...CTX(), payers });
  assert.equal(r.ok, true);
  assert.equal(r.preAuthorisations, null, "null is a list that could not be read; [] would be a patient with none");
  assert.equal(r.preAuthsUnreadable, true);
  const warnings = r.payerWarnings["cl-1"];
  assert.ok(warnings.some((w) => /unchecked/.test(w)));
  assert.ok(!warnings.some((w) => /no approved pre-authorisation is recorded/.test(w)), "never stated as a fact off a read that failed");
});
