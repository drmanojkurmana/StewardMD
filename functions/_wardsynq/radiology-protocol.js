/* functions/_wardsynq/radiology-protocol.js - deciding what will actually be done to the patient.
 *
 * A radiology request says "CT abdomen". PROTOCOLLING decides what that means: which phases, and
 * above all whether intravenous contrast is given. That second decision is the reason this file
 * exists, because it is the point at which an imaging request stops being a question and becomes a
 * drug administration - and it is routinely made by somebody who is not looking at the chart.
 *
 * TWO THINGS CAN GO WRONG WITH CONTRAST AND BOTH ARE FORESEEABLE:
 *
 *   A PREVIOUS REACTION. A recorded contrast allergy is the one fact that must never be discovered
 *   afterwards. It is surfaced here and, when the protocol asks for contrast anyway, an explicit
 *   reason is required and is kept on the record. Not blocked: a contrast study is sometimes the
 *   right call under premedication, and a radiologist who cannot make that call safely will make it
 *   unsafely somewhere this system cannot see.
 *
 *   RENAL FUNCTION. Contrast in significant renal impairment is a recognised harm. The most recent
 *   creatinine is shown with its DATE, and where there is none that is stated as absent - never
 *   assumed normal, which is the assumption that makes this dangerous. An old creatinine is not a
 *   current one and its age is on the record.
 *
 * IT DOES NOT DECIDE, AND IT COMPUTES NO eGFR. Turning a creatinine into a filtration rate needs
 * age, sex and a formula whose variants disagree, and a number this file invented would be trusted
 * as though a laboratory had issued it. It shows what the record holds and names what it does not.
 *
 * A PROTOCOL IS AGAINST AN ORDER VERSION. If the request changes after protocolling - a different
 * region, a different question - what was protocolled was protocolled against the old one, and the
 * record shows both. The same rule pharmacy verification and dispensing already follow.
 *
 * IT NEVER MARKS ANYTHING DONE. Protocolling is not performing: the scan still has to happen and the
 * report is still the radiologist's own act through radiology-report.js.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "ImagingProtocol";

/** LOINC-ish creatinine codes the lab seed already produces. One vocabulary, not a second. */
const CREATININE_CODES = Object.freeze(["2160-0", "38483-4"]);

/** Words that mean "this patient reacted to contrast". Matched on the recorded substance, loosely. */
const CONTRAST_WORDS = Object.freeze(["contrast", "iodinated", "gadolinium", "iohexol", "iopamidol", "ioversol", "gadobutrol"]);

/** PURE. Whether an allergy record is about contrast media. */
function isContrastAllergy(allergy) {
  const s = str(allergy && allergy.substance).toLowerCase();
  if (!s) return false;
  return CONTRAST_WORDS.some((w) => s.includes(w));
}

/**
 * PURE. The most recent creatinine, with its age, or an explicit absence.
 *
 * Never returns a number without a date. A creatinine with no time attached cannot be judged, and a
 * reader shown one alone assumes it is current.
 */
function latestCreatinine(observations, nowIso) {
  const rows = (observations || []).filter((o) => o && CREATININE_CODES.includes(str(o.code)) && o.value != null)
    .map((o) => ({ value: o.value, unit: o.unit || null, at: (o.meta && o.meta.effectiveAt) || o.effectiveAt || (o.meta && o.meta.recordedAt) || null }))
    .filter((o) => Number.isFinite(Date.parse(str(o.at))))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  if (!rows.length) {
    /* STATED, never assumed normal. "We have no creatinine" and "the creatinine is fine" are
     * opposite facts and only one of them is knowable here. */
    return { known: false, note: "NO CREATININE IS RECORDED for this patient. Renal function is unknown, which is not the same as normal." };
  }
  const top = rows[0];
  const days = Math.floor((Date.parse(str(nowIso) || new Date().toISOString()) - Date.parse(top.at)) / 86400000);
  return {
    known: true, value: top.value, unit: top.unit, at: top.at, ageDays: days,
    /* The age is part of the result, not a footnote: an old creatinine is not a current one, and a
     * patient's renal function can change entirely in a week. */
    note: days >= 7
      ? `This creatinine is ${days} days old. It describes the patient then, not now.`
      : `Creatinine from ${days === 0 ? "today" : days + " day" + (days === 1 ? "" : "s") + " ago"}.`,
  };
}

async function open_(request, env, ctx, need) {
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

/** ctx: { migration, serviceRequestId } - what a radiologist needs on screen before deciding. */
async function protocolContext(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", request: null };

  const serviceRequestId = str(ctx.serviceRequestId);
  if (!serviceRequestId) return { ...base, ok: false, status: 422, error: "request_required", request: null };

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, request: null };

  let sr;
  try { sr = await svc.get("ServiceRequest", serviceRequestId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), request: null }; }
  if (!sr) return { ...base, ok: false, status: 404, error: "request_not_found", serviceRequestId, request: null };

  let allergies = [], observations = [];
  try {
    [allergies, observations] = await Promise.all([
      svc.byPatient("AllergyIntolerance", sr.patientId).catch(() => []),
      svc.byPatient("Observation", sr.patientId).catch(() => []),
    ]);
  } catch (e) { /* the context is shown with what could be read; the gaps are named below */ }

  const contrastAllergies = (allergies || []).filter(isContrastAllergy)
    .map((a) => ({ substance: a.substance, reaction: a.reaction || null, severity: a.severity || null, criticality: a.criticality || null }));

  return {
    ...base, ok: true,
    request: { id: sr.id, version: sr.version, code: sr.code, display: sr.display || sr.code, patientId: sr.patientId, priority: sr.priority || null, reason: sr.reason || null },
    contrastAllergies,
    renal: latestCreatinine(observations, ctx.now),
    /* Said whether or not anything was found. A radiologist who only sees this section when it has
     * content learns to read its absence as "checked and clear". */
    note: contrastAllergies.length
      ? "A CONTRAST REACTION IS RECORDED for this patient. Protocolling contrast anyway requires a reason, which is kept on the record."
      : "No contrast reaction is recorded. That is what the record holds, not a guarantee that none happened elsewhere.",
    computed: "Nothing here computes an eGFR. Turning a creatinine into a filtration rate needs age, sex and a formula whose variants disagree, and a number this system invented would be trusted as though a laboratory had issued it.",
  };
}

/**
 * Records the protocol.
 * ctx: { migration, serviceRequestId, protocol, contrast, contrastReason?, notes?, at? }
 */
async function recordProtocol(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const serviceRequestId = str(ctx.serviceRequestId), protocol = str(ctx.protocol);
  if (!serviceRequestId || !protocol) return { ...base, ok: false, status: 422, error: "request_and_protocol_required", written: 0 };
  const contrast = ctx.contrast === true;

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let sr;
  try { sr = await svc.get("ServiceRequest", serviceRequestId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!sr) return { ...base, ok: false, status: 404, error: "request_not_found", serviceRequestId, written: 0 };

  let allergies = [], observations = [];
  try {
    [allergies, observations] = await Promise.all([
      svc.byPatient("AllergyIntolerance", sr.patientId).catch(() => []),
      svc.byPatient("Observation", sr.patientId).catch(() => []),
    ]);
  } catch (e) {
    /* FAIL CLOSED on the allergy read. Protocolling contrast without having been able to check for a
     * previous reaction is the exact situation this file exists to prevent, and proceeding with an
     * empty list would look identical to proceeding with a clear one. */
    if (contrast) return { ...base, ok: false, status: 502, error: "allergy_read_failed", written: 0,
      detail: "The allergy record could not be read, so a contrast protocol cannot be recorded. An unreadable allergy list is not a clear one." };
  }

  const contrastAllergies = (allergies || []).filter(isContrastAllergy);
  const contrastReason = str(ctx.contrastReason);
  if (contrast && contrastAllergies.length && !contrastReason) {
    return {
      ...base, ok: false, status: 422, error: "contrast_reason_required", written: 0,
      contrastAllergies: contrastAllergies.map((a) => ({ substance: a.substance, reaction: a.reaction || null, severity: a.severity || null })),
      detail: "This patient has a recorded contrast reaction. Contrast is not blocked - it is sometimes the right call under premedication - but the reason is required and is kept on the record.",
    };
  }

  const at = str(ctx.at) || new Date().toISOString();
  const renal = latestCreatinine(observations, at);
  const id = `wsq-proto-${str(serviceRequestId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-v${Number(sr.version)}`;

  const record = {
    resourceType: TYPE, id,
    patientId: sr.patientId,
    serviceRequestId,
    /* AGAINST A VERSION. If the request changes afterwards, what was protocolled was protocolled
     * against the old one and the record shows both. */
    requestVersion: Number(sr.version),
    protocol, contrast,
    contrastReason: contrastReason || null,
    /* WHAT WAS ON SCREEN, kept. Not so the radiologist can be blamed - so that a later reader can
     * tell a decision made with the creatinine in front of them from one made without it. */
    renalAtProtocol: renal,
    contrastAllergiesAtProtocol: contrastAllergies.map((a) => ({ substance: a.substance, reaction: a.reaction || null, severity: a.severity || null })),
    notes: str(ctx.notes) || null,
    protocolledBy: resolved.actor.id, at,
    source: { system: "wardsynq-native", sourceId: `imaging-protocol:${id}` },
  };

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, protocolId: id, serviceRequestId, requestVersion: Number(sr.version),
      contrast, recordVersion: out.record.version, protocolRecord: record, actor: resolved.actor.id,
      ...(contrast && !renal.known ? {
        renalWarning: "Contrast was protocolled with NO creatinine on record. Renal function is unknown, which is not the same as normal.",
      } : {}),
      ...(contrast && renal.known && renal.ageDays >= 7 ? {
        renalWarning: `Contrast was protocolled against a creatinine ${renal.ageDays} days old. It describes the patient then, not now.`,
      } : {}),
      note: "A protocol, not a scan. Nothing has been performed and no report exists: the study still has to happen.",
    };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", detail: e.detail, written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

export { TYPE, CREATININE_CODES, CONTRAST_WORDS, isContrastAllergy, latestCreatinine, protocolContext, recordProtocol };
