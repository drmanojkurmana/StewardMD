/* test/wardsynq-fhir-procedure.test.mjs — TASK 7.2: the three resources this server could not export.
 *
 * A surgical case as a Procedure, an appointment as an Appointment, a risk assessment as a
 * RiskAssessment. The rule all three hold: what the hospital wrote in its own words travels as TEXT.
 * A procedure code invented from "laparoscopic cholecystectomy", or a standard risk code invented
 * from one hospital's word "high", is the single most dangerous thing a mapper can do - a receiving
 * system acts on codes.
 *
 * node --test test/wardsynq-fhir-procedure.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFhir, FHIR_TYPE } from "../functions/_wardsynq/fhir.js";
import { validateResource } from "../functions/_wardsynq/fhir-validate.js";

const meta = { recordedAt: "2026-09-09T08:00:00.000Z", effectiveAt: "2026-09-09T08:00:00.000Z", source: { system: "wardsynq-native", sourceId: null }, derivedFrom: [] };
const conformant = (r) => validateResource(r).issues.filter((i) => i.severity === "error" || i.severity === "fatal");

const CASE = {
  resourceType: "SurgicalCase", id: "case-1", version: 3, patientId: "pat-1", encounterId: "enc-1",
  procedure: "Laparoscopic cholecystectomy", site: "abdomen", laterality: "not-applicable",
  stage: "signed-out", incisionAt: "2026-09-09T09:30:00.000Z",
  signIn: { at: "2026-09-09T09:00:00.000Z", items: {}, signatures: [{ role: "surgeon", actorId: "cfa:surgeon" }] },
  signOut: { at: "2026-09-09T11:15:00.000Z", items: {}, signatures: [
    { role: "surgeon", actorId: "cfa:surgeon" }, { role: "anaesthetist", actorId: "cfa:anaes" }, { role: "nurse", actorId: "cfa:nurse" }] },
  ledger: [], meta,
};

/* ---- 1: the operation ---------------------------------------------------------------------------- */

test("1. a signed-out case is a completed Procedure, with the theatre team in their own roles", () => {
  const p = toFhir(CASE);
  assert.equal(p.resourceType, "Procedure");
  assert.equal(p.status, "completed");
  assert.equal(p.code.text, "Laparoscopic cholecystectomy");
  assert.equal(p.code.coding, undefined, "NO code is invented for the hospital's own words");
  assert.equal(p.subject.reference, "Patient/pat-1");
  assert.equal(p.encounter.reference, "Encounter/enc-1");
  assert.equal(p.performedPeriod.start, "2026-09-09T09:30:00.000Z", "the operation began at the incision");
  assert.equal(p.performedPeriod.end, "2026-09-09T11:15:00.000Z");
  assert.deepEqual(p.performer.map((x) => x.function.text), ["surgeon", "anaesthetist", "nurse"]);
  assert.equal(p.performer[0].actor.identifier.value, "cfa:surgeon");
  assert.deepEqual(p.bodySite, [{ text: "abdomen not-applicable" }], "the side is text: this record has no coded laterality qualifier");
  assert.deepEqual(conformant(p), []);
});

test("2. every stage of the checklist is a real point in the same operation, and none is guessed", () => {
  const at = (stage) => toFhir({ ...CASE, stage }).status;
  assert.equal(at("booked"), "preparation");
  assert.equal(at("marked"), "preparation");
  assert.equal(at("signed-in"), "preparation");
  assert.equal(at("timed-out"), "preparation", "still before the knife");
  assert.equal(at("incised"), "in-progress");
  assert.equal(at("signed-out"), "completed");
  assert.equal(at("abandoned"), "not-done", "a list cancelled is not an operation that failed");
  assert.equal(at("something-else"), "unknown", "a stage this mapper does not know is unknown, never completed");
});

test("3. a case that has not been incised carries NO performed time", () => {
  const booked = toFhir({ ...CASE, stage: "booked", incisionAt: null, signIn: null, signOut: null });
  assert.equal(booked.performedPeriod, undefined, "an operation dated to when it was booked would be a fabricated fact");
  assert.equal(booked.status, "preparation");
  assert.deepEqual(conformant(booked), []);
});

/* ---- 4: the appointment --------------------------------------------------------------------------- */

const APPT = { resourceType: "Appointment", id: "appt-1", version: 1, patientId: "pat-1", clinicianId: "cfa:doc",
  startAt: "2026-09-10T04:30:00.000Z", minutes: 15, reason: "Follow-up", state: "booked", overbooked: false, meta };

test("4. an appointment's five states are R4's five states, renamed and not reinterpreted", () => {
  const at = (state) => toFhir({ ...APPT, state }).status;
  assert.equal(at("booked"), "booked");
  assert.equal(at("arrived"), "arrived");
  assert.equal(at("completed"), "fulfilled");
  assert.equal(at("cancelled"), "cancelled");
  assert.equal(at("did-not-attend"), "noshow");
});

test("5. the slot is a start and a duration, and the end is computed only from both", () => {
  const a = toFhir(APPT);
  assert.equal(a.start, "2026-09-10T04:30:00.000Z");
  assert.equal(a.end, "2026-09-10T04:45:00.000Z");
  assert.equal(a.minutesDuration, 15);
  assert.equal(a.participant[0].actor.reference, "Patient/pat-1");
  assert.equal(a.participant[1].actor.identifier.value, "cfa:doc", "the clinician is a matchable identifier");
  assert.deepEqual(conformant(a), []);

  const noDuration = toFhir({ ...APPT, minutes: null });
  assert.equal(noDuration.end, undefined, "no duration, no end - never an invented one");
  assert.equal(noDuration.start, "2026-09-10T04:30:00.000Z");
  assert.deepEqual(conformant(noDuration), []);
});

test("6. an overbooking is stated, because a receiver that cannot see it reads two appointments in one slot as an error", () => {
  const a = toFhir({ ...APPT, overbooked: true, overbookReason: "Squeezed in after theatre" });
  assert.match(a.comment, /Deliberately overbooked: Squeezed in after theatre/);
});

/* ---- 7: the risk assessment ----------------------------------------------------------------------- */

const RISK = { resourceType: "RiskAssessment", id: "risk-1", version: 1, patientId: "pat-1", encounterId: "enc-1",
  toolId: "braden", toolName: "Braden Scale", toolVersion: "2", answers: {}, total: 14, band: "moderate risk",
  actions: ["2-hourly repositioning", "pressure-relieving mattress"], actionsDone: [], reassessEvery: 24,
  assessedBy: "cfa:nurse", assessedAt: "2026-09-09T07:00:00.000Z", meta };

test("7. the band travels as the hospital's own word, never as a shared risk code", () => {
  const r = toFhir(RISK);
  assert.equal(r.resourceType, "RiskAssessment");
  assert.equal(r.status, "final");
  assert.equal(r.prediction[0].qualitativeRisk.text, "moderate risk");
  assert.equal(r.prediction[0].qualitativeRisk.coding, undefined, "'high' on one hospital's tool is not 'high' on another's");
  assert.equal(r.method.text, "Braden Scale v2", "the tool and its version, so the number can be reconciled with the paper form");
  assert.equal(r.performer.identifier.value, "cfa:nurse");
  assert.equal(r.mitigation, "2-hourly repositioning; pressure-relieving mattress", "what is actually being done about it");
  assert.match(r.note[0].text, /Score 14 on Braden Scale/);
  assert.deepEqual(conformant(r), []);
});

test("8. an assessment with no band predicts nothing rather than predicting 'unknown'", () => {
  const r = toFhir({ ...RISK, band: null, actions: [], total: null });
  assert.equal(r.prediction, undefined);
  assert.equal(r.mitigation, undefined);
  assert.equal(r.note, undefined);
  assert.deepEqual(conformant(r), []);
});

test("9. all three are declared as what they are", () => {
  assert.equal(FHIR_TYPE.SurgicalCase, "Procedure");
  assert.equal(FHIR_TYPE.Appointment, "Appointment");
  assert.equal(FHIR_TYPE.RiskAssessment, "RiskAssessment");
});
