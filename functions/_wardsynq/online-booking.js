/* functions/_wardsynq/online-booking.js - a patient books, moves or cancels an appointment in the portal (gap wave 2026-09-16).
 *
 * THIS CHANGES A STANDING RULE ON PURPOSE. portal-requests.js says "A PATIENT CANNOT BOOK": a patient's request
 * reserves nothing. That stays true for the free-text request. What is added is narrower: a patient may take a slot
 * the hospital itself PUBLISHED for online booking (wardsynq.onlineBooking.sessions: a clinician, a department, the
 * weekdays, a start and end time and a slot length). A slot nobody published cannot be booked from the portal, so
 * the promise is the hospital's own and was offered before the patient took it. Decisions.md records the change.
 *
 * NO DOUBLE BOOKING. The same checks scheduling.js makes (a blackout refuses, an overlapping booked or arrived
 * appointment of that clinician refuses, overlaps() is reused) are made against the diary as read now, and then the
 * slot is CLAIMED: a `_wardsynq_slot_hold` record per clinician and instant, appended at the next version. Two
 * patients racing for one slot both read it free, and only one append of that version can land; the other is told
 * the slot was just taken and nothing of theirs is written. The appointment itself is an ordinary Appointment,
 * written through RecordService by the patient's own actor (id patient:<id>, or the proxy's reader id), so the
 * desk's diary, reminders and the portal's appointment list all see it. A staff booking made in the same instant
 * as a patient's does not take the hold; that residual race is the one scheduling.js already has.
 *
 * HOSPITAL RULES. How many days ahead (maxDaysAhead, 14), the notice needed to book (minHoursBefore, 2), to cancel
 * (cancelHoursBefore, 4) and to move (rescheduleHoursBefore, 4), and how many upcoming online bookings one patient
 * may hold (maxUpcoming, 2). A patient changes only appointments they booked online; one the desk booked is
 * changed by ringing the desk.
 *
 * THE PATIENT ID COMES FROM THE SESSION, never from the request (functions/api/portal/[[path]].js).
 */

import { makeActor, KIND, TIER, GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { Appointment, appointmentIdFor, overlaps, HOLDS_SLOT, TYPE as APPT } from "./scheduling.js";
import { blackedOutBy } from "./blackout.js";

const HOLD = "_wardsynq_slot_hold";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const refuse = (status, error, detail) => ({ ok: false, status, error, detail });
const hhmm = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(str(v));
const toMin = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));

/** PURE. The hospital's booking settings, with defaults and only well-formed sessions. */
function bookingSettings(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const int = (v, d, lo, hi) => (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi && v !== "" && v !== null ? Number(v) : d);
  const sessions = (Array.isArray(c.sessions) ? c.sessions : []).slice(0, 200).map((s, i) => ({
    id: slug(s && s.id) || `s${i + 1}`, clinicianId: str(s && s.clinicianId), clinicianName: str(s && s.clinicianName).slice(0, 80),
    department: str(s && s.department).slice(0, 80), weekdays: [...new Set((Array.isArray(s && s.weekdays) ? s.weekdays : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))],
    start: str(s && s.start), end: str(s && s.end), slotMinutes: int(s && s.slotMinutes, 15, 5, 240),
  })).filter((s) => s.clinicianId && s.department && s.weekdays.length && hhmm(s.start) && hhmm(s.end) && toMin(s.end) > toMin(s.start));
  return {
    enabled: c.enabled === true, sessions,
    maxDaysAhead: int(c.maxDaysAhead, 14, 1, 90), minHoursBefore: int(c.minHoursBefore, 2, 0, 168),
    cancelHoursBefore: int(c.cancelHoursBefore, 4, 0, 168), rescheduleHoursBefore: int(c.rescheduleHoursBefore, 4, 0, 168), maxUpcoming: int(c.maxUpcoming, 2, 1, 10),
  };
}

/** PURE. Every published slot from now (plus the notice) to maxDaysAhead, in UTC ISO. */
function publishedSlots(s, nowMs, off) {
  const out = [];
  const earliest = nowMs + s.minHoursBefore * 3600000;
  const localToday = Date.parse(new Date(nowMs + off * 60000).toISOString().slice(0, 10) + "T00:00:00Z");
  for (let d = 0; d <= s.maxDaysAhead; d++) {
    const dayUtc = localToday + d * 86400000, weekday = new Date(dayUtc).getUTCDay();
    for (const ses of s.sessions) {
      if (!ses.weekdays.includes(weekday)) continue;
      for (let m = toMin(ses.start); m + ses.slotMinutes <= toMin(ses.end); m += ses.slotMinutes) {
        const at = dayUtc + m * 60000 - off * 60000;
        if (at < earliest) continue;
        out.push({ sessionId: ses.id, clinicianId: ses.clinicianId, clinicianName: ses.clinicianName || null, department: ses.department, startAt: new Date(at).toISOString(), minutes: ses.slotMinutes });
      }
    }
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** PURE. Published slots nobody holds and no blackout covers. */
function freeSlots(slots, appointments, blackouts) {
  return slots.filter((x) => !blackedOutBy(blackouts, x.clinicianId, x)
    && !(appointments || []).some((a) => a && a.clinicianId === x.clinicianId && HOLDS_SLOT.includes(a.state) && overlaps(a, x)));
}

function portalActor(session) {
  return makeActor({ id: str(session.readerId) || `patient:${str(session.patientId)}`, kind: KIND.HUMAN, tier: TIER.DRAFT,
    scope: { read: [APPT, "Blackout"], write: [APPT] } });
}
const svcFor = (ctx, session) => new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: { id: ctx.migration.tenantId },
  actor: portalActor(session), role: "patient-portal", roleSource: "wardsynq-patient-access" });
const offsetOf = (cfg) => (cfg && cfg.utcOffsetMinutes != null ? Number(cfg.utcOffsetMinutes) || 0 : 330);
const holdId = (clinicianId, startAt) => `hold-${slug(clinicianId)}-${slug(startAt)}`;

async function diary(ctx, session) {
  const svc = svcFor(ctx, session);
  /* R4-2: every appointment/booking and blackout (service.listAll, paged). The old reads were the OLDEST 500, so a clash
   * with a newer booking or leave was not seen. Past 50,000 the read throws and nothing is booked (502 with the reason).
   * ponytail: a by-clinician or by-resource index is the upgrade; audit O20 for the paging cost. */
  const [appointments, blackouts] = await Promise.all([svc.listAll(APPT, { max: 50000, throwOnTruncate: true }).then((g) => g.rows), svc.listAll("Blackout", { max: 50000, throwOnTruncate: true }).then((g) => g.rows, (e) => { if (e && e.name === "ListCeilingError") throw e; return []; })]);
  return { svc, appointments: (appointments || []).filter(Boolean), blackouts: blackouts || [] };
}

function mineOf(appointments, session, s, nowMs) {
  return appointments.filter((a) => a.patientId === str(session.patientId) && HOLDS_SLOT.includes(a.state) && Date.parse(a.startAt) > nowMs)
    .sort((a, b) => a.startAt.localeCompare(b.startAt)).map((a) => {
      const hoursLeft = (Date.parse(a.startAt) - nowMs) / 3600000, online = a.bookedVia === "portal";
      return { appointmentId: a.id, clinicianId: a.clinicianId, startAt: a.startAt, minutes: a.minutes, state: a.state, online,
        canCancel: online && a.state === "booked" && hoursLeft >= s.cancelHoursBefore, canReschedule: online && a.state === "booked" && hoursLeft >= s.rescheduleHoursBefore };
    });
}

/** What the portal shows. ctx: { migration, recordDeps, wsqCfg }, session from sessionPatient(). */
async function bookingOptions(ctx, session) {
  const s = bookingSettings(ctx.wsqCfg && ctx.wsqCfg.onlineBooking);
  if (!s.enabled || !s.sessions.length) return { ok: true, enabled: false };
  const nowMs = Date.now();
  let d;
  try { d = await diary(ctx, session); } catch { return refuse(502, "record_read_failed", "Free appointments could not be loaded. Try again later."); }
  const free = freeSlots(publishedSlots(s, nowMs, offsetOf(ctx.wsqCfg)), d.appointments, d.blackouts);
  return {
    ok: true, enabled: true,
    rules: { maxDaysAhead: s.maxDaysAhead, minHoursBefore: s.minHoursBefore, cancelHoursBefore: s.cancelHoursBefore, rescheduleHoursBefore: s.rescheduleHoursBefore, maxUpcoming: s.maxUpcoming },
    departments: [...new Set(s.sessions.map((x) => x.department))].sort(),
    clinicians: [...new Map(s.sessions.map((x) => [x.clinicianId, { clinicianId: x.clinicianId, name: x.clinicianName || null, department: x.department }])).values()],
    slots: free.slice(0, 1500), mine: mineOf(d.appointments, session, s, nowMs),
  };
}

/** Claim a slot's hold: the one append that decides a race. -> { ok, hold } or a refusal. */
async function claim(ctx, slot, appointmentId, by) {
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, id = holdId(slot.clinicianId, slot.startAt), at = new Date().toISOString();
  let cur;
  try { cur = await repo.latest(tenantId, HOLD, id); } catch { return refuse(502, "record_read_failed", "The appointment could not be booked. Try again."); }
  if (cur && cur.state === "held") return refuse(409, "slot_taken", "That time has just been taken. Choose another.");
  const hold = { resourceType: HOLD, id, version: cur ? cur.version + 1 : 1, clinicianId: slot.clinicianId, startAt: slot.startAt, state: "held", appointmentId, writtenBy: { id: by, kind: "human", at } };
  try { await repo.append(tenantId, [hold], { audit: { ts: at, actor: by, connectorId: "wardsynq-online-booking", action: "booking.slot_held", outcome: "ok", scope: { holdId: id } } }); }
  catch (e) { return e instanceof VersionConflictError ? refuse(409, "slot_taken", "That time has just been taken. Choose another.") : refuse(502, "record_write_failed", "The appointment could not be booked. Try again."); }
  return { ok: true, hold };
}
async function release(ctx, clinicianId, startAt, by) {
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, id = holdId(clinicianId, startAt), at = new Date().toISOString();
  const cur = await repo.latest(tenantId, HOLD, id);
  if (!cur || cur.state !== "held") return;
  await repo.append(tenantId, [{ ...cur, version: cur.version + 1, state: "released", writtenBy: { id: by, kind: "human", at } }],
    { audit: { ts: at, actor: by, connectorId: "wardsynq-online-booking", action: "booking.slot_released", outcome: "ok", scope: { holdId: id } } });
}

/** Book one published free slot. ctx: { migration, recordDeps, wsqCfg, clinicianId, startAt, reason? } */
async function bookOnline(ctx, session) {
  const s = bookingSettings(ctx.wsqCfg && ctx.wsqCfg.onlineBooking);
  if (!s.enabled) return refuse(404, "online_booking_off", "This hospital does not take bookings online.");
  const nowMs = Date.now(), by = str(session.readerId) || `patient:${str(session.patientId)}`;
  const wantAt = Date.parse(str(ctx.startAt));
  const slot = Number.isFinite(wantAt) ? publishedSlots(s, nowMs, offsetOf(ctx.wsqCfg)).find((x) => x.clinicianId === str(ctx.clinicianId) && Date.parse(x.startAt) === wantAt) : null;
  if (!slot) return refuse(422, "not_a_published_slot", "That time is not offered for online booking.");
  let d;
  try { d = await diary(ctx, session); } catch { return refuse(502, "record_read_failed", "The appointment could not be booked. Try again."); }
  const mine = mineOf(d.appointments, session, s, nowMs);
  if (!ctx.replacing && mine.filter((a) => a.online).length >= s.maxUpcoming) return refuse(409, "too_many_bookings", `You already have ${s.maxUpcoming} upcoming appointments booked online. Cancel one first, or contact the hospital.`);
  if (!freeSlots([slot], d.appointments, d.blackouts).length) return refuse(409, "slot_taken", "That time has just been taken. Choose another.");
  const id = appointmentIdFor(slot.clinicianId, slot.startAt, str(session.patientId));
  const c = await claim(ctx, slot, id, by);
  if (!c.ok) return c;
  let current = null;
  try { current = await d.svc.get(APPT, id); } catch { current = null; }
  const at = new Date().toISOString();
  const appt = { ...Appointment({ id, patientId: str(session.patientId), clinicianId: slot.clinicianId, startAt: slot.startAt, minutes: slot.minutes,
    reason: str(ctx.reason).slice(0, 300) || null, state: "booked", bookedBy: by, bookedAt: at }), bookedVia: "portal", department: slot.department };
  try { await d.svc.put(appt, { expectedVersion: current ? current.version : undefined }); }
  catch (e) {
    try { await release(ctx, slot.clinicianId, slot.startAt, by); } catch { /* the hold stays; the desk sees a held slot with no appointment */ }
    if (e instanceof GovernanceError) return refuse(403, "governance", "The appointment could not be booked.");
    return refuse(e instanceof VersionConflictError ? 409 : 502, "record_write_failed", "The appointment could not be booked. Nothing was booked; try again.");
  }
  return { ok: true, appointment: { appointmentId: id, clinicianId: slot.clinicianId, clinicianName: slot.clinicianName, department: slot.department, startAt: slot.startAt, minutes: slot.minutes } };
}

/** Cancel one of the patient's own online bookings, within the hospital's notice. ctx: { ..., appointmentId, reason? } */
async function cancelOnline(ctx, session) {
  const s = bookingSettings(ctx.wsqCfg && ctx.wsqCfg.onlineBooking);
  if (!s.enabled) return refuse(404, "online_booking_off", "This hospital does not take bookings online.");
  const by = str(session.readerId) || `patient:${str(session.patientId)}`;
  let svc, cur;
  try { svc = svcFor(ctx, session); cur = await svc.get(APPT, str(ctx.appointmentId)); } catch { return refuse(502, "record_read_failed", "The appointment could not be read."); }
  if (!cur || cur.patientId !== str(session.patientId)) return refuse(404, "appointment_not_found", "No such appointment.");
  if (cur.bookedVia !== "portal") return refuse(409, "booked_by_hospital", "This appointment was booked by the hospital. Contact the hospital to change it.");
  if (cur.state !== "booked") return refuse(409, "not_booked", "This appointment cannot be cancelled now.");
  const hoursLeft = (Date.parse(cur.startAt) - Date.now()) / 3600000;
  const limit = ctx.forReschedule ? s.rescheduleHoursBefore : s.cancelHoursBefore;
  if (hoursLeft < limit) return refuse(409, "too_late", `Online changes close ${limit} hours before the appointment. Contact the hospital.`);
  const at = new Date().toISOString();
  const next = { ...Appointment({ ...cur, state: "cancelled", changedBy: by, changedAt: at, changeReason: str(ctx.reason).slice(0, 300) || (ctx.forReschedule ? "Moved by the patient online" : "Cancelled by the patient online") }), bookedVia: "portal", department: cur.department || null };
  try { await svc.put(next, { expectedVersion: cur.version }); }
  catch (e) { return refuse(e instanceof VersionConflictError ? 409 : 502, "record_write_failed", "The appointment could not be cancelled. It is still booked."); }
  try { await release(ctx, cur.clinicianId, cur.startAt, by); } catch { /* the slot's hold stays held: the time is not offered again until released; the appointment is cancelled */ }
  return { ok: true, cancelled: cur.id };
}

/** Move: book the new slot first, then cancel the old. If the second step fails, both are reported, never a success. */
async function rescheduleOnline(ctx, session) {
  const s = bookingSettings(ctx.wsqCfg && ctx.wsqCfg.onlineBooking);
  let cur;
  try { cur = await svcFor(ctx, session).get(APPT, str(ctx.appointmentId)); } catch { return refuse(502, "record_read_failed", "The appointment could not be read."); }
  if (!cur || cur.patientId !== str(session.patientId)) return refuse(404, "appointment_not_found", "No such appointment.");
  if (cur.bookedVia !== "portal") return refuse(409, "booked_by_hospital", "This appointment was booked by the hospital. Contact the hospital to change it.");
  if (cur.state !== "booked" || (Date.parse(cur.startAt) - Date.now()) / 3600000 < s.rescheduleHoursBefore) return refuse(409, "too_late", `Online changes close ${s.rescheduleHoursBefore} hours before the appointment. Contact the hospital.`);
  const booked = await bookOnline({ ...ctx, replacing: true }, session);
  if (!booked.ok) return booked;
  const cancelled = await cancelOnline({ ...ctx, forReschedule: true }, session);
  if (!cancelled.ok) return { ok: false, status: 502, error: "reschedule_incomplete", partial: true, booked: booked.appointment, stillBooked: cur.id,
    detail: "The new time is booked, but the old appointment could not be cancelled, so you now hold both. Cancel the old one or contact the hospital." };
  return { ok: true, appointment: booked.appointment, cancelled: cur.id };
}

export { HOLD as HOLD_TYPE, bookingSettings, publishedSlots, freeSlots, bookingOptions, bookOnline, cancelOnline, rescheduleOnline };
