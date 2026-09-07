/* test/wardsynq-ward-metrics.test.mjs — what is outstanding on the ward, counted. Pure half.
 *
 * node --test test/wardsynq-ward-metrics.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { IN_FLIGHT, summariseWard } from "../functions/_wardsynq/ward-metrics.js";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const stay = (id, patientId, ward, bed) => ({ id, patientId, class: "IPD", status: "in-progress", location: { ward, bed } });
const base = {
  nowMs: NOW,
  encounters: [stay("e1", "p1", "Medical A", "12"), stay("e2", "p2", "Medical A", "14"), stay("e3", "p3", "HDU", "1")],
};

test("it counts the ward's open items and names no patient except the oldest critical", () => {
  const m = summariseWard({
    ...base, ward: "Medical A",
    criticalLoops: [
      { id: "l1", patientId: "p1", display: "Potassium", state: "open", reportedAt: "2026-09-07T09:00:00.000Z" },
      { id: "l2", patientId: "p2", display: "Sodium", state: "open", reportedAt: "2026-09-07T11:50:00.000Z" },
      { id: "l3", patientId: "p1", display: "Lactate", state: "acknowledged", reportedAt: "2026-09-07T08:00:00.000Z" },
    ],
    administrations: [{ id: "a1", patientId: "p1", status: "scanned" }, { id: "a2", patientId: "p2", status: "administered" }],
    handovers: [{ id: "h1", patientId: "p1", receivedBy: null }, { id: "h2", patientId: "p2", receivedBy: "cfa:x" }],
  });
  assert.equal(m.patients, 2, "the HDU stay is not on this ward");
  assert.equal(m.occupiedBeds, 2);
  assert.equal(m.open.criticalResults, 2, "an acknowledged one is not open");
  assert.equal(m.open.criticalResultsEscalated, 1, "the three-hour-old one");
  assert.equal(m.open.dosesInFlight, 1, "a given dose is not in flight");
  assert.equal(m.open.handoversWaiting, 1);

  // The safest ward dashboard cannot leak a diagnosis to whoever glances at the nurses' station.
  // The ONE exception is the oldest unacknowledged critical: "three hours unacknowledged" is not
  // actionable without knowing whose.
  assert.equal(m.oldestUnacknowledgedCritical.patientId, "p1");
  assert.equal(m.oldestUnacknowledgedCritical.display, "Potassium");
  assert.equal(m.oldestUnacknowledgedCritical.escalation.level, "escalate");
  const json = JSON.stringify({ ...m, oldestUnacknowledgedCritical: null });
  assert.ok(!json.includes("p1") && !json.includes("Sodium"), "no other patient or result is named");
});

test("THE HEADLINE IS A SUM OF OPEN ITEMS, not a score", () => {
  const m = summariseWard({
    ...base, ward: "Medical A",
    criticalLoops: [{ id: "l1", patientId: "p1", state: "open", reportedAt: "2026-09-07T11:55:00.000Z" }],
    administrations: [{ id: "a1", patientId: "p1", status: "held" }],
    handovers: [{ id: "h1", patientId: "p2", receivedBy: null }],
    reconciliations: [{ id: "r1", patientId: "p1", encounterId: "e1", stage: "admission", medicines: [
      { key: "warfarin", drug: "Warfarin", decision: "undecided" }, { key: "ramipril", drug: "Ramipril", decision: "continued" },
    ] }],
    orders: [], verifications: [],
  });
  // 1 critical + 1 in-flight + 1 handover + 1 undecided medicine + 1 stay with no history (e2) = 5.
  assert.equal(m.open.medicinesUndecided, 1);
  assert.equal(m.open.staysWithNoMedicationHistory, 1, "e2 has no reconciliation at all");
  assert.equal(m.openItems, 5);
  // It goes down only when somebody does the work: there is nothing here to normalise or weight,
  // and a ward cannot improve it except by finishing something.
  const done = summariseWard({ ...base, ward: "Medical A", criticalLoops: [], administrations: [], handovers: [],
    reconciliations: [
      { id: "r1", patientId: "p1", encounterId: "e1", medicines: [{ key: "a", drug: "A", decision: "continued" }] },
      { id: "r2", patientId: "p2", encounterId: "e2", medicines: [{ key: "b", drug: "B", decision: "stopped", reason: "x" }] },
    ] });
  assert.equal(done.openItems, 0);
});

test("no history taken is counted apart from a history left undecided", () => {
  // Nobody having taken a medicines history is a DIFFERENT failure from one taken and left open,
  // and lumping them together hides the first entirely.
  const m = summariseWard({
    ...base, ward: "Medical A",
    reconciliations: [{ id: "r1", patientId: "p1", encounterId: "e1", medicines: [{ key: "a", drug: "A", decision: "continued" }] }],
  });
  assert.equal(m.open.medicinesUndecided, 0);
  assert.equal(m.open.staysWithNoMedicationHistory, 1);
});

test("an order verified against an OLDER version of itself does not count as verified", () => {
  const orders = [{ id: "rx1", patientId: "p1", status: "active", version: 3 }, { id: "rx2", patientId: "p2", status: "active", version: 1 }];
  const m = summariseWard({
    ...base, ward: "Medical A", orders,
    verifications: [
      { orderId: "rx1", outcome: "verified", orderVersion: 2 },   // stale: the dose changed after
      { orderId: "rx2", outcome: "verified", orderVersion: 1 },
    ],
  });
  assert.equal(m.open.ordersNotPharmacyVerified, 1, "a stale verification is not a verification");
  // A query is not a verification either.
  assert.equal(summariseWard({ ...base, ward: "Medical A", orders, verifications: [{ orderId: "rx1", outcome: "queried", orderVersion: 3 }, { orderId: "rx2", outcome: "verified", orderVersion: 1 }] }).open.ordersNotPharmacyVerified, 1);
});

test("admitted with no bed is its own number, not zero", () => {
  const m = summariseWard({ nowMs: NOW, ward: "Medical A", encounters: [stay("e1", "p1", "Medical A", "12"), stay("e2", "p2", "Medical A", "")] });
  assert.equal(m.patients, 2);
  assert.equal(m.occupiedBeds, 1);
  assert.equal(m.unplaced, 1, "a patient on the ward awaiting a bed is a real state");
});

test("with no ward named it is the whole hospital, and a closed stay never counts", () => {
  const all = summariseWard({ ...base, encounters: [...base.encounters, { id: "e9", patientId: "p9", class: "IPD", status: "finished", location: { ward: "Medical A", bed: "20" } }] });
  assert.equal(all.patients, 3, "the discharged stay is not on the ward");
  assert.equal(all.ward, null);
  // An OPD visit is not an inpatient either.
  assert.equal(summariseWard({ nowMs: NOW, encounters: [{ id: "o1", patientId: "p1", class: "OPD", status: "in-progress", location: {} }] }).patients, 0);
});

test("the states that mean a dose was started and never finished", () => {
  assert.deepEqual([...IN_FLIGHT].sort(), ["dispensed", "held", "ordered", "scanned", "verified"]);
  assert.ok(!IN_FLIGHT.includes("administered"), "a given dose is finished");
  assert.ok(!IN_FLIGHT.includes("refused") && !IN_FLIGHT.includes("cancelled"), "and so is a decided one");
});

test("it is computed, so the clock moves the escalation without anything being rewritten", () => {
  const loops = [{ id: "l1", patientId: "p1", state: "open", reportedAt: "2026-09-07T11:45:00.000Z" }];
  const soon = summariseWard({ ...base, ward: "Medical A", criticalLoops: loops, nowMs: Date.parse("2026-09-07T11:50:00.000Z") });
  assert.equal(soon.open.criticalResultsEscalated, 0);
  const later = summariseWard({ ...base, ward: "Medical A", criticalLoops: loops, nowMs: Date.parse("2026-09-07T13:00:00.000Z") });
  assert.equal(later.open.criticalResultsEscalated, 1, "the same record, an hour later");
  assert.equal(later.computedAt, "2026-09-07T13:00:00.000Z", "and it says when it was computed");
});
