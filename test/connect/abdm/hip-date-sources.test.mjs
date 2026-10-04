// The other HIP record sources and the connector normalizers also give documents and medications a
// CLINICAL date (hip.js#filterRecordByDateRange drops an undated or out-of-window one), never the export
// instant. WardSynQ and FollowCare are covered in wardsynq-abdm-hip-record.test.mjs and hip-serve.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRecordByDateRange } from "../../../functions/_connect/abdm/hip.js";
import { projectTimeline } from "../../../functions/_connect/abdm/hip-sources/native-opd.js";
import { projectInvoiceRecord } from "../../../functions/_connect/abdm/hip-sources/clinic-billing.js";
import { normalizeFhir } from "../../../functions/_connect/connectors/fhir-r4/normalize.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { makeCtx } from "../../../functions/_connect/interfaces.js";
import { buildInvoice } from "../../../functions/_clinic_billing.js";
import { SYNTHETIC } from "../fixtures/fhir-synthetic.mjs";

const D = (iso) => Date.parse(iso);
const EXPORT_NOW = "2026-10-04T00:00:00.000Z";

test("native OPD: the consultation narrative is dated by its latest note, lists every note date, and medications by their entry time", () => {
  const T = (iso) => D(iso);
  const tl = { ticketId: "tkt-1", entries: [
    { ts: T("2026-03-01T10:00:00Z"), kind: "note", text: "first visit" },
    { ts: T("2026-03-05T10:00:00Z"), kind: "medication", text: "Tab A" },
    { ts: T("2026-03-09T10:00:00Z"), kind: "assessment", text: "review" },
  ] };
  const rec = projectTimeline(tl, { tenantId: "t", now: () => EXPORT_NOW });
  assert.equal(rec.documents[0].date, "2026-03-09T10:00:00.000Z");
  assert.deepEqual(rec.documents[0].coversDates, ["2026-03-01T10:00:00.000Z", "2026-03-09T10:00:00.000Z"]);
  assert.equal(rec.medications[0].effectivePeriod.start, "2026-03-05T10:00:00.000Z");
  const whole = filterRecordByDateRange(rec, D("2026-03-01T00:00:00Z"), D("2026-03-31T00:00:00Z")).record;
  assert.deepEqual([whole.documents.length, whole.medications.length], [1, 1]);
  const part = filterRecordByDateRange(rec, D("2026-03-03T00:00:00Z"), D("2026-03-31T00:00:00Z")).record;
  assert.equal(part.documents.length, 0, "the narrative states the 1 March note, which is outside");
  assert.equal(part.medications.length, 1);
});

test("clinic billing: the invoice narrative is dated by the invoice date, not the export instant", () => {
  const row = Object.assign({ id: "inv_1", patientId: "P-1", status: "open", createdAt: D("2026-08-18T09:30:00Z") }, buildInvoice([{ id: "o1", name: "Consult", qty: 1, unitPrice: 50000 }]));
  const rec = projectInvoiceRecord(row, { tenantId: "t", now: () => EXPORT_NOW });
  assert.equal(rec.documents[0].date, "2026-08-18T09:30:00.000Z");
  assert.notEqual(rec.documents[0].date, EXPORT_NOW);
});

test("FHIR R4 connector: a medication's authoredOn / effective[x] reach the record; none stays undated and is dropped", () => {
  const raw = { patient: SYNTHETIC.patient, resources: [
    { resourceType: "MedicationRequest", id: "mr-1", status: "active", medicationCodeableConcept: { text: "Drug A" }, authoredOn: "2026-02-10T00:00:00Z" },
    { resourceType: "MedicationStatement", id: "ms-1", status: "active", medicationCodeableConcept: { text: "Drug B" }, effectivePeriod: { start: "2026-02-12T00:00:00Z" } },
    { resourceType: "MedicationStatement", id: "ms-2", status: "active", medicationCodeableConcept: { text: "Drug C" }, effectiveDateTime: "2026-02-14T00:00:00Z" },
    { resourceType: "MedicationRequest", id: "mr-undated", status: "active", medicationCodeableConcept: { text: "Drug D" } },
    { resourceType: "DocumentReference", id: "dr-1", status: "current", date: "2026-02-11T00:00:00Z", description: "note" },
    { resourceType: "DocumentReference", id: "dr-undated", status: "current", description: "note" },
  ] };
  const b = normalizeFhir(makeCtx(), raw);
  const kept = filterRecordByDateRange(b, D("2026-02-01T00:00:00Z"), D("2026-02-28T00:00:00Z")).record;
  assert.deepEqual(kept.medications.map((m) => m.id), ["mr-1", "ms-1", "ms-2"]);
  assert.deepEqual(kept.documents.map((d) => d.id), ["dr-1"]);
  const late = filterRecordByDateRange(b, D("2026-02-13T00:00:00Z"), D("2026-02-28T00:00:00Z")).record;
  // owner decision 2026-10-04: mr-1 and ms-1 started before 13 Feb but are still active (no end), so they
  // were active inside the window and are shared; only the undated one is still dropped.
  assert.deepEqual(late.medications.map((m) => m.id), ["mr-1", "ms-1", "ms-2"]);
  const after = filterRecordByDateRange(normalizeFhir(makeCtx(), { ...raw, resources: [
    { resourceType: "MedicationStatement", id: "ms-ended", status: "completed", medicationCodeableConcept: { text: "Drug E" }, effectivePeriod: { start: "2026-01-02T00:00:00Z", end: "2026-01-20T00:00:00Z" } },
    { resourceType: "MedicationStatement", id: "ms-ongoing", status: "active", medicationCodeableConcept: { text: "Drug F" }, effectivePeriod: { start: "2026-01-02T00:00:00Z" } }] }),
    D("2026-02-01T00:00:00Z"), D("2026-02-28T00:00:00Z")).record;
  assert.deepEqual(after.medications.map((m) => m.id), ["ms-ongoing"], "an end before the window drops it; an open period keeps it");
});

test("ABDM bundle normalizer: a MedicationRequest's authoredOn and a DocumentReference's date are carried", () => {
  const docBundle = { resourceType: "Bundle", type: "document", entry: [
    { fullUrl: "urn:uuid:c1", resource: { resourceType: "Composition", id: "c1", status: "final", date: "2026-04-01T00:00:00Z", title: "Prescription record",
      type: { coding: [{ system: "http://snomed.info/sct", code: "440545006" }] }, section: [{ title: "Prescription", entry: [{ reference: "urn:uuid:m1" }, { reference: "urn:uuid:doc1" }] }] } },
    { fullUrl: "urn:uuid:m1", resource: { resourceType: "MedicationRequest", id: "m1", status: "active", intent: "order", authoredOn: "2026-04-02T00:00:00Z", medicationCodeableConcept: { text: "Drug" } } },
    { fullUrl: "urn:uuid:doc1", resource: { resourceType: "DocumentReference", id: "doc1", status: "current", date: "2026-04-03T00:00:00Z", content: [{ attachment: { title: "scan", contentType: "application/pdf" } }] } },
  ] };
  const b = normalizeNdhm(makeCtx(), docBundle);
  assert.equal(b.medications.find((m) => m.id === "m1").effectivePeriod.start, "2026-04-02T00:00:00Z");
  assert.equal(b.documents.find((d) => d.id === "doc1").date, "2026-04-03T00:00:00Z");
});
