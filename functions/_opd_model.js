/* functions/_opd_model.js — normalized StewardMD OPD entities + events (Phase 1: the boundary).
 *
 * The OPD engine consumes ONLY these shapes. An EMR connector (or the native provider) returns them; the
 * engine never sees a GHIS id, a FHIR resource, or any wire format. Pure + versioned like the SCCM
 * canonical model, which we REUSE for patient/encounter rather than duplicating (data-ownership: the EMR
 * owns identity/clinical, OPD owns queue/room state — see the architecture doc §8).
 *
 * Nothing imports this yet — it is a contract, wired in Phase 2 (GHIS-as-connector) onward.
 */
import { patient as sccmPatient, encounter as sccmEncounter } from "./_connect/canonical/model.js";

export const OPD_MODEL_VERSION = "1.0";

function requireId(o) { if (!o || o.id == null || String(o.id) === "") throw new Error("opd_model: id required"); }
const s = (v) => (v == null ? "" : String(v));
const orNull = (v) => (v == null || String(v) === "" ? null : String(v));

// ---- org structure (OPD-native; SCCM has no Organization/Department/Room) ----------------------
export function organization(o = {}) {
  requireId(o);
  return { id: s(o.id), name: s(o.name), mode: o.mode === "connect" ? "connect" : "native", connectorId: orNull(o.connectorId) };
}
export function department(o = {}) { requireId(o); return { id: s(o.id), orgId: s(o.orgId), name: s(o.name), code: s(o.code) }; }
export function room(o = {}) {
  requireId(o);
  return { id: s(o.id), orgId: s(o.orgId), name: s(o.name), number: s(o.number), department: s(o.department), doctorId: s(o.doctorId) };
}
export function doctor(o = {}) {
  requireId(o);
  return { id: s(o.id), orgId: s(o.orgId), name: s(o.name), department: s(o.department), emrDoctorId: orNull(o.emrDoctorId) };
}

// ---- patient / appointment / visit (reuse SCCM patient + encounter) ----------------------------
// A minimal local shadow (displayName + mrnLast4) rides alongside the SCCM patient + the EMR identifier.
// We never store a duplicate medical record — the external EMR stays authoritative (architecture §8).
export function opdPatient(o = {}) {
  requireId(o);
  const p = sccmPatient({ id: o.id, identifiers: o.identifiers, name: o.name, gender: o.gender, birthDate: o.birthDate });
  return Object.assign(p, {
    emrPatientId: orNull(o.emrPatientId),
    displayName: s(o.displayName || o.name),
    mrnLast4: s(o.mrnLast4).replace(/\D/g, "").slice(-4)
  });
}
export function appointment(o = {}) {
  requireId(o);
  return {
    id: s(o.id), orgId: s(o.orgId), department: s(o.department), doctorId: s(o.doctorId),
    patientId: s(o.patientId), emrAppointmentId: orNull(o.emrAppointmentId), slot: o.slot || null,
    status: s(o.status || "scheduled")
  };
}
export function visit(o = {}) {
  requireId(o);
  const e = sccmEncounter({ id: o.id, status: o.status, class: o.class });
  return Object.assign(e, { orgId: s(o.orgId), patientId: s(o.patientId), roomId: s(o.roomId), emrConsultationId: orNull(o.emrConsultationId) });
}

// ---- normalized events (connector-agnostic; the engine also emits these from staff actions) -----
export const OPD_EVENTS = ["patient.arrived", "patient.checked_in", "visit.assigned_to_room", "consultation.started", "consultation.ended", "patient.checked_out"];
export function opdEvent(o = {}) {
  if (OPD_EVENTS.indexOf(o.type) < 0) throw new Error("opd_model: unknown OPD event: " + s(o.type));
  return { type: o.type, orgId: s(o.orgId), ts: Number(o.ts) || 0, patientId: s(o.patientId), roomId: s(o.roomId), emrRefs: o.emrRefs || {}, source: s(o.source || "opd") };
}
