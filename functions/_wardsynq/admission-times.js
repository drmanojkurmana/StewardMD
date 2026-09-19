/* functions/_wardsynq/admission-times.js - the two times NABH KPI 1 is measured between (R2-2 ward-times-and-desk, 2026-09-17).
 *
 * NABH PSQ 3a indicator 1 runs "from the time that the patient has arrived at the bed of the ward until the time that the
 * initial assessment has been completed and documented by a doctor". Neither time existed. The admission Encounter's
 * periodStart is when the admission was entered (or the time the desk stated), and a transfer's movedAt is when the bed
 * changed on the record: both are clerical times, and a patient admitted from the emergency department reaches the bed
 * later than either. So each is recorded by the person whose act it is, on one AdmissionTimes record per stay:
 *
 *   bedArrival          emr.vitals   the nurse receiving the patient records when they reached the bed (default now)
 *   initialAssessment   emr.treat    a doctor marks one SIGNED note of the stay as its initial assessment; the time is
 *                                    that note's signing time, never typed in. The first mark wins; a second is refused
 *                                    naming the note already marked.
 *
 * A TIME NEVER GOES BACKWARDS WITHOUT A REASON (discharge-milestones.js's rule, reused): an assessment signed before the
 * recorded bed arrival is refused unless the person says why, and a stay recorded that way is counted beside the average,
 * never averaged as a negative or as zero. Changing the bed arrival is a new version with a reason. A stay missing either
 * time is counted as missing.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-initial-assessment.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ADMISSION_CLASSES } from "./migrate-inpatient.js";

const TYPE = "AdmissionTimes";
const SKEW_MS = 5 * 60000;
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const admissionTimesIdFor = (encounterId) => `wsq-adt-${slug(encounterId)}`;
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

async function openService(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "Someone recorded a time on this stay since it was shown. Refresh and record it again.", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/** PURE. Minutes from bed arrival to the initial assessment's signing, or null when either is missing or it is negative. */
function assessmentMinutes(record) {
  const a = ms(record && record.bedArrival && record.bedArrival.at), s = ms(record && record.initialAssessment && record.initialAssessment.signedAt);
  if (a == null || s == null || s < a) return null;
  return Math.round((s - a) / 60000);
}

/**
 * PURE. NABH KPI 1 for one month: admissions (inpatient classes, not day care, not cancelled) that started in the window.
 * numerator = sum of minutes, denominator = admissions with both times in order, value = the mean. Admissions missing a
 * time, or recorded out of order with a reason, are counted beside and listed, never averaged.
 */
function initialAssessmentCell(records, encounters, w) {
  const byEnc = new Map((records || []).filter((r) => r && r.encounterId).map((r) => [r.encounterId, r]));
  const adm = (encounters || []).filter((e) => e && ADMISSION_CLASSES.includes(e.class) && e.status !== "cancelled" && ms(e.periodStart) != null && ms(e.periodStart) >= w.fromMs && ms(e.periodStart) <= w.toMs);
  const mins = [], missing = [];
  let outOfOrder = 0;
  for (const e of adm) {
    const r = byEnc.get(e.id);
    const gaps = [!(r && r.bedArrival && r.bedArrival.at) && "bedArrival", !(r && r.initialAssessment && r.initialAssessment.signedAt) && "initialAssessment"].filter(Boolean);
    if (gaps.length) { missing.push({ encounterId: e.id, missing: gaps }); continue; }
    const m = assessmentMinutes(r);
    if (m == null) { outOfOrder++; continue; }
    mins.push(m);
  }
  const sum = mins.reduce((a, b) => a + b, 0);
  return {
    numerator: sum, denominator: mins.length, value: mins.length ? Math.round((sum / mins.length) * 10) / 10 : null, admissions: adm.length,
    missingBedArrival: missing.filter((x) => x.missing.includes("bedArrival")).length, missingInitialAssessment: missing.filter((x) => x.missing.includes("initialAssessment")).length,
    outOfOrder, missing: missing.slice(0, 200),
  };
}

/** Reads the stay, and the stay's record, for a write. Returns { enc, current } or a refusal. */
async function readStay(svc, encounterId, base) {
  let enc, current;
  try { enc = await svc.get("Encounter", encounterId); current = await svc.get(TYPE, admissionTimesIdFor(encounterId)); }
  catch (e) {
    if (e instanceof GovernanceError) return { refusal: { ...base, ...writeFailure(e, { written: 0 }) } };
    return { refusal: { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The stay could not be read, so nothing was recorded.", written: 0 } };
  }
  if (!enc) return { refusal: { ...base, ok: false, status: 404, error: "encounter_not_found", written: 0 } };
  if (!ADMISSION_CLASSES.includes(enc.class)) return { refusal: { ...base, ok: false, status: 409, error: "not_admitted", detail: "these times belong to an inpatient stay, not day care or an outpatient visit", written: 0 } };
  return { enc, current };
}

async function save(svc, resolved, base, enc, current, patch, extra, idempotencyKey) {
  const record = current
    ? { ...current, ...patch }
    : { resourceType: TYPE, id: admissionTimesIdFor(enc.id), encounterId: enc.id, patientId: enc.patientId, class: enc.class, bedArrival: null, initialAssessment: null, ...patch,
      source: { system: "wardsynq-native", sourceId: `admission-times:${enc.id}` } };
  delete record.version;
  delete record.meta;
  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : 0, idempotencyKey: idempotencyKey || null });
    return { ...base, ok: true, written: 1, encounterId: enc.id, ...extra, minutes: assessmentMinutes(record), version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { encounterId: enc.id, written: 0, actor: resolved.actor.id }) }; }
}

/** The nurse records when the patient reached the bed. ctx: { migration, encounterId, at?, reason?, expectedVersion?, now?, ... } */
async function recordBedArrival(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const encounterId = str(ctx.encounterId), reason = str(ctx.reason);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  const nowMs = ms(ctx.now) || Date.now();
  const atMs = str(ctx.at) ? ms(ctx.at) : nowMs;
  if (atMs == null) return { ...base, ok: false, status: 422, error: "at_invalid", detail: "give the time as a date and time", written: 0 };
  if (atMs > nowMs + SKEW_MS) return { ...base, ok: false, status: 422, error: "at_in_future", detail: "the arrival is recorded when it has happened, not before", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const { enc, current, refusal } = await readStay(svc, encounterId, base);
  if (refusal) return refusal;

  const prior = current && current.bedArrival;
  if (prior) {
    if (!Number.isInteger(ctx.expectedVersion)) return { ...base, ok: false, status: 422, error: "expected_version_required", detail: "name the version being corrected", version: current.version, written: 0 };
    if (ctx.expectedVersion !== current.version) return { ...base, ok: false, status: 409, error: "version_conflict", detail: "Someone recorded a time on this stay since it was shown. Refresh and record it again.", version: current.version, written: 0 };
    if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the recorded arrival time is being changed", version: current.version, written: 0 };
    if (ms(prior.at) === atMs) return { ...base, ok: false, status: 409, error: "unchanged", detail: "that time is already recorded", version: current.version, written: 0 };
  }
  const signed = ms(current && current.initialAssessment && current.initialAssessment.signedAt);
  const outOfOrder = signed != null && signed < atMs;
  if (outOfOrder && reason.length < 5) return { ...base, ok: false, status: 422, error: "out_of_order", detail: "the initial assessment marked for this stay was signed before this arrival time. Check the time, or say why it is right.", written: 0 };

  const entry = { at: new Date(atMs).toISOString(), by: resolved.actor.id, recordedAt: new Date(nowMs).toISOString(), reason: reason || null, outOfOrder, previousAt: prior ? prior.at : null };
  return save(svc, resolved, base, enc, current, { bedArrival: entry }, { bedArrivedAt: entry.at, revised: !!prior, outOfOrder }, ctx.idempotencyKey);
}

/** A doctor marks a signed note as the stay's initial assessment. ctx: { migration, encounterId, noteId, reason?, ... } */
async function markInitialAssessment(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const encounterId = str(ctx.encounterId), noteId = str(ctx.noteId), reason = str(ctx.reason);
  if (!encounterId || !noteId) return { ...base, ok: false, status: 422, error: "encounter_and_note_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const { enc, current, refusal } = await readStay(svc, encounterId, base);
  if (refusal) return refusal;
  const had = current && current.initialAssessment;
  if (had) return { ...base, ok: false, status: 409, error: "already_marked", detail: `the initial assessment of this stay is already marked: note ${had.noteId}, signed ${had.signedAt}`, marked: had, written: 0 };

  let note;
  try { note = await svc.get("ClinicalNote", noteId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The note could not be read, so nothing was recorded.", written: 0 }; }
  if (!note || note.encounterId !== encounterId) return { ...base, ok: false, status: 404, error: "note_not_found", detail: "no note of this stay has that id", written: 0 };
  if (note.noteType === "nursing") return { ...base, ok: false, status: 422, error: "not_a_doctors_note", detail: "NABH counts the assessment documented by a doctor; a nursing note cannot be marked", written: 0 };
  if (!note.signedBy || ms(note.signedAt) == null) return { ...base, ok: false, status: 409, error: "note_not_signed", detail: "only a signed note can be the initial assessment; sign it first", written: 0 };

  const arrived = ms(current && current.bedArrival && current.bedArrival.at);
  const outOfOrder = arrived != null && ms(note.signedAt) < arrived;
  if (outOfOrder && reason.length < 5) return { ...base, ok: false, status: 422, error: "out_of_order", detail: "this note was signed before the recorded bed arrival. Check the note, or say why it is right.", written: 0 };

  const entry = { noteId, signedAt: note.signedAt, signedBy: note.signedBy, markedBy: resolved.actor.id, markedAt: new Date().toISOString(), reason: reason || null, outOfOrder };
  return save(svc, resolved, base, enc, current, { initialAssessment: entry }, { initialAssessment: entry }, ctx.idempotencyKey);
}

/** The stay's two times and the signed notes a doctor may mark. ctx: { migration, encounterId, ... } */
async function admissionTimes(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", record: null };
  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", record: null };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, record: null };
  let enc, current;
  try { enc = await svc.get("Encounter", encounterId); current = await svc.get(TYPE, admissionTimesIdFor(encounterId)); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", record: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The admission times could not be read. Do not read this as not recorded.", record: null };
  }
  if (!enc) return { ...base, ok: false, status: 404, error: "encounter_not_found", record: null };
  /* The notes a doctor may mark; null when they cannot be read, so the screen never offers "no signed note" for a failed read. */
  let signedNotes = null;
  try {
    signedNotes = (await svc.byPatient("ClinicalNote", enc.patientId)).filter((n) => n && n.encounterId === encounterId && n.signedBy && ms(n.signedAt) != null && n.noteType !== "nursing")
      .map((n) => ({ noteId: n.id, noteType: n.noteType || null, templateId: n.templateId || null, signedBy: n.signedBy, signedAt: n.signedAt }))
      .sort((a, b) => String(a.signedAt).localeCompare(String(b.signedAt)));
  } catch { signedNotes = null; }
  return {
    ...base, ok: true, encounterId, admittedAt: enc.periodStart || null, eligible: ADMISSION_CLASSES.includes(enc.class),
    record: current ? { bedArrival: current.bedArrival || null, initialAssessment: current.initialAssessment || null, version: current.version } : null,
    minutes: assessmentMinutes(current), signedNotes,
  };
}

export { TYPE, admissionTimesIdFor, assessmentMinutes, initialAssessmentCell, recordBedArrival, markInitialAssessment, admissionTimes };
