/* functions/_wardsynq/migrate-ed.js — the emergency department half of the ward vertical: arrival
 * (known or unidentified), triage acuity, and disposition (home / admitted / transferred / left
 * without being seen / deceased).
 *
 * REUSES, DELIBERATELY, EVERYTHING DOWNSTREAM OF ARRIVAL. Ward vitals (migrate-inpatient.js),
 * clinical notes (note-templates.js), medication and investigation orders (migrate-inpatient.js,
 * ward-order.js), the five-rights eMAR (wardsynq-meds.js via migrate-emar.js), labs/specimens
 * (lab-result.js, specimen.js), NEWS2/PEWS (news2-view.js) and critical-result loops
 * (critical-results.js) are ALL encounter-class-agnostic already - none of them read
 * Encounter.class - so nothing in this file duplicates them. This file adds only what those
 * genuinely lack: an ED Encounter to hang everything off, an identity for a patient arriving with
 * none, and a way for an ED visit to end WITHOUT an admission.
 *
 * UNIDENTIFIED PATIENTS use wardsynq-mpi.js's makeProvisionalIdentity() - built and tested since
 * before this file existed (test/wardsynq-mpi.test.mjs), never wired to a route until now. The
 * provisional Patient this writes is DELIBERATELY not a placeholder pending a "real" registration
 * later: it is the record, the same one every subsequent order/dose/result is written against,
 * until a person MERGES it with a confirmed identity through the EXISTING merge path
 * (wardsynq-mpi.js merge/unmerge, reachable via mpi-view.js) - which moves nothing and can be taken
 * back, exactly as it already works for every other identity conflict in this system. Nothing here
 * builds a second unidentified-patient scheme.
 *
 * THE SEQUENCE THAT MAKES A PROVISIONAL MRN UNIQUE IS FOUND HERE, NOT TRUSTED FROM A CALLER. Two
 * simultaneous unidentified arrivals of the same sex on the same day must never collide on one
 * provisional MRN - a wrong-patient hazard makeProvisionalIdentity's own comment names directly. The
 * same (tenant, resourceType, id, version) uniqueness every other atomic write in this system
 * already depends on (see migrate-inpatient.js's claimBed(), which this mirrors) decides a genuine
 * race: two arrivals computing the same candidate sequence both attempt the same Patient id: version
 * 1, the storage layer lands exactly one, and the loser retries the next sequence.
 *
 * TRIAGE ACUITY IS NEVER COMPUTED. It is the one thing in this whole file a human chooses, exactly
 * once (recordEdTriage). No algorithm here derives it from vitals, NEWS2 or anything else - the
 * vitals and the acuity are two separate facts on the same chart, read by a clinician. This
 * hospital's own acuity SCALE (what each level of 1-5 is called) is ORG content, the same convention
 * formulary.js/note-templates.js/admission-request.js already use for content this file must not
 * invent: the level is stored; what a hospital calls it is theirs, and nothing here ships a default.
 *
 * DISPOSITION "admitted" DOES NOT WRITE A SECOND ADMISSION MECHANISM. It closes the ED Encounter and
 * calls admitPatient() (migrate-inpatient.js) - the SAME governed door, the SAME bed-occupancy guard
 * (functions/_wardsynq/migrate-inpatient.js, closed under PR #971) - so an ED patient admitted to a
 * bed is checked against every other open admission exactly as any other admission is.
 */

import { Encounter } from "../../wardsynq/wardsynq-model.js";
import { makeProvisionalIdentity } from "../../wardsynq/wardsynq-mpi.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";
import { admitPatient } from "./migrate-inpatient.js";

const ED = "ED";
const OPEN = "in-progress";
const FINISHED = "finished";
const DISPOSITIONS = Object.freeze(["home", "admitted", "transferred", "lwbs", "deceased"]);
const MAX_SEQUENCE_ATTEMPTS = 25;

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Deterministic, the same convention as admissionIdFor (opd-identity.js): mrn + arrival instant. */
function edVisitIdFor(mrn, arrivedAt) {
  const m = slug(mrn), at = slug(arrivedAt);
  return m && at ? `wsq-ed-${m}-${at}` : null;
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

/**
 * Arrival. ctx: { migration, arrival: { mrn?, unknown?: {sex, name?}, chiefComplaint?, arrivedAt?,
 *   facilityId? }, actorDeps, recordDeps }
 * Exactly one of arrival.mrn / arrival.unknown is required. A known patient must already be
 * registered - this door does not invent a Patient for a named person, the same rule
 * admitPatient() already keeps for an admission's identity.
 */
async function edArrival(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const arrival = ctx.arrival || {};
  const arrivedAt = str(arrival.arrivedAt) || new Date().toISOString();
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  if (arrival.unknown) {
    return arriveUnknown(svc, resolved, base, arrival, arrivedAt, ctx);
  }

  const mrn = str(arrival.mrn);
  if (!mrn) return { ...base, ok: false, status: 422, error: "identity_required", detail: "name the patient by MRN, or arrival.unknown for a genuinely unidentified one", written: 0 };
  return openEdEncounter(svc, resolved, base, mrn, arrivedAt, arrival, ctx, 0);
}

/** The provisional-identity path: find a sequence nobody else has just claimed, write the Patient,
 *  then open the encounter under the same mrn. */
async function arriveUnknown(svc, resolved, base, arrival, arrivedAt, ctx) {
  let candidates;
  try { candidates = await svc.list("Patient", 1000); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  let start = 1;
  try {
    const probe = makeProvisionalIdentity({ sex: arrival.unknown.sex, name: arrival.unknown.name, arrivedAt, sequence: 1 });
    // The token+day prefix, shared by every unidentified arrival of this sex today - so the count
    // starts past whoever else already arrived, rather than always guessing 1 and retrying every time.
    const prefix = probe.mrn.replace(/-01$/, "-");
    start = (candidates || []).filter((p) => p && str(p.mrn).startsWith(prefix)).length + 1;
  } catch (e) { return { ...base, ok: false, status: 422, error: "invalid_arrival", detail: str(e && e.message), written: 0 }; }

  for (let attempt = 0; attempt < MAX_SEQUENCE_ATTEMPTS; attempt++) {
    const sequence = start + attempt;
    let provisional;
    try { provisional = makeProvisionalIdentity({ sex: arrival.unknown.sex, name: arrival.unknown.name, arrivedAt, sequence }); }
    catch (e) { return { ...base, ok: false, status: 422, error: "invalid_arrival", detail: str(e && e.message), written: 0 }; }
    const patientId = patientIdForMrn(provisional.mrn);
    const newPatient = { ...provisional, id: patientId };

    try {
      await svc.put(newPatient, { idempotencyKey: null });
    } catch (e) {
      if (e instanceof VersionConflictError) continue;   // this sequence was just claimed - try the next
      return { ...base, ...writeFailure(e, { written: 0 }) };
    }
    // The Patient landed; the encounter is opened under the SAME mrn as any known-identity arrival.
    const result = await openEdEncounter(svc, resolved, base, provisional.mrn, arrivedAt, arrival, ctx, 1);
    return { ...result, provisional: true };
  }
  return { ...base, ok: false, status: 409, error: "sequence_exhausted", detail: `could not find a free provisional MRN after ${MAX_SEQUENCE_ATTEMPTS} attempts - an unusually busy day for unidentified arrivals of this sex; try again`, written: 0 };
}

async function openEdEncounter(svc, resolved, base, mrn, arrivedAt, arrival, ctx, alreadyWritten) {
  const patientId = patientIdForMrn(mrn);
  const encId = edVisitIdFor(mrn, arrivedAt);
  if (!patientId || !encId) return { ...base, ok: false, status: 422, error: "identity_required", written: alreadyWritten };

  let currentEnc;
  try { currentEnc = await svc.get("Encounter", encId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: alreadyWritten }; }
  if (currentEnc) return { ...base, ok: true, written: alreadyWritten, skipped: "unchanged", encounterId: encId, patientId, mrn, version: currentEnc.version, actor: resolved.actor.id };

  const enc = Encounter({
    id: encId, patientId, class: ED, status: OPEN,
    identifiers: [{ system: "opd-mrn", value: mrn }],
    location: { facilityId: str(arrival.facilityId) || null, ward: "ED", bed: null },
    periodStart: arrivedAt, periodEnd: null,
    source: { system: "wardsynq-native", sourceId: `ed-arrival:${encId}` },
  });
  const cc = str(arrival.chiefComplaint);
  if (cc) enc.reason = cc;

  try {
    const out = await svc.put(enc, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: alreadyWritten + 1, encounterId: encId, patientId, mrn, version: out.record.version, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { encounterId: encId, patientId, mrn, written: alreadyWritten, actor: resolved.actor.id }) };
  }
}

/**
 * Triage. A human's acuity choice, recorded on the Encounter as a new version - the same
 * bolted-on-field convention transferPatient() already uses for movedBy/movedFrom. Never computed.
 * ctx: { migration, encounterId, acuity (required, 1-5), chiefComplaint?, actorDeps, recordDeps }
 */
async function recordEdTriage(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  const acuity = Number(ctx.acuity);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!Number.isInteger(acuity) || acuity < 1 || acuity > 5) {
    return { ...base, ok: false, status: 422, error: "acuity_required", detail: "acuity is a whole number 1-5, chosen by the triage nurse - never computed here", written: 0 };
  }

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };
  if (current.class !== ED) return { ...base, ok: false, status: 409, error: "not_an_ed_visit", detail: "triage is for an ED presentation", encounterId, written: 0 };
  if (current.status !== OPEN) return { ...base, ok: false, status: 409, error: "not_open", detail: "this ED visit is closed", encounterId, written: 0 };

  const next = Encounter({
    id: current.id, patientId: current.patientId, class: current.class, status: current.status,
    identifiers: current.identifiers, location: current.location,
    periodStart: current.periodStart, periodEnd: current.periodEnd,
    source: { system: "wardsynq-native", sourceId: `ed-triage:${current.id}` },
  });
  if (current.attendingId) next.attendingId = current.attendingId;
  const cc = str(ctx.chiefComplaint) || str(current.reason);
  if (cc) next.reason = cc;
  next.acuity = acuity;
  next.triagedAt = new Date().toISOString();
  next.triagedBy = resolved.actor.id;

  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, encounterId, acuity, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { encounterId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Disposition: the ED visit ends. "admitted" hands off to admitPatient() (the SAME governed,
 * bed-guarded admission door); every other disposition simply closes the encounter.
 * ctx: { migration, encounterId, disposition (required), reason?, at?,
 *   admission?: {ward, bed?, class?} - required when disposition is "admitted", actorDeps, recordDeps }
 */
async function edDisposition(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  const disposition = str(ctx.disposition);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!DISPOSITIONS.includes(disposition)) {
    return { ...base, ok: false, status: 422, error: "disposition_required", detail: `disposition must be one of ${DISPOSITIONS.join(", ")}`, written: 0 };
  }

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };
  if (current.class !== ED) return { ...base, ok: false, status: 409, error: "not_an_ed_visit", encounterId, written: 0 };
  if (current.status !== OPEN) return { ...base, ok: true, written: 0, skipped: "already_closed", encounterId, disposition: current.disposition || null, version: current.version };

  const at = str(ctx.at) || new Date().toISOString();

  if (disposition === "admitted") {
    const admission = ctx.admission || {};
    if (!str(admission.ward)) return { ...base, ok: false, status: 422, error: "ward_required", detail: "an ED admission needs the ward it is admitting to", written: 0 };
    const mrn = (current.identifiers || []).find((i) => i && i.system === "opd-mrn");
    if (!mrn || !str(mrn.value)) return { ...base, ok: false, status: 502, error: "record_write_failed", detail: "this ED encounter carries no MRN identifier to admit under", written: 0 };
    const admitResult = await admitPatient(request, env, {
      // class forwarded, TASK 2.9 fix: without it every ED admission silently defaulted to IPD
      // regardless of what was requested, which blocked the master plan's own primary journey
      // (ED -> ICU) - admitPatient()/encounterFromAdmission() already validate it against
      // ADMISSION_CLASSES and fall back to IPD themselves, so this only forwards the request.
      ...ctx, admission: { mrn: mrn.value, ward: admission.ward, bed: admission.bed || undefined, class: admission.class || undefined, admittedAt: at, reason: str(ctx.reason) || current.reason || undefined },
    });
    if (!admitResult.ok) return admitResult;   // the SAME bed-occupancy refusal an inpatient admit would give
    const closed = await closeEdEncounter(svc, current, disposition, at, ctx);
    if (!closed.ok) return closed;
    return { ...base, ok: true, written: 2, encounterId, disposition, admittedEncounterId: admitResult.encounterId, patientId: current.patientId, version: closed.version, actor: resolved.actor.id };
  }

  const closed = await closeEdEncounter(svc, current, disposition, at, ctx);
  if (!closed.ok) return closed;
  return { ...base, ok: true, written: 1, encounterId, disposition, patientId: current.patientId, version: closed.version, actor: resolved.actor.id };
}

async function closeEdEncounter(svc, current, disposition, at, ctx) {
  const next = Encounter({
    id: current.id, patientId: current.patientId, class: current.class, status: FINISHED,
    identifiers: current.identifiers, location: current.location,
    periodStart: current.periodStart, periodEnd: at,
    source: { system: "wardsynq-native", sourceId: `ed-disposition:${current.id}` },
  });
  if (current.attendingId) next.attendingId = current.attendingId;
  if (current.reason) next.reason = current.reason;
  if (current.acuity != null) next.acuity = current.acuity;
  if (current.triagedAt) { next.triagedAt = current.triagedAt; next.triagedBy = current.triagedBy; }
  next.disposition = disposition;
  const reason = str(ctx.reason);
  if (reason) next.dispositionReason = reason;
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ok: true, version: out.record.version };
  } catch (e) {
    return { ok: false, ...writeFailure(e, {}) };
  }
}

/**
 * The ED board: every open ED presentation, from the record itself - the same query-not-a-table
 * discipline listWard() already keeps for the inpatient ward list.
 * ctx: { migration, actorDeps, recordDeps }
 */
async function listEd(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", patients: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, patients: [] };

  let encounters;
  try { encounters = await svc.list("Encounter", 200); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), detail: str(e.message), patients: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), patients: [] };
  }

  const patients = (encounters || [])
    .filter((e) => e && e.class === ED && e.status === OPEN)
    .map((e) => ({
      encounterId: e.id, patientId: e.patientId,
      mrn: ((e.identifiers || []).find((i) => i && i.system === "opd-mrn") || {}).value || null,
      chiefComplaint: e.reason || null, acuity: e.acuity != null ? e.acuity : null,
      arrivedAt: e.periodStart || null, triagedAt: e.triagedAt || null, version: e.version,
    }))
    // Untriaged first, then by acuity (1 = most urgent), then by longest wait - so the board reads
    // as a worklist, not an arrival log. A human still decides who is actually seen next.
    .sort((a, b) => {
      if (!a.acuity && b.acuity) return -1;
      if (a.acuity && !b.acuity) return 1;
      if (a.acuity !== b.acuity) return (a.acuity || 99) - (b.acuity || 99);
      return String(a.arrivedAt).localeCompare(String(b.arrivedAt));
    });
  return { ...base, ok: true, patients };
}

export { ED, OPEN, FINISHED, DISPOSITIONS, edVisitIdFor, edArrival, recordEdTriage, edDisposition, listEd };
