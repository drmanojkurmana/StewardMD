/* functions/_wardsynq/discharge-milestones.js - the time from "can go" to "has gone".
 *
 * A discharge in an Indian private hospital is a relay: the consultant advises it, pharmacy clears the returns and the
 * take-home medicines, the billing desk makes the bill ready, a cashless stay waits for the TPA's final approval, the
 * summary is signed, and the patient leaves. The bed is blocked for the whole relay, and nobody could say which leg
 * took the hours. One DischargeMilestone record per stay holds each leg's time, recorded by the person whose act it is:
 *
 *   advised               emr.treat       the consultant approves discharge (NABH KPI 24 starts here)
 *   pharmacy-cleared      order.verify    pharmacy has cleared the stay
 *   bill-ready            billing.charge  the final bill is ready
 *   tpa-final-requested   billing.charge  the TPA's final approval was asked for (cashless stays only)
 *   tpa-final-received    billing.charge  the TPA's final approval came back
 *   summary-signed        derived         the first signed version of the discharge summary (migrate-discharge.js)
 *   left                  queue.add       the patient left the clinical unit (NABH KPI 24 ends here); when nobody
 *                                         recorded it, the time the stay was closed in WardSynQ, and said so
 *
 * A STEP NEVER GOES BACKWARDS WITHOUT A REASON. Every other step is at or after "advised", "left" is at or after every
 * other step, and the TPA's answer is at or after the request. A time that breaks that order is refused unless the
 * person says why, and the reason is kept on the step. Changing a recorded time is a new version with a reason.
 *
 * NOTHING HERE PREDICTS OR JUDGES. Turnaround is arithmetic on the recorded times (median minutes from "advised", with
 * the number of stays behind it); a step nobody recorded is counted as not recorded, never as zero minutes.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-discharge-capacity.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";
import { dischargeSummaryIdFor } from "./migrate-discharge.js";
import { patientLabels, labelKey } from "./patient-label.js";

const DMS_TYPE = "DischargeMilestone";
const READ_MAX = 50000;
const STEPS = Object.freeze(["advised", "pharmacy-cleared", "bill-ready", "tpa-final-requested", "tpa-final-received", "summary-signed", "left"]);
const RECORDED_STEPS = Object.freeze(STEPS.filter((s) => s !== "summary-signed"));
const SKEW_MS = 5 * 60000;
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const dmsIdFor = (encounterId) => `wsq-dms-${slug(encounterId)}`;

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
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "Someone recorded a step on this discharge since it was shown. Refresh and record it again.", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

/** PURE. The steps already timed (ms) that a time `atMs` for `step` would put out of order. */
function orderConflicts(step, atMs, times) {
  const t = (s) => (times && Number.isFinite(times[s]) ? times[s] : null);
  const out = [];
  const mustBeAfter = (s) => { if (t(s) != null && atMs < t(s)) out.push(s); };
  const mustBeBefore = (s) => { if (t(s) != null && atMs > t(s)) out.push(s); };
  if (step === "advised") { for (const s of STEPS) if (s !== "advised") mustBeBefore(s); return out; }
  mustBeAfter("advised");
  if (step === "left") { for (const s of STEPS) if (s !== "left" && s !== "advised") mustBeAfter(s); return out; }
  mustBeBefore("left");
  if (step === "tpa-final-received") mustBeAfter("tpa-final-requested");
  if (step === "tpa-final-requested") mustBeBefore("tpa-final-received");
  return out;
}

/**
 * PURE. Each step's time and where it came from. derived: { summarySignedAt?: iso | false (could not be read),
 * encounter?: the stay or null/false }. A step with no time is null, never "now" and never zero.
 */
function milestoneTimes(record, derived) {
  const m = (record && record.milestones) || {};
  const d = derived || {};
  const steps = {};
  for (const s of STEPS) {
    const x = m[s];
    steps[s] = x && ms(x.at) != null ? { at: x.at, source: "recorded", by: x.by || null, reason: x.reason || null, outOfOrder: x.outOfOrder || null } : null;
  }
  if (d.summarySignedAt === false) steps["summary-signed"] = { at: null, source: "unreadable" };
  else if (d.summarySignedAt) steps["summary-signed"] = { at: d.summarySignedAt, source: "derived" };
  const enc = d.encounter;
  if (!steps.left) {
    if (enc === false) steps.left = { at: null, source: "unreadable" };
    else if (enc && enc.status === "finished" && ms(enc.periodEnd) != null) steps.left = { at: enc.periodEnd, source: "stay-closed" };
  }
  return steps;
}

/**
 * PURE. NABH KPI 24 for one stay: minutes from discharge advised to leaving the clinical unit, less any time the patient
 * asked to stay (recorded on "left"). Null when either end is missing or the answer would be negative.
 */
function dischargeMinutes(record, encounter) {
  const steps = milestoneTimes(record, { encounter: encounter || null });
  const a = steps.advised && ms(steps.advised.at), l = steps.left && ms(steps.left.at);
  if (a == null || l == null) return null;
  const left = record && record.milestones && record.milestones.left;
  const delay = Number((left && left.patientDelayMinutes) || 0);
  const minutes = (l - a) / 60000 - (Number.isFinite(delay) ? delay : 0);
  return minutes >= 0 ? Math.round(minutes) : null;
}

/** PURE. The median of numbers, or null for none. */
function median(values) {
  const v = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * PURE. Turnaround by step over the stays that left in [fromMs, toMs]: for each step the median minutes from "advised"
 * and how many stays it is taken from, and how many stays have no time for it. stays: [{ record, times }]
 */
function turnaround(stays, fromMs, toMs) {
  const done = (stays || []).filter((s) => {
    const l = s.times.left && ms(s.times.left.at), a = s.times.advised && ms(s.times.advised.at);
    return a != null && l != null && l >= fromMs && l <= toMs;
  });
  const steps = STEPS.filter((s) => s !== "advised").map((step) => {
    const mins = [];
    let missing = 0;
    for (const s of done) {
      const at = s.times[step] && ms(s.times[step].at);
      if (at == null) { missing += 1; continue; }
      mins.push(Math.round((at - ms(s.times.advised.at)) / 60000));
    }
    return { step, medianMinutesFromAdvised: median(mins), stays: mins.length, notRecorded: missing };
  });
  const totals = done.map((s) => dischargeMinutes(s.record, s.encounter)).filter((x) => x != null);
  return { stays: done.length, medianTotalMinutes: median(totals), steps };
}

/**
 * Records one step. ctx: { migration, encounterId, step, at?, reason?, patientDelayMinutes?, expectedVersion?, now?,
 * actorDeps, recordDeps }. The route has already checked the step's own capability.
 */
async function recordDischargeMilestone(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const encounterId = str(ctx.encounterId), step = str(ctx.step), reason = str(ctx.reason);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (step === "summary-signed") return { ...base, ok: false, status: 422, error: "derived_step", detail: "Signing the discharge summary records this step.", written: 0 };
  if (!RECORDED_STEPS.includes(step)) return { ...base, ok: false, status: 422, error: "step_invalid", detail: `the step is one of ${RECORDED_STEPS.join(", ")}`, written: 0 };
  const nowMs = ms(ctx.now) || Date.now();
  const atMs = str(ctx.at) ? ms(ctx.at) : nowMs;
  if (atMs == null) return { ...base, ok: false, status: 422, error: "at_invalid", detail: "give the time as a date and time", written: 0 };
  if (atMs > nowMs + SKEW_MS) return { ...base, ok: false, status: 422, error: "at_in_future", detail: "a step is recorded when it has happened, not before", written: 0 };
  let delay = null;
  if (step === "left" && ctx.patientDelayMinutes != null && str(ctx.patientDelayMinutes) !== "") {
    delay = Number(ctx.patientDelayMinutes);
    if (!Number.isInteger(delay) || delay < 0 || delay > 1440) return { ...base, ok: false, status: 422, error: "delay_invalid", detail: "the time the patient asked to stay is whole minutes, 0 to 1440", written: 0 };
  }

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = dmsIdFor(encounterId);
  let current, enc = null;
  try {
    current = await svc.get(DMS_TYPE, id);
    // Only the steps whose holders read the stay look at it: advised opens the record, left can close after the stay.
    if (step === "advised" || step === "left") enc = await svc.get("Encounter", encounterId);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ...writeFailure(e, { written: 0 }) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The discharge could not be read, so nothing was recorded.", written: 0 };
  }
  if (!current && step !== "advised") return { ...base, ok: false, status: 409, error: "not_advised", detail: "No doctor has recorded that discharge was advised for this stay. That comes first.", written: 0 };
  if (step === "advised" || step === "left") {
    if (!enc) return { ...base, ok: false, status: 404, error: "encounter_not_found", written: 0 };
    if (!ADMISSION_CLASSES.includes(enc.class)) return { ...base, ok: false, status: 409, error: "not_admitted", detail: "discharge milestones belong to an inpatient stay", written: 0 };
    if (step === "advised" && !current && enc.status !== OPEN && reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "this stay is already closed; say why discharge advice is being recorded now", written: 0 };
  }
  const prior = current && current.milestones && current.milestones[step];
  if (prior) {
    if (!Number.isInteger(ctx.expectedVersion)) return { ...base, ok: false, status: 422, error: "expected_version_required", detail: "name the version being corrected", version: current.version, written: 0 };
    if (ctx.expectedVersion !== current.version) return { ...base, ok: false, status: 409, error: "version_conflict", detail: "Someone recorded a step on this discharge since it was shown. Refresh and record it again.", version: current.version, written: 0 };
    if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why a recorded time is being changed", version: current.version, written: 0 };
    if (ms(prior.at) === atMs && (step !== "left" || (prior.patientDelayMinutes || null) === delay)) return { ...base, ok: false, status: 409, error: "unchanged", detail: "that time is already recorded", version: current.version, written: 0 };
  }

  const times = {};
  const known = milestoneTimes(current, { encounter: step === "advised" || step === "left" ? enc : null });
  for (const s of STEPS) if (s !== step && known[s] && ms(known[s].at) != null) times[s] = ms(known[s].at);
  const conflicts = orderConflicts(step, atMs, times);
  if (conflicts.length && reason.length < 5) {
    return { ...base, ok: false, status: 422, error: "out_of_order", conflicts, detail: `this time is out of order with: ${conflicts.join(", ")}. Check the time, or say why it is right.`, written: 0 };
  }
  if (delay != null && times.advised != null && delay > (atMs - times.advised) / 60000) {
    return { ...base, ok: false, status: 422, error: "delay_invalid", detail: "the time the patient asked to stay is longer than the whole discharge", written: 0 };
  }

  const recordedAt = new Date(nowMs).toISOString();
  const entry = {
    at: new Date(atMs).toISOString(), by: resolved.actor.id, recordedAt,
    reason: reason || null, outOfOrder: conflicts.length ? conflicts : null, previousAt: prior ? prior.at : null,
    ...(step === "left" ? { patientDelayMinutes: delay } : {}),
  };
  const record = current
    ? { ...current, milestones: { ...current.milestones, [step]: entry } }
    : {
      resourceType: DMS_TYPE, id, encounterId, patientId: enc.patientId, class: enc.class,
      ward: (enc.location && enc.location.ward) || null, bed: (enc.location && enc.location.bed) || null,
      milestones: { advised: entry }, source: { system: "wardsynq-native", sourceId: `discharge-milestone:${encounterId}` },
    };
  delete record.version;
  delete record.meta;
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, encounterId, step, at: entry.at, outOfOrder: entry.outOfOrder, revised: !!prior, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { encounterId, step, written: 0, actor: resolved.actor.id }) }; }
}

/** The first time the stay's discharge summary was signed, per encounter; false when the summaries cannot be read. */
async function signedAtByEncounter(svc, encounterIds) {
  let hist;
  try { hist = await svc.histories("ClinicalNote", encounterIds.map(dischargeSummaryIdFor)); }
  catch { return false; }
  const out = new Map();
  for (const eid of encounterIds) {
    const rows = hist.get(dischargeSummaryIdFor(eid));
    if (rows === null) { out.set(eid, false); continue; }
    const first = (rows || []).find((r) => r && r.signedBy);
    out.set(eid, first ? ((first.meta && first.meta.recordedAt) || null) : null);
  }
  return out;
}

/**
 * The discharges in progress and the turnaround of those that finished. ctx: { migration, days?, now?, withPatients?,
 * actorDeps, recordDeps }. A source this role cannot read is named as unreadable, never shown as a missing step.
 */
async function dischargeProgress(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", inProgress: [], turnaround: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, inProgress: null, turnaround: null };
  const nowMs = ms(ctx.now) || Date.now();
  const days = Math.min(90, Math.max(1, Number(ctx.days) || 30));

  let rows, truncated = false;
  /* Every stay's milestones (service.listAll, oldest first). Past READ_MAX the newest discharges are the ones not read and
   * truncated says so. ponytail: archive by month (or audit O20's latest-version table) if a hospital outgrows it. */
  try { const got = await svc.listAll(DMS_TYPE, { max: READ_MAX }); rows = got.rows.filter(Boolean); truncated = got.truncated; }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", inProgress: null, turnaround: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "Discharge progress could not be read. Do not read this as no discharges.", inProgress: null, turnaround: null };
  }
  // An encounter read past the ceiling would leave the newest stays without a ward: unread (false), not missing.
  const encounters = await svc.listAll("Encounter", { max: READ_MAX, throwOnTruncate: true }).then((e) => new Map(e.rows.filter(Boolean).map((x) => [x.id, x])), () => false);
  const signed = rows.length ? await signedAtByEncounter(svc, rows.map((r) => r.encounterId)) : new Map();
  const stays = rows.map((record) => {
    const encounter = encounters === false ? false : (encounters.get(record.encounterId) || null);
    const signedAt = signed === false ? false : signed.get(record.encounterId);
    return { record, encounter, times: milestoneTimes(record, { encounter, summarySignedAt: signedAt }) };
  });

  const open = stays.filter((s) => !(s.times.left && s.times.left.at) && !(s.encounter && s.encounter.status === "cancelled"))
    .sort((a, b) => String(a.times.advised && a.times.advised.at).localeCompare(String(b.times.advised && b.times.advised.at)));
  const labels = ctx.withPatients ? await patientLabels(svc, open.map((s) => ({ patientId: s.record.patientId }))) : null;
  const inProgress = open.slice(0, 200).map((s) => {
    const l = labels ? labels.get(labelKey({ patientId: s.record.patientId })) || {} : {};
    const advisedMs = s.times.advised && ms(s.times.advised.at);
    return {
      encounterId: s.record.encounterId, patientId: s.record.patientId, version: s.record.version,
      ward: (s.encounter && s.encounter.location && s.encounter.location.ward) || s.record.ward || null,
      bed: (s.encounter && s.encounter.location && s.encounter.location.bed) || s.record.bed || null,
      ...(labels ? { name: l.name || null, mrn: l.mrn || null } : {}),
      minutesSinceAdvised: advisedMs != null ? Math.max(0, Math.round((nowMs - advisedMs) / 60000)) : null,
      steps: STEPS.map((step) => ({ step, ...(s.times[step] || { at: null, source: null }) })),
    };
  });
  return {
    ...base, ok: true, days, computedAt: new Date(nowMs).toISOString(), inProgress, inProgressTotal: open.length,
    turnaround: turnaround(stays, nowMs - days * 86400000, nowMs),
    unreadable: { stays: encounters === false, summaries: signed === false },
    truncated,
    note: "Times as recorded by the people who did each step. Turnaround is the median minutes from discharge advised; a step nobody recorded is counted as not recorded, not as zero.",
  };
}

export { DMS_TYPE, STEPS, RECORDED_STEPS, dmsIdFor, orderConflicts, milestoneTimes, dischargeMinutes, median, turnaround, recordDischargeMilestone, dischargeProgress };
