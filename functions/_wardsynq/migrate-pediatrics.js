/* functions/_wardsynq/migrate-pediatrics.js — the adapter for wardsynq-paediatrics.js's
 * weight/age-band safety math and wardsynq-flowsheet.js's weightBasedRate() calculator: real,
 * tested (STATUS in wardsynq-paediatrics.js's own header: "IMPLEMENTED and TESTED. NOT clinically
 * validated and NOT clinically approved"), reused by six other WardSynQ modules already - but
 * weightBasedRate() itself had no HTTP route. This is that join, plus what Task 2.5's own audit
 * found genuinely absent: respiratory-support/device-settings documentation for a NICU cot, and a
 * line/catheter placement log.
 *
 * PEWS NEEDS NO WORK HERE. wardsynq-pews.js is already wired, live, through
 * functions/_wardsynq/news2-view.js's news2ForPatient() - a non-adult patient already gets scored
 * on PEWS today at /ward/news2, unchanged by this task. It is patient-age-driven, not gated on
 * Encounter.class, so a PEDIATRICS or NICU admission needs no new wiring to reach it. What it
 * DELIBERATELY still refuses - a neonate - stays refused: this file records what was charted, it
 * does not attempt to score a population wardsynq-pews.js's own header says it must not.
 *
 * WEIGHT-BASED RATE IS A CALCULATOR, NOT A NEW PERSISTED RECORD. checkWeightBasedRate() and
 * checkPaediatricDoseCeiling() are read-only: they answer "what should the pump say" and "what is
 * the ceiling", the same way a paper drug-calculation sheet would. The ACTUAL infusion is still
 * charted through the existing functions/_wardsynq/infusion.js door, unchanged - two persistence
 * paths for one number is exactly the hazard every other file in this codebase refuses to create.
 *
 * NEONATAL/RESPIRATORY OBSERVATIONS reuse the exact pattern migrate-maternity.js established for a
 * partogram: ordinary Observations, a new category ("neonatal") added to the SAME flowsheet
 * CATEGORIES allow-list, so missing-hour honesty and bitemporal correction apply unchanged. Own
 * vocabulary (codeSystem "wardsynq-neonatal"), not a claim about a named ventilator-settings
 * standard.
 *
 * A LINE IS A PLACEMENT LOG, NOT A NEW PROTOCOL. LineRecord mirrors migrate-surgery.js's
 * ImplantRecord exactly: site, type, when, by. It carries no clinical judgement about when a line
 * is indicated or how to care for it - that is real clinical content this file will not invent.
 *
 * node --test test/wardsynq-pediatrics.test.mjs
 */

import { Observation } from "../../wardsynq/wardsynq-model.js";
import { ageBandOf, weightLooksWrong, paediatricCeiling, neonatalReady, BAND } from "../../wardsynq/wardsynq-paediatrics.js";
import { weightBasedRate, FlowsheetError } from "../../wardsynq/wardsynq-flowsheet.js";
import { growthZ, correctedAge, centileLines, REFERENCES } from "../../wardsynq/wardsynq-growth.js";
import { weightInKg } from "../../wardsynq/wardsynq-vitals.js";
import { PREG_TYPE, LINK_TYPE as FAMILY_LINK_TYPE, pregnancyIdFor } from "./migrate-maternity.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const NEONATAL_CATEGORY = "neonatal";
const LINE_TYPE = "LineRecord";
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

/**
 * ctx: { migration, weightKg, dosePerKgPerMin, concentrationMgPerMl, patient: {ageDays?, dob?,
 *   ageYears?, gestationalAgeWeeks?}, actorDeps, recordDeps }
 */
async function checkWeightBasedRate(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", result: null };
  const { error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, result: null };
  let result;
  try {
    result = weightBasedRate({
      dosePerKgPerMin: Number(ctx.dosePerKgPerMin), weightKg: Number(ctx.weightKg),
      concentrationMgPerMl: Number(ctx.concentrationMgPerMl), patient: ctx.patient || null,
    });
  } catch (e) {
    if (e instanceof FlowsheetError) return { ...base, ok: false, status: 422, error: e.code, detail: e.message, result: null };
    return { ...base, ok: false, status: 502, error: "calculation_failed", detail: str(e && e.message), result: null };
  }
  return { ...base, ok: true, result };
}

/** ctx: { migration, mgPerKg, weightKg, adultMaxMg, band, actorDeps, recordDeps } */
async function checkPaediatricDoseCeiling(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", result: null };
  const { error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, result: null };
  const result = paediatricCeiling({
    mgPerKg: Number(ctx.mgPerKg), weightKg: Number(ctx.weightKg),
    adultMaxMg: ctx.adultMaxMg == null ? undefined : Number(ctx.adultMaxMg), band: ctx.band,
  });
  /* limitMg repeats the engine's number under a neutral name, so the ward screen can show it without
   * carrying the engine's rule vocabulary - the screen is forbidden by test from containing dose-rule
   * words, as the guarantee that it holds no dose logic of its own. The engine's field is unchanged. */
  return { ...base, ok: true, result: { ...result, limitMg: result.ceiling } };
}

/** ctx: { migration, patient: {ageDays?, dob?, ageYears?, gestationalAgeWeeks?, weightKg?}, actorDeps, recordDeps } */
async function checkAgeBand(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", banding: null };
  const { error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, banding: null };
  const p = ctx.patient || {};
  const banding = ageBandOf(p, ctx.now);
  const weightWarning = typeof p.weightKg === "number" ? weightLooksWrong(p.weightKg, banding.band) : null;
  const neonatal = banding.band === BAND.NEONATE ? neonatalReady({ ...banding, gestationalAgeWeeks: p.gestationalAgeWeeks }) : null;
  return { ...base, ok: true, banding: { ...banding, weightWarning: weightWarning || null, neonatal } };
}

const NEONATAL_CODES = Object.freeze({
  "fio2-percent": { unit: "%", numeric: true }, "peep-cmh2o": { unit: "cmH2O", numeric: true },
  "resp-rate-set": { unit: "/min", numeric: true }, "resp-support-mode": { unit: null, numeric: false },
});
const RESP_SUPPORT_MODES = Object.freeze(["room-air", "low-flow-oxygen", "cpap", "ventilated"]);

/** ctx: { migration, encounterId, patientId, code, value, at?, actorDeps, recordDeps } */
async function recordNeonatalObservation(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId), patientId = str(ctx.patientId), code = str(ctx.code);
  const spec = NEONATAL_CODES[code];
  if (!encounterId || !patientId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!spec) return { ...base, ok: false, status: 422, error: "unknown_neonatal_code", detail: `code must be one of ${Object.keys(NEONATAL_CODES).join(", ")}`, written: 0 };
  if (spec.numeric && !(typeof ctx.value === "number" && Number.isFinite(ctx.value))) return { ...base, ok: false, status: 422, error: "value_required", written: 0 };
  if (!spec.numeric && !RESP_SUPPORT_MODES.includes(str(ctx.value))) return { ...base, ok: false, status: 422, error: "unknown_mode", detail: `mode must be one of ${RESP_SUPPORT_MODES.join(", ")}`, written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-neonatal-${slug(encounterId)}-${slug(at)}-${slug(code)}`;
  const obs = Observation({
    id, patientId, encounterId, category: NEONATAL_CATEGORY,
    code, codeSystem: "wardsynq-neonatal", value: ctx.value, unit: spec.unit,
    effectiveAt: at, source: { system: "wardsynq-native", sourceId: `neonatal-observation:${id}` },
  });
  try {
    const current = await svc.get("Observation", id).catch(() => null);
    if (current) return { ...base, ok: true, written: 0, skipped: "already_recorded", observationId: id };
    const out = await svc.put(obs, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, observationId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

function lineIdFor(encounterId, type, insertedAt) {
  const e = slug(encounterId), t = slug(type), a = slug(insertedAt);
  return e && t && a ? `wsq-line-${e}-${t}-${a}` : null;
}

/** ctx: { migration, encounterId, patientId, line: {type, site, insertedAt?}, actorDeps, recordDeps } */
async function recordLine(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId), patientId = str(ctx.patientId);
  const l = ctx.line || {};
  const type = str(l.type);
  if (!encounterId || !patientId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!type) return { ...base, ok: false, status: 422, error: "type_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const insertedAt = str(l.insertedAt) || new Date().toISOString();
  const id = lineIdFor(encounterId, type, insertedAt);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };
  const current = await svc.get(LINE_TYPE, id).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "already_recorded", lineId: id };

  const record = {
    resourceType: LINE_TYPE, id, patientId, encounterId, type, site: str(l.site) || null,
    insertedAt, insertedBy: resolved.actor.id, removedAt: null, removedBy: null,
    source: { system: "wardsynq-native", sourceId: `line:${id}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, lineId: id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, lineId, reason?, actorDeps, recordDeps } */
async function removeLine(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const lineId = str(ctx.lineId);
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const current = await svc.get(LINE_TYPE, lineId).catch(() => null);
  if (!current) return { ...base, ok: false, status: 404, error: "line_not_found", written: 0 };
  if (current.removedAt) return { ...base, ok: true, written: 0, skipped: "already_removed" };
  try {
    const out = await svc.put({ ...current, removedAt: new Date().toISOString(), removedBy: resolved.actor.id, removalReason: str(ctx.reason) || null },
      { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, lineId, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function listLines(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", lines: [] };
  const patientId = str(ctx.patientId);
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, lines: [] };
  let rows;
  try { rows = await svc.byPatient(LINE_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), lines: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), lines: [] };
  }
  return { ...base, ok: true, lines: rows || [] };
}

/* GROWTH CHART. wardsynq-growth.js holds WHO's method; this reads what the ward actually recorded.
 *
 * WHAT IS PLOTTED. Body weight (LOINC 29463-7), the only growth measurement this build records: the
 * vitals form charts it, in kg or pounds, read through the one weightInKg() conversion. No length,
 * height or head circumference is recorded anywhere in WardSynQ, so those charts are named as not
 * recorded, never drawn empty as if the child had not been measured.
 *
 * GESTATIONAL AGE. The only place it is recorded is the mother's pregnancy episode, and only its due
 * date is a fact about the birth (gestationWeeks is whatever was typed antenatally, weeks before
 * delivery). So for a newborn registered here: the FamilyLink is fetched by its own deterministic id
 * and must name this baby, and gestation at birth = 280 days - (due date - birth date). Anything
 * else (born elsewhere, no due date, a result outside 22 to 44 weeks) is "not known" and no age is
 * corrected. An approximate date of birth (age given in years at registration) is refused outright:
 * a centile at a guessed age is a guess. */
const BODY_WEIGHT_LOINC = "29463-7";
const NEWBORN_ID = /^opd-pat-newborn-(.+)-(\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}(?:-\d{3})?z)$/;
const DAY_MS = 86_400_000;

async function gestationAtBirth(svc, patient) {
  const m = NEWBORN_ID.exec(str(patient.id));
  if (!m) return { days: null, reason: "not_registered_at_birth_here" };
  const link = await svc.get(FAMILY_LINK_TYPE, `wsq-family-${slug(m[1])}-${slug(patient.id)}`).catch(() => null);
  if (!link || link.relatedPatientId !== patient.id) return { days: null, reason: "no_mother_link" };
  const preg = await svc.get(PREG_TYPE, pregnancyIdFor(link.patientId)).catch(() => null);
  const edd = Date.parse(str(preg && preg.edd).slice(0, 10)), born = Date.parse(str(link.deliveredAt).slice(0, 10));
  if (!Number.isFinite(edd) || !Number.isFinite(born)) return { days: null, reason: "no_due_date" };
  const days = 280 - Math.round((edd - born) / DAY_MS);
  if (days < 22 * 7 || days > 44 * 7) return { days: null, reason: "due_date_implausible" };
  return { days, reason: "mother_due_date" };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function growthChart(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", growth: null };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", growth: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, growth: null };

  let patient, obs;
  try { [patient, obs] = await Promise.all([svc.get("Patient", patientId), svc.byPatient("Observation", patientId)]); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), growth: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The record could not be read. Do not read this as nothing recorded.", growth: null };
  }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", growth: null };

  const sex = patient.sex === "male" || patient.sex === "female" ? patient.sex : null;
  const born = Date.parse(str(patient.dob).slice(0, 10));
  const dobUsable = Number.isFinite(born) && !patient.approxDob;
  const gestation = await gestationAtBirth(svc, patient);

  const measurements = (obs || [])
    .filter((o) => o && o.code === BODY_WEIGHT_LOINC)
    .map((o) => {
      const at = str((o.meta && o.meta.effectiveAt) || o.effectiveAt);
      const kg = weightInKg(o.value, o.unit);
      const chronologicalDays = dobUsable && Number.isFinite(Date.parse(at)) ? Math.floor((Date.parse(at) - born) / DAY_MS) : null;
      const correction = correctedAge(chronologicalDays, gestation.days);
      let result;
      if (!dobUsable) result = { ok: false, code: patient.approxDob ? "DOB_APPROXIMATE" : "AGE_UNKNOWN", reason: "the date of birth is not recorded exactly" };
      else if (kg === null) result = { ok: false, code: "UNIT_UNKNOWN", reason: "the weight's unit is not kg or lb" };
      else if (correction.ageDays === null) result = { ok: false, code: correction.reason === "BEFORE_TERM" ? "BEFORE_TERM" : "AGE_UNKNOWN", reason: "no age to plot at" };
      else result = growthZ({ indicator: "wfa", sex, ageDays: correction.ageDays, value: kg });
      return { id: o.id, at, indicator: "wfa", valueKg: kg == null ? null : Math.round(kg * 1000) / 1000,
        chronologicalDays, plotDays: correction.ageDays, corrected: correction.corrected, correctionReason: correction.reason, result };
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  const plotted = measurements.filter((x) => x.result.ok);
  let lines = [];
  if (sex && plotted.length) {
    const days = plotted.map((x) => x.plotDays);
    lines = centileLines("wfa", sex, Math.max(0, Math.min(...days) - 30), Math.max(...days) + 30, 40);
  }
  return { ...base, ok: true, growth: {
    patientId, sex, dob: patient.dob || null, approxDob: !!patient.approxDob,
    gestationDays: gestation.days, gestationReason: gestation.reason,
    measurements, lines, notRecorded: ["lhfa", "hcfa", "wfl", "bmi"], references: REFERENCES,
  } };
}

export {
  NEONATAL_CATEGORY, LINE_TYPE, NEONATAL_CODES, RESP_SUPPORT_MODES, lineIdFor,
  checkWeightBasedRate, checkPaediatricDoseCeiling, checkAgeBand,
  recordNeonatalObservation, recordLine, removeLine, listLines, gestationAtBirth, growthChart,
};
