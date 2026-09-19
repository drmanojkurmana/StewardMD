/* functions/_wardsynq/surveillance.js - proactive clinical surveillance: which patients have a rule
 * already defined somewhere in WardSynQ that is true for them right now.
 *
 * NO THRESHOLD IN THIS FILE IS NEW. Every rule names the module and the function whose judgement it
 * is. Where a rule needs a number no module or hospital configuration supplies (a pharmacy
 * verification window, a high-alert drug list), the rule is NOT EVALUATED and says why, rather than
 * running on a number invented here.
 *
 * NOTHING HERE WRITES A CLINICAL RECORD, CHANGES AN ORDER OR PAGES ANYONE. A signal is computed on
 * every read and is shown; the only write is a clinician's acknowledgement, an append-only record
 * of its own that states who looked at which evidence and what they noted.
 *
 * "NOT EVALUATED" IS NEVER "NO SIGNAL". A rule whose data could not be read, or that the hospital has
 * not configured, is listed with its reason. An empty signal list next to a failed read would read
 * as a well patient.
 *
 * FIRST SEEN is the record time at which the rule's evidence first held (the dose's due time plus
 * grace, the second NEWS2 reading, the task's due time). Signals are not stored, so it is not the
 * moment this software first noticed; the basis is stated on every signal.
 *
 * READMISSION RISK IS NOT BUILT. wardsynq-quality.js READMISSION_30D is a retrospective rate over
 * discharged stays whose 30-day window has closed, not a prospective risk for a patient on the ward.
 * Scoring today's patient against it would be inventing a model.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { news2, trendOf } from "../../wardsynq/wardsynq-deterioration.js";
import { MedicationAdministrationRecord } from "../../wardsynq/wardsynq-meds.js";
import { SIGNAL_SOURCES } from "../../wardsynq/wardsynq-incidents.js";
import { sepsisScreen } from "./icu-care.js";
import { deltaCheck } from "./lab-delta.js";
import { vitalsDue, latestVitalsAt, isOverdue as taskOverdue, FREQ, TASK as NURSING_TASK } from "./nursing.js";
import { verificationState, TYPE as VERIFICATION } from "./pharmacy-verify.js";
import { reconciliationIdFor, reconciliationSummary } from "./med-reconciliation.js";
import { dischargeSummaryIdFor } from "./migrate-discharge.js";
import { marSchedule } from "./mar-schedule.js";

const TYPE = "SurveillanceAcknowledgement";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const timeOf = (o) => Date.parse(str((o && o.meta && o.meta.effectiveAt) || (o && o.effectiveAt) || (o && o.meta && o.meta.recordedAt)));
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const NOT_OBS = new Set(["29463-7"]);   // body weight: nursing.js NOT_OBS, not a set of observations
const LACTATE_CODE = "2524-7";          // icu-care.js LACTATE_CODE
const FOUR_HOURS = 4 * 3600e3;          // icu-care.js sepsis screen window ("in the last 4 hours")

/** Every rule, with the module whose judgement it is. The board shows `source` beside each signal. */
const RULES = Object.freeze({
  "news2-rising": { label: "NEWS2 rising", group: "deterioration", source: "trendOf() in wardsynq-deterioration.js: a rise of 2 or more between the last two complete NEWS2 scores. Scale 1; Scale 2 is never inferred." },
  "sepsis-screen-positive": { label: "Sepsis screen positive", group: "deterioration", source: "sepsisScreen() in icu-care.js (qSOFA from wardsynq-emergency.js; lactate above 2 or temperature 38.3 C from icu.js)." },
  "lab-worsening": { label: "Lab result worsening", group: "labs", source: "Three consecutive results of one analyte in one unit moving further outside the reference range recorded on the result (lab-result.js); delta check from deltaCheck() in lab-delta.js with this hospital's deltaLimits." },
  "high-alert-dose-overdue": { label: "High-alert dose overdue", group: "medication", source: "isOverdue() in mar-schedule.js (due time plus the ward's grace) for a drug on this hospital's highAlertDrugs list (wardsynq-meds.js isHighAlert)." },
  "order-unverified": { label: "Active order not pharmacy-verified", group: "medication", source: "verificationState() in pharmacy-verify.js, past this hospital's orderVerifyWithinHours." },
  "obs-overdue": { label: "Observations overdue", group: "care", source: "vitalsDue() in nursing.js against the observation frequency set for this admission." },
  "task-overdue": { label: "Nursing task overdue", group: "care", source: "isOverdue() in nursing.js: an open task past its due time." },
  "discharge-high-risk": { label: "Discharged with open items", group: "discharge", source: "Encounter finished (migrate-discharge.js) with an open critical-result loop (critical-results.js), an unreconciled admission medicine list (med-reconciliation.js) or no signed discharge summary." },
});
const NOT_BUILT = Object.freeze([{ ruleId: "readmission-risk", reason: "wardsynq-quality.js READMISSION_30D is a retrospective rate over discharged stays, not a prospective risk definition. No existing module defines readmission risk for a patient on the ward, so none is computed." }]);

const ev = (o, extra) => ({ resourceType: o.resourceType || "Observation", id: o.id, value: o.value == null ? null : o.value, unit: o.unit || null, at: iso(timeOf(o)), ...(extra || {}) });
function signal(ruleId, key, patientId, encounterId, firstSeenAt, summary, evidence, extra) {
  return { id: `${ruleId}|${key}`, ruleId, label: RULES[ruleId].label, group: RULES[ruleId].group, source: RULES[ruleId].source,
    patientId, encounterId: encounterId || null, summary, evidence, firstSeenAt: firstSeenAt || null,
    firstSeenBasis: "record time at which this rule's evidence first held; signals are computed, not stored", active: true,
    // Which evidence record an incident signal may name (wardsynq-incidents.js SIGNAL_SOURCES). Null when none qualifies.
    incidentSource: ((e) => (e ? { resourceType: e.resourceType, id: e.id } : null))(evidence.find((e) => e.id && SIGNAL_SOURCES.includes(e.resourceType))),
    ...(extra || {}) };
}

/* ------------------------------------------------------------------ the rules, PURE */

/** NEWS2 at each of the last two distinct vital-sign reading times, and trendOf() over them. */
function news2Rule(d, out) {
  const vitals = (d.observations || []).filter((o) => o && o.category === "vital-signs" && !NOT_OBS.has(o.code) && Number.isFinite(timeOf(o)));
  const times = [...new Set(vitals.map(timeOf))].sort((a, b) => a - b).slice(-2);
  if (times.length < 2) return out.notEvaluated.push({ ruleId: "news2-rising", reason: "fewer than two vital-sign readings" });
  const scores = times.map((t) => news2({ observations: vitals.filter((o) => timeOf(o) <= t), patient: d.patient, scale: 1, now: iso(t) }));
  const bad = scores.find((s) => !s.scorable);
  if (bad) return out.notEvaluated.push({ ruleId: "news2-rising", reason: `a reading could not be scored: ${bad.reason || bad.code || "incomplete"}` });
  const tr = trendOf(scores);
  if (!tr.significant) return;
  const evidence = times.map((t, i) => ({ resourceType: "NEWS2", id: null, value: scores[i].total, unit: "points", at: iso(t), risk: scores[i].risk,
    from: Object.values(scores[i].sources || {}).map((s) => ({ resourceType: "Observation", id: s.id, at: s.atIso })) }));
  for (const s of evidence[1].from) evidence.push({ resourceType: "Observation", id: s.id, value: (vitals.find((o) => o.id === s.id) || {}).value ?? null, unit: (vitals.find((o) => o.id === s.id) || {}).unit || null, at: s.at });
  out.signals.push(signal("news2-rising", iso(times[1]), d.patientId, d.encounterId, iso(times[1]),
    `NEWS2 ${scores[0].total} to ${scores[1].total} (${tr.reason}).`, evidence));
}

function sepsisRule(d, out) {
  const nowMs = d.nowMs;
  const lab = (d.observations || []).filter((o) => o && o.code === LACTATE_CODE && Number.isFinite(timeOf(o)) && timeOf(o) <= nowMs && nowMs - timeOf(o) <= FOUR_HOURS)
    .sort((a, b) => timeOf(b) - timeOf(a))[0];
  const lactate = lab && typeof lab.value === "number" ? { value: lab.value, at: iso(timeOf(lab)), from: lab.id } : null;
  const s = sepsisScreen({ observations: d.observations, patient: d.patient, lactate, now: iso(nowMs) });
  if (s.result === "cannot-screen") return out.notEvaluated.push({ ruleId: "sepsis-screen-positive", reason: s.say });
  if (s.result !== "screen-positive") return;
  const recent = (d.observations || []).filter((o) => o && o.category === "vital-signs" && Number.isFinite(timeOf(o)) && timeOf(o) <= nowMs && nowMs - timeOf(o) <= FOUR_HOURS);
  const latest = Math.max(...recent.map(timeOf));
  const evidence = recent.map((o) => ev(o)).concat(lab ? [ev(lab)] : []);
  out.signals.push(signal("sepsis-screen-positive", iso(latest), d.patientId, d.encounterId, iso(latest), s.say, evidence, { qsofa: s.qsofa }));
}

function labRule(d, out) {
  const byCode = new Map();
  for (const o of d.observations || []) {
    if (!o || o.category !== "laboratory" || typeof o.value !== "number" || !Number.isFinite(timeOf(o))) continue;
    if (!byCode.has(o.code)) byCode.set(o.code, []);
    byCode.get(o.code).push(o);
  }
  const abnormal = [];
  for (const [code, rowsAll] of byCode) {
    const rows = rowsAll.sort((a, b) => timeOf(a) - timeOf(b));
    const latest = rows[rows.length - 1];
    const range = latest.referenceRange || {};
    const low = typeof range.low === "number" ? range.low : null, high = typeof range.high === "number" ? range.high : null;
    const above = high !== null && latest.value > high, below = low !== null && latest.value < low;
    if (above || below) abnormal.push(ev(latest, { code, display: latest.display || code, referenceRange: { low, high }, direction: above ? "above" : "below" }));
    const same = rows.filter((o) => str(o.unit) === str(latest.unit)).slice(-3);
    if (same.length < 3 || !(above || below)) continue;
    const [a, b, c] = same.map((o) => o.value);
    if (!(above ? (a < b && b < c) : (a > b && b > c))) continue;
    const delta = deltaCheck({ code, unit: latest.unit, value: latest.value, observations: rows.filter((o) => o !== latest), nowMs: timeOf(latest), deltaLimits: d.cfg.deltaLimits });
    out.signals.push(signal("lab-worsening", latest.id, d.patientId, d.encounterId, iso(timeOf(same[1])),
      `${latest.display || code} ${a}, ${b}, ${c}${latest.unit ? " " + latest.unit : ""}: ${above ? "rising above " + high : "falling below " + low}.`,
      same.map((o) => ev(o)), { delta }));
  }
  out.abnormalLabs = abnormal;
}

function medicationRules(d, out) {
  const high = Array.isArray(d.cfg.highAlertDrugs) ? d.cfg.highAlertDrugs.filter((x) => str(x)) : [];
  if (!high.length) out.notEvaluated.push({ ruleId: "high-alert-dose-overdue", reason: "this hospital has not configured highAlertDrugs" });
  else if (!d.schedule) out.notEvaluated.push({ ruleId: "high-alert-dose-overdue", reason: "the medication schedule could not be read" });
  else {
    const emar = new MedicationAdministrationRecord({ highAlertDrugs: high });
    const grace = Number.isFinite(d.cfg.graceMinutes) ? d.cfg.graceMinutes : 60;   // mar-schedule.js isOverdue default
    for (const row of d.schedule.due || []) {
      if (!row.overdue || !emar.isHighAlert({ drug: row.drug })) continue;
      out.signals.push(signal("high-alert-dose-overdue", row.administrationId || `${row.orderId}-${row.dueAt}`, d.patientId, d.encounterId,
        iso(Date.parse(row.dueAt) + grace * 60000), `${row.drug}${row.dose ? " " + row.dose : ""} due ${row.dueAt} is not resolved${row.status ? " (" + row.status + ")" : " (not started)"}.`,
        [{ resourceType: "MedicationOrder", id: row.orderId, value: row.drug, unit: null, at: row.dueAt }]
          .concat(row.status && row.administrationId ? [{ resourceType: "MedicationAdministration", id: row.administrationId, value: row.status, unit: null, at: row.dueAt }] : [])));
    }
    if (d.schedule.unreadDoses) out.notEvaluated.push({ ruleId: "high-alert-dose-overdue", reason: d.schedule.warning || "some dose records could not be read" });
  }

  const hours = Number(d.cfg.orderVerifyWithinHours);
  if (!(Number.isFinite(hours) && hours > 0)) out.notEvaluated.push({ ruleId: "order-unverified", reason: "this hospital has not configured orderVerifyWithinHours" });
  else if (!d.orders || !d.verifications) out.notEvaluated.push({ ruleId: "order-unverified", reason: "orders or pharmacy verifications could not be read" });
  else {
    for (const o of d.orders.filter((x) => x && x.status === "active")) {
      const v = verificationState(o, d.verifications);
      if (v.state !== "unverified" && v.state !== "stale") continue;
      // Stale is measured from the version the pharmacist has not seen; unverified from the order itself.
      const since = v.state === "stale" ? Date.parse(str(o.meta && o.meta.recordedAt)) : timeOf(o);
      if (!Number.isFinite(since) || d.nowMs - since <= hours * 3600e3) continue;
      out.signals.push(signal("order-unverified", `${o.id}@${o.version}`, d.patientId, d.encounterId, iso(since + hours * 3600e3),
        `${o.drug || "Order"} is ${v.state === "stale" ? "changed since it was verified" : "not verified"}, more than ${hours} h.`,
        [{ resourceType: "MedicationOrder", id: o.id, value: o.drug || null, unit: null, at: iso(since), version: o.version }]));
    }
  }
}

function careRules(d, out) {
  if (!d.encounterId) out.notEvaluated.push({ ruleId: "obs-overdue", reason: "no admission to read an observation frequency from" });
  else if (d.frequency === undefined || !d.observations) out.notEvaluated.push({ ruleId: "obs-overdue", reason: "the observation frequency or observations could not be read" });
  else {
    const due = vitalsDue(d.frequency, latestVitalsAt(d.observations), d.nowMs);
    if (due.state === "no_frequency") out.notEvaluated.push({ ruleId: "obs-overdue", reason: "no observation frequency set" });
    else if (due.state === "overdue") {
      out.signals.push(signal("obs-overdue", due.dueAt || "never", d.patientId, d.encounterId, due.dueAt || iso(timeOf(d.frequency)), due.text + ".",
        [{ resourceType: FREQ, id: d.frequency.id, value: due.everyHours, unit: "h", at: iso(timeOf(d.frequency)) }]
          .concat(due.lastAt ? [{ resourceType: "Observation", id: ((d.observations || []).find((o) => iso(timeOf(o)) === due.lastAt) || {}).id || null, value: null, unit: null, at: due.lastAt }] : [])));
    }
  }
  if (!d.tasks) out.notEvaluated.push({ ruleId: "task-overdue", reason: "nursing tasks could not be read" });
  else for (const t of d.tasks.filter((x) => x && (!d.encounterId || x.encounterId === d.encounterId) && taskOverdue(x, d.nowMs))) {
    out.signals.push(signal("task-overdue", t.id, d.patientId, d.encounterId, t.dueAt, `${t.title || t.text || "Task"} was due ${t.dueAt}.`,
      [{ resourceType: NURSING_TASK, id: t.id, value: t.title || t.text || null, unit: null, at: t.dueAt }]));
  }
}

function dischargeRule(d, out) {
  const enc = d.encounter;
  if (!enc || enc.status !== "finished") return;
  if (!d.loops || d.reconciliation === undefined || d.dischargeSummary === undefined) return out.notEvaluated.push({ ruleId: "discharge-high-risk", reason: "critical loops, reconciliation or discharge summary could not be read" });
  const open = d.loops.filter((l) => l && l.state !== "closed" && (!l.encounterId || l.encounterId === enc.id));
  const rec = d.reconciliation ? reconciliationSummary(d.reconciliation) : null;
  const items = [], evidence = [{ resourceType: "Encounter", id: enc.id, value: enc.status, unit: null, at: enc.periodEnd || null }];
  if (open.length) { items.push(`${open.length} critical result loop${open.length === 1 ? "" : "s"} not closed`); for (const l of open) evidence.push({ resourceType: "CriticalResultLoop", id: l.id, value: l.value ?? null, unit: l.unit || null, at: l.reportedAt || null, state: l.state }); }
  if (!rec) items.push("no admission medicine reconciliation");
  else if (!rec.complete) { items.push(`${rec.undecided} medicine${rec.undecided === 1 ? "" : "s"} not reconciled`); evidence.push({ resourceType: "MedicationReconciliation", id: rec.reconciliationId, value: rec.undecided, unit: "undecided", at: rec.startedAt }); }
  if (!d.dischargeSummary) items.push("no discharge summary");
  else if (!d.dischargeSummary.signedBy) { items.push("discharge summary not signed"); evidence.push({ resourceType: "ClinicalNote", id: d.dischargeSummary.id, value: "unsigned", unit: null, at: iso(timeOf(d.dischargeSummary)) }); }
  if (!items.length) return;
  out.signals.push(signal("discharge-high-risk", enc.id, d.patientId, enc.id, enc.periodEnd || null, `Discharged with: ${items.join("; ")}.`, evidence));
}

/** PURE. Every rule over one patient's data. A read that failed is passed as null (or undefined for a single get). */
function evaluateSignals(data) {
  const d = { cfg: {}, ...data, nowMs: Number.isFinite(data && data.nowMs) ? data.nowMs : Date.now() };
  const out = { signals: [], notEvaluated: [], abnormalLabs: null };
  if (!d.observations) {
    for (const r of ["news2-rising", "sepsis-screen-positive", "lab-worsening"]) out.notEvaluated.push({ ruleId: r, reason: "observations could not be read" });
  } else { news2Rule(d, out); sepsisRule(d, out); labRule(d, out); }
  medicationRules(d, out);
  careRules(d, out);
  dischargeRule(d, out);
  return out;
}

/* ------------------------------------------------------------------ record I/O */

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/**
 * One patient's active signals, with acknowledgements. Writes nothing.
 * ctx: { migration, patientId, encounterId?, wsqCfg?, schedule? (marSchedule opts), now?, actorDeps, recordDeps }
 */
async function patientSurveillance(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", signals: [], notEvaluated: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required" };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  // The patient itself is the permission gate: a patient this actor may not read is a refusal, not an empty board.
  let patient;
  try { patient = await svc.get("Patient", patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) };
  }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found" };

  const eid = str(ctx.encounterId);
  const soft = (p) => p.then((v) => v, () => null);
  const cfg = ctx.wsqCfg || {};
  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const [encounter, observations, orders, verifications, loops, tasks, frequency, reconciliation, dischargeSummary, acks, schedule] = await Promise.all([
    eid ? svc.get("Encounter", eid).then((v) => v, () => undefined) : null,
    soft(svc.byPatient("Observation", patientId)),
    soft(svc.byPatient("MedicationOrder", patientId)),
    soft(svc.byPatient(VERIFICATION, patientId)),
    soft(svc.byPatient("CriticalResultLoop", patientId)),
    soft(svc.byPatient(NURSING_TASK, patientId)),
    eid ? svc.get(FREQ, `wsq-obsfreq-${slug(eid)}`).then((v) => v, () => undefined) : undefined,
    eid ? svc.get("MedicationReconciliation", reconciliationIdFor(eid, "admission")).then((v) => v, () => undefined) : undefined,
    eid ? svc.get("ClinicalNote", dischargeSummaryIdFor(eid)).then((v) => v, () => undefined) : undefined,
    soft(svc.byPatient(TYPE, patientId)),
    marSchedule(request, env, { ...ctx, ...(ctx.schedule || {}), patientId, from: iso(nowMs - 12 * 3600e3), to: iso(nowMs + 3600e3), now: iso(nowMs) })
      .then((s) => (s && s.ok ? s : null), () => null),
  ]);
  if (encounter && str(encounter.patientId) !== patientId) return { ...base, ok: false, status: 409, error: "encounter_mismatch" };

  const res = evaluateSignals({ patientId, encounterId: eid || null, patient, encounter: encounter || null, observations, orders, verifications,
    loops, tasks, frequency: frequency === undefined ? undefined : frequency, reconciliation, dischargeSummary, schedule, nowMs,
    cfg: { deltaLimits: cfg.deltaLimits || null, highAlertDrugs: cfg.highAlertDrugs || [], orderVerifyWithinHours: cfg.orderVerifyWithinHours,
      graceMinutes: Number.isFinite(cfg.marGraceMinutes) ? cfg.marGraceMinutes : undefined } });
  const ackRows = acks || [];
  for (const s of res.signals) s.acknowledgements = ackRows.filter((a) => a && a.signalId === s.id).map((a) => ({ id: a.id, by: a.acknowledgedBy, at: a.acknowledgedAt, note: a.note }));
  return { ...base, ok: true, patientId, encounterId: eid || null, computedAt: iso(nowMs), ...res,
    ...(acks ? {} : { acknowledgementsUnread: true }), notBuilt: NOT_BUILT };
}

/**
 * A clinician acknowledges one ACTIVE signal. Append-only: each acknowledgement is its own record.
 * The signal is recomputed first, so nobody can acknowledge a signal the record does not support.
 * ctx: patientSurveillance's, plus { signalId, note, idempotencyKey? }
 */
async function acknowledgeSignal(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const signalId = str(ctx.signalId), note = str(ctx.note);
  if (!signalId) return { ...base, ok: false, status: 422, error: "signal_required", written: 0 };
  if (note.length < 3) return { ...base, ok: false, status: 422, error: "note_required", detail: "an acknowledgement says what was done or decided", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const current = await patientSurveillance(request, env, ctx);
  if (!current.ok) return { ...current, written: 0 };
  const sig = current.signals.find((s) => s.id === signalId);
  if (!sig) return { ...base, ok: false, status: 409, error: "signal_not_active", detail: "that signal is not active on this patient's record now", written: 0 };
  const at = new Date().toISOString();
  const record = {
    resourceType: TYPE, id: `wsq-survack-${slug(ctx.patientId)}-${at.replace(/[^0-9]/g, "").slice(0, 17)}-${slug(sig.ruleId)}`,
    patientId: sig.patientId, encounterId: sig.encounterId, signalId: sig.id, ruleId: sig.ruleId,
    note, acknowledgedBy: resolved.actor.id, acknowledgedAt: at,
    // What the clinician was looking at, by id. The signal is recomputed later; this is what it was.
    evidence: sig.evidence.map((e) => ({ resourceType: e.resourceType, id: e.id, value: e.value, unit: e.unit, at: e.at })),
    source: { system: "wardsynq-native", sourceId: `surveillance-ack:${sig.id}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, acknowledgementId: record.id, signalId: sig.id, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

export { TYPE, RULES, NOT_BUILT, evaluateSignals, patientSurveillance, acknowledgeSignal };
