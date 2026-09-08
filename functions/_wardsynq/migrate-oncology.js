/* functions/_wardsynq/migrate-oncology.js — the bridge into ONCqis, TASK 2.6.
 *
 * ONCqis (onco-*.js, functions/_onco_store.js, kb/onco/*) is a large, mature, OWNER-APPROVED
 * production oncology product: TNM staging (17 sites), 267 chemo protocols, a BSA/GFR dose engine,
 * CTCAE v5.0 / immune-related-AE toxicity grading, a plan/cycle store. NONE OF THAT IS REBUILT HERE.
 * The master plan is explicit: "ONCqis already exists. Do NOT rebuild it." This file does the one
 * thing that was genuinely missing: ONCqis's own store (functions/_onco_store.js) scopes every plan
 * by `hospitalId` + `ghisPatientId` (a bare MRN string) and has never been linked to a canonical
 * WardSynQ Patient/Encounter - a genuinely disconnected oncology record, exactly the failure mode
 * the master plan names.
 *
 * NOT A LIVE CALL INTO ONCqis'S OWN STORE. This file does not import functions/_onco_store.js and
 * does not read its Firestore collections directly - the same boundary WardSynQ already keeps
 * around GHIS (wardsynq-ghis-adapter.js references identifiers, it does not reach into GHIS's own
 * database). A link is recorded from the identifying facts a caller (ONCqis's own UI, or a
 * clinician) already has - planId, hospitalId, the regimen/protocol name and version, the ghis
 * patient id - resolved to WardSynQ's canonical patientId the SAME way every other GHIS-sourced
 * identity already is (patientIdForMrn - ghisPatientId doubles as the MRN, the same trap
 * wardsynq-ghis-adapter.js's own header already names).
 *
 * STAGING, REGIMEN CONTENT AND TOXICITY GRADES ARE NEVER RECOMPUTED. recordOncologyDiagnosis()
 * records the T/N/M and stage group ONCqis's own staging engine (onco-staging.js) already resolved,
 * as a bolt-on to the canonical Condition - the same convention every sibling migration uses for a
 * fact the canonical shape has no field for (migrate-inpatient.js's attendingId/reason). It asserts
 * nothing about what the values mean. recordAdverseEvent() records a CTCAE grade onco-ctcae.js
 * already assigned; this file grades nothing. recordChemoAdministration() records what a cycle's
 * administration actually was - drug, dose, BSA used, premedications, whether an extravasation
 * occurred - fields the audit for this task found WardSynQ's own single-dose eMAR model has no place
 * for, and ONCqis's own admin record does not structure either. It does not re-run the five-rights
 * scan/administer state machine (wardsynq-meds.js): that machine is reused unchanged for the actual
 * bedside act, through the existing /ward/mar door, when a chemo order is placed as an ordinary
 * WardSynQ MedicationOrder. This record is the LINKAGE and the DOCUMENTATION, not a second
 * administration authority.
 *
 * WHAT REMAINS EXPLICITLY OUT OF SCOPE, STATED RATHER THAN QUIETLY DECIDED: functions/_wardsynq/
 * actor.js fences every oncqis_* role to no clinical actor at all (verified by
 * test/wardsynq-record-service.test.mjs's own assertion that they resolve to null) - this file does
 * NOT change that. Writing an oncology link through these routes requires an ordinary WardSynQ
 * clinical role (the same emr.treat authority a diagnosis or a resus bundle already needs), not a
 * new oncqis_* grant - deciding whether ONCqis's own roles should gain scoped write access into the
 * canonical record is a real authorization-architecture decision this task does not make
 * unilaterally.
 *
 * node --test test/wardsynq-oncology.test.mjs
 */

import { Condition } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";

const LINK_TYPE = "OncologyLink";
const AE_TYPE = "AdverseEventRecord";
const CHEMO_TYPE = "ChemoAdministrationRecord";
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

function linkIdFor(oncoPlanId) { const p = slug(oncoPlanId); return p ? `wsq-onco-link-${p}` : null; }

/**
 * Links an ONCqis plan to the canonical WardSynQ patient - the join this task exists for.
 * ctx: { migration, encounterId?, plan: {oncoPlanId, hospitalId, ghisPatientId, regimen,
 *   protocolVersion}, actorDeps, recordDeps }
 */
async function linkOncologyPlan(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const p = ctx.plan || {};
  const oncoPlanId = str(p.oncoPlanId), ghisPatientId = str(p.ghisPatientId);
  const id = linkIdFor(oncoPlanId);
  if (!id) return { ...base, ok: false, status: 422, error: "onco_plan_id_required", written: 0 };
  const patientId = patientIdForMrn(ghisPatientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "ghis_patient_id_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await svc.get(LINK_TYPE, id).catch(() => null);
  const record = {
    resourceType: LINK_TYPE, id, patientId, encounterId: str(ctx.encounterId) || null,
    oncoPlanId, hospitalId: str(p.hospitalId) || null, ghisPatientId,
    regimen: str(p.regimen) || null, protocolVersion: str(p.protocolVersion) || null,
    linkedBy: resolved.actor.id, linkedAt: new Date().toISOString(),
    source: { system: "wardsynq-native", sourceId: `oncology-link:${id}` },
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, linkId: id, patientId, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function getOncologyLink(request, env, ctx) {
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
 * Records the oncology diagnosis, with the staging result ONCqis's own engine already resolved
 * bolted onto the canonical Condition - never recomputed here.
 * ctx: { migration, patientId, encounterId, condition: {code, codeSystem?, display}, staging?:
 *   {oncoSite, stageGroup, t, n, m, resolvedAt}, actorDeps, recordDeps }
 */
async function recordOncologyDiagnosis(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  const c = ctx.condition || {};
  const code = str(c.code);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!code) return { ...base, ok: false, status: 422, error: "code_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = `wsq-onco-dx-${slug(patientId)}-${slug(code)}`;
  const current = await svc.get("Condition", id).catch(() => null);
  const condition = Condition({
    id, patientId, encounterId: encounterId || null, code, codeSystem: str(c.codeSystem) || "unspecified",
    display: str(c.display) || code, clinicalStatus: "active", verificationStatus: "confirmed",
    onsetDate: str(c.onsetDate) || null,
  });
  const s = ctx.staging || null;
  // Bolted on, the convention every sibling migration keeps for a fact the canonical shape has no
  // field for. ONCqis's own staging engine resolved this; nothing here re-derives it.
  if (s) {
    condition.oncologyStaging = {
      oncoSite: str(s.oncoSite) || null, stageGroup: str(s.stageGroup) || null,
      t: str(s.t) || null, n: str(s.n) || null, m: str(s.m) || null,
      resolvedAt: str(s.resolvedAt) || null, source: "oncqis",
    };
  }
  try {
    const out = await svc.put(condition, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, conditionId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/**
 * Records a CTCAE-graded adverse event - the grade onco-ctcae.js already assigned, never graded here.
 * ctx: { migration, patientId, encounterId, oncoPlanId?, event: {term, grade, ctcaeVersion?}, actorDeps, recordDeps }
 */
async function recordAdverseEvent(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  const e = ctx.event || {};
  const term = str(e.term);
  const grade = Number(e.grade);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!term) return { ...base, ok: false, status: 422, error: "term_required", written: 0 };
  if (!Number.isInteger(grade) || grade < 1 || grade > 5) return { ...base, ok: false, status: 422, error: "grade_must_be_1_to_5", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = new Date().toISOString();
  const id = `wsq-onco-ae-${slug(patientId)}-${slug(term)}-${slug(at)}`;
  const record = {
    resourceType: AE_TYPE, id, patientId, encounterId: encounterId || null, oncoPlanId: str(ctx.oncoPlanId) || null,
    term, grade, ctcaeVersion: str(e.ctcaeVersion) || "5.0", source: "oncqis",
    gradedBy: resolved.actor.id, gradedAt: at,
    sourceDoc: { system: "wardsynq-native", sourceId: `adverse-event:${id}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, eventId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e2) { return { ...base, ...writeFailure(e2, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function listAdverseEvents(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", events: [] };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, events: [] };
  let rows;
  try { rows = await svc.byPatient(AE_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), events: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), events: [] };
  }
  return { ...base, ok: true, events: rows || [] };
}

/**
 * Documents a chemotherapy administration: what a cycle's dose actually was, tied to the plan/cycle,
 * with the fields the audit found nowhere else has - premedications, dose lineage, a structured
 * extravasation/reaction field. Does NOT re-run the five-rights scan/administer state machine
 * (wardsynq-meds.js): that machine is reused unchanged, through the existing /ward/mar door, for the
 * actual bedside act when a chemo order is placed as an ordinary WardSynQ MedicationOrder. This is
 * the record and the linkage, never a second administration authority.
 * ctx: { migration, patientId, encounterId, oncoPlanId, cycleId, admin: {drug, doseGiven, doseUnit,
 *   bsaUsed?, route, startedAt?, endedAt?, premedications?: string[], extravasation?: {occurred,
 *   detail?}}, actorDeps, recordDeps }
 */
async function recordChemoAdministration(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  const oncoPlanId = str(ctx.oncoPlanId), cycleId = str(ctx.cycleId);
  const a = ctx.admin || {};
  const drug = str(a.drug);
  if (!patientId || !encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!oncoPlanId || !cycleId) return { ...base, ok: false, status: 422, error: "plan_and_cycle_required", written: 0 };
  if (!drug) return { ...base, ok: false, status: 422, error: "drug_required", written: 0 };
  const doseGiven = Number(a.doseGiven);
  if (!(doseGiven > 0)) return { ...base, ok: false, status: 422, error: "dose_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const startedAt = str(a.startedAt) || new Date().toISOString();
  const id = `wsq-chemo-${slug(cycleId)}-${slug(drug)}-${slug(startedAt)}`;
  const current = await svc.get(CHEMO_TYPE, id).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "already_recorded", chemoId: id };

  const record = {
    resourceType: CHEMO_TYPE, id, patientId, encounterId, oncoPlanId, cycleId,
    drug, doseGiven, doseUnit: str(a.doseUnit) || null, bsaUsed: a.bsaUsed == null ? null : Number(a.bsaUsed),
    route: str(a.route) || null, startedAt, endedAt: str(a.endedAt) || null,
    premedications: Array.isArray(a.premedications) ? a.premedications.map(str).filter(Boolean) : [],
    // Structured, never a bare free-text field: whether it happened is a fact a chart must be able
    // to query, not something buried in prose.
    extravasation: { occurred: !!(a.extravasation && a.extravasation.occurred), detail: str(a.extravasation && a.extravasation.detail) || null },
    administeredBy: resolved.actor.id, recordedAt: new Date().toISOString(),
    source: { system: "wardsynq-native", sourceId: `chemo-administration:${id}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, chemoId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function listChemoAdministrations(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", administrations: [] };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, administrations: [] };
  let rows;
  try { rows = await svc.byPatient(CHEMO_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), administrations: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), administrations: [] };
  }
  return { ...base, ok: true, administrations: rows || [] };
}

/**
 * THE LONGITUDINAL TIMELINE the master plan requires: everything this file has linked, for one
 * patient, in one read - the concrete proof that the oncology record is no longer disconnected.
 * ctx: { migration, patientId, actorDeps, recordDeps }
 */
async function oncologyTimeline(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", timeline: null };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, timeline: null };

  const [links, conditions, events, admins] = await Promise.all([
    svc.byPatient(LINK_TYPE, patientId).catch(() => []),
    svc.byPatient("Condition", patientId).catch(() => []),
    svc.byPatient(AE_TYPE, patientId).catch(() => []),
    svc.byPatient(CHEMO_TYPE, patientId).catch(() => []),
  ]);
  return {
    ...base, ok: true, timeline: {
      patientId, links: links || [],
      diagnoses: (conditions || []).filter((c) => c && c.oncologyStaging),
      adverseEvents: events || [], chemoAdministrations: admins || [],
    },
  };
}

export {
  LINK_TYPE, AE_TYPE, CHEMO_TYPE, linkIdFor,
  linkOncologyPlan, getOncologyLink, recordOncologyDiagnosis,
  recordAdverseEvent, listAdverseEvents,
  recordChemoAdministration, listChemoAdministrations, oncologyTimeline,
};
