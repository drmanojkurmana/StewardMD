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

const CASE_TYPE = "SurgicalCase";
const ANES_TYPE = "AnesthesiaRecord";
const IMPLANT_TYPE = "ImplantRecord";
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
  return { ...base, ok: false, status: e && ["NO_PATIENT", "NO_ACTOR", "NO_PROCEDURE", "NO_LATERALITY"].includes(e.code) ? 422 : 409, error: "surgical_refused", code: (e && e.code) || null, detail: str(e && e.message), ...extra };
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
  const bookedAt = str(b.scheduledAt) || new Date().toISOString();
  const caseId = caseIdFor(patientId, b.procedure, bookedAt);
  if (!caseId) return { ...base, ok: false, status: 422, error: "procedure_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await loadCase(svc, caseId).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "unchanged", caseId, encounterId: current.encounterId, version: current.version };

  let c;
  try { c = await engine.book({ id: patientId, mrn }, { procedure: b.procedure, site: b.site, laterality: b.laterality }, resolved.actor.id); }
  catch (e) { return caseRefusal(base, e, { written: 0 }); }
  c.id = caseId;

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
  try { updated = await apply(c, resolved); }
  catch (e) { return caseRefusal(base, e, { caseId, written: 0 }); }

  try {
    const out = await svc.put(serializeCase(updated), { expectedVersion: c.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId, stage: updated.stage, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { caseId, written: 0, actor: resolved.actor.id }) };
  }
}

const markCaseSite = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => engine.markSite(c, ctx.marking || {}, r.actor.id));
const signInCase = (request, env, ctx) => mutateCase(request, env, ctx, (c) => engine.signIn(c, ctx.submission || {}));
const timeOutCase = (request, env, ctx) => mutateCase(request, env, ctx, (c) => engine.timeOut(c, ctx.submission || {}));
const inciseCase = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => engine.incise(c, r.actor.id));
const signOutCase = (request, env, ctx) => mutateCase(request, env, ctx, (c) => engine.signOut(c, ctx.submission || {}));
const abandonCase = (request, env, ctx) => mutateCase(request, env, ctx, (c, r) => engine.abandon(c, r.actor.id, str(ctx.reason)));

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
  signOutCase, abandonCase, recordOperativeNote, dispositionCase, getSurgicalCase, listSurgicalCases,
  listOpenCases,
  startAnesthesia, recordAnesthesiaEvent, endAnesthesia, getAnesthesia,
  recordImplant, listImplants,
};
