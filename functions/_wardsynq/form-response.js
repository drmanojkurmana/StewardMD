/* functions/_wardsynq/form-response.js — a completed hospital form on the patient's record.
 * The response is checked on the server against the exact published version it names (wardsynq-forms.js):
 * applicability (role, department, in force), required fields, types, ranges, visibility, and calculated
 * fields computed here. An invalid response writes nothing and returns every field error.
 *
 * PRE-ADMISSION INTAKE (R3-3). A patient with a planned admission answers the hospital's patient forms on the
 * portal before they arrive. Four rules:
 *
 * WHAT A PATIENT SAYS STAYS WHAT A PATIENT SAID. The response is stored with `origin: "patient"` and a review
 * state, and it is never copied into allergies, medicines or problems - not when it is sent and not when it is
 * accepted. Accepting records that a named clinician read it. Putting "penicillin, rash" on the allergy list
 * is still that clinician's own act through the allergy route, because a patient's word typed into a box is
 * not a verified allergy and a chart that treats it as one is wrong in both directions. (`origin` rather than
 * `source`: `source` on a record is its provenance system, as on AppointmentRequest, which already marks a
 * patient's own request with `origin: "patient"`.)
 *
 * ONLY A PATIENT FORM, ONLY FOR A PLANNED ADMISSION. The portal lists and accepts only published definitions
 * marked `audience: "patient"`, and only while the patient holds a waiting AdmissionRequest with a planned
 * date. A staff form cannot be read or answered through this door, whatever key is sent.
 *
 * THE PATIENT MAY CORRECT IT UNTIL SOMEBODY HAS READ IT. One response per form per planned admission; sending
 * again is a new version of it. Once accepted it is closed; returned with a reason, it opens again.
 *
 * A REVIEWER ACCEPTS THE VERSION THEY READ. The review names the version, so a patient's later correction is
 * never accepted by somebody who never saw it. */
import { GovernanceError, makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { evaluateResponse, applicabilityProblem, fieldsOf, isPatientForm } from "../../wardsynq/wardsynq-forms.js";

const TYPE = "FormResponse";
const ADMISSION_TYPE = "AdmissionRequest";
const ORIGIN_PATIENT = "patient";
const REVIEW_DECISIONS = Object.freeze({ accept: "accepted", return: "returned" });
const str = (v) => (v == null ? "" : String(v).trim());
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }), resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** ctx: { migration, definition (the published version), patientId, encounterId, answers, department, actorDeps, recordDeps } */
async function submitFormResponse(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const def = ctx.definition;
  if (!def) return { ...base, ok: false, status: 404, error: "form_not_found", message: "That form version is not published.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const notFor = applicabilityProblem(def, { role: resolved.role, department: str(ctx.department), date: new Date().toISOString().slice(0, 10) });
  if (notFor) return { ...base, ok: false, status: 403, error: "form_not_applicable", message: notFor, written: 0 };
  let evaluated;
  try { evaluated = evaluateResponse(def, ctx.answers); } catch (e) { return { ...base, ok: false, status: 422, error: e.code, message: e.message, problems: e.problems, written: 0 }; }
  if (!evaluated.valid) return { ...base, ok: false, status: 422, error: "invalid_response", errors: evaluated.errors, written: 0 };
  try {
    const patient = await svc.get("Patient", str(ctx.patientId));
    if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    const at = new Date().toISOString();
    const codes = fieldsOf(def).filter((f) => f.code && f.key in evaluated.answers).map((f) => ({ field: f.key, system: f.code.system, code: f.code.code, value: evaluated.answers[f.key] }));
    const rec = { resourceType: TYPE, id: `wsq-form-${def.key}-${str(ctx.patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
      patientId: patient.id, encounterId: str(ctx.encounterId) || null, formKey: def.key, formVersion: def.version, formTitle: def.title,
      answers: evaluated.answers, codes, completedBy: resolved.actor.id, completedAt: at };
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, response: { ...rec, version: out.record.version } };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

async function patientFormResponses(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", responses: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  try { return { ...base, ok: true, responses: (await svc.byPatient(TYPE, str(ctx.patientId))).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))) }; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
}

/* ---- pre-admission intake --------------------------------------------------------------------------------- */

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One response per form per planned admission; the request id already names the patient. */
const intakeId = (formKey, requestId) => `wsq-intake-${slug(formKey)}-${slug(requestId)}`;
const today = () => new Date().toISOString().slice(0, 10);

/** The portal writer: the patient (or a proxy, under its own id), drafting one type and reading two. */
function intakeActor(session) {
  return makeActor({ id: str(session.readerId) || `patient:${str(session.patientId)}`, kind: KIND.HUMAN, tier: TIER.DRAFT, scope: { read: [TYPE, ADMISSION_TYPE], write: [TYPE] } });
}
function portalService(ctx, session) {
  return new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: { id: ctx.migration.tenantId },
    actor: intakeActor(session), role: "patient-portal", roleSource: "wardsynq-patient-access" });
}

/** PURE. The admissions a patient may answer intake forms for: still waiting, with a date the hospital gave. */
function plannedAdmissions(requests) {
  return (requests || []).filter((r) => r && r.state === "waiting" && str(r.plannedFor))
    .map((r) => ({ requestId: r.id, plannedFor: r.plannedFor, specialty: r.specialty || null }))
    .sort((a, b) => String(a.plannedFor).localeCompare(String(b.plannedFor)));
}

/** PURE. What either side is shown of one intake response. */
function intakeView(r) {
  return { responseId: r.id, admissionRequestId: r.admissionRequestId, formKey: r.formKey, formVersion: r.formVersion, formTitle: r.formTitle,
    answers: r.answers, origin: r.origin, reviewState: r.reviewState, submittedBy: r.completedBy, submittedAt: r.completedAt,
    reviewedBy: r.reviewedBy || null, reviewedAt: r.reviewedAt || null, reviewReason: r.reviewReason || null, version: r.version };
}

const notInGrant = { ok: false, status: 403, error: "not_in_grant", detail: "This access does not include that." };
const NOT_VERIFIED = "What you send is kept as what you told the hospital. It is not added to your medical record as checked information until a member of staff reviews it.";

/**
 * The portal read: the patient's planned admissions, the hospital's patient forms and their own answers so far.
 * ctx: { migration, recordDeps, published: the latest published definitions (null when they could not be read) }
 */
async function portalIntake(ctx, session) {
  const base = baseOf(ctx.migration);
  if (!session.sections.includes("forms")) return { ...base, ...notInGrant };
  if (!Array.isArray(ctx.published)) return { ...base, ok: false, status: 502, error: "forms_read_failed" };
  let requests, responses;
  try {
    const svc = portalService(ctx, session);
    [requests, responses] = await Promise.all([svc.byPatient(ADMISSION_TYPE, session.patientId), svc.byPatient(TYPE, session.patientId)]);
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "governance" : "record_read_failed" }; }
  const admissions = plannedAdmissions(requests);
  // No planned admission, no forms: the list is not offered to somebody it is not for.
  const forms = admissions.length ? ctx.published.filter((d) => isPatientForm(d) && !applicabilityProblem(d, { role: null, department: "", date: today() })) : [];
  const open = new Set(admissions.map((a) => a.requestId));
  return { ...base, ok: true, admissions, forms, notVerified: NOT_VERIFIED,
    responses: (responses || []).filter((r) => r && r.origin === ORIGIN_PATIENT && open.has(r.admissionRequestId)).map(intakeView) };
}

/** The portal write. ctx: { migration, recordDeps, definition (the exact published version named), requestId, answers } */
async function portalSubmitIntake(ctx, session) {
  const base = baseOf(ctx.migration);
  if (!session.sections.includes("forms")) return { ...base, ...notInGrant, written: 0 };
  const def = ctx.definition;
  if (!def) return { ...base, ok: false, status: 404, error: "form_not_found", detail: "That form is not published.", written: 0 };
  // The same answer for a staff form as for a missing one would hide a misconfiguration; a staff form is refused by name.
  if (!isPatientForm(def)) return { ...base, ok: false, status: 403, error: "not_for_patients", detail: "This form is not one patients fill in.", written: 0 };
  const notFor = applicabilityProblem(def, { role: null, department: "", date: today() });
  if (notFor) return { ...base, ok: false, status: 403, error: "form_not_applicable", detail: notFor, written: 0 };
  const svc = portalService(ctx, session);
  const requestId = str(ctx.requestId);
  let adm;
  try { adm = requestId ? await svc.get(ADMISSION_TYPE, requestId) : null; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  // Another patient's request and no request answer alike: a caller learns nothing about ids that are not theirs.
  if (!adm || str(adm.patientId) !== str(session.patientId) || !plannedAdmissions([adm]).length) {
    return { ...base, ok: false, status: 403, error: "no_planned_admission", detail: "There is no planned admission to fill this form in for.", written: 0 };
  }
  let evaluated;
  try { evaluated = evaluateResponse(def, ctx.answers); } catch (e) { return { ...base, ok: false, status: 422, error: e.code, detail: e.message, written: 0 }; }
  if (!evaluated.valid) return { ...base, ok: false, status: 422, error: "invalid_response", errors: evaluated.errors, written: 0 };
  const id = intakeId(def.key, adm.id);
  try {
    const current = await svc.get(TYPE, id);
    if (current && current.reviewState === "accepted") return { ...base, ok: false, status: 409, error: "already_reviewed", detail: "The hospital has already reviewed this form. Contact the hospital to change anything in it.", written: 0 };
    const rec = { resourceType: TYPE, id, patientId: adm.patientId, encounterId: null, admissionRequestId: adm.id,
      formKey: def.key, formVersion: def.version, formTitle: def.title, answers: evaluated.answers,
      /* Terminology codes are not attached: a coded value reads as a clinical finding to anything downstream. */
      codes: [], origin: ORIGIN_PATIENT, reviewState: "submitted", reviewedBy: null, reviewedAt: null, reviewReason: null,
      completedBy: str(session.readerId) || `patient:${session.patientId}`, completedAt: new Date().toISOString() };
    const out = await svc.put(rec, current ? { expectedVersion: current.version } : {});
    return { ...base, ok: true, written: 1, response: intakeView({ ...rec, version: out.record.version }), notVerified: NOT_VERIFIED };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", written: 0 };
  }
}

/** Staff read of one patient's intake answers. ctx: { migration, patientId, requestId? } */
async function intakeResponses(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", responses: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", responses: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, responses: null };
  try {
    const rows = await svc.byPatient(TYPE, patientId);
    const want = str(ctx.requestId);
    return { ...base, ok: true, responses: rows.filter((r) => r && r.origin === ORIGIN_PATIENT && (!want || r.admissionRequestId === want)).map(intakeView)
      .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))) };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", responses: null }; }
}

/**
 * A clinician accepts an intake response as reviewed, or returns it to the patient with a reason.
 * ctx: { migration, responseId, version (the one they read), decision: "accept"|"return", reason }
 * Writes this FormResponse and nothing else: no allergy, medicine or problem is created from the answers.
 */
async function reviewIntake(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const state = REVIEW_DECISIONS[str(ctx.decision)];
  if (!state) return { ...base, ok: false, status: 400, error: "unknown_decision", detail: "decision must be accept or return", written: 0 };
  const reason = str(ctx.reason).slice(0, 1000);
  if (state === "returned" && !reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say what the patient needs to change; they will read this", written: 0 };
  const version = Number(ctx.version);
  if (!Number.isInteger(version) || version < 1) return { ...base, ok: false, status: 422, error: "version_required", detail: "name the version you read", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(TYPE, str(ctx.responseId)); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  if (!current || current.origin !== ORIGIN_PATIENT) return { ...base, ok: false, status: 404, error: "intake_not_found", written: 0 };
  if (current.version !== version) return { ...base, ok: false, status: 409, error: "changed_since_read", detail: "The patient has sent a newer version. Read it before reviewing.", written: 0 };
  if (current.reviewState !== "submitted") return { ...base, ok: false, status: 409, error: "not_awaiting_review", detail: `This form is already ${current.reviewState}.`, written: 0 };
  const { meta, version: _v, ...rest } = current;
  const next = { ...rest, reviewState: state, reviewedBy: resolved.actor.id, reviewedAt: new Date().toISOString(), reviewReason: reason || null };
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, response: intakeView({ ...next, version: out.record.version }), actor: resolved.actor.id,
      note: state === "accepted" ? "Marked as reviewed. Nothing was added to allergies, medicines or problems: record anything that belongs in the chart through its own screen."
        : "Returned. The patient sees your reason on the portal and can send it again." };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", written: 0 };
  }
}

export { TYPE, ORIGIN_PATIENT, submitFormResponse, patientFormResponses, plannedAdmissions, intakeId, portalIntake, portalSubmitIntake, intakeResponses, reviewIntake };
