/* functions/_wardsynq/migrate-cardiology.js — the bridge into KardiQ X, TASK 2.7.
 *
 * KardiQ X (kardiox*.js) is an AI ECG-photo interpreter: a single EfficientNet-B3 classifier reading
 * ECG photos, self-declared "clinically unvalidated, regulatory-pending" (docs/ecg-engine-roadmap.md,
 * vault/Flags.md's smd_kardiox entry). It has NO patient/encounter concept and NO server-side store -
 * every ECGAnalysis (kardiox-store.js) lives local-only, encrypted at rest, "never syncs to the
 * cloud". A genuinely disconnected record, the same failure mode Task 2.6 closed for ONCqis. This
 * file does the one thing genuinely missing: a caller who already has KardiQ X's own verdict can
 * link it to a canonical WardSynQ Patient/Encounter.
 *
 * NOTHING RE-INTERPRETED. This file never re-reads an ECG image, never re-runs the classifier, and
 * never re-derives a HEART/TIMI score - it records the verdict KardiQ X's own engine already
 * produced, exactly as recordOncologyDiagnosis() records staging onco-staging.js already resolved.
 *
 * UNVALIDATED, STATED RATHER THAN HIDDEN: unlike ONCqis (owner-approved production status),
 * KardiQ X's own documentation states no real-phone-photo performance has ever been measured. Every
 * ECGReference this file writes carries `unvalidated: true` and `source: "kardiox"` so nothing
 * downstream can present it as a validated clinical finding.
 *
 * NO NEW Encounter.class. The audit for this task found cardiology needs none: a consult/stress-test
 * referral is OPD/DAYCARE, a cath-lab procedure is SURGERY/PACU (migrate-surgery.js's WHO-checklist
 * SurgicalCase and its ImplantRecord already fit a coronary stent as-is - device/lot/serial/site),
 * an admitted cardiology inpatient is IPD. None of that is touched here.
 *
 * node --test test/wardsynq-cardiology.test.mjs
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";

const LINK_TYPE = "CardiologyLink";
const ECG_TYPE = "ECGReference";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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

function linkIdFor(kardioxRecordId) { const p = slug(kardioxRecordId); return p ? `wsq-cardio-link-${p}` : null; }

/**
 * Links a KardiQ X ECG record to the canonical WardSynQ patient - the join this task exists for.
 * ctx: { migration, encounterId?, link: {kardioxRecordId, mrn}, actorDeps, recordDeps }
 */
async function linkCardiologyRecord(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const p = ctx.link || {};
  const kardioxRecordId = str(p.kardioxRecordId), mrn = str(p.mrn);
  const id = linkIdFor(kardioxRecordId);
  if (!id) return { ...base, ok: false, status: 422, error: "kardiox_record_id_required", written: 0 };
  const patientId = patientIdForMrn(mrn);
  if (!patientId) return { ...base, ok: false, status: 422, error: "mrn_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await svc.get(LINK_TYPE, id).catch(() => null);
  const record = {
    resourceType: LINK_TYPE, id, patientId, encounterId: str(ctx.encounterId) || null,
    kardioxRecordId, mrn,
    linkedBy: resolved.actor.id, linkedAt: new Date().toISOString(),
    source: { system: "wardsynq-native", sourceId: `cardiology-link:${id}` },
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, linkId: id, patientId, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function getCardiologyLink(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", links: [] };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, links: [] };
  let rows;
  try { rows = await svc.byPatient(LINK_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), links: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), links: [] };
  }
  return { ...base, ok: true, links: rows || [] };
}

/**
 * Records the AI ECG verdict KardiQ X already produced - never re-interpreted here.
 * ctx: { migration, patientId, encounterId, ecg: {kardioxRecordId, verdict, findings?: string[],
 *   heartScore?, timiScore?, capturedAt?}, actorDeps, recordDeps }
 */
async function recordEcgReference(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  const e = ctx.ecg || {};
  const kardioxRecordId = str(e.kardioxRecordId);
  const verdict = str(e.verdict);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!kardioxRecordId) return { ...base, ok: false, status: 422, error: "kardiox_record_id_required", written: 0 };
  if (!verdict) return { ...base, ok: false, status: 422, error: "verdict_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = `wsq-ecg-${slug(kardioxRecordId)}`;
  const current = await svc.get(ECG_TYPE, id).catch(() => null);
  const record = {
    resourceType: ECG_TYPE, id, patientId, encounterId: encounterId || null, kardioxRecordId,
    verdict, findings: Array.isArray(e.findings) ? e.findings.map(str).filter(Boolean) : [],
    heartScore: e.heartScore == null ? null : Number(e.heartScore),
    timiScore: e.timiScore == null ? null : Number(e.timiScore),
    capturedAt: str(e.capturedAt) || null,
    // KardiQ X's own status, stated not hidden: docs/ecg-engine-roadmap.md - no real-phone-photo
    // performance has ever been measured. Never presented downstream as a validated finding.
    unvalidated: true, source: "kardiox",
    recordedBy: resolved.actor.id, recordedAt: new Date().toISOString(),
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ecgId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e2) { return { ...base, ...writeFailure(e2, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function listEcgReferences(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", ecgs: [] };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, ecgs: [] };
  let rows;
  try { rows = await svc.byPatient(ECG_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), ecgs: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), ecgs: [] };
  }
  return { ...base, ok: true, ecgs: rows || [] };
}

/**
 * The longitudinal cardiology timeline for one patient - link plus every ECG reference.
 * ctx: { migration, patientId, actorDeps, recordDeps }
 */
async function cardiologyTimeline(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", timeline: null };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, timeline: null };

  /* Same rule as the oncology timeline: a part that failed is named, never returned as empty. */
  const incomplete = [];
  const read = (type, what) => svc.byPatient(type, patientId).catch(() => { incomplete.push(what); return null; });
  const [links, ecgs] = await Promise.all([
    read(LINK_TYPE, "KardiQ X link"),
    read(ECG_TYPE, "ECGs"),
  ]);
  return { ...base, ok: true, ...(incomplete.length ? { incomplete, warning: "Could not read: " + incomplete.join(", ") + ". Do not read those as empty." } : {}), timeline: { patientId, links: links || [], ecgs: ecgs || [] } };
}

export {
  LINK_TYPE, ECG_TYPE, linkIdFor,
  linkCardiologyRecord, getCardiologyLink,
  recordEcgReference, listEcgReferences, cardiologyTimeline,
};
