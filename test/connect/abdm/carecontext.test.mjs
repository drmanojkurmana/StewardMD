// The care-context model. Two ABDM rules are load-bearing here and both are enforced by tests:
// the HIE-CM is data-blind (no clinical detail in a display), and a linked context can never be
// unlinked, so a reference must be stable and resolvable forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HI_TYPES, SOURCE_MODE, sourceModeFor, canServeAsHip, careContextRef, parseCareContextRef,
  careContextDisplay, assertDataBlind, hiTypesForVisit, careContextForVisit, patientCareContexts,
  CareContextError,
} from "../../../functions/_connect/abdm/carecontext.js";

// ── deployment modes (docs/queue/opd-platform-architecture.md §8) ───────────────────────────────────
test("a hospital with a wired EMR connector is served by fetching from that EMR", () => {
  assert.equal(sourceModeFor({ connectorId: "ghis" }), SOURCE_MODE.CONNECTED);
  assert.equal(sourceModeFor({ connectorId: "fhir-r4" }), SOURCE_MODE.CONNECTED);
  assert.equal(canServeAsHip({ connectorId: "ghis" }), true);
});

test("a clinic with no EMR is served from StewardMD's own store", () => {
  assert.equal(sourceModeFor({}), SOURCE_MODE.NATIVE);
  assert.equal(sourceModeFor({ connectorId: "none" }), SOURCE_MODE.NATIVE);
  assert.equal(canServeAsHip({}), true);
});

test("a local-first clinic EMR CANNOT act as a HIP - the server cannot read those records", () => {
  // Shared/Personal Clinic EMR is end-to-end encrypted to the doctor's devices; no server-side
  // process can build a FHIR bundle for it, so it must never be advertised as servable.
  assert.equal(sourceModeFor({ clinicMode: "shared" }), SOURCE_MODE.LOCAL_ONLY);
  assert.equal(sourceModeFor({ clinicMode: "personal" }), SOURCE_MODE.LOCAL_ONLY);
  assert.equal(canServeAsHip({ clinicMode: "shared" }), false);
});

test("a wired connector wins over a clinic flag - the EMR is authoritative when present", () => {
  assert.equal(sourceModeFor({ connectorId: "ghis", clinicMode: "shared" }), SOURCE_MODE.CONNECTED);
});

// ── references ──────────────────────────────────────────────────────────────────────────────────────
test("references round-trip and are namespaced by visit kind", () => {
  assert.equal(careContextRef({ kind: "opd", id: "visit-123" }), "OPD:visit-123");
  assert.equal(careContextRef({ kind: "ipd", id: "adm-9" }), "IPD:adm-9");
  assert.deepEqual(parseCareContextRef("OPD:visit-123"), { kind: "opd", id: "visit-123" });
  assert.equal(parseCareContextRef("nonsense"), null);
});

test("an unresolvable or unsafe reference is refused at creation, not discovered later", () => {
  // A linked context can never be unlinked, so a bad reference is permanent.
  assert.throws(() => careContextRef({ kind: "opd", id: "" }), CareContextError);
  assert.throws(() => careContextRef({ kind: "wardround", id: "x" }), CareContextError);
  assert.throws(() => careContextRef({ kind: "opd", id: "has space" }), CareContextError);
  assert.throws(() => careContextRef({ kind: "opd", id: "a/../b" }), CareContextError);
});

// ── the data-blind rule ─────────────────────────────────────────────────────────────────────────────
test("a display names record types and a date, in ABDM's sanctioned style", () => {
  const d = careContextDisplay({ kind: "opd", date: "2026-03-03", types: ["DiagnosticReport", "Prescription"] });
  assert.equal(d, "OPD records (Lab report, Prescription) from 3 March 2026");
});

test("an inpatient display is labelled IPD and can name the facility", () => {
  const d = careContextDisplay({ kind: "ipd", date: "2026-03-04", types: ["DischargeSummary"], facility: "StewardMD" });
  assert.match(d, /^IPD records \(Discharge summary\) from 4 March 2026 at StewardMD$/);
});

test("clinical detail in a display is refused - the consent manager must never see it", () => {
  for (const bad of [
    "OPD records (Diabetes review) from 3 March 2026",
    "OPD records - BP 140/90",
    "IPD records: carcinoma follow-up",
    "OPD records (HIV screening)",
    "OPD records - amoxicillin 500mg",
    "OPD records (result: positive)",
  ]) assert.throws(() => assertDataBlind(bad), CareContextError, "should have refused: " + bad);
});

test("an empty or oversized display is refused", () => {
  assert.throws(() => assertDataBlind(""), CareContextError);
  assert.throws(() => assertDataBlind("x".repeat(201)), CareContextError);
});

test("a bad date is caught rather than rendered as Invalid Date", () => {
  assert.throws(() => careContextDisplay({ kind: "opd", date: "not-a-date", types: ["Prescription"] }), CareContextError);
});

// ── visit projection ────────────────────────────────────────────────────────────────────────────────
test("HI types reflect only what the visit actually has", () => {
  assert.deepEqual(hiTypesForVisit({ notes: "seen", medications: [{}] }), ["OPConsultation", "Prescription"]);
  assert.deepEqual(hiTypesForVisit({ investigations: [{}] }), ["DiagnosticReport"]);
  assert.deepEqual(hiTypesForVisit({ dischargeSummary: {} }), ["DischargeSummary"]);
  assert.deepEqual(hiTypesForVisit({ vitals: { hr: 80 } }), ["WellnessRecord"]);
  assert.deepEqual(hiTypesForVisit({ bill: { total: 100 } }), ["Invoice"]);
  assert.deepEqual(hiTypesForVisit({}), []);
});

test("every produced HI type is one ABDM recognises", () => {
  const all = hiTypesForVisit({
    notes: "x", medications: [{}], investigations: [{}], dischargeSummary: {},
    immunisations: [{}], vitals: {}, documents: [{}], invoice: {},
  });
  assert.equal(all.length, 8);
  for (const t of all) assert.ok(HI_TYPES.includes(t), t);
});

test("an empty visit yields NO care context - linking an empty one is irreversible noise", () => {
  assert.equal(careContextForVisit({ kind: "opd", id: "v1", date: "2026-03-03" }), null);
});

test("a real visit projects to a reference, a blind display and its HI types", () => {
  const cc = careContextForVisit({ kind: "opd", id: "v1", date: "2026-03-03", notes: "seen", medications: [{}] });
  assert.equal(cc.referenceNumber, "OPD:v1");
  assert.equal(cc.display, "OPD records (Consultation, Prescription) from 3 March 2026");
  assert.deepEqual(cc.hiTypes, ["OPConsultation", "Prescription"]);
});

// ── the patient block ABDM expects ──────────────────────────────────────────────────────────────────
test("the patient block carries our own reference, the contexts, and the union of HI types", () => {
  const p = patientCareContexts({
    patientRef: "MRN-1", display: "StewardMD records",
    visits: [
      { kind: "opd", id: "v1", date: "2026-03-03", notes: "x" },
      { kind: "ipd", id: "a1", date: "2026-04-01", dischargeSummary: {}, investigations: [{}] },
      { kind: "opd", id: "v2", date: "2026-05-05" },   // empty, dropped
    ],
  });
  assert.equal(p.referenceNumber, "MRN-1");
  assert.equal(p.count, 2);
  assert.deepEqual(p.careContexts.map((c) => c.referenceNumber), ["OPD:v1", "IPD:a1"]);
  assert.deepEqual([...p.hiType].sort(), ["DiagnosticReport", "DischargeSummary", "OPConsultation"]);
  // no ABHA anywhere in what we hand the gateway
  assert.ok(!JSON.stringify(p).includes("@"), "no ABHA address may appear in a discovery response");
});

test("a patient-level display is data-blind too", () => {
  assert.throws(() => patientCareContexts({ patientRef: "MRN-1", display: "Diabetes clinic records", visits: [] }), CareContextError);
});
