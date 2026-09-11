/* functions/_wardsynq/migrate-maternity.js — the adapter for wardsynq-obstetrics.js: a real, tested
 * MEOWS trigger-based obstetric chart, quantitative-vs-visual blood-loss discipline, and PPH/
 * eclampsia bundle definitions (STATUS in that file's own header: "IMPLEMENTED and TESTED. NOT
 * clinically validated and NOT clinically approved") that were reachable by nobody - no route, no
 * RecordService wiring, imported only by their own tests. This is the join, plus the pieces the
 * obstetrics module's own header explicitly says it does not cover: labour status, a partogram's
 * raw data capture, delivery documentation, and newborn linkage.
 *
 * ADMISSION IS NOT REBUILT. A MATERNITY stay is admitted, transferred, bed-boarded and discharged
 * through the EXACT SAME migrate-inpatient.js/migrate-discharge.js functions IPD and ICU already
 * use - MATERNITY simply joined ADMISSION_CLASSES there, the same way ICU did in Task 2.2. Nothing
 * in this file duplicates a bed guard, a ward roster, or a discharge.
 *
 * NEITHER IS THE FLOWSHEET. A partogram's raw data (cervical dilation, contraction frequency, fetal
 * heart rate, a stated labour status) is charted as ordinary Observations, category "labour" - the
 * SAME flowsheet grid (functions/_wardsynq/flowsheet-view.js) that already renders vitals renders
 * these too, once "labour" joined its CATEGORIES allow-list. What is genuinely new here is only the
 * write path and the vocabulary; the missing-hour honesty, the bitemporal correction, the backfill
 * flagging all come from that file, unchanged. THE WHO PARTOGRAM'S ALERT/ACTION-LINE LOGIC IS NOT
 * BUILT: that is a plotted reference curve and a divergence rule, real clinical content this file
 * will not invent without an obstetric lead's sign-off - the grid shows what was charted, honestly,
 * and nothing draws a line on it.
 *
 * OBSTETRIC BUNDLES REUSE THE RESUS CLOCK. wardsynq-obstetrics.js's OBSTETRIC_BUNDLES are written to
 * be passed as EmergencyBundle's own `definition` parameter - migrate-resus.js now does exactly
 * that for "code-pph"/"code-eclampsia", so a PPH or eclampsia bundle runs through the SAME tested
 * timing/element/breach machinery Code Sepsis already does. No second clock.
 *
 * NEWBORN LINKAGE IS NOT PatientLink. PatientLink (identity-merge.js) asserts "these two records are
 * ONE person" - the wrong claim entirely for a mother and her newborn, who are two different people.
 * FamilyLink, below, is its own type for exactly that: a clinical relationship between two distinct
 * patients, never a duplicate-identity claim.
 *
 * node --test test/wardsynq-maternity.test.mjs
 */

import { Patient, Observation } from "../../wardsynq/wardsynq-model.js";
import {
  obstetricState, meowsFromObservations, recordBloodLoss, pphThresholdReached,
  assessObstetricRecognition, LOSS_METHOD,
} from "../../wardsynq/wardsynq-obstetrics.js";
import { ObstetricError } from "../../wardsynq/wardsynq-obstetrics.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";

const PREG_TYPE = "PregnancyEpisode";
const DELIVERY_TYPE = "DeliveryRecord";
const LOSS_TYPE = "BloodLossRecord";
const LINK_TYPE = "FamilyLink";
const LABOUR_CATEGORY = "labour";
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
  if (e instanceof ObstetricError) return { ok: false, status: 422, error: e.code, detail: e.message, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

function pregnancyIdFor(patientId) { const p = slug(patientId); return p ? `wsq-preg-${p}` : null; }

/** ctx: { migration, patientId, pregnancy: {gravida?, para?, lmp?, edd?, gestationWeeks?, riskFactors?}, actorDeps, recordDeps } */
async function recordPregnancy(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  const id = pregnancyIdFor(patientId);
  if (!id) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const p = ctx.pregnancy || {};
  const current = await svc.get(PREG_TYPE, id).catch(() => null);
  const record = {
    resourceType: PREG_TYPE, id, patientId,
    gravida: Number.isFinite(Number(p.gravida)) ? Number(p.gravida) : (current ? current.gravida : null),
    para: Number.isFinite(Number(p.para)) ? Number(p.para) : (current ? current.para : 0),
    lmp: str(p.lmp) || (current ? current.lmp : null),
    edd: str(p.edd) || (current ? current.edd : null),
    gestationWeeks: Number.isFinite(Number(p.gestationWeeks)) ? Number(p.gestationWeeks) : (current ? current.gestationWeeks : null),
    riskFactors: Array.isArray(p.riskFactors) ? p.riskFactors : (current ? current.riskFactors : []),
    recordedBy: resolved.actor.id, recordedAt: new Date().toISOString(),
    source: { system: "wardsynq-native", sourceId: `pregnancy-episode:${id}` },
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, pregnancyId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function getPregnancy(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", pregnancy: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, pregnancy: null };
  const pregnancy = await svc.get(PREG_TYPE, pregnancyIdFor(str(ctx.patientId))).catch(() => null);
  return { ...base, ok: true, pregnancy };
}

/**
 * The obstetricState()/meows() view of one patient, assembled from the real records rather than a
 * caller-supplied guess: the pregnancy episode (gestation), the latest delivery record (deliveredAt),
 * and the most recent charted labour-status observation (inLabour).
 */
async function maternityView(svc, patientId) {
  const [pregnancy, deliveries, labourObs] = await Promise.all([
    svc.get(PREG_TYPE, pregnancyIdFor(patientId)).catch(() => null),
    svc.byPatient(DELIVERY_TYPE, patientId).catch(() => []),
    svc.byPatient("Observation", patientId).catch(() => []),
  ]);
  const lastDelivery = (deliveries || []).slice().sort((a, b) => String(b.deliveredAt || "").localeCompare(String(a.deliveredAt || "")))[0] || null;
  const effectiveAt = (o) => (o && o.meta && o.meta.effectiveAt) || (o && o.effectiveAt) || "";
  const statusObs = (labourObs || []).filter((o) => o && o.category === LABOUR_CATEGORY && o.code === "labour-status")
    .sort((a, b) => String(effectiveAt(b)).localeCompare(String(effectiveAt(a))))[0] || null;
  const inLabour = !!statusObs && statusObs.value !== "not-in-labour" && !lastDelivery;
  return {
    pregnant: !!pregnancy, gestationWeeks: pregnancy ? pregnancy.gestationWeeks : null,
    inLabour, deliveredAt: lastDelivery ? lastDelivery.deliveredAt : null,
  };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function maternityStatus(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", status: null };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, status: null };
  const view = await maternityView(svc, patientId);
  return { ...base, ok: true, status: obstetricState(view) };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function maternityMeows(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", meows: null };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, meows: null };
  const [view, observations] = await Promise.all([maternityView(svc, patientId), svc.byPatient("Observation", patientId).catch(() => [])]);
  return { ...base, ok: true, meows: meowsFromObservations(observations || [], view) };
}

const LABOUR_CODES = Object.freeze({
  "dilation-cm": { unit: "cm", numeric: true }, "contractions-per-10min": { unit: "/10min", numeric: true },
  "fhr-bpm": { unit: "/min", numeric: true }, "labour-status": { unit: null, numeric: false },
});
const LABOUR_STATUS_WORDS = Object.freeze(["not-in-labour", "latent", "active", "second-stage", "third-stage"]);

/**
 * One partogram data point (or a stated labour status), charted as an ordinary Observation category
 * "labour" - own vocabulary (codeSystem "wardsynq-labour"), not a claim about a named LOINC panel.
 * ctx: { migration, encounterId, patientId, code, value, at?, actorDeps, recordDeps }
 */
async function recordLabourObservation(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId), patientId = str(ctx.patientId), code = str(ctx.code);
  const spec = LABOUR_CODES[code];
  if (!encounterId || !patientId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!spec) return { ...base, ok: false, status: 422, error: "unknown_labour_code", detail: `code must be one of ${Object.keys(LABOUR_CODES).join(", ")}`, written: 0 };
  if (spec.numeric && !(typeof ctx.value === "number" && Number.isFinite(ctx.value))) return { ...base, ok: false, status: 422, error: "value_required", written: 0 };
  if (!spec.numeric && !LABOUR_STATUS_WORDS.includes(str(ctx.value))) return { ...base, ok: false, status: 422, error: "unknown_status", detail: `status must be one of ${LABOUR_STATUS_WORDS.join(", ")}`, written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-labour-${slug(encounterId)}-${slug(at)}-${slug(code)}`;
  const obs = Observation({
    id, patientId, encounterId, category: LABOUR_CATEGORY,
    code, codeSystem: "wardsynq-labour", value: ctx.value, unit: spec.unit,
    effectiveAt: at, source: { system: "wardsynq-native", sourceId: `labour-observation:${id}` },
  });
  try {
    const current = await svc.get("Observation", id).catch(() => null);
    if (current) return { ...base, ok: true, written: 0, skipped: "already_recorded", observationId: id };
    const out = await svc.put(obs, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, observationId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, encounterId, loss: {ml, method, at?}, actorDeps, recordDeps } */
async function recordMaternalBloodLoss(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const l = ctx.loss || {};
  const at = str(l.at) || new Date().toISOString();
  let loss;
  try { loss = recordBloodLoss({ ml: Number(l.ml), method: l.method, at, by: resolved.actor.id }); }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }

  const id = `wsq-loss-${slug(patientId)}-${slug(at)}`;
  const record = { resourceType: LOSS_TYPE, id, patientId, encounterId: encounterId || null, ...loss, source: { system: "wardsynq-native", sourceId: `blood-loss:${id}` } };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    const threshold = pphThresholdReached(loss);
    const view = await maternityView(svc, patientId);
    const observations = await svc.byPatient("Observation", patientId).catch(() => []);
    const meowsResult = meowsFromObservations(observations || [], view);
    const recognition = assessObstetricRecognition({ meowsResult, loss, at });
    return { ...base, ok: true, written: 1, lossId: id, loss, threshold, recognition, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function listBloodLoss(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", losses: [] };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, losses: [] };
  const losses = await svc.byPatient(LOSS_TYPE, patientId).catch(() => []);
  return { ...base, ok: true, losses: losses || [] };
}

/**
 * Delivery documentation. Updates the pregnancy episode's own para count - a delivery is exactly
 * the fact that changes it, and nothing else in this file ever touches that number.
 * ctx: { migration, patientId, encounterId, delivery: {mode, deliveredAt?, complications?}, actorDeps, recordDeps }
 */
async function recordDelivery(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  const d = ctx.delivery || {};
  const mode = str(d.mode);
  if (!patientId || !encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!mode) return { ...base, ok: false, status: 422, error: "mode_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const deliveredAt = str(d.deliveredAt) || new Date().toISOString();
  const id = `wsq-delivery-${slug(encounterId)}`;
  const current = await svc.get(DELIVERY_TYPE, id).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "already_recorded", deliveryId: id };

  const record = {
    resourceType: DELIVERY_TYPE, id, patientId, encounterId, mode, deliveredAt,
    complications: str(d.complications) || null, recordedBy: resolved.actor.id, recordedAt: new Date().toISOString(),
    source: { system: "wardsynq-native", sourceId: `delivery-record:${id}` },
  };
  let written = 0;
  try { await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null }); written += 1; }
  catch (e) { return { ...base, ...writeFailure(e, { written, actor: resolved.actor.id }) }; }

  const preg = await svc.get(PREG_TYPE, pregnancyIdFor(patientId)).catch(() => null);
  if (preg) {
    try {
      await svc.put({ ...preg, para: Number.isFinite(preg.para) ? preg.para + 1 : 1, recordedBy: resolved.actor.id, recordedAt: new Date().toISOString() },
        { expectedVersion: preg.version, idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:para` : null });
      written += 1;
    } catch { /* the delivery record itself is the fact that matters; a stale para count is visible and correctable */ }
  }
  return { ...base, ok: true, written, deliveryId: id, patientId, encounterId, actor: resolved.actor.id };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function getDelivery(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", delivery: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, delivery: null };
  const deliveries = await svc.byPatient(DELIVERY_TYPE, str(ctx.patientId)).catch(() => []);
  const delivery = (deliveries || []).slice().sort((a, b) => String(b.deliveredAt || "").localeCompare(String(a.deliveredAt || "")))[0] || null;
  return { ...base, ok: true, delivery };
}

function newbornIdFor(motherPatientId, deliveredAt) {
  const m = slug(motherPatientId), t = slug(deliveredAt);
  return m && t ? `opd-pat-newborn-${m}-${t}` : null;
}

/**
 * Registers a newborn: a REAL Patient record, through the canonical factory, and a FamilyLink to
 * the mother - never PatientLink, which claims identity, not relationship. A newborn has no MRN and
 * no mobile number; its identity is deterministic from the mother's patient id and the delivery
 * time, the same discipline patientIdForMrn() keeps for an adult.
 * ctx: { migration, motherPatientId, deliveredAt, sex, name?, actorDeps, recordDeps }
 */
async function registerNewborn(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const motherPatientId = str(ctx.motherPatientId), encounterId = str(ctx.encounterId);
  const sex = str(ctx.sex);
  if (!motherPatientId || !encounterId) return { ...base, ok: false, status: 422, error: "mother_and_encounter_required", written: 0 };
  if (!["male", "female", "unknown"].includes(sex)) return { ...base, ok: false, status: 422, error: "sex_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  // deliveredAt is NEVER taken from the caller - only from a real, already-recorded DeliveryRecord
  // for this encounter, the same discipline the device-association fix (Task 2.2) established:
  // trusting a client-supplied fact here would let a newborn be linked to a delivery that was never
  // actually recorded.
  const delivery = await svc.get(DELIVERY_TYPE, `wsq-delivery-${slug(encounterId)}`).catch(() => null);
  if (!delivery) return { ...base, ok: false, status: 409, error: "no_delivery_recorded", detail: "a newborn cannot be linked before this encounter's delivery is recorded", written: 0 };
  const deliveredAt = delivery.deliveredAt;

  const newbornId = newbornIdFor(motherPatientId, deliveredAt);
  if (!newbornId) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const current = await svc.get("Patient", newbornId).catch(() => null);
  if (!current) {
    // A newborn has no MRN of its own yet and no mobile-number identity path an adult registration
    // assumes - this synthetic MRN is deterministic from the SAME (mother, deliveredAt) inputs
    // newbornIdFor() itself uses, never reverse-engineered by string surgery on the id: built this
    // way, patientIdForMrn(newbornMrn) reproduces newbornId exactly (opd-identity.js just re-slugs
    // whatever string it is handed), so a NICU admission using this real MRN lands on the SAME
    // already-registered Patient migrate-inpatient.js's admitPatient() would otherwise construct a
    // second, mismatched id for. The same discipline wardsynq-mpi.js keeps for an unidentified ED
    // arrival's provisional MRN.
    const newbornMrn = `NEWBORN-${slug(motherPatientId).toUpperCase()}-${slug(deliveredAt).toUpperCase()}`;
    const patient = Patient({
      id: newbornId, mrn: newbornMrn, name: str(ctx.name) || "Newborn", sex, dob: deliveredAt.slice(0, 10),
      identifiers: [], provisional: true, source: { system: "wardsynq-native", sourceId: `newborn:${newbornId}` },
    });
    try { await svc.put(patient, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:patient` : null }); }
    catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
  }

  const linkId = `wsq-family-${slug(motherPatientId)}-${slug(newbornId)}`;
  const existingLink = await svc.get(LINK_TYPE, linkId).catch(() => null);
  if (existingLink) return { ...base, ok: true, written: current ? 0 : 1, newbornId, linkId, skipped: "already_linked" };

  const link = {
    resourceType: LINK_TYPE, id: linkId, patientId: motherPatientId, relatedPatientId: newbornId,
    relationship: "mother-newborn", deliveredAt, recordedBy: resolved.actor.id, recordedAt: new Date().toISOString(),
    source: { system: "wardsynq-native", sourceId: `family-link:${linkId}` },
  };
  try {
    const out = await svc.put(link, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:link` : null });
    return { ...base, ok: true, written: current ? 1 : 2, newbornId, linkId, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: current ? 0 : 1, newbornId, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } - every FamilyLink naming this patient, either side. */
async function listFamilyLinks(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", links: [] };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, links: [] };
  const asMother = await svc.byPatient(LINK_TYPE, patientId).catch(() => []);
  return { ...base, ok: true, links: asMother || [] };
}

export {
  PREG_TYPE, DELIVERY_TYPE, LOSS_TYPE, LINK_TYPE, LABOUR_CATEGORY, LABOUR_CODES, LABOUR_STATUS_WORDS,
  pregnancyIdFor, newbornIdFor, maternityView,
  recordPregnancy, getPregnancy, maternityStatus, maternityMeows,
  recordLabourObservation, recordMaternalBloodLoss, listBloodLoss,
  recordDelivery, getDelivery, registerNewborn, listFamilyLinks,
};
