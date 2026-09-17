/* functions/_wardsynq/migrate-surgery.js — the missing adapter for wardsynq-surgical.js's
 * SurgicalCase: a real, tested, WHO Surgical Safety Checklist gate (STATUS in that file's own
 * header: "IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved") that was
 * reachable by nobody - no resource type, no route, no RecordService wiring, imported only by its
 * own tests. This is the join; every rule about laterality, sequencing and three-signature
 * independence is enforced by that file, unchanged, by running the SAME class here.
 *
 * NO HYDRATE/PROTOTYPE TRICK NEEDED. Unlike wardsynq-emergency.js's EmergencyBundle, SurgicalCase's
 * methods take the case `c` as a plain data argument rather than holding it as instance state - the
 * class only carries `now`/`bus`/`store` deps. So a single shared instance (constructed with no
 * store, so its own internal _persist()/_emit() no-op) operates on any case object read back from
 * storage; only the encounter/consent glue and the write-through are this file's job.
 *
 * DETERMINISTIC IDS, NOT book()'S OWN. SurgicalCase.book() mints `case-<patientId>-<Date.now()>`
 * internally - fine for its own tests, wrong for an idempotent HTTP retry. caseIdFor() computes a
 * deterministic id from (patient, procedure, booked time) the same way bundleIdFor() does for
 * ResusBundle, and overwrites `c.id` with it immediately after book() returns.
 *
 * A LINKED SURGERY ENCOUNTER, NOT A SHADOW CHART. Booking a case also opens a real, canonical
 * Encounter (class SURGERY) so the case is visible on the record the same way an ED or ICU visit
 * is - counted in ward metrics, printed on the downtime pack, exported over FHIR/HL7 - and closed
 * again on sign-out/disposition or abandonment. The case itself carries no clinical fact the
 * Encounter doesn't also know about; it is the checklist state, not a second patient record.
 *
 * NOT MODELLED HERE EITHER, same caveat as wardsynq-surgical.js's own header plus what it names as
 * absent: theatre/staff scheduling orchestration (resource-booking.js/scheduling.js already support
 * booking a theatre and a surgeon's time independently; wiring case booking to auto-reserve them is
 * left to a later pass rather than half-built without a rollback story), fire risk, VTE prophylaxis,
 * glycaemic control, and specimen chain-of-custody linkage (specimen.js's SpecimenCollection is
 * reused as-is for collection/labelling; nothing here cross-checks it against sign-out's
 * "specimens-labelled" item, which stays a human attestation).
 *
 * node --test test/wardsynq-surgery.test.mjs
 */

import { SurgicalCase, SurgicalSafetyError } from "../../wardsynq/wardsynq-surgical.js";
import { Encounter } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";
import { recordConsent as writePatientConsent } from "./consent.js";
import { resolveCoding } from "./code-sets.js";
import { theatreSettings } from "./theatre.js";

const CASE_TYPE = "SurgicalCase";
const ANES_TYPE = "AnesthesiaRecord";
const IMPLANT_TYPE = "ImplantRecord";
const PAC_TYPE = "PreAnaestheticCheckup";
const SURGERY = "SURGERY", PACU = "PACU";
const OPEN = "in-progress", FINISHED = "finished";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function caseIdFor(patientId, procedure, bookedAt) {
  const p = slug(patientId), pr = slug(procedure), t = slug(bookedAt);
  return p && pr && t ? `wsq-case-${p}-${pr}-${t}` : null;
}
function encounterIdForCase(caseId) { return caseId ? `wsq-enc-${caseId}` : null; }
function anesthesiaIdFor(caseId) { return caseId ? `wsq-anes-${caseId}` : null; }
function pacIdFor(caseId) { return caseId ? `wsq-pac-${slug(caseId)}` : null; }
function implantIdFor(caseId, device, lot) {
  const c = slug(caseId), d = slug(device), l = slug(lot);
  return c && d ? `wsq-implant-${c}-${d}${l ? "-" + l : ""}` : null;
}

async function openService(request, env, ctx, need) {
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
/** SurgicalCase throws its own SurgicalSafetyError (NO_LATERALITY, LATERALITY_CONFLICT,
 *  CHECKLIST_INCOMPLETE, SIGNATURES_NOT_INDEPENDENT, SIGN_IN_INCOMPLETE, ...) - shown verbatim,
 *  never paraphrased into a generic failure. */
function caseRefusal(base, e, extra) {
  return { ...base, ok: false, status: e && e.code === "PAC_READ_FAILED" ? 502 : e && ["NO_PATIENT", "NO_ACTOR", "NO_PROCEDURE", "NO_LATERALITY", "BAD_TIME", "BAD_KIND", "BAD_VALUE", "REASON_REQUIRED"].includes(e.code) ? 422 : 409, error: "surgical_refused", code: (e && e.code) || null, detail: str(e && e.message), ...extra };
}

const engine = new SurgicalCase({});
async function loadCase(svc, caseId) { return svc.get(CASE_TYPE, caseId); }
function serializeCase(c) { return { resourceType: CASE_TYPE, ...c }; }

/** ctx: { migration, booking: {mrn, procedure, site, laterality, theatre?, scheduledAt?}, actorDeps, recordDeps } */
async function bookSurgicalCase(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const b = ctx.booking || {};
  const mrn = str(b.mrn);
  const patientId = patientIdForMrn(mrn);
  if (!patientId) return { ...base, ok: false, status: 422, error: "no_patient_identity", written: 0 };
  /* The scheduled start and planned minutes are optional, and recorded only as given: a case booked with no time has no
   * scheduled start, and the theatre report says so rather than taking the moment of booking for one. */
  if (str(b.scheduledAt) && !Number.isFinite(Date.parse(str(b.scheduledAt)))) return { ...base, ok: false, status: 422, error: "bad_scheduled_at", detail: "the scheduled start is not a date and time", written: 0 };
  const plannedMinutes = b.minutes == null || b.minutes === "" ? null : Number(b.minutes);
  if (plannedMinutes != null && (!Number.isInteger(plannedMinutes) || plannedMinutes < 1 || plannedMinutes > 1440)) return { ...base, ok: false, status: 422, error: "bad_minutes", detail: "planned minutes are 1 to 1440", written: 0 };
  const bookedAt = str(b.scheduledAt) || new Date().toISOString();
  const caseId = caseIdFor(patientId, b.procedure, bookedAt);
  if (!caseId) return { ...base, ok: false, status: 422, error: "procedure_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await loadCase(svc, caseId).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "unchanged", caseId, encounterId: current.encounterId, version: current.version };
  // An optional procedure code, only from the hospital's loaded code set (code-sets.js). The words stay the booking's.
  let procedureCoding = null;
  try { const rc = await resolveCoding(svc, mig.tenantId, b.coding); if (rc.refuse) return { ...base, ok: false, ...rc.refuse, written: 0 }; procedureCoding = rc.coding; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The code set could not be read, so the case was not booked.", written: 0 }; }

  let c;
  try { c = await engine.book({ id: patientId, mrn }, { procedure: b.procedure, site: b.site, laterality: b.laterality }, resolved.actor.id); }
  catch (e) { return caseRefusal(base, e, { written: 0 }); }
  c.id = caseId;
  if (procedureCoding) c.procedureCoding = procedureCoding;
  c.scheduledAt = str(b.scheduledAt) ? new Date(Date.parse(str(b.scheduledAt))).toISOString() : null;
  c.firstScheduledAt = c.scheduledAt;
  c.plannedMinutes = plannedMinutes;
  c.theatreId = str(b.theatre) || null;

  const enc = Encounter({
    id: encounterIdForCase(caseId), patientId, class: SURGERY, status: OPEN,
    identifiers: [{ system: "opd-mrn", value: mrn }],
    location: { facilityId: null, ward: str(b.theatre) || "OT", bed: null },
    periodStart: bookedAt, periodEnd: null,
    source: { system: "wardsynq-native", sourceId: `surgical-case:${caseId}` },
  });
  c.encounterId = enc.id;

  let written = 0;
  try { await svc.put(enc, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:enc` : null }); written += 1; }
  catch (e) { return { ...base, ...writeFailure(e, { written, actor: resolved.actor.id }) }; }
  try {
    const out = await svc.put(serializeCase(c), { idempotencyKey: ctx.idempotencyKey || null });
    written += 1;
    return { ...base, ok: true, written, caseId, encounterId: enc.id, patientId, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written, caseId, encounterId: enc.id, actor: resolved.actor.id }) };
  }
}

/**
 * Records consent through consent.js's own governed PatientConsent (never a second consent store),
 * then checks it against THIS booking's procedure and side via the real SurgicalCase mismatch logic.
 * ctx: { migration, caseId, consent: {procedure, laterality, expiresAt?, signedByPatientOrProxy,
 *   givenBy?, giverName?, capacity?}, actorDeps, recordDeps }
 */
async function recordCaseConsent(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const caseId = str(ctx.caseId);
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const c = await loadCase(svc, caseId).catch(() => null);
  if (!c) return { ...base, ok: false, status: 404, error: "case_not_found", caseId, written: 0 };

  const consent = ctx.consent || {};
  const patientConsentRes = await writePatientConsent(request, env, {
    migration: mig, patientId: c.patientId, encounterId: c.encounterId, scope: "procedure",
    decision: consent.signedByPatientOrProxy ? "granted" : "refused",
    detail: `${consent.procedure || ""}|${consent.laterality || ""}`,
    givenBy: consent.givenBy, giverName: consent.giverName, capacity: consent.capacity,
    validUntil: consent.expiresAt, actorDeps: ctx.actorDeps, recordDeps: ctx.recordDeps,
    idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:consent` : null,
  });
  if (!patientConsentRes.ok) return { ...base, ...patientConsentRes, caseId, written: 0 };

  let updated;
  try { updated = await engine.recordConsent(c, consent, resolved.actor.id); }
  catch (e) { return caseRefusal(base, e, { caseId, written: 1, consent: patientConsentRes }); }

  try {
    const out = await svc.put(serializeCase(updated), { expectedVersion: c.version, idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:case` : null });
    return { ...base, ok: true, written: 2, caseId, stage: updated.stage, version: out.record.version, consent: patientConsentRes, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { caseId, written: 1, actor: resolved.actor.id }) };
  }
}

/** Every checklist-phase route shares this shape: load, call the real engine method, persist. */
async function mutateCase(request, env, ctx, apply) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const caseId = str(ctx.caseId);
  if (!caseId) return { ...base, ok: false, status: 422, error: "case_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const c = await loadCase(svc, caseId).catch(() => null);
  if (!c) return { ...base, ok: false, status: 404, error: "case_not_found", caseId, written: 0 };

  let updated;
  try { updated = await apply(c, resolved, svc); }
  catch (e) { return caseRefusal(base, e, { caseId, written: 0 }); }

  try {
    const out = await svc.put(serializeCase(updated), { expectedVersion: c.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId, stage: updated.stage, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { caseId, written: 0, actor: resolved.actor.id }) };
  }
}

const markCaseSite = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => engine.markSite(c, ctx.marking || {}, r.actor.id));
/* Sign In also reads the case's pre-anaesthetic checkup and never passes it silently: the checklist runs
 * first (its own refusals come first), then a missing PAC or an "unfit" decision refuses the sign-in
 * unless the team states, in words, why they are proceeding. What the PAC said at that moment (or that
 * there was none) is kept on the sign-in itself, so a later revision of the PAC cannot rewrite it. */
const signInCase = (request, env, ctx) => mutateCase(request, env, ctx, async (c, r, svc) => {
  const submission = ctx.submission || {};
  const out = await engine.signIn(c, submission);
  out.signIn.pac = await pacGate(svc, c, submission.pacAcknowledgement);
  return out;
});
const timeOutCase = (request, env, ctx) => mutateCase(request, env, ctx, (c) => engine.timeOut(c, ctx.submission || {}));
const inciseCase = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => engine.incise(c, r.actor.id));
const signOutCase = (request, env, ctx) => mutateCase(request, env, ctx, (c) => engine.signOut(c, ctx.submission || {}));
const abandonCase = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => engine.abandon(c, r.actor.id, str(ctx.reason)));

/* ---- theatre times, rescheduling and unplanned return (P3 theatre-opd-access, 2026-09-17) ----------------------
 * What theatre.js measures, recorded on the case by a person. Nothing here is inferred: a time not recorded stays
 * absent and the report lists it as missing. Every change is also written to the case ledger, and the record service
 * keeps every earlier version. */
const LIVE_BEFORE_KNIFE = ["booked", "marked", "signed-in", "timed-out"];
const refuseIf = (cond, message, code) => { if (cond) throw new SurgicalSafetyError(message, code); };
/** A stated time, or now. A time more than five minutes ahead is refused: it has not happened yet. */
function statedTime(v) {
  if (!str(v)) return new Date().toISOString();
  const t = Date.parse(str(v));
  refuseIf(!Number.isFinite(t), "the time is not a date and time", "BAD_TIME");
  refuseIf(t > Date.now() + 5 * 60000, "the time is in the future", "BAD_TIME");
  return new Date(t).toISOString();
}

/** ctx: { migration, caseId, kind: "postponed"|"cancelled", toStart?, reasonCode?, reason, theatre (settings) } */
const rescheduleCase = (request, env, ctx) => mutateCase(request, env, ctx, async (c, r) => {
  const kind = str(ctx.kind), reason = str(ctx.reason).slice(0, 500), code = str(ctx.reasonCode);
  const reasons = theatreSettings(ctx.theatre).rescheduleReasons;
  refuseIf(kind !== "postponed" && kind !== "cancelled", "say whether the case is postponed or cancelled", "BAD_KIND");
  refuseIf(reason.length < 3, "say why the case is rescheduled", "REASON_REQUIRED");
  /* The hospital's reason codes, when it has set them, are the only codes accepted; with none set the reason is words only. */
  refuseIf(reasons.length > 0 && !reasons.some((x) => x.code === code), `choose one of the hospital's reason codes: ${reasons.map((x) => x.code).join(", ")}`, "REASON_REQUIRED");
  refuseIf(!LIVE_BEFORE_KNIFE.includes(c.stage), `a case at stage ${c.stage} is not rescheduled; a case already under way is abandoned instead`, "OUT_OF_SEQUENCE");
  const at = new Date().toISOString();
  const entry = { kind, at, by: r.actor.id, reasonCode: reasons.length ? code : null, reason, fromStart: c.scheduledAt || null, toStart: null };
  if (kind === "postponed") {
    const to = Date.parse(str(ctx.toStart));
    refuseIf(!Number.isFinite(to), "a postponed case needs its new start", "BAD_TIME");
    refuseIf(c.scheduledAt && Date.parse(c.scheduledAt) === to, "the new start is the same as the current one", "BAD_TIME");
    entry.toStart = new Date(to).toISOString();
    if (!c.firstScheduledAt) c.firstScheduledAt = c.scheduledAt || null;
    c.scheduledAt = entry.toStart;
    c.ledger.push({ at, event: "postponed", actorId: r.actor.id, detail: `${entry.fromStart || "no time"} to ${entry.toStart}: ${reason}` });
  } else {
    await engine.abandon(c, r.actor.id, reason);
    c.ledger.push({ at, event: "cancelled-before-surgery", actorId: r.actor.id, detail: reason });
  }
  c.reschedules = [...(Array.isArray(c.reschedules) ? c.reschedules : []), entry];
  return c;
});

/** ctx: { migration, caseId, event: "in-room"|"out-of-room", at?, correctionReason? } */
const recordTheatreTime = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => {
  const event = str(ctx.event);
  refuseIf(event !== "in-room" && event !== "out-of-room", "say whether the patient entered or left the theatre", "BAD_KIND");
  refuseIf(c.stage === "abandoned", "this case was abandoned", "ABANDONED");
  const at = statedTime(ctx.at), key = event === "in-room" ? "inRoomAt" : "outRoomAt";
  const t = { ...(c.theatreTimes || {}) };
  const correction = str(ctx.correctionReason).slice(0, 500);
  refuseIf(t[key] && correction.length < 3, `this time is already recorded (${t[key]}); a change needs a reason`, "ALREADY_RECORDED");
  refuseIf(key === "outRoomAt" && !t.inRoomAt, "record when the patient entered the theatre first", "OUT_OF_SEQUENCE");
  refuseIf(key === "outRoomAt" && Date.parse(at) < Date.parse(t.inRoomAt), "the patient cannot leave before entering", "BAD_TIME");
  refuseIf(key === "inRoomAt" && t.outRoomAt && Date.parse(at) > Date.parse(t.outRoomAt), "the patient cannot enter after leaving", "BAD_TIME");
  if (t[key]) t.corrections = [...(t.corrections || []), { field: key, was: t[key], now: at, reason: correction, by: r.actor.id, at: new Date().toISOString() }];
  t[key] = at; t[key.replace("At", "By")] = r.actor.id;
  c.theatreTimes = t;
  c.ledger.push({ at: new Date().toISOString(), event, actorId: r.actor.id, detail: at });
  return c;
});

/** ctx: { migration, caseId, value: boolean, indexCaseId?, reason? } - the surgeon's statement that this operation was, or
 *  was not, an unplanned return to theatre for a complication of an earlier operation in the same admission (NABH #6). */
const flagUnplannedReturn = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => {
  refuseIf(typeof ctx.value !== "boolean", "say yes or no", "BAD_VALUE");
  const reason = str(ctx.reason).slice(0, 500);
  refuseIf(ctx.value && reason.length < 3, "name the complication that brought the patient back", "REASON_REQUIRED");
  refuseIf(!c.incisionAt, "only an operation that took place can be a return to theatre", "OUT_OF_SEQUENCE");
  c.unplannedReturn = { value: ctx.value, indexCaseId: str(ctx.indexCaseId) || null, reason: reason || null, by: r.actor.id, at: new Date().toISOString(), previous: c.unplannedReturn ? { value: c.unplannedReturn.value, by: c.unplannedReturn.by, at: c.unplannedReturn.at } : null };
  c.ledger.push({ at: c.unplannedReturn.at, event: "unplanned-return", actorId: r.actor.id, detail: ctx.value ? `yes: ${reason}` : "no" });
  return c;
});

/** ctx: { migration, caseId, note?, actorDeps, recordDeps } - the operative record, refused unless
 *  sign-in/time-out/sign-out are all complete (wardsynq-surgical.js's own MILESTONE_BYPASSED rule). */
async function recordOperativeNote(request, env, ctx) {
  return mutateCase(request, env, ctx, async (c, r) => {
    const record = await engine.operativeRecord(c, r.actor.id, str(ctx.note) || null);
    c.operativeRecord = record;
    return c;
  });
}

/**
 * Ends the theatre stay: closes the SURGERY encounter, optionally opens a PACU encounter. Moving
 * from PACU onward to a ward bed reuses the EXISTING /ward/admit call, unchanged - not duplicated
 * here, the same way an ED disposition to "admitted" reuses it too.
 * ctx: { migration, caseId, disposition: "pacu"|"direct-discharge", pacuBed?, actorDeps, recordDeps }
 */
async function dispositionCase(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const caseId = str(ctx.caseId);
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const c = await loadCase(svc, caseId).catch(() => null);
  if (!c) return { ...base, ok: false, status: 404, error: "case_not_found", caseId, written: 0 };
  if (c.stage !== "signed-out") return { ...base, ok: false, status: 409, error: "not_signed_out", detail: "disposition happens after sign out", caseId, stage: c.stage, written: 0 };

  let enc;
  try { enc = await svc.get("Encounter", c.encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!enc) return { ...base, ok: false, status: 404, error: "encounter_not_found", caseId, written: 0 };

  const now = new Date().toISOString();
  const closed = Encounter({ ...enc, status: FINISHED, periodEnd: now, source: { system: "wardsynq-native", sourceId: `surgical-disposition:${caseId}` } });
  if (enc.attendingId) closed.attendingId = enc.attendingId;
  if (enc.reason) closed.reason = enc.reason;

  let written = 0;
  try { await svc.put(closed, { expectedVersion: enc.version, idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:close` : null }); written += 1; }
  catch (e) { return { ...base, ...writeFailure(e, { written, caseId, actor: resolved.actor.id }) }; }

  let pacuEncounterId = null;
  if (str(ctx.disposition) === "pacu") {
    const pacu = Encounter({
      id: `wsq-pacu-${caseId}`, patientId: c.patientId, class: PACU, status: OPEN,
      identifiers: enc.identifiers, location: { facilityId: null, ward: "PACU", bed: str(ctx.pacuBed) || null },
      periodStart: now, periodEnd: null, source: { system: "wardsynq-native", sourceId: `pacu-admission:${caseId}` },
    });
    try { await svc.put(pacu, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:pacu` : null }); written += 1; pacuEncounterId = pacu.id; }
    catch (e) { return { ...base, ...writeFailure(e, { written, caseId, actor: resolved.actor.id }) }; }
  }

  return { ...base, ok: true, written, caseId, disposition: str(ctx.disposition) || "direct-discharge", pacuEncounterId, actor: resolved.actor.id, role: resolved.role };
}

/**
 * THE THEATRE BOARD: every open SURGERY-class encounter, hospital-wide - what a charge nurse or
 * theatre coordinator actually needs, not a per-patient lookup. caseId is deterministically
 * recoverable from the linked encounter's own id (encounterIdForCase's inverse), so this needs no
 * second index. ctx: { migration, actorDeps, recordDeps }
 */
async function listOpenCases(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", cases: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, cases: [] };

  let encounters;
  try { encounters = await svc.list("Encounter", 200); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), cases: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), cases: [] };
  }
  const theatres = (encounters || []).filter((e) => e && e.class === SURGERY && e.status === OPEN);
  const cases = [];
  for (const enc of theatres) {
    const caseId = str(enc.id).replace(/^wsq-enc-/, "");
    const c = await loadCase(svc, caseId).catch(() => null);
    if (c) cases.push({ ...c, theatre: (enc.location && enc.location.ward) || null });
  }
  return { ...base, ok: true, cases: cases.sort((a, b) => String(a.ledger?.[0]?.at || "").localeCompare(String(b.ledger?.[0]?.at || ""))) };
}

/** ctx: { migration, caseId, actorDeps, recordDeps } */
async function getSurgicalCase(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", case: null };
  const caseId = str(ctx.caseId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, case: null };
  const c = await loadCase(svc, caseId).catch(() => null);
  return { ...base, ok: true, case: c };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function listSurgicalCases(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", cases: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", cases: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, cases: [] };
  let rows;
  try { rows = await svc.byPatient(CASE_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), cases: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), cases: [] };
  }
  return { ...base, ok: true, cases: (rows || []).sort((a, b) => String(b.ledger?.[0]?.at || "").localeCompare(String(a.ledger?.[0]?.at || ""))) };
}

/* ---- anaesthesia record: induction/maintenance/emergence, drugs given ------------------------- */

/** ctx: { migration, caseId, asaClass?, actorDeps, recordDeps } */
async function startAnesthesia(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const caseId = str(ctx.caseId);
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const c = await loadCase(svc, caseId).catch(() => null);
  if (!c) return { ...base, ok: false, status: 404, error: "case_not_found", caseId, written: 0 };
  const id = anesthesiaIdFor(caseId);
  const current = await svc.get(ANES_TYPE, id).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "already_started", caseId, version: current.version };
  const record = {
    resourceType: ANES_TYPE, id, caseId, patientId: c.patientId, encounterId: c.encounterId,
    startedAt: new Date().toISOString(), startedBy: resolved.actor.id,
    // ASA physical status is recorded exactly as entered - never computed or inferred here.
    asaClass: str(ctx.asaClass) || null, events: [], endedAt: null,
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId, anesthesiaId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { caseId, written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, caseId, event: {drug, dose, route?, at?}, actorDeps, recordDeps } */
async function recordAnesthesiaEvent(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const caseId = str(ctx.caseId);
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = anesthesiaIdFor(caseId);
  const current = await svc.get(ANES_TYPE, id).catch(() => null);
  if (!current) return { ...base, ok: false, status: 404, error: "anesthesia_not_started", caseId, written: 0 };
  if (current.endedAt) return { ...base, ok: false, status: 409, error: "already_ended", caseId, written: 0 };
  const ev = ctx.event || {};
  const drug = str(ev.drug), dose = str(ev.dose);
  if (!drug || !dose) return { ...base, ok: false, status: 422, error: "drug_and_dose_required", caseId, written: 0 };
  const events = [...current.events, { drug, dose, route: str(ev.route) || null, at: str(ev.at) || new Date().toISOString(), by: resolved.actor.id }];
  try {
    const out = await svc.put({ ...current, events }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId, events: out.record.events, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { caseId, written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, caseId, actorDeps, recordDeps } */
async function endAnesthesia(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const caseId = str(ctx.caseId);
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = anesthesiaIdFor(caseId);
  const current = await svc.get(ANES_TYPE, id).catch(() => null);
  if (!current) return { ...base, ok: false, status: 404, error: "anesthesia_not_started", caseId, written: 0 };
  if (current.endedAt) return { ...base, ok: true, written: 0, skipped: "already_ended", caseId, version: current.version };
  try {
    const out = await svc.put({ ...current, endedAt: new Date().toISOString(), endedBy: resolved.actor.id }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { caseId, written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, caseId, actorDeps, recordDeps } */
async function getAnesthesia(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", record: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, record: null };
  const record = await svc.get(ANES_TYPE, anesthesiaIdFor(str(ctx.caseId))).catch(() => null);
  return { ...base, ok: true, record };
}

/* ---- pre-anaesthetic checkup (PAC) ------------------------------------------------------------- */

/* The PAC form's closed vocabularies. Recorded exactly as the anaesthetist chose them: nothing here
 * computes an ASA class, grades an airway or judges a fasting interval, because those are the
 * anaesthetist's clinical calls, not rules this build may invent. Numbers are only range-checked. */
const PAC_MALLAMPATI = Object.freeze(["I", "II", "III", "IV", "not-assessable"]);
const PAC_NECK = Object.freeze(["normal", "restricted", "fixed"]);
const PAC_ASA = Object.freeze(["I", "II", "III", "IV", "V", "VI"]);
const PAC_FASTING = Object.freeze(["adequate", "inadequate", "not-fasted-emergency"]);
const PAC_TECHNIQUE = Object.freeze(["general", "spinal", "epidural", "combined-spinal-epidural", "regional-block", "sedation", "local-with-monitoring"]);
const PAC_DECISION = Object.freeze(["fit", "fit-with-conditions", "unfit"]);
// A last-intake time: null when not given, undefined when given but not a date.
const isoOrNull = (v) => { const t = str(v); if (!t) return null; const ms = Date.parse(t); return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined; };
const cm = (v, max) => { if (v === "" || v == null || typeof v === "boolean") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };

/** PURE. The checkup as it will be stored, or the first reason it is refused. */
function pacValidate(input) {
  const f = input && typeof input === "object" ? input : {};
  const bad = (field, detail) => ({ ok: false, error: "pac_invalid", field, detail });
  const history = str(f.history);
  if (!history) return bad("history", "record the history (conditions, previous anaesthetics, medicines, allergies), or say none");
  const a = f.airway || {};
  if (!PAC_MALLAMPATI.includes(str(a.mallampati))) return bad("airway.mallampati", `Mallampati is one of ${PAC_MALLAMPATI.join(", ")}`);
  const mouth = cm(a.mouthOpeningCm, 10), tmd = cm(a.thyromentalDistanceCm, 15);
  if (mouth == null) return bad("airway.mouthOpeningCm", "mouth opening in cm, 0 to 10");
  if (tmd == null) return bad("airway.thyromentalDistanceCm", "thyromental distance in cm, 0 to 15");
  if (!PAC_NECK.includes(str(a.neckMovement))) return bad("airway.neckMovement", `neck movement is one of ${PAC_NECK.join(", ")}`);
  if (!PAC_ASA.includes(str(f.asaClass))) return bad("asaClass", `ASA class is one of ${PAC_ASA.join(", ")}`);
  const fa = f.fasting || {};
  if (!PAC_FASTING.includes(str(fa.status))) return bad("fasting.status", `fasting status is one of ${PAC_FASTING.join(", ")}`);
  const solidsLastAt = isoOrNull(fa.solidsLastAt), clearFluidsLastAt = isoOrNull(fa.clearFluidsLastAt);
  if (solidsLastAt === undefined || clearFluidsLastAt === undefined) return bad("fasting", "a last-intake time is not a date and time");
  const inv = f.investigations || {};
  if (typeof inv.reviewed !== "boolean") return bad("investigations.reviewed", "say whether the investigations were reviewed");
  const p = f.plan || {};
  if (!PAC_TECHNIQUE.includes(str(p.technique))) return bad("plan.technique", `the planned technique is one of ${PAC_TECHNIQUE.join(", ")}`);
  const co = f.consent || {};
  if (typeof co.obtained !== "boolean") return bad("consent.obtained", "say whether consent for anaesthesia was obtained");
  const decision = str(f.decision);
  if (!PAC_DECISION.includes(decision)) return bad("decision", `the decision is one of ${PAC_DECISION.join(", ")}`);
  const decisionReason = str(f.decisionReason);
  if (decision !== "fit" && decisionReason.length < 5) return bad("decisionReason", decision === "unfit" ? "say why the patient is unfit" : "state the conditions");
  return {
    ok: true,
    pac: {
      history,
      airway: { mallampati: str(a.mallampati), mouthOpeningCm: mouth, thyromentalDistanceCm: tmd, neckMovement: str(a.neckMovement) },
      asaClass: str(f.asaClass), asaEmergency: f.asaEmergency === true,
      fasting: { status: str(fa.status), solidsLastAt, clearFluidsLastAt },
      investigations: { reviewed: inv.reviewed, summary: str(inv.summary) || null },
      plan: { technique: str(p.technique), notes: str(p.notes) || null },
      consent: { obtained: co.obtained, givenBy: str(co.givenBy) || null },
      decision, decisionReason: decisionReason || null,
    },
  };
}

/**
 * Records a case's pre-anaesthetic checkup, or revises it (a new version with a reason, naming the
 * version it replaces). Who and when come from the session and the server clock.
 * ctx: { migration, caseId, pac, revisionReason?, expectedVersion?, actorDeps, recordDeps }
 */
async function recordPac(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const caseId = str(ctx.caseId);
  if (!caseId) return { ...base, ok: false, status: 422, error: "case_required", written: 0 };
  const v = pacValidate(ctx.pac);
  if (!v.ok) return { ...base, status: 422, ...v, written: 0 };
  const reason = str(ctx.revisionReason);

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = pacIdFor(caseId);
  let c, current;
  try { [c, current] = await Promise.all([loadCase(svc, caseId), svc.get(PAC_TYPE, id)]); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ...writeFailure(e, { written: 0 }) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The case could not be read, so nothing was saved.", written: 0 };
  }
  if (!c) return { ...base, ok: false, status: 404, error: "case_not_found", caseId, written: 0 };
  if (current) {
    if (reason.length < 5) return { ...base, ok: false, status: 409, error: "already_recorded", detail: "a checkup is already recorded for this case; a change is a revision with a reason", version: current.version, written: 0 };
    if (!Number.isInteger(ctx.expectedVersion)) return { ...base, ok: false, status: 422, error: "expected_version_required", detail: "name the version being revised", version: current.version, written: 0 };
  } else if (reason) {
    return { ...base, ok: false, status: 409, error: "nothing_to_revise", detail: "no checkup is recorded for this case yet", written: 0 };
  }

  const record = {
    resourceType: PAC_TYPE, id, caseId, patientId: c.patientId, encounterId: c.encounterId || null,
    ...v.pac,
    assessedBy: resolved.actor.id, assessedAt: new Date().toISOString(),
    revision: current ? { reason, previousVersion: current.version, previousDecision: current.decision, previousAssessedBy: current.assessedBy || null, previousAssessedAt: current.assessedAt || null } : null,
    source: { system: "wardsynq-native", sourceId: `pac:${caseId}` },
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? ctx.expectedVersion : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, pacId: id, caseId, decision: record.decision, revised: !!current, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { caseId, written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, caseId, actorDeps, recordDeps } - pac is the record, or null when none is recorded. */
async function getPac(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", pac: null };
  const caseId = str(ctx.caseId);
  if (!caseId) return { ...base, ok: false, status: 422, error: "case_required", pac: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, pac: null };
  try { return { ...base, ok: true, caseId, pac: (await svc.get(PAC_TYPE, pacIdFor(caseId))) || null }; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The pre-anaesthetic checkup could not be read. Do not read this as not done.", pac: null }; }
}

/** Throws a coded refusal (shown verbatim, like the checklist's own) or returns the sign-in's PAC snapshot. */
async function pacGate(svc, c, acknowledgement) {
  let pac;
  try { pac = await svc.get(PAC_TYPE, pacIdFor(c.id)); }
  catch (e) { throw new SurgicalSafetyError("the pre-anaesthetic checkup could not be read, so sign in was not recorded; try again", "PAC_READ_FAILED"); }
  const ack = str(acknowledgement);
  const status = pac ? pac.decision : "missing";
  if (status === "missing" && ack.length < 5) throw new SurgicalSafetyError("no pre-anaesthetic checkup is recorded for this case; record one, or state why sign in proceeds without it", "PAC_MISSING");
  if (status === "unfit" && ack.length < 5) throw new SurgicalSafetyError(`the pre-anaesthetic checkup found the patient unfit (${pac.decisionReason || "no reason given"}); state why sign in proceeds`, "PAC_UNFIT");
  return {
    status, pacId: pac ? pac.id : null, version: pac ? pac.version : null,
    decisionReason: pac ? pac.decisionReason || null : null, asaClass: pac ? pac.asaClass : null,
    assessedBy: pac ? pac.assessedBy || null : null, assessedAt: pac ? pac.assessedAt || null : null,
    acknowledgement: status === "missing" || status === "unfit" ? ack : null,
  };
}

/* ---- implant / prosthesis traceability ---------------------------------------------------------- */

/** ctx: { migration, caseId, implant: {device, lot?, serial?, site?}, actorDeps, recordDeps } */
async function recordImplant(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const caseId = str(ctx.caseId);
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const c = await loadCase(svc, caseId).catch(() => null);
  if (!c) return { ...base, ok: false, status: 404, error: "case_not_found", caseId, written: 0 };
  const i = ctx.implant || {};
  const device = str(i.device);
  if (!device) return { ...base, ok: false, status: 422, error: "device_required", caseId, written: 0 };
  const id = implantIdFor(caseId, device, i.lot);
  const record = {
    resourceType: IMPLANT_TYPE, id, caseId, patientId: c.patientId, encounterId: c.encounterId,
    device, lot: str(i.lot) || null, serial: str(i.serial) || null, site: str(i.site) || null,
    recordedBy: resolved.actor.id, recordedAt: new Date().toISOString(),
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId, implantId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { caseId, written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, caseId?, actorDeps, recordDeps } */
async function listImplants(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", implants: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", implants: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, implants: [] };
  let rows;
  try { rows = await svc.byPatient(IMPLANT_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), implants: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), implants: [] };
  }
  const caseId = str(ctx.caseId);
  return { ...base, ok: true, implants: (rows || []).filter((r) => !caseId || r.caseId === caseId) };
}

export {
  CASE_TYPE, ANES_TYPE, IMPLANT_TYPE, SURGERY, PACU, caseIdFor, encounterIdForCase,
  bookSurgicalCase, recordCaseConsent, markCaseSite, signInCase, timeOutCase, inciseCase,
  signOutCase, abandonCase, rescheduleCase, recordTheatreTime, flagUnplannedReturn, recordOperativeNote, dispositionCase, getSurgicalCase, listSurgicalCases,
  listOpenCases,
  startAnesthesia, recordAnesthesiaEvent, endAnesthesia, getAnesthesia,
  recordImplant, listImplants,
  PAC_TYPE, pacIdFor, pacValidate, recordPac, getPac,
};
