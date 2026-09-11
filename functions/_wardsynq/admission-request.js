/* functions/_wardsynq/admission-request.js — the patient who has been promised a bed.
 *
 * WardSynQ could admit a patient and could not plan one. Every admission was an emergency by
 * construction: somebody arrived, somebody typed. A hospital that cannot hold a waiting list keeps it
 * on paper at the nurses' station, and a paper list is how a patient waits four months for an
 * operation nobody can find a record of promising them.
 *
 * A WAITING-LIST ENTRY IS NOT A BED RESERVATION, and this is the property the file exists to keep.
 * Nothing here touches the bed board, holds a bed, or makes one unavailable. Reserving a bed for a
 * patient who is not in it is how a ward runs out of beds it actually has - the board would show
 * full while three beds stood empty, and the ward would start ignoring the board.
 *
 * NOTHING IS ADMITTED AUTOMATICALLY. A request becoming an admission is a human act, through the
 * ordinary admission route, with a bed somebody chose. A queue that admitted its own head would
 * allocate a bed to whoever had waited longest rather than to whoever needs it, and would do it at
 * 3am with nobody watching.
 *
 * HOW LONG SOMEBODY HAS WAITED IS COMPUTED, NEVER STORED. A stored wait is wrong the moment nobody
 * updates it, and the number is the entire clinical and managerial point of the list.
 *
 * IT IS NEVER CLOSED BY GUESSING. Admitting a patient does not silently close their request: a
 * patient can legitimately hold two - a medical bed now and a surgical slot next month - and picking
 * one by identity alone would close the wrong one. The list REPORTS that the patient is currently
 * admitted, so a human closes the right entry knowing why.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "AdmissionRequest";

const STATES = Object.freeze(["waiting", "admitted", "cancelled"]);
/** How soon, in the hospital's words. Ordering matters: it is what the list sorts by. */
const URGENCY = Object.freeze(["emergency", "urgent", "soon", "elective"]);

function AdmissionRequest(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    mrn: i.mrn || null,
    specialty: i.specialty || null,
    ward: i.ward || null,                     // a PREFERENCE, never an allocation
    reason: i.reason || null,
    urgency: URGENCY.includes(i.urgency) ? i.urgency : "elective",
    state: STATES.includes(i.state) ? i.state : "waiting",
    requestedBy: i.requestedBy || null, requestedAt: i.requestedAt || null,
    /* When the hospital said it would happen, if it said. NOT a promise the system enforces: nothing
     * here admits anybody, and a date that has passed is shown as passed rather than acted on. */
    plannedFor: i.plannedFor || null,
    encounterId: i.encounterId || null,       // set when a human closes it against a real admission
    closedBy: i.closedBy || null, closedAt: i.closedAt || null, closeReason: i.closeReason || null,
    source: { system: "wardsynq-native", sourceId: `admission-request:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * PURE. One request per (patient, specialty, request time).
 *
 * The time is in the id because A PATIENT MAY LEGITIMATELY BE ON THE LIST TWICE - a medical bed now
 * and a surgical slot next month - and an id keyed on the patient alone would have silently replaced
 * the first promise with the second.
 */
function requestIdFor(patientId, specialty, requestedAt) {
  const p = slug(patientId), t = slug(requestedAt);
  if (!p || !t) return null;
  const s = slug(specialty);
  return s ? `wsq-adr-${p}-${s}-${t}` : `wsq-adr-${p}-${t}`;
}

/** PURE. How long this has been waiting, in whole hours. Null once it is no longer waiting. */
function waitingHours(req, nowMs) {
  if (!req || req.state !== "waiting") return null;
  const t = Date.parse(str(req.requestedAt));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor(((Number.isFinite(nowMs) ? nowMs : Date.now()) - t) / 3600000));
}

/** PURE. Sort key: the sickest first, then the longest waiting. Never the other way round. */
function rank(req) {
  const u = URGENCY.indexOf(str(req && req.urgency));
  return u < 0 ? URGENCY.length : u;
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
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

function summary(r, nowMs) {
  return {
    requestId: r.id, patientId: r.patientId, mrn: r.mrn || null,
    specialty: r.specialty || null, ward: r.ward || null, reason: r.reason || null,
    urgency: r.urgency, state: r.state, plannedFor: r.plannedFor || null,
    requestedBy: r.requestedBy, requestedAt: r.requestedAt,
    waitingHours: waitingHours(r, nowMs),
    encounterId: r.encounterId || null, closedBy: r.closedBy || null, closedAt: r.closedAt || null,
    closeReason: r.closeReason || null, version: r.version,
  };
}

/** Puts a patient on the list. ctx: { migration, mrn, specialty?, ward?, reason?, urgency?, plannedFor? } */
async function requestAdmission(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const mrn = str(ctx.mrn);
  const patientId = patientIdForMrn(mrn);
  if (!patientId) return { ...base, ok: false, status: 422, error: "mrn_required", written: 0 };
  const reason = str(ctx.reason);
  // A waiting list entry with no reason cannot be prioritised, reviewed or explained to the patient.
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say what the admission is for", written: 0 };
  const urgency = str(ctx.urgency) || "elective";
  if (!URGENCY.includes(urgency)) return { ...base, ok: false, status: 400, error: "unknown_urgency", detail: `urgency must be one of ${URGENCY.join(", ")}`, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.requestedAt) || new Date().toISOString();
  const id = requestIdFor(patientId, ctx.specialty, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch { current = null; }
  if (current) return { ...base, ok: true, written: 0, skipped: "already_requested", ...summary(current) };

  const record = AdmissionRequest({
    id, patientId, mrn, specialty: str(ctx.specialty) || null, ward: str(ctx.ward) || null,
    reason, urgency, state: "waiting", plannedFor: str(ctx.plannedFor) || null,
    requestedBy: resolved.actor.id, requestedAt: at,
  });
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...record, version: out.record.version }),
      /* Said every time. A ward that believed this held a bed would show full while beds stood
       * empty, and would start ignoring the board. */
      note: "On the waiting list. NO bed is reserved and nothing will admit this patient automatically.",
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { requestId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * A human closes a request - because the patient was admitted, or because they no longer need to be.
 * ctx: { migration, requestId, state: "admitted" | "cancelled", encounterId?, reason }
 */
async function closeAdmissionRequest(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const requestId = str(ctx.requestId), state = str(ctx.state);
  if (!requestId) return { ...base, ok: false, status: 422, error: "request_required", written: 0 };
  if (state !== "admitted" && state !== "cancelled") {
    return { ...base, ok: false, status: 400, error: "unknown_state", detail: "state must be admitted or cancelled", written: 0 };
  }
  const reason = str(ctx.reason);
  /* Cancelling without a reason loses why a patient who was promised a bed did not get one, which is
   * the single question a complaint about a waiting list asks. */
  if (state === "cancelled" && !reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this patient is coming off the list", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, requestId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "request_not_found", requestId, written: 0 };
  if (current.state !== "waiting") return { ...base, ok: true, written: 0, skipped: "already_closed", ...summary(current) };

  const encounterId = str(ctx.encounterId);
  if (state === "admitted") {
    // Closed AGAINST a real admission, never on somebody's say-so: "admitted" with no encounter is
    // a waiting list that empties itself and a patient nobody can find.
    if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", detail: "closing a request as admitted needs the admission it became", requestId, written: 0 };
    let enc;
    try { enc = await svc.get("Encounter", encounterId); }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
    if (!enc) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };
    // And against the RIGHT patient's admission. Closing one patient's request with another's
    // encounter would put two people in one record.
    if (enc.patientId !== current.patientId) {
      return { ...base, ok: false, status: 409, error: "wrong_patient", detail: "that admission belongs to a different patient", requestId, encounterId, written: 0 };
    }
  }

  const next = AdmissionRequest({
    ...current, state, encounterId: state === "admitted" ? encounterId : current.encounterId,
    closedBy: resolved.actor.id, closedAt: new Date().toISOString(), closeReason: reason || null,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { requestId, written: 0, actor: resolved.actor.id }) };
  }
}

/** The waiting list. ctx: { migration, specialty?, includeClosed?, now? } */
async function admissionWaitingList(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", requests: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, requests: [] };

  let rows, encounters;
  try {
    [rows, encounters] = await Promise.all([
      svc.list(TYPE, 500),
      svc.list("Encounter", 500).catch(() => []),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), requests: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), requests: [] };
  }

  /* Who is CURRENTLY an inpatient. Derived, so it cannot disagree with the ward list, and used only
   * to REPORT - never to close a request. A patient may hold two, and picking one by identity would
   * close the wrong one. */
  const admitted = new Set((encounters || [])
    .filter((e) => e && e.class === "IPD" && e.status === "in-progress")
    .map((e) => str(e.patientId)));

  const want = str(ctx.specialty).toLowerCase();
  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const requests = (rows || []).filter(Boolean)
    .filter((r) => (ctx.includeClosed ? true : r.state === "waiting"))
    .filter((r) => !want || str(r.specialty).toLowerCase() === want)
    .map((r) => {
      const s = summary(r, nowMs);
      if (r.state === "waiting" && admitted.has(str(r.patientId))) {
        s.patientAlreadyAdmitted = true;
        s.detail = "This patient is currently an inpatient. Close this request against their admission, or say why it is still open.";
      }
      // A planned date that has passed is SHOWN as passed. Nothing acts on it.
      if (r.state === "waiting" && r.plannedFor && Date.parse(str(r.plannedFor)) < nowMs) s.plannedDatePassed = true;
      return s;
    })
    // The sickest first, then the longest waiting. Never the other way round.
    .sort((a, b) => (rank(a) - rank(b)) || String(a.requestedAt || "").localeCompare(String(b.requestedAt || "")));

  return {
    ...base, ok: true, requests,
    waiting: requests.filter((r) => r.state === "waiting").length,
    longestWaitHours: requests.reduce((m, r) => (r.waitingHours !== null && r.waitingHours > m ? r.waitingHours : m), 0),
    note: "A waiting list, not a bed allocation. No bed is held for anybody on it.",
  };
}

export { TYPE, STATES, URGENCY, AdmissionRequest, requestIdFor, waitingHours, rank, requestAdmission, closeAdmissionRequest, admissionWaitingList };
