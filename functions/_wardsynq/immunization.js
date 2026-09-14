/* functions/_wardsynq/immunization.js - a vaccine given (or deliberately not given) to a patient.
 *
 * THE VACCINE IS WHAT THE PERSON WROTE. There is no vaccine catalogue here and none is invented: a
 * list of "standard" vaccines shipped with the product would be wrong for most of the countries it is
 * sold into, and a picker is how "Hep B (paediatric)" gets recorded as whatever was nearest the top.
 * The name travels as text. A code travels beside it only when the person gave one AND named a code
 * system this server knows (CVX, SNOMED CT, ATC); a code whose system is unknown is refused rather
 * than kept, because a bare code with no system is a number nobody downstream can read.
 *
 * NOT-DONE IS A FACT, NOT A GAP. "Refused", "contraindicated" and "out of stock" are clinical
 * history - the next clinician needs to know the dose was considered and why it was not given - so
 * not-done is its own status and it needs a reason. A not-done row with no reason is the same as no
 * row at all.
 *
 * APPEND-ONLY. A wrong entry is marked entered-in-error by a named person with a reason, as a new
 * version, and stays readable: somebody working out whether a child actually had a second dose has to
 * be able to see the entry that said so and who withdrew it.
 *
 * GIVEN HERE OR TOLD ABOUT. `primarySource` is R4's own distinction: true when the person recording
 * gave it (or watched it given), false when it is the patient's or a card's account. A reported dose
 * is still history; it is just not this hospital's evidence.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { systemUri } from "./terminology.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "Immunization";
const STATUSES = Object.freeze(["completed", "not-done"]);
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function immunizationIdFor(patientId, at, salt) {
  const p = str(patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const t = str(at).replace(/[^0-9a-zA-Z]+/g, "");
  const s = str(salt).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return p && t ? `wsq-imm-${p}-${t}${s ? "-" + s : ""}` : null;
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

/** PURE. An Immunization record from what the screen sent, or a refusal naming what is wrong. */
function immunizationFrom(input, patientId, actorId, now, id) {
  const i = input || {};
  const vaccine = str(i.vaccine);
  if (!vaccine) return { error: "vaccine_required", detail: "Write the vaccine as it was given." };
  const status = str(i.status) || "completed";
  if (!STATUSES.includes(status)) return { error: "bad_status", detail: "Status is given or not given." };
  const statusReason = str(i.statusReason);
  if (status === "not-done" && !statusReason) return { error: "reason_required", detail: "Say why it was not given - that is what the next clinician needs." };
  const occurredOn = str(i.occurredOn);
  if (!occurredOn || !DATE.test(occurredOn) || Number.isNaN(Date.parse(occurredOn))) return { error: "date_required", detail: "Give the date (YYYY-MM-DD)." };
  /* A dose in the future is a typing error every time. Refused rather than clamped, because clamping
   * hides the typo. Compared by day so a date-only entry for today is never "later than now". */
  if (occurredOn.slice(0, 10) > str(now).slice(0, 10)) return { error: "date_in_the_future", detail: "The date cannot be later than today." };
  const code = str(i.vaccineCode), system = str(i.vaccineCodeSystem);
  if (code && !system) return { error: "code_system_required", detail: "Say which code system the code is from, or leave the code out." };
  if (code && !systemUri(system)) return { error: "code_system_unknown", detail: "That code system is not one this server knows. Leave the code out; the vaccine name is kept." };
  let doseNumber = null;
  if (i.doseNumber !== undefined && i.doseNumber !== null && str(i.doseNumber) !== "") {
    const n = Number(i.doseNumber);
    if (!Number.isInteger(n) || n < 1) return { error: "bad_dose_number", detail: "Dose number is a whole number from 1." };
    doseNumber = n;
  }
  return {
    record: {
      resourceType: TYPE, id, patientId,
      encounterId: str(i.encounterId) || null,
      vaccine, vaccineCode: code || null, vaccineCodeSystem: code ? system : null,
      status, statusReason: status === "not-done" ? statusReason : null,
      occurredOn, doseNumber,
      lotNumber: str(i.lotNumber) || null, site: str(i.site) || null, route: str(i.route) || null,
      /* Who gave it. Given here by the recorder unless another person is named; a reported dose names
       * nobody here, because nobody here gave it. */
      primarySource: i.primarySource !== false,
      performerId: i.primarySource === false ? null : (str(i.performerId) || actorId),
      performerName: str(i.performerName) || null,
      note: str(i.note) || null,
      recordedBy: actorId, recordedAt: now,
    },
  };
}

/** POST: records one immunization. */
async function recordImmunization(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const now = str(ctx.now) || new Date().toISOString();
  const id = immunizationIdFor(patientId, now, ctx.immunization && ctx.immunization.vaccine);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };
  const built = immunizationFrom(ctx.immunization, patientId, resolved.actor.id, now, id);
  if (built.error) return { ...base, ok: false, status: 422, error: built.error, detail: built.detail, written: 0 };

  let patient;
  try { patient = await svc.get("Patient", patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };

  try {
    const out = await svc.put(built.record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, immunizationId: id, patientId, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** POST: marks one entry entered-in-error, with a reason. A new version; the entry stays readable. */
async function markImmunizationError(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const id = str(ctx.immunizationId), reason = str(ctx.reason);
  if (!id) return { ...base, ok: false, status: 422, error: "immunization_required", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "Say why this entry is wrong.", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "immunization_not_found", written: 0 };
  if (current.status === "entered-in-error") return { ...base, ok: false, status: 409, error: "already_withdrawn", written: 0 };

  const now = str(ctx.now) || new Date().toISOString();
  try {
    const next = { ...current, status: "entered-in-error", errorOf: current.status, errorReason: reason, errorBy: resolved.actor.id, errorAt: now };
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, immunizationId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** GET: every immunization for one patient, newest first, withdrawn ones included and marked. */
async function listImmunizations(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", immunizations: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", immunizations: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, immunizations: [] };

  let rows;
  try { rows = (await svc.byPatient(TYPE, patientId)) || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), immunizations: [] }; }

  const immunizations = rows.map((r) => ({
    immunizationId: str(r.id), vaccine: str(r.vaccine), vaccineCode: r.vaccineCode || null, vaccineCodeSystem: r.vaccineCodeSystem || null,
    status: str(r.status), statusReason: r.statusReason || null, occurredOn: str(r.occurredOn), doseNumber: r.doseNumber || null,
    lotNumber: r.lotNumber || null, site: r.site || null, route: r.route || null,
    primarySource: r.primarySource !== false, performerId: r.performerId || null, performerName: r.performerName || null,
    note: r.note || null, recordedBy: str(r.recordedBy), recordedAt: str(r.recordedAt),
    ...(r.status === "entered-in-error" ? { errorReason: str(r.errorReason), errorBy: str(r.errorBy), errorAt: str(r.errorAt) } : {}),
  })).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.recordedAt.localeCompare(a.recordedAt));
  return { ...base, ok: true, patientId, immunizations };
}

export { TYPE, STATUSES, immunizationIdFor, immunizationFrom, recordImmunization, markImmunizationError, listImmunizations };
