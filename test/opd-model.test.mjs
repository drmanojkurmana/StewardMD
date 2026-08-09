// test/opd-model.test.mjs — normalized OPD entities/events (Phase 1 boundary). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { organization, department, room, doctor, opdPatient, appointment, visit, opdEvent, OPD_EVENTS } from "../functions/_opd_model.js";

test("organization: mode defaults to native; connectorId nulled when absent", () => {
  assert.deepEqual(organization({ id: "o1", name: "GIMSR" }), { id: "o1", name: "GIMSR", mode: "native", connectorId: null });
  assert.equal(organization({ id: "o1", mode: "connect", connectorId: "ghis" }).connectorId, "ghis");
  assert.equal(organization({ id: "o1", mode: "connect", connectorId: "ghis" }).mode, "connect");
  assert.equal(organization({ id: "o1", mode: "weird" }).mode, "native");   // unknown mode -> native
});

test("room / doctor / department normalise + carry EMR refs without depending on them", () => {
  const r = room({ id: "r1", orgId: "o1", name: "Medicine 1", number: "101", department: "medicine", doctorId: "d1" });
  assert.equal(r.name, "Medicine 1"); assert.equal(r.department, "medicine");
  assert.equal(doctor({ id: "d1", orgId: "o1", name: "Dr Rao" }).emrDoctorId, null);
  assert.equal(doctor({ id: "d1", emrDoctorId: 502862 }).emrDoctorId, "502862");   // stringified, carried
  assert.equal(department({ id: "dep1", orgId: "o1", name: "Cardiology", code: "CARD" }).code, "CARD");
});

test("opdPatient: SCCM patient + EMR id + masked shadow (mrnLast4 digits-only, last 4)", () => {
  const p = opdPatient({ id: "p1", name: "AMBATI V", emrPatientId: "MR26125863", mrnLast4: "MR26125863" });
  assert.equal(p.id, "p1");                 // SCCM patient shape preserved
  assert.equal(p.gender, "unknown");        // SCCM default
  assert.equal(p.emrPatientId, "MR26125863");
  assert.equal(p.mrnLast4, "5863");         // digits only, last 4
  assert.equal(p.displayName, "AMBATI V");
  assert.equal(opdPatient({ id: "p2" }).emrPatientId, null);   // native patient, no EMR id
});

test("visit + appointment reuse SCCM encounter and carry EMR consultation/appointment ids", () => {
  const v = visit({ id: "v1", orgId: "o1", patientId: "p1", roomId: "r1", status: "in-progress", emrConsultationId: "C9" });
  assert.equal(v.id, "v1"); assert.equal(v.roomId, "r1"); assert.equal(v.emrConsultationId, "C9");
  const a = appointment({ id: "a1", orgId: "o1", department: "medicine", patientId: "p1" });
  assert.equal(a.status, "scheduled"); assert.equal(a.emrAppointmentId, null);
});

test("opdEvent validates the type; requireId enforced on entities", () => {
  for (const t of OPD_EVENTS) assert.equal(opdEvent({ type: t, orgId: "o1" }).type, t);
  assert.throws(() => opdEvent({ type: "nope" }), /unknown OPD event/);
  assert.throws(() => room({ orgId: "o1" }), /id required/);
  assert.throws(() => opdPatient({}), /id required/);
});
