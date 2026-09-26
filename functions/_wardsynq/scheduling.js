/* functions/_wardsynq/scheduling.js — appointments, and the follow-up that was promised.
 *
 * WardSynQ could register a patient who walked in and could not book one to come back. Every
 * discharge summary this system writes can say "review in clinic in one week", and until now that
 * sentence went nowhere: nothing held the appointment, nothing noticed when it was never made, and
 * the patient's next contact with the hospital was whenever they happened to turn up.
 *
 * TWO PATIENTS CANNOT HOLD ONE SLOT. The same invariant the bed board turns on, for the same reason:
 * a diary that double-books is a diary the clinic stops trusting within a week, and then everybody
 * keeps the real one on paper. Overbooking is ALLOWED - real clinics overbook, and a system that
 * refuses will simply be worked around - but it is a DELIBERATE act that says so on the record,
 * never something that happens because two people clicked at once.
 *
 * A RECALL IS A REQUEST, NOT A BOOKING. "Review in one week" creates something that has to be
 * booked, and stays visibly outstanding until it is. Auto-booking it would put an appointment in a
 * diary nobody agreed to, at a time nobody offered the patient - and, worse, would make the promise
 * look kept when nobody had spoken to them. The whole value of a recall is that it is visibly
 * UNMET until a human does something.
 *
 * A CANCELLED APPOINTMENT KEEPS ITS HISTORY. The slot frees immediately, and the record still shows
 * it was booked and cancelled and by whom, because "they cancelled" and "they never had one" are
 * different facts and the second one is what a complaint turns on.
 *
 * DID-NOT-ATTEND IS RECORDED, NEVER INFERRED. A slot whose time has passed with nobody marking it
 * is not a DNA - it is an appointment nobody updated. Treating time alone as evidence of absence
 * would put a DNA on the record of every patient a clinic was too busy to check in.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "Appointment";
const RECALL_TYPE = "AppointmentRequest";

/** Where an appointment can be. `booked` holds the slot; nothing else does. */
const STATES = Object.freeze(["booked", "arrived", "completed", "cancelled", "did-not-attend"]);
/** The states that still occupy the slot. */
const HOLDS_SLOT = Object.freeze(["booked", "arrived"]);

function Appointment(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    clinicianId: i.clinicianId || null,
    /* The slot instant, as an ISO string. An appointment is AT a time; a duration without a start
     * is not a slot and a start without a duration cannot be checked for collision. */
    startAt: i.startAt || null,
    minutes: Number.isFinite(i.minutes) ? i.minutes : null,
    reason: i.reason || null,
    state: STATES.includes(i.state) ? i.state : "booked",
    /* Set only when somebody deliberately books over an existing appointment. Real clinics overbook;
     * a system that refuses will be worked around, so this makes it visible instead. */
    overbooked: !!i.overbooked,
    overbookReason: i.overbookReason || null,
    bookedBy: i.bookedBy || null,
    bookedAt: i.bookedAt || null,
    changedBy: i.changedBy || null,
    changedAt: i.changedAt || null,
    changeReason: i.changeReason || null,
    /* The recall this appointment answers, when it answers one. That link is what lets a promised
     * follow-up be seen through to an actual booking. */
    requestId: i.requestId || null,
    source: { system: "wardsynq-native", sourceId: `appointment:${i.id}` },
  };
}

/** A follow-up somebody promised. Not an appointment: it has to be booked by a human. */
function AppointmentRequest(input) {
  const i = input || {};
  return {
    resourceType: RECALL_TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    clinicianId: i.clinicianId || null,
    reason: i.reason || null,
    /* When it should happen BY. A recall with no window is a wish; this is what makes "overdue"
     * computable rather than a judgement. */
    dueBy: i.dueBy || null,
    state: i.state === "booked" || i.state === "cancelled" ? i.state : "open",
    appointmentId: i.appointmentId || null,
    requestedBy: i.requestedBy || null,
    requestedAt: i.requestedAt || null,
    closedBy: i.closedBy || null,
    closedAt: i.closedAt || null,
    source: { system: "wardsynq-native", sourceId: `recall:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One appointment per (clinician, instant, patient) - a retried booking is the same one. */
function appointmentIdFor(clinicianId, startAt, patientId) {
  const c = slug(clinicianId), t = slug(startAt), p = slug(patientId);
  return c && t && p ? `wsq-appt-${c}-${t}-${p}` : null;
}
function recallIdFor(patientId, encounterId, reason) {
  const p = slug(patientId), e = slug(encounterId) || "none", r = slug(reason) || "review";
  return p ? `wsq-recall-${p}-${e}-${r}` : null;
}

/** PURE. Do two appointments overlap? Both need a start and a length to be comparable. */
function overlaps(a, b) {
  const as = Date.parse(a && a.startAt), bs = Date.parse(b && b.startAt);
  const am = Number(a && a.minutes), bm = Number(b && b.minutes);
  if (!Number.isFinite(as) || !Number.isFinite(bs) || !Number.isFinite(am) || !Number.isFinite(bm)) return false;
  return as < bs + bm * 60000 && bs < as + am * 60000;
}

/** PURE. Is this recall overdue? COMPUTED, never stored - a stored one goes stale by the hour. */
function recallStatus(recall, nowMs) {
  if (!recall) return { state: "none", overdueDays: 0 };
  if (recall.state === "booked") return { state: "booked", overdueDays: 0 };
  if (recall.state === "cancelled") return { state: "cancelled", overdueDays: 0 };
  const due = Date.parse(recall.dueBy || "");
  if (!Number.isFinite(due)) return { state: "open", overdueDays: 0 };
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const days = Math.floor((now - due) / 86400000);
  return days > 0 ? { state: "overdue", overdueDays: days } : { state: "open", overdueDays: 0 };
}

async function open(request, env, ctx, need) {
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

function apptSummary(a) {
  return {
    appointmentId: a.id, patientId: a.patientId, clinicianId: a.clinicianId,
    startAt: a.startAt, minutes: a.minutes, reason: a.reason || null, state: a.state,
    overbooked: !!a.overbooked, overbookReason: a.overbookReason || null,
    bookedBy: a.bookedBy, bookedAt: a.bookedAt,
    changedBy: a.changedBy || null, changedAt: a.changedAt || null, changeReason: a.changeReason || null,
    requestId: a.requestId || null, version: a.version,
  };
}

/**
 * Books an appointment.
 * ctx: { migration, patientId, clinicianId, startAt, minutes, reason?, requestId?, overbook?,
 *        overbookReason?, actorDeps, recordDeps }
 */
async function bookAppointment(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), clinicianId = str(ctx.clinicianId), startAt = str(ctx.startAt);
  const minutes = Number(ctx.minutes);
  if (!patientId || !clinicianId) return { ...base, ok: false, status: 422, error: "patient_and_clinician_required", written: 0 };
  if (!Number.isFinite(Date.parse(startAt))) return { ...base, ok: false, status: 422, error: "start_required", detail: "an appointment is at a time", written: 0 };
  // A start with no duration cannot be checked for collision, which would quietly disable the one
  // invariant this file exists to hold.
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 480) {
    return { ...base, ok: false, status: 422, error: "minutes_required", detail: "an appointment has a length, between 1 and 480 minutes", written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = appointmentIdFor(clinicianId, startAt, patientId);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let all;
  try { all = await svc.list(TYPE, 500); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  const candidate = { startAt, minutes };
  /* TWO PATIENTS CANNOT HOLD ONE SLOT. Checked against every appointment this clinician still holds,
   * and refused with the clash named so the desk can offer another time rather than being told "no". */
  const clash = (all || []).find((a) => a && a.id !== id && a.clinicianId === clinicianId
    && HOLDS_SLOT.includes(a.state) && overlaps(a, candidate));
  if (clash && !ctx.overbook) {
    return {
      ...base, ok: false, status: 409, error: "slot_taken",
      detail: `${clinicianId} already has an appointment overlapping ${startAt}`,
      clashesWith: { appointmentId: clash.id, patientId: clash.patientId, startAt: clash.startAt, minutes: clash.minutes },
      written: 0,
    };
  }
  const overbookReason = str(ctx.overbookReason);
  // Overbooking is allowed and must SAY it is overbooking. Without a reason it is indistinguishable
  // from the double-book this file refuses.
  if (clash && ctx.overbook && !overbookReason) {
    return { ...base, ok: false, status: 422, error: "overbook_reason_required", detail: "say why this slot is being double-booked", written: 0 };
  }

  let current;
  try { current = await svc.get(TYPE, id); }
  catch { current = null; }
  if (current && HOLDS_SLOT.includes(current.state)) {
    return { ...base, ok: true, written: 0, skipped: "already_booked", ...apptSummary(current) };
  }

  const appt = Appointment({
    id, patientId, clinicianId, startAt, minutes,
    reason: str(ctx.reason) || null, state: "booked",
    overbooked: !!clash, overbookReason: clash ? overbookReason : null,
    bookedBy: resolved.actor.id, bookedAt: new Date().toISOString(),
    requestId: str(ctx.requestId) || null,
  });
  try {
    const out = await svc.put(appt, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    // A recall this booking answers is closed by the booking, which is the whole point of the link.
    let recall = null;
    if (appt.requestId) {
      try {
        const r = await svc.get(RECALL_TYPE, appt.requestId);
        if (r && r.state === "open") {
          await svc.put(AppointmentRequest({ ...r, state: "booked", appointmentId: id, closedBy: resolved.actor.id, closedAt: appt.bookedAt }), { expectedVersion: r.version });
          recall = { requestId: r.id, state: "booked" };
        }
      } catch { /* the appointment stands whatever happens to the recall link */ }
    }
    return { ...base, ok: true, written: 1, ...apptSummary({ ...appt, version: out.record.version }), ...(recall ? { recall } : {}), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { appointmentId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Moves an appointment to another state. ctx: { migration, appointmentId, state, reason?, ... }
 */
async function setAppointmentState(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const appointmentId = str(ctx.appointmentId);
  const state = str(ctx.state);
  if (!appointmentId) return { ...base, ok: false, status: 422, error: "appointment_required", written: 0 };
  if (!STATES.includes(state) || state === "booked") {
    return { ...base, ok: false, status: 400, error: "unknown_state", detail: `state must be one of ${STATES.filter((s) => s !== "booked").join(", ")}`, written: 0 };
  }
  const reason = str(ctx.reason);
  // Cancelling and recording a DNA both need a reason: they are the two that a patient may later ask
  // about, and "cancelled" with nothing beside it answers nothing.
  if ((state === "cancelled" || state === "did-not-attend") && !reason) {
    return { ...base, ok: false, status: 422, error: "reason_required", detail: `say why this appointment was ${state}`, written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, appointmentId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "appointment_not_found", appointmentId, written: 0 };
  if (current.state === state) return { ...base, ok: true, written: 0, skipped: "unchanged", ...apptSummary(current) };
  // A finished appointment is not reopened: a completed visit that became "booked" again would put a
  // slot back in a diary for a consultation that already happened.
  if (["completed", "cancelled", "did-not-attend"].includes(current.state)) {
    return { ...base, ok: false, status: 409, error: "already_closed", detail: `this appointment is ${current.state}; book a new one`, appointmentId, written: 0 };
  }

  const next = Appointment({
    ...current, state,
    changedBy: resolved.actor.id, changedAt: new Date().toISOString(), changeReason: reason || null,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    /* The slot frees immediately on cancellation, and the record still shows it was booked and by
     * whom: "they cancelled" and "they never had one" are different facts. */
    return { ...base, ok: true, written: 1, ...apptSummary({ ...next, version: out.record.version }), slotFreed: !HOLDS_SLOT.includes(state), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { appointmentId, written: 0, actor: resolved.actor.id }) };
  }
}

/** Records a promised follow-up. ctx: { migration, patientId, encounterId?, reason, dueBy?, ... } */
async function requestFollowUp(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), reason = str(ctx.reason);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say what the follow-up is for", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = recallIdFor(patientId, str(ctx.encounterId), reason);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(RECALL_TYPE, id); }
  catch { current = null; }
  if (current && current.state !== "open") return { ...base, ok: true, written: 0, skipped: `already_${current.state}`, requestId: id, state: current.state };

  const rec = AppointmentRequest({
    id, patientId, encounterId: str(ctx.encounterId) || null, clinicianId: str(ctx.clinicianId) || null,
    reason, dueBy: str(ctx.dueBy) || null, state: "open",
    requestedBy: (current && current.requestedBy) || resolved.actor.id,
    requestedAt: (current && current.requestedAt) || new Date().toISOString(),
  });
  try {
    const out = await svc.put(rec, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, requestId: id, patientId, reason, dueBy: rec.dueBy, state: "open",
      /* Said on the response, because it is the property that makes a recall worth anything: this is
       * NOT an appointment and nothing has been booked. */
      note: "This is a follow-up REQUEST. Nothing is booked until somebody books it, and it stays visibly outstanding until then.",
      version: out.record.version, actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { requestId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The diary, and what is still unbooked.
 * ctx: { migration, patientId?, clinicianId?, from?, to?, actorDeps, recordDeps }
 */
async function listSchedule(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", appointments: [], recalls: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, appointments: [], recalls: [] };

  const patientId = str(ctx.patientId);
  let appts, recalls;
  try {
    [appts, recalls] = await Promise.all([
      patientId ? svc.byPatient(TYPE, patientId) : svc.list(TYPE, 500),
      (patientId ? svc.byPatient(RECALL_TYPE, patientId) : svc.list(RECALL_TYPE, 500)).catch(() => []),
    ]);
  } catch (e) {
    /* A SCOPE REFUSAL IS A 403, NOT A SERVER ERROR. A role can hold queue.view (which opens this
     * route) and have no read scope on Appointment - the laboratory is exactly that - and answering
     * 502 tells the caller the server is broken when it has simply said no. Same fix as listWard. */
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), detail: str(e.message), appointments: [], recalls: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), appointments: [], recalls: [] };
  }

  const from = Date.parse(str(ctx.from)), to = Date.parse(str(ctx.to));
  const clinicianId = str(ctx.clinicianId);
  const nowMs = Date.now();
  const appointments = (appts || []).filter(Boolean)
    .filter((a) => !clinicianId || a.clinicianId === clinicianId)
    .filter((a) => {
      const t = Date.parse(a.startAt || "");
      if (!Number.isFinite(t)) return true;
      return (!Number.isFinite(from) || t >= from) && (!Number.isFinite(to) || t < to);
    })
    .map(apptSummary)
    .sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")));

  const open_ = (recalls || []).filter((r) => r && r.state === "open").map((r) => ({
    requestId: r.id, patientId: r.patientId, reason: r.reason, dueBy: r.dueBy || null,
    clinicianId: r.clinicianId || null, requestedBy: r.requestedBy, requestedAt: r.requestedAt,
    ...recallStatus(r, nowMs),
  })).sort((a, b) => b.overdueDays - a.overdueDays);

  return {
    ...base, ok: true, appointments, recalls: open_,
    /* The number a clinic acts on: follow-ups that were promised and never booked. That promise is
     * made in a discharge summary and then, without this, goes nowhere. */
    unbookedRecalls: open_.length,
    overdueRecalls: open_.filter((r) => r.state === "overdue").length,
  };
}

export {
  TYPE, RECALL_TYPE, STATES, HOLDS_SLOT, Appointment, AppointmentRequest,
  appointmentIdFor, recallIdFor, overlaps, recallStatus,
  bookAppointment, setAppointmentState, requestFollowUp, listSchedule,
};
