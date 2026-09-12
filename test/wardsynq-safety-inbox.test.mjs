import { test, mock } from "node:test";
import assert from "node:assert/strict";

let writeScope = null;
let store = new Map();
let failFor = new Set();

mock.module(new URL("../functions/_wardsynq/actor.js", import.meta.url).href, {
  namedExports: {
    resolveClinicalActor: async () => ({
      actor: { id: "dr.a@x.test", scope: { write: writeScope, read: null } },
      tenant: {}, role: "doctor", source: "opd",
    }),
  },
});
mock.module(new URL("../functions/_wardsynq/service.js", import.meta.url).href, {
  namedExports: {
    RecordService: class {
      async byPatient(type, patientId) {
        if (failFor.has(patientId)) throw new Error("read failed");
        return [...store.values()].filter((r) => r.resourceType === type && r.patientId === patientId);
      }
      async get() { return null; }
    },
    /* chart-completion.js reaches for these off the same module; a mock that omits them fails to
     * link rather than failing an assertion, which is a far more confusing way to be wrong. */
    isExternalRecord: () => false,
    externallyOwned: () => false,
    RESOURCE_TYPES: [],
    MODE: { NATIVE: "native" },
    NATIVE_SYSTEM: "wardsynq-native",
  },
});

const M = await import("../functions/_wardsynq/safety-inbox.js");

const CTX = { migration: { mode: "native", tenantId: "t1" }, recordDeps: {}, actorDeps: {} };
const NOW = "2026-09-13T12:00:00.000Z";
const ward = (n) => Array.from({ length: n }, (_, i) => ({ patientId: "p" + i, name: "Patient " + i, mrn: "M" + i, ward: "A", bed: String(i) }));

function reset() {
  store = new Map(); failFor = new Set();
}
function addCritical(patientId, id, opts = {}) {
  store.set(id, {
    resourceType: "CriticalResultLoop", id, patientId,
    code: "K", display: "Potassium", value: 6.9, unit: "mmol/L",
    state: opts.state || "open", reportedAt: opts.reportedAt || "2026-09-13T09:00:00.000Z",
  });
}

/* ---- the pure pieces -------------------------------------------------------------------------- */

test("an item goes to the role the hospital said owns it", () => {
  assert.deepEqual(M.ownersOf({ type: "unsigned-notes", responsibleRole: "pharmacy" }), ["pharmacy"]);
  // Falling back to the default only when the hospital has not said.
  assert.deepEqual(M.ownersOf({ type: "unsigned-notes" }), ["doctor"]);
});

test("an item nobody owns is shown to EVERYBODY, never to nobody", () => {
  const orphan = { type: "something-new" };
  assert.deepEqual(M.ownersOf(orphan), []);
  assert.equal(M.forRole(orphan, "nurse"), true);
  assert.equal(M.forRole(orphan, "doctor"), true);
});

test("a role filter narrows, and no role asked means everything", () => {
  const nursing = { type: "handover" };
  assert.equal(M.forRole(nursing, "nurse"), true);
  assert.equal(M.forRole(nursing, "doctor"), false);
  assert.equal(M.forRole(nursing, ""), true);
});

test("the list is ordered most urgent first, then oldest first", () => {
  const out = M.sortItems([
    { type: "a", escalation: { level: "due" }, since: "2026-09-01" },
    { type: "b", escalation: { level: "escalate" }, since: "2026-09-10" },
    { type: "c", escalation: { level: "overdue" }, since: "2026-09-05" },
    { type: "d", escalation: { level: "escalate" }, since: "2026-09-02" },
  ]);
  assert.deepEqual(out.map((i) => i.type), ["d", "b", "c", "a"]);
});

/* ---- the inbox -------------------------------------------------------------------------------- */

test("an unacknowledged critical result reaches the inbox even with no rules configured", async () => {
  reset();
  addCritical("p0", "loop1");
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: ward(2), rules: null, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].type, "critical-result");
  assert.match(r.items[0].detail, /Potassium 6\.9 mmol\/L/);
  assert.match(r.items[0].detail, /nobody has acknowledged this yet/);
  // And the hospital is told why the rest of the list is thin.
  assert.match(r.note, /no chart-completion rules/);
});

test("an acknowledged critical is not outstanding", async () => {
  reset();
  addCritical("p0", "loop1", { state: "acknowledged" });
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: ward(2), now: NOW });
  assert.equal(r.items.length, 0);
});

test("the item names the patient, so the list can be worked without opening charts", async () => {
  reset();
  addCritical("p1", "loop1");
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: ward(3), now: NOW });
  assert.equal(r.items[0].patient.patientId, "p1");
  assert.equal(r.items[0].patient.name, "Patient 1");
  assert.equal(r.items[0].patient.bed, "1");
});

test("A PATIENT WHO COULD NOT BE CHECKED IS NAMED, and the list says it is incomplete", async () => {
  reset();
  addCritical("p0", "loop1");
  failFor.add("p2");
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: ward(4), now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].patientId, "p2");
  assert.match(r.warning, /incomplete/);
  assert.match(r.warning, /do not read it as a quiet ward/);
});

test("A WARD LARGER THAN THE CAP SAYS SO rather than returning a short list that reads as quiet", async () => {
  reset();
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: ward(M.SCAN_CAP + 5), now: NOW });
  assert.equal(r.truncated, true);
  assert.equal(r.scanned, M.SCAN_CAP);
  assert.match(r.warning, /Only the first/);
  assert.match(r.warning, /do not read it as a quiet ward/);
});

test("a ward within the cap is not marked truncated", async () => {
  reset();
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: ward(3), now: NOW });
  assert.equal(r.truncated, undefined);
  assert.equal(r.scanned, 3);
});

test("the role filter narrows this inbox but the ward total still counts everything", async () => {
  reset();
  addCritical("p0", "loop1");   // owned by doctor AND nurse by default
  const doctor = await M.safetyInbox({}, {}, { ...CTX, patients: ward(2), role: "doctor", now: NOW });
  const pharmacy = await M.safetyInbox({}, {}, { ...CTX, patients: ward(2), role: "pharmacy", now: NOW });

  assert.equal(doctor.items.length, 1);
  assert.equal(pharmacy.items.length, 0, "a critical result is not the pharmacist's to acknowledge");
  // But the pharmacist can still see the ward is not quiet.
  assert.equal(pharmacy.totalOnWard, 1);
});

test("counts are of THIS role's items, not the ward's", async () => {
  reset();
  addCritical("p0", "loop1");
  addCritical("p1", "loop2");
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: ward(2), role: "pharmacy", now: NOW });
  assert.equal(r.escalated, 0);
  assert.equal(r.overdue, 0);
  assert.equal(r.totalOnWard, 2);
});

test("an empty ward is an empty inbox, not an error", async () => {
  reset();
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: [], now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
  assert.equal(r.scanned, 0);
});

test("a hospital that is not WardSynQ-native is skipped, never errored", async () => {
  reset();
  const r = await M.safetyInbox({}, {}, { migration: { mode: "off" }, patients: ward(2) });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "off");
});

test("a malformed roster entry is ignored rather than crashing the whole inbox", async () => {
  reset();
  addCritical("p0", "loop1");
  const r = await M.safetyInbox({}, {}, { ...CTX, patients: [null, { name: "no id" }, ...ward(1)], now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.scanned, 1);
  assert.equal(r.items.length, 1);
});
