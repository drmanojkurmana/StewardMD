/* functions/_wardsynq/patient-identity.js — who this person is to other people, and whether they
 * have died.
 *
 * Both are facts about a PERSON, not findings about a body, which is why they sit together here and
 * not in the clinical modules. A next of kin is not an observation and a death is not a diagnosis.
 *
 * DECEASED IS A VERSION OF THE PATIENT, NOT A NEW RECORD AND NEVER A DELETION. The Patient record
 * gains a `deceased` block and moves to its next version; every clinical record underneath is
 * untouched and stays readable, because a death is the moment a chart becomes MORE important to
 * read, not less. Nothing here closes an encounter, cancels an order or stops a write: post-mortem
 * documentation is real work, and a system that locks the chart at the moment of death forces the
 * people doing that work to record it somewhere the record cannot see.
 *
 * IT IS ALSO NOT REVERSIBLE BY EDITING. Marking the wrong patient dead is a real and serious
 * mistake, so undoing it is its own governed act that writes a further version saying the record
 * was corrected and by whom - the same discipline every other correction in this codebase keeps.
 * The wrong entry stays in the history, because somebody investigating how a living patient came to
 * be recorded as dead needs to see it.
 *
 * RELATIONSHIPS ARE THEIR OWN RECORDS, APPEND-ONLY, DEACTIVATED RATHER THAN DELETED. "Who do we
 * call" is asked at the worst moments, and an emergency contact that was quietly overwritten last
 * month leaves nobody to call. Removing one marks it inactive and keeps it.
 *
 * ONE RESOURCE, THREE JOBS. Next of kin, guardian and emergency contact are not three different
 * kinds of person - they are three things the same person can be, and in a real family they usually
 * are the same person. Modelling them as three lists guarantees they disagree.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const RELATED_TYPE = "RelatedPerson";
const PATIENT_TYPE = "Patient";

/* The relationships a hospital actually records. Deliberately short and deliberately including
 * "other": a list that cannot express a real family forces the front desk to pick a wrong one. */
const RELATIONSHIPS = Object.freeze([
  "spouse", "parent", "child", "sibling", "grandparent", "grandchild",
  "guardian", "friend", "neighbour", "carer", "employer", "other",
]);

function relatedIdFor(patientId, at, salt) {
  const p = str(patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const t = str(at).replace(/[^0-9a-zA-Z]+/g, "");
  const s = str(salt).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return p && t ? `wsq-rel-${p}-${t}${s ? "-" + s : ""}` : null;
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

function writeFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code) };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) };
}

/** PURE. The deceased block a death records, or a refusal saying what is wrong with it. */
function deceasedBlock(input, actorId, now) {
  const at = str(input && input.at) || now;
  /* A death in the future is a data-entry error every time, and recording one silently would put a
   * date on a certificate that nobody can defend. Refused rather than clamped to now, because
   * clamping hides the typo that produced it. */
  if (at > now) return { error: "death_in_the_future", detail: "The time of death cannot be later than now. Check the date." };
  return {
    at,
    cause: str(input && input.cause) || null,
    /* Who certified it, as typed, because the certifying doctor is often not the person at the
     * keyboard - and who RECORDED it is captured separately and cannot be typed. */
    certifiedBy: str(input && input.certifiedBy) || null,
    recordedBy: actorId,
    recordedAt: now,
  };
}

/** Records that a patient has died. A governed new version of the Patient; nothing is deleted. */
async function recordDeath(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  /* A consequential, effectively irreversible act needs an explicit confirmation that cannot be
   * produced by a mis-click or a replayed request body. */
  if (ctx.confirm !== true) {
    return { ...base, ok: false, status: 422, error: "confirmation_required", written: 0,
      detail: "Recording a death has to be confirmed explicitly. Nothing was changed." };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let patient;
  try { patient = await svc.get(PATIENT_TYPE, patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", patientId, written: 0 };
  if (patient.deceased && !ctx.correct) {
    return { ...base, ok: false, status: 409, error: "already_recorded", written: 0,
      deceased: patient.deceased,
      detail: "This patient is already recorded as deceased. Correcting that is a separate, recorded action." };
  }

  const now = str(ctx.now) || new Date().toISOString();
  const block = deceasedBlock(ctx.deceased || ctx, resolved.actor.id, now);
  if (block.error) return { ...base, ok: false, status: 422, error: block.error, detail: block.detail, written: 0 };

  try {
    const next = { ...patient, deceased: block };
    const out = await svc.put(next, { expectedVersion: patient.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, patientId, deceased: block, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/**
 * Takes back a death recorded against the wrong patient.
 *
 * A correction, never an erasure: it writes a further version carrying `deceasedCorrection` with
 * who withdrew it and why, and the version that said they had died stays in the history. Somebody
 * investigating how a living patient came to be recorded dead needs to be able to read that.
 */
async function correctDeath(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  const reason = str(ctx.reason);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!reason) {
    return { ...base, ok: false, status: 422, error: "reason_required", written: 0,
      detail: "Say why this is being withdrawn. A correction nobody can account for is worse than the error." };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let patient;
  try { patient = await svc.get(PATIENT_TYPE, patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", patientId, written: 0 };
  if (!patient.deceased) return { ...base, ok: false, status: 409, error: "not_recorded_deceased", written: 0 };

  const now = str(ctx.now) || new Date().toISOString();
  try {
    const next = {
      ...patient,
      deceased: null,
      deceasedCorrection: {
        withdrew: patient.deceased, reason, by: resolved.actor.id, at: now,
        ...(patient.deceasedCorrection ? { previous: patient.deceasedCorrection } : {}),
      },
    };
    const out = await svc.put(next, { expectedVersion: patient.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, patientId, version: out.record.version, actor: resolved.actor.id,
      detail: "Withdrawn. The earlier entry stays in this patient's history." };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** PURE. Validates a relationship, or says what is missing. */
function relatedPersonFrom(input, patientId, actorId, at, id) {
  const name = str(input && input.name);
  const relationship = str(input && input.relationship).toLowerCase();
  if (!name) return { error: "name_required", detail: "A contact needs a name." };
  if (!relationship) return { error: "relationship_required", detail: "Say how this person is related." };
  if (RELATIONSHIPS.indexOf(relationship) < 0) {
    return { error: "unknown_relationship", detail: "Use one of: " + RELATIONSHIPS.join(", ") + "." };
  }
  const phone = str(input && input.phone);
  const nextOfKin = input && input.nextOfKin === true;
  const guardian = input && input.guardian === true;
  const emergencyContact = input && input.emergencyContact === true;
  /* A contact that is none of the three is somebody nobody will ever be asked to call, which is
   * almost always a half-filled form rather than an intention. */
  if (!nextOfKin && !guardian && !emergencyContact) {
    return { error: "role_required", detail: "Say what this person is: next of kin, guardian, emergency contact, or more than one." };
  }
  /* SOMEBODY HAS TO BE REACHABLE. A next of kin or an emergency contact with no number is a name on
   * a screen at the moment somebody needs to be telephoned. A guardian recorded for the record's
   * sake is allowed without one. */
  if ((nextOfKin || emergencyContact) && !phone) {
    return { error: "phone_required", detail: "A next of kin or emergency contact needs a telephone number - this is the name somebody rings." };
  }
  return {
    record: {
      resourceType: RELATED_TYPE, id, patientId,
      name, relationship, phone: phone || null,
      nextOfKin, guardian, emergencyContact,
      ...(str(input && input.note) ? { note: str(input.note) } : {}),
      active: true, recordedBy: actorId, recordedAt: at,
    },
  };
}

/** Records a person to contact about this patient. */
async function addRelatedPerson(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = relatedIdFor(patientId, at, (ctx.person && ctx.person.name) || "");
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const built = relatedPersonFrom(ctx.person || ctx, patientId, resolved.actor.id, at, id);
  if (built.error) return { ...base, ok: false, status: 422, error: built.error, detail: built.detail, written: 0 };

  try {
    const out = await svc.put(built.record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, relatedPersonId: id, patientId,
      person: built.record, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** Marks a contact inactive. Kept, never deleted. */
async function removeRelatedPerson(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const id = str(ctx.relatedPersonId);
  if (!id) return { ...base, ok: false, status: 422, error: "contact_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(RELATED_TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "contact_not_found", written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  try {
    const next = { ...current, active: false, removedBy: resolved.actor.id, removedAt: at,
      ...(str(ctx.reason) ? { removedReason: str(ctx.reason) } : {}) };
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, relatedPersonId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** Everyone recorded for this patient. Inactive ones are returned too, marked, never hidden. */
async function listRelatedPeople(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", people: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", people: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, people: [] };

  let rows, patient;
  try {
    rows = (await svc.byPatient(RELATED_TYPE, patientId)) || [];
    patient = await svc.get(PATIENT_TYPE, patientId);
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), people: [] };
  }

  const people = rows
    .map((r) => ({
      relatedPersonId: str(r.id), name: str(r.name), relationship: str(r.relationship),
      phone: str(r.phone) || null, nextOfKin: !!r.nextOfKin, guardian: !!r.guardian,
      emergencyContact: !!r.emergencyContact, note: str(r.note) || null,
      active: r.active !== false, recordedBy: str(r.recordedBy), recordedAt: str(r.recordedAt),
      ...(r.active === false ? { removedBy: str(r.removedBy), removedAt: str(r.removedAt), removedReason: str(r.removedReason) || null } : {}),
    }))
    // Active first, then who to ring first within that, then most recently recorded.
    .sort((a, b) => (b.active - a.active) || (b.emergencyContact - a.emergencyContact) || str(b.recordedAt).localeCompare(str(a.recordedAt)));

  const active = people.filter((p) => p.active);
  return {
    ...base, ok: true, patientId, people,
    /* Said on every read, because "is there anybody to ring" is the question this list exists to
     * answer and an empty answer must be loud rather than an empty list nobody notices. */
    hasEmergencyContact: active.some((p) => p.emergencyContact),
    ...(active.length === 0 ? { warning: "Nobody is recorded as a contact for this patient." } : {}),
    ...(patient && patient.deceased ? { deceased: patient.deceased } : {}),
    ...(patient && patient.deceasedCorrection && !(patient && patient.deceased)
      ? { deceasedCorrected: { reason: str(patient.deceasedCorrection.reason), by: str(patient.deceasedCorrection.by), at: str(patient.deceasedCorrection.at) } }
      : {}),
  };
}

export {
  RELATIONSHIPS, RELATED_TYPE, relatedIdFor, deceasedBlock, relatedPersonFrom,
  recordDeath, correctDeath, addRelatedPerson, removeRelatedPerson, listRelatedPeople,
};
