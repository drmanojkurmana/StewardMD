/* test/wardsynq-no-silent-empty-boards.test.mjs - R6-2, the other half: a faulted read on the
 * laboratory board, the phlebotomy list and an outbound HL7 message REFUSES, and never answers with
 * an empty one.
 *
 * Each of these was a `.catch(() => [])` on a read whose emptiness means something clinical: "nothing
 * has been resulted" puts an answered order back on the bench, "nothing has been collected" sends a
 * phlebotomist to a patient already bled, and an ORU with no OBX segments is filed by the receiving
 * system as a report with no results. The surrounding code already returned a 502 for exactly this;
 * the swallow was what stopped the failure reaching it.
 *
 * Same mocked RecordService as test/wardsynq-no-silent-empty-chart.test.mjs, so a named type can be
 * made to fail while the others answer.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-no-silent-empty-boards.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const REAL_SERVICE = await import("../functions/_wardsynq/service.js");
const REAL_ACTOR = await import("../functions/_wardsynq/actor.js");

const store = { rows: {}, fault: new Set() };
class StubService {
  async get(type, id) {
    if (store.fault.has(type)) throw new Error("store unavailable: " + type);
    return (store.rows[type] || []).find((r) => r.id === id) || null;
  }
  async byPatient(type, patientId) {
    if (store.fault.has(type)) throw new Error("store unavailable: " + type);
    return (store.rows[type] || []).filter((r) => r.patientId === patientId);
  }
  async listByStatus(type) {
    if (store.fault.has(type)) throw new Error("store unavailable: " + type);
    return store.rows[type] || [];
  }
  async listAll(type) { return { rows: store.rows[type] || [], truncated: false }; }
  async put(record) { return { record: { ...record, version: 1 } }; }
}
mock.module("../functions/_wardsynq/service.js", { namedExports: { ...REAL_SERVICE, RecordService: StubService } });
mock.module("../functions/_wardsynq/actor.js", {
  namedExports: {
    ...REAL_ACTOR,
    resolveClinicalActor: async () => ({ tenant: { id: "t1" }, actor: { id: "dr-a" }, role: "doctor", source: "test" }),
  },
});

const { pendingRequests } = await import("../functions/_wardsynq/lab-result.js");
const { collectionList } = await import("../functions/_wardsynq/specimen.js");
const { oruForReport } = await import("../functions/_wardsynq/hl7v2.js");

const PID = "pat-1";
const REQ = new Request("https://x/api/queue/ward/lab-pending");
const CTX = () => ({ migration: { mode: "native", tenantId: "t1" }, patientId: PID, actorDeps: {}, recordDeps: {} });
const ORDER = { id: "sr-1", patientId: PID, code: "U+E", display: "U+E", status: "active", category: "laboratory" };

function seed() {
  store.fault = new Set();
  store.rows = {
    ServiceRequest: [{ ...ORDER }],
    DiagnosticReport: [{ id: "rep-1", patientId: PID, serviceRequestId: "sr-1", status: "final" }],
    SpecimenCollection: [{ id: "sp-1", patientId: PID, serviceRequestId: "sr-1", state: "collected" }],
    Observation: [{ id: "ob-1", patientId: PID, code: "Na", value: 140 }],
  };
}

test("a faulted report read does not put already-answered orders back on the laboratory bench", async () => {
  seed();
  store.fault.add("DiagnosticReport");
  const r = await pendingRequests(REQ, {}, CTX());
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.error, "record_read_failed");
  assert.deepEqual(r.pending, []);

  /* The state the refusal above must never be confused with: the store answered, the order is
   * resulted, and nothing is owed. Same empty list, entirely different fact - which is why one of
   * them carries ok:false. */
  seed();
  const ok = await pendingRequests(REQ, {}, CTX());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.pending, []);
});

test("a faulted specimen read does not send a phlebotomist back to a patient already bled", async () => {
  seed();
  store.fault.add("SpecimenCollection");
  const r = await collectionList(REQ, {}, CTX());
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.error, "record_read_failed");
  assert.deepEqual(r.requests, []);

  seed();
  const ok = await collectionList(REQ, {}, CTX());
  assert.equal(ok.ok, true);
  assert.equal(ok.requests.length, 1);
  assert.equal(ok.requests[0].collection.state, "collected", "the specimen that WAS read is on the list as collected");
});

test("an ORU is refused rather than sent with no results for a report that released some", async () => {
  seed();
  store.rows.DiagnosticReport = [{ id: "rep-1", patientId: PID, code: "U+E", status: "final", resultObservationIds: ["ob-1"], reportedAt: "2026-09-08T09:00:00.000Z" }];
  store.fault.add("Observation");
  const ctx = { migration: { mode: "native", tenantId: "t1" }, reportId: "rep-1", actorDeps: {}, recordDeps: {} };
  const r = await oruForReport(REQ, {}, ctx);
  // A receiving system files an ORU with no OBX as a report with no results. It is not sent short.
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.error, "record_read_failed");
  assert.equal(r.message, null);
});
