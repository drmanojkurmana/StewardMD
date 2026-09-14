/* functions/_wardsynq/nursing.js — the nursing command center: who has the patient, what is due, and when obs are next.
 *
 * THREE RECORDS, EACH APPEND-ONLY AND VERSIONED like everything else in the store:
 *
 *   NurseAssignment       one per admission. Who is looking after this patient this shift. A change of
 *                         nurse is a new version with the previous one kept in `history`, so "who had bed
 *                         12 at 03:00" can always be answered afterwards.
 *   NursingTask           one per task. open -> done | cancelled (with a reason). Never deleted.
 *   ObservationFrequency  one per admission. How often vital signs are due, in hours.
 *
 * VITALS DUE IS COMPUTED, NEVER STORED. It is worked out from the frequency and the time of the latest
 * vital-sign Observation, on every read. A stored "not due" stops being true the moment the clock passes.
 *
 * NO FREQUENCY IS NOT "NOT DUE". A patient with no frequency set says exactly that. Reading silence as
 * "nothing due" is the failure this file exists to prevent.
 *
 * NOTHING HERE PAGES ANYONE. A high early-warning score is shown on the worklist with the score and the
 * plain statement that escalation is the nurse's call. The bands are the NEWS2 module's own
 * (wardsynq-deterioration.js); this file adds no clinical threshold.
 *
 * WHO MAY ASSIGN: the route is gated on queue.assign, the capability that already means "may decide who
 * looks after a patient" (nurse, doctor, supervisor, reception hold it; interns and residents do not).
 * The record write is still checked by the store, and NurseAssignment is in the EMR_VITALS write scope,
 * so in practice the assigner is a nurse or a doctor. There is no separate charge-nurse role in this
 * product; a hospital that wants one narrows queue.assign by role.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { CAPS, can } from "../_queue_roles.js";

const ASSIGN = "NurseAssignment", TASK = "NursingTask", FREQ = "ObservationFrequency";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const HOURS = Object.freeze([1, 2, 4, 6, 12]);
/* Body weight is a vital-sign Observation in this store, but weighing a patient is not a set of obs:
 * counting it would reset the obs clock on a patient nobody has observed. */
const NOT_OBS = new Set(["29463-7"]);

class NursingError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status || 422; } }

/** PURE. The latest vital-sign time in a patient's observations, or null. */
function latestVitalsAt(observations) {
  let best = null;
  for (const o of observations || []) {
    if (!o || o.category !== "vital-signs" || NOT_OBS.has(o.code)) continue;
    // The canonical model carries the clinical time on meta (wardsynq-model.js makeMeta).
    const t = Date.parse((o.meta && o.meta.effectiveAt) || o.effectiveAt);
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}

/** PURE. Whether obs are due. freq: { everyHours } | null. */
function vitalsDue(freq, lastAt, nowMs) {
  const every = freq && HOURS.includes(Number(freq.everyHours)) ? Number(freq.everyHours) : null;
  if (!every) return { state: "no_frequency", everyHours: null, lastAt: lastAt || null, dueAt: null, text: "No observation frequency set" };
  if (!lastAt) return { state: "overdue", everyHours: every, lastAt: null, dueAt: null, text: "Observations every " + every + " h; none recorded yet, due now" };
  const dueMs = Date.parse(lastAt) + every * 3600e3;
  const overdue = nowMs > dueMs;
  return { state: overdue ? "overdue" : "not_due", everyHours: every, lastAt, dueAt: new Date(dueMs).toISOString(),
    text: "Observations every " + every + " h; " + (overdue ? "overdue" : "next due") };
}

/** PURE. Open and past its due time. */
const isOverdue = (t, nowMs) => t.status === "open" && Number.isFinite(Date.parse(t.dueAt)) && Date.parse(t.dueAt) < nowMs;

/** PURE. The next assignment record. input: { action: "assign"|"unassign", nurseId, nurseLabel, shift, reason, actorId, at } */
function applyAssignment(cur, base, input) {
  const i = input || {};
  const prev = cur || { resourceType: ASSIGN, ...base, nurseId: null, history: [] };
  if (i.action === "unassign") {
    if (!prev.nurseId) throw new NursingError("not_assigned", "nobody is assigned to this patient", 409);
    const ev = { action: "unassign", nurseId: prev.nurseId, at: i.at, by: i.actorId, ...(str(i.reason) ? { reason: str(i.reason) } : {}) };
    return { ...prev, nurseId: null, nurseLabel: null, shift: null, assignedBy: i.actorId, assignedAt: i.at, history: [...(prev.history || []), ev] };
  }
  if (i.action !== "assign") throw new NursingError("unknown_action", "an assignment can be assign or unassign");
  if (!str(i.nurseId)) throw new NursingError("nurse_required", "say which nurse is looking after this patient");
  const ev = { action: "assign", nurseId: str(i.nurseId), shift: str(i.shift) || null, at: i.at, by: i.actorId };
  return { ...prev, nurseId: str(i.nurseId), nurseLabel: str(i.nurseLabel) || null, shift: str(i.shift) || null, assignedBy: i.actorId, assignedAt: i.at, history: [...(prev.history || []), ev] };
}

/** PURE. A new task. */
function newTask(input) {
  const i = input || {};
  if (!str(i.title)) throw new NursingError("title_required", "say what the task is");
  if (!Number.isFinite(Date.parse(i.dueAt))) throw new NursingError("due_required", "a task needs a due time");
  return { resourceType: TASK, id: i.id, patientId: i.patientId, encounterId: i.encounterId, title: str(i.title).slice(0, 200),
    dueAt: new Date(i.dueAt).toISOString(), status: "open", createdBy: i.actorId, createdAt: i.at,
    doneBy: null, doneAt: null, cancelledBy: null, cancelledAt: null, cancelReason: null };
}

/** PURE. done / cancel. */
function applyTaskAction(task, input) {
  const i = input || {};
  if (task.status !== "open") throw new NursingError("not_open", "this task is already " + task.status, 409);
  if (i.action === "done") return { ...task, status: "done", doneBy: i.actorId, doneAt: i.at };
  if (i.action === "cancel") {
    if (!str(i.reason)) throw new NursingError("reason_required", "say why this task is cancelled");
    return { ...task, status: "cancelled", cancelledBy: i.actorId, cancelledAt: i.at, cancelReason: str(i.reason) };
  }
  throw new NursingError("unknown_action", "a task can be done or cancelled");
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function failure(e) {
  if (e instanceof NursingError) return { ok: false, status: e.status, error: e.code, detail: e.message };
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code) };
  if (e instanceof VersionConflictError && e.code === "IDEMPOTENCY_KEY_REUSED") return { ok: false, status: 409, error: "idempotency_conflict", detail: "this request key already recorded something else" };
  // G2: the record as it is now travels with the conflict, so a device's conflict review can show it beside the entry.
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "this changed since you opened it; reload it", currentVersion: e.detail && e.detail.currentVersion != null ? e.detail.currentVersion : null, ...(e.detail && e.detail.current ? { current: e.detail.current } : {}) };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

async function encounterOf(svc, encounterId, patientId) {
  const enc = str(encounterId) ? await svc.get("Encounter", str(encounterId)) : null;
  if (!enc) throw new NursingError("encounter_not_found", "this admission was not found", 404);
  if (patientId && enc.patientId !== str(patientId)) throw new NursingError("encounter_patient_mismatch", "this admission does not belong to that patient", 409);
  return enc;
}
function stale(cur, expected) {
  if (expected != null && expected !== "" && Number(expected) !== (cur ? cur.version : 0)) throw new VersionConflictError("stale", { expectedVersion: Number(expected), currentVersion: cur ? cur.version : 0, current: cur || null });
}

/**
 * Assign or unassign a nurse. ctx: { input: { encounterId, nurseId, shift, action, reason, expectedVersion },
 *   staffMember: async (identity) => membership row | null }
 */
async function assignNurse(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const i = ctx.input || {};
  const action = str(i.action) || "assign";
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  try {
    const enc = await encounterOf(svc, i.encounterId);
    let label = null;
    if (action === "assign") {
      const m = str(i.nurseId) ? await ctx.staffMember(str(i.nurseId)) : null;
      if (str(i.nurseId) && (!m || m.active === false)) throw new NursingError("not_an_active_member", "That person is not an active member of staff at this hospital, so they cannot be assigned a patient.");
      if (m && !can(m.role, CAPS.EMR_VITALS)) throw new NursingError("cannot_record_observations", "That member of staff cannot record observations, so they cannot be the nurse looking after a patient.");
      label = m ? (m.email || m.identity) : null;
    }
    const id = `wsq-nassign-${slug(enc.id)}`;
    const cur = await svc.get(ASSIGN, id);
    stale(cur, i.expectedVersion);
    const next = applyAssignment(cur, { id, patientId: enc.patientId, encounterId: enc.id },
      { action, nurseId: i.nurseId, nurseLabel: label, shift: i.shift, reason: i.reason, actorId: resolved.actor.id, at: new Date().toISOString() });
    delete next.version;
    const out = await svc.put(next, { expectedVersion: cur ? cur.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, assignment: { ...next, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e), written: 0 }; }
}

/** ctx.input: { encounterId, everyHours (0 or empty clears), expectedVersion } */
async function setObservationFrequency(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const i = ctx.input || {};
  const every = i.everyHours === "" || i.everyHours == null || Number(i.everyHours) === 0 ? null : Number(i.everyHours);
  if (every != null && !HOURS.includes(every)) return { ...base, ok: false, status: 422, error: "bad_frequency", detail: "choose every 1, 2, 4, 6 or 12 hours", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  try {
    const enc = await encounterOf(svc, i.encounterId);
    const id = `wsq-obsfreq-${slug(enc.id)}`;
    const cur = await svc.get(FREQ, id);
    stale(cur, i.expectedVersion);
    const at = new Date().toISOString();
    const next = { resourceType: FREQ, id, patientId: enc.patientId, encounterId: enc.id, everyHours: every, setBy: resolved.actor.id, setAt: at,
      history: [...((cur && cur.history) || []), { everyHours: every, at, by: resolved.actor.id }] };
    const out = await svc.put(next, { expectedVersion: cur ? cur.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, frequency: { ...next, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e), written: 0 }; }
}

/** ctx.input: { patientId, encounterId, title, dueAt } */
async function createNursingTask(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const i = ctx.input || {};
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  try {
    const enc = await encounterOf(svc, i.encounterId, i.patientId);
    const task = newTask({ ...i, patientId: enc.patientId, encounterId: enc.id, actorId: resolved.actor.id, at: new Date().toISOString(),
      id: `wsq-ntask-${slug(enc.id)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` });
    const out = await svc.put(task, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, task: { ...task, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e), written: 0 }; }
}

/** ctx.input: { taskId, action: done|cancel, reason, expectedVersion } */
async function actOnNursingTask(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const i = ctx.input || {};
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  try {
    const cur = await svc.get(TASK, str(i.taskId));
    if (!cur) throw new NursingError("task_not_found", "this task was not found", 404);
    // A retried request (an offline device replaying after a lost response) gets its original
    // outcome, not a version conflict against the version its own first attempt produced.
    const prior = ctx.idempotencyKey ? await svc.replayFor(ctx.idempotencyKey, TASK, cur.patientId || null, cur.id) : null;
    if (prior && prior.record) {
      if (prior.record.id !== cur.id) throw Object.assign(new VersionConflictError("idempotency key reused for another task"), { code: "IDEMPOTENCY_KEY_REUSED" });
      return { ...base, ok: true, written: 0, replayed: true, task: prior.record };
    }
    stale(cur, i.expectedVersion);
    const next = applyTaskAction(cur, { action: i.action, reason: i.reason, actorId: resolved.actor.id, at: new Date().toISOString() });
    delete next.version;
    const out = await svc.put(next, { expectedVersion: cur.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, task: { ...next, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e), written: 0 }; }
}

/* Each piece is read on its own: one that fails is null with a sentence, never an empty list or a zero. */
async function readPatient(svc, patientId, encounterId, nowMs) {
  const out = { assignment: null, tasks: null, tasksOpen: null, tasksOverdue: null, vitals: null, problems: [] };
  const eid = slug(encounterId);
  try {
    const a = eid ? await svc.get(ASSIGN, `wsq-nassign-${eid}`) : null;
    out.assignment = a && a.nurseId ? { nurseId: a.nurseId, nurseLabel: a.nurseLabel || null, shift: a.shift || null, assignedAt: a.assignedAt, version: a.version } : { nurseId: null, version: a ? a.version : null };
  } catch { out.problems.push("nurse assignment could not be read"); }
  try {
    const rows = (await svc.byPatient(TASK, patientId)) || [];
    const tasks = rows.filter((t) => t && (!encounterId || t.encounterId === encounterId))
      .map((t) => ({ ...t, overdue: isOverdue(t, nowMs) }))
      .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || String(a.dueAt).localeCompare(String(b.dueAt)));
    out.tasks = tasks;
    out.tasksOpen = tasks.filter((t) => t.status === "open").length;
    out.tasksOverdue = tasks.filter((t) => t.overdue).length;
  } catch { out.problems.push("tasks could not be read"); }
  try {
    const [freq, obs] = await Promise.all([eid ? svc.get(FREQ, `wsq-obsfreq-${eid}`) : null, svc.byPatient("Observation", patientId)]);
    out.vitals = { ...vitalsDue(freq, latestVitalsAt(obs), nowMs), version: freq ? freq.version : null };
  } catch { out.problems.push("observation schedule could not be read"); }
  return out;
}

/** One patient's nursing panel. ctx: { patientId, encounterId } */
async function nursingPatient(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };
  if (!str(ctx.patientId) || !str(ctx.encounterId)) return { ...base, ok: false, status: 422, error: "encounter_required" };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  return { ...base, ok: true, patientId: str(ctx.patientId), encounterId: str(ctx.encounterId), ...(await readPatient(svc, str(ctx.patientId), str(ctx.encounterId), Date.now())) };
}

/** The worklist's nursing columns, for many patients under one actor. ctx: { patients: [{ patientId, encounterId }] } -> Map */
async function nursingWard(request, env, ctx) {
  const map = new Map();
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return map;
  const nowMs = Date.now();
  await Promise.all((ctx.patients || []).map(async (p) => { map.set(p.patientId, await readPatient(svc, p.patientId, p.encounterId, nowMs)); }));
  return map;
}

export { ASSIGN, TASK, FREQ, HOURS, NursingError, latestVitalsAt, vitalsDue, isOverdue, applyAssignment, newTask, applyTaskAction,
  assignNurse, setObservationFrequency, createNursingTask, actOnNursingTask, nursingPatient, nursingWard };
