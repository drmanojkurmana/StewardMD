/* functions/_wardsynq/access-times.js - how long an outpatient waited, for the doctor and for a test (P3 theatre-opd-access,
 * 2026-09-17). NABH PSQ 3c indicators 22 and 23.
 *
 * OUTPATIENT CONSULTATION (22). The arrival is the OPD visit's start (migrate-encounter.js: the ticket's registration
 * time at the OPD desk) and the consultation start is the moment the ticket moved into consultation in the consultant's
 * queue (consultStartAt on the same encounter). For a patient with an appointment NABH starts the clock at the
 * appointment time: the appointment used is the one for the same patient on the same hospital day that the desk marked
 * arrived or completed, and only when there is exactly one. A patient seen before the appointment time waited zero
 * minutes (NABH's own rule). The clock never starts before the patient arrived, so a patient who came late is not counted
 * as waiting for the time they were not there.
 *
 * DIAGNOSTICS (23). A DiagnosticVisit is written at the laboratory or imaging counter: the time the requisition was
 * presented, and later the time the test began. Only outpatient visits count, as NABH says.
 *
 * NOTHING MISSING IS GUESSED. A visit with no consultation start, or a test with no start, is counted as missing and
 * listed; it adds nothing to the sum and nothing to the count divided by. Each visit's inputs are returned beside its
 * waiting time, so the average can be checked by hand.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, ListCeilingError } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const READ_MAX = 50000;
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const MIN = 60000, DAY = 86400000;
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

const TYPE = "DiagnosticVisit";
const SERVICES = Object.freeze(["laboratory", "imaging"]);
const SETTINGS = Object.freeze(["outpatient", "inpatient"]);

function DiagnosticVisit(input) {
  const i = input || {};
  return {
    resourceType: TYPE, id: i.id, patientId: i.patientId,
    service: i.service, setting: i.setting, serviceRequestId: i.serviceRequestId || null,
    arrivedAt: i.arrivedAt || null, appointmentAt: i.appointmentAt || null,
    startedAt: i.startedAt || null, startedBy: i.startedBy || null,
    recordedBy: i.recordedBy || null, recordedAt: i.recordedAt || null,
    source: { system: "wardsynq-native", sourceId: `diagnostic-visit:${i.id}` },
  };
}
function visitIdFor(patientId, service, arrivedAt) { const p = slug(patientId), s = slug(service), t = slug(arrivedAt); return p && s && t ? `wsq-dxv-${p}-${s}-${t}` : null; }

/** PURE. Minutes waited from max(arrival, appointment) to the start, never below zero; or why it cannot be computed. */
function waitOf(arrivalMs, appointmentMs, startMs) {
  if (arrivalMs == null) return { minutes: null, missing: ["arrival"] };
  if (startMs == null) return { minutes: null, missing: ["start"] };
  const from = appointmentMs != null && appointmentMs > arrivalMs ? appointmentMs : arrivalMs;
  return { minutes: r1(Math.max(0, startMs - from) / MIN), from: iso(from), missing: [] };
}
const localDay = (t, offMs) => new Date(t + offMs).toISOString().slice(0, 10);

/** PURE. Outpatient visits that arrived in [fromMs, toMs]: each with its inputs and wait. */
function opdWaits(encounters, appointments, w) {
  const off = w.offsetMs || 0;
  const appts = (appointments || []).filter((a) => a && (a.state === "arrived" || a.state === "completed") && ms(a.startAt) != null);
  return (encounters || []).filter((e) => e && e.class === "OPD" && e.status !== "cancelled" && ms(e.periodStart) != null && ms(e.periodStart) >= w.fromMs && ms(e.periodStart) <= w.toMs)
    .map((e) => {
      const arrival = ms(e.periodStart), day = localDay(arrival, off);
      const same = appts.filter((a) => str(a.patientId) === str(e.patientId) && localDay(ms(a.startAt), off) === day);
      const appt = same.length === 1 ? same[0] : null;
      const wait = waitOf(arrival, appt ? ms(appt.startAt) : null, ms(e.consultStartAt));
      return { encounterId: e.id, patientId: e.patientId, arrivedAt: iso(arrival), appointmentAt: appt ? iso(ms(appt.startAt)) : null,
        appointmentsThatDay: same.length, consultStartAt: ms(e.consultStartAt) == null ? null : iso(ms(e.consultStartAt)), department: (e.location && e.location.ward) || null, ...wait };
    }).sort((a, b) => String(a.arrivedAt).localeCompare(String(b.arrivedAt)));
}

/** PURE. Outpatient diagnostic visits that arrived in the window. */
function diagnosticWaits(visits, w) {
  return (visits || []).filter((v) => v && v.setting === "outpatient" && ms(v.arrivedAt) != null && ms(v.arrivedAt) >= w.fromMs && ms(v.arrivedAt) <= w.toMs)
    .map((v) => ({ visitId: v.id, patientId: v.patientId, service: v.service, arrivedAt: v.arrivedAt, appointmentAt: v.appointmentAt || null, startedAt: v.startedAt || null,
      ...waitOf(ms(v.arrivedAt), ms(v.appointmentAt), ms(v.startedAt)) }))
    .sort((a, b) => String(a.arrivedAt).localeCompare(String(b.arrivedAt)));
}

/** PURE. The NABH cell: sum of minutes over the visits that have both times; the missing ones counted beside. */
function waitCell(rows) {
  const done = rows.filter((r) => r.minutes != null);
  const sum = done.reduce((a, r) => a + r.minutes, 0);
  return { numerator: r1(sum), denominator: done.length, value: done.length ? r1(sum / done.length) : null, missing: rows.length - done.length };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
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
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });
/** A stated time, or now; undefined when stated but not a time or ahead of now by more than five minutes. */
function stated(v) {
  if (!str(v)) return new Date().toISOString();
  const t = ms(v);
  return t == null || t > Date.now() + 5 * MIN ? undefined : iso(t);
}

/** ctx: { migration, patientId, service, setting, arrivedAt?, appointmentAt?, serviceRequestId?, actorDeps, recordDeps } */
async function recordDiagnosticArrival(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId), service = str(ctx.service), setting = str(ctx.setting);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!SERVICES.includes(service)) return { ...base, ok: false, status: 422, error: "service_required", detail: "laboratory or imaging", written: 0 };
  if (!SETTINGS.includes(setting)) return { ...base, ok: false, status: 422, error: "setting_required", detail: "outpatient or inpatient", written: 0 };
  const arrivedAt = stated(ctx.arrivedAt);
  if (arrivedAt === undefined) return { ...base, ok: false, status: 422, error: "bad_time", detail: "the arrival time is not a date and time, or is in the future", written: 0 };
  const appointmentAt = str(ctx.appointmentAt) ? (ms(ctx.appointmentAt) == null ? undefined : iso(ms(ctx.appointmentAt))) : null;
  if (appointmentAt === undefined) return { ...base, ok: false, status: 422, error: "bad_time", detail: "the appointment time is not a date and time", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = visitIdFor(patientId, service, arrivedAt);
  const rec = DiagnosticVisit({ id, patientId, service, setting, serviceRequestId: str(ctx.serviceRequestId) || null, arrivedAt, appointmentAt, recordedBy: resolved.actor.id, recordedAt: new Date().toISOString() });
  try {
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, visitId: id, visit: { ...rec, version: out.record.version }, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { visitId: id, written: 0 }) }; }
}

/** ctx: { migration, visitId, startedAt?, actorDeps, recordDeps } */
async function recordDiagnosticStart(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const visitId = str(ctx.visitId);
  if (!visitId) return { ...base, ok: false, status: 422, error: "visit_required", written: 0 };
  const startedAt = stated(ctx.startedAt);
  if (startedAt === undefined) return { ...base, ok: false, status: 422, error: "bad_time", detail: "the start time is not a date and time, or is in the future", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(TYPE, visitId); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "visit_not_found", written: 0 };
  if (current.startedAt) return { ...base, ok: true, written: 0, skipped: "already_started", visitId, startedAt: current.startedAt, version: current.version };
  if (ms(startedAt) < ms(current.arrivedAt)) return { ...base, ok: false, status: 422, error: "bad_time", detail: "a test cannot start before the patient arrived", written: 0 };
  const next = DiagnosticVisit({ ...current, startedAt, startedBy: resolved.actor.id });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, visitId, startedAt, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { visitId, written: 0 }) }; }
}

/** The day's (or a window's) outpatient waits with their inputs. ctx: { migration, from?, to?, utcOffsetMinutes?, actorDeps, recordDeps } */
async function accessTimes(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", opd: [], diagnostics: [] };
  const off = (ctx.utcOffsetMinutes != null && ctx.utcOffsetMinutes !== "" && Number.isFinite(Number(ctx.utcOffsetMinutes)) ? Number(ctx.utcOffsetMinutes) : 330) * MIN;
  let fromMs = ms(ctx.from), toMs = ms(ctx.to);
  if (fromMs == null) fromMs = Date.parse(localDay(Date.now(), off) + "T00:00:00Z") - off;
  if (toMs == null) toMs = fromMs + DAY - 1;
  if (toMs < fromMs || toMs - fromMs > 31 * DAY) return { ...base, ok: false, status: 422, error: "bad_window", detail: "from must be before to, at most 31 days apart", opd: null, diagnostics: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, opd: null, diagnostics: null };
  const w = { fromMs, toMs, offsetMs: off };
  /* Every record of the type (service.listAll, oldest first). Past READ_MAX the newest, which hold this window's waits, are
   * the ones not read, so that read fails visibly (null with the reason) rather than showing short waits. */
  const read = async (t) => { try { return { rows: (await svc.listAll(t, { max: READ_MAX, throwOnTruncate: true })).rows.filter(Boolean) }; } catch (e) { return { failed: e instanceof GovernanceError ? "not readable with this role" : e instanceof ListCeilingError ? "more records than can be read at once; the newest were not read" : "read failed" }; } };
  const [enc, appt, dx] = await Promise.all([read("Encounter"), read("Appointment"), read(TYPE)]);
  /* A role that may read neither the visits nor the diagnostic counter has no waits to see: refused, not an empty 200. */
  if (enc.failed === "not readable with this role" && dx.failed === "not readable with this role") return { ...base, ok: false, status: 403, error: "permission", detail: "Visits and diagnostic visits are not readable with this role.", opd: null, diagnostics: null };
  /* A list that could not be read is null with the reason, never an empty list. Appointments only move the clock start,
   * so without them the OPD waits are still shown, measured from arrival, and the screen says the appointments were not read. */
  const opd = enc.failed ? null : opdWaits(enc.rows, appt.rows || [], w);
  const diagnostics = dx.failed ? null : diagnosticWaits(dx.rows, w);
  const openVisits = dx.failed ? null : dx.rows.filter((v) => !v.startedAt && ms(v.arrivedAt) != null && ms(v.arrivedAt) >= fromMs && ms(v.arrivedAt) <= toMs)
    .map((v) => ({ visitId: v.id, patientId: v.patientId, service: v.service, setting: v.setting, arrivedAt: v.arrivedAt, appointmentAt: v.appointmentAt || null }));
  return {
    ...base, ok: true, from: iso(fromMs), to: iso(toMs),
    opd, opdSummary: opd ? waitCell(opd) : null, ...(enc.failed ? { opdUnreadable: enc.failed } : {}), ...(appt.failed ? { appointmentsUnreadable: appt.failed } : {}),
    diagnostics, diagnosticsSummary: diagnostics ? waitCell(diagnostics) : null, openVisits, ...(dx.failed ? { diagnosticsUnreadable: dx.failed } : {}),
  };
}

export { TYPE, SERVICES, SETTINGS, DiagnosticVisit, visitIdFor, waitOf, opdWaits, diagnosticWaits, waitCell, recordDiagnosticArrival, recordDiagnosticStart, accessTimes };
