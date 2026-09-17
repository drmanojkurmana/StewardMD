/* functions/_wardsynq/theatre.js - theatre sessions, and how the theatre's time was used (P3 theatre-opd-access, 2026-09-17).
 *
 * resource-booking.js books a theatre for a length of time. migrate-surgery.js runs the case. Neither said who the
 * theatre's afternoon belonged to, or whether the booked time was the time actually used. This file adds the session
 * (a block of theatre time given to a unit or a surgeon) and the report that sets booked time and used time side by side.
 *
 * A SESSION IS HELD UNTIL IT IS RELEASED. While held, only its owner's bookings may use its minutes (resource-booking.js
 * asks heldSessionFor). It is released either by a person (with a reason), or by the hospital's release rule: at
 * `theatre.releaseHours` before the session starts, the unbooked minutes are free to anyone. With no rule configured
 * nothing is released automatically, and the screen says so. Release is COMPUTED from the rule and the clock, never
 * stored, the same way scheduling.js computes an overdue recall: a stored "released" goes stale the hour it is written.
 *
 * EVERY NUMBER IS ARITHMETIC ON RECORDED TIMES, AND ITS INPUTS ARE RETURNED BESIDE IT. Booked minutes are the
 * ResourceBooking minutes that fall inside the session. Used minutes are the patient-in-room to patient-out-of-room
 * times a person recorded on the case. A case missing either time is listed as missing and contributes nothing: a
 * missing time is never read as zero and never estimated from the booking. The same holds for the first case's start
 * and the turnover between cases.
 *
 * Thresholds are the hospital's: the release hours, the minutes of grace a first case may start late and still be on
 * time, and the reschedule reason codes. None has a default here.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { resolveResources } from "./resource-booking.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

const TYPE = "TheatreSession";
const OWNER_KINDS = Object.freeze(["unit", "surgeon"]);
/* NABH PSQ 3c indicator 19: "cancellation and postponement (beyond 4 hours)", measured from "the first booked time". */
const POSTPONE_COUNTS_AFTER_MS = 4 * HOUR;

/** PURE. The hospital's theatre settings. Absent or malformed means not configured, never a default. */
function theatreSettings(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const whole = (v, lo, hi) => (v !== "" && v !== null && v !== undefined && Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  const reasons = (Array.isArray(c.rescheduleReasons) ? c.rescheduleReasons : []).slice(0, 50).map((x) => {
    const code = slug(x && typeof x === "object" ? x.code : x), label = str(x && typeof x === "object" ? x.label : x).slice(0, 120);
    return code ? { code, label: label || code } : null;
  }).filter(Boolean);
  return { releaseHours: whole(c.releaseHours, 1, 720), firstCaseGraceMinutes: whole(c.firstCaseGraceMinutes, 0, 240), rescheduleReasons: reasons };
}

function TheatreSession(input) {
  const i = input || {};
  return {
    resourceType: TYPE, id: i.id,
    theatreId: i.theatreId, theatreName: i.theatreName || null,
    startAt: i.startAt || null, minutes: Number.isFinite(i.minutes) ? i.minutes : null,
    owner: i.owner || null,
    releasedAt: i.releasedAt || null, releasedBy: i.releasedBy || null, releaseReason: i.releaseReason || null,
    createdBy: i.createdBy || null, createdAt: i.createdAt || null,
    source: { system: "wardsynq-native", sourceId: `theatre-session:${i.id}` },
  };
}
function sessionIdFor(theatreId, startAt) { const t = slug(theatreId), s = slug(startAt); return t && s ? `wsq-ots-${t}-${s}` : null; }

/** PURE. Held or released, when and how. The rule releases at start minus releaseHours; a person may release earlier. */
function sessionStatus(session, settings, nowMs) {
  const start = ms(session && session.startAt);
  const manual = ms(session && session.releasedAt);
  const ruleAt = start != null && settings && settings.releaseHours != null ? start - settings.releaseHours * HOUR : null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const byRule = ruleAt != null && now >= ruleAt ? ruleAt : null;
  if (manual != null && (byRule == null || manual < byRule)) return { state: "released", releasedAt: new Date(manual).toISOString(), by: "person" };
  if (byRule != null) return { state: "released", releasedAt: new Date(byRule).toISOString(), by: "rule" };
  return { state: "held", releasesAt: ruleAt == null ? null : new Date(ruleAt).toISOString() };
}

/** PURE. Minutes two intervals share. */
function overlapMinutes(aStart, aMinutes, bStart, bMinutes) {
  const a = ms(aStart), b = ms(bStart);
  if (a == null || b == null || !Number.isFinite(Number(aMinutes)) || !Number.isFinite(Number(bMinutes))) return 0;
  return Math.max(0, Math.min(a + Number(aMinutes) * MIN, b + Number(bMinutes) * MIN) - Math.max(a, b)) / MIN;
}

/** PURE. The held session of another owner that this theatre booking would take minutes from, or null. */
function heldSessionFor(sessions, booking, ownerId, settings, nowMs) {
  return (sessions || []).find((s) => s && str(s.theatreId) === str(booking.resourceId)
    && overlapMinutes(s.startAt, s.minutes, booking.startAt, booking.minutes) > 0
    && sessionStatus(s, settings, nowMs).state === "held"
    && str(s.owner && s.owner.id) !== str(ownerId)) || null;
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

/** ctx: { migration, resources, theatre, theatreId, startAt, minutes, ownerKind, ownerId, ownerName, actorDeps, recordDeps } */
async function createTheatreSession(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const theatreId = str(ctx.theatreId), startAt = str(ctx.startAt), minutes = Number(ctx.minutes);
  const ownerKind = str(ctx.ownerKind), ownerId = str(ctx.ownerId), ownerName = str(ctx.ownerName).slice(0, 120);
  if (!theatreId) return { ...base, ok: false, status: 422, error: "theatre_required", written: 0 };
  if (ms(startAt) == null) return { ...base, ok: false, status: 422, error: "bad_start", detail: "a session starts at a date and time", written: 0 };
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) return { ...base, ok: false, status: 422, error: "minutes_required", detail: "a session is 15 to 1440 minutes long", written: 0 };
  if (!OWNER_KINDS.includes(ownerKind) || !ownerId) return { ...base, ok: false, status: 422, error: "owner_required", detail: "a session belongs to a unit or a surgeon", written: 0 };
  const theatre = resolveResources(ctx.resources).resources.find((r) => r.id === theatreId && r.kind === "theatre");
  if (!theatre) return { ...base, ok: false, status: 404, error: "theatre_not_found", detail: `this hospital has no theatre "${theatreId}" in its resources`, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let existing;
  try { existing = (await svc.list(TYPE, 1000)) || []; }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", written: 0 }; }
  const id = sessionIdFor(theatreId, startAt);
  const current = existing.find((s) => s && s.id === id);
  if (current) return { ...base, ok: true, written: 0, skipped: "already_exists", sessionId: id, version: current.version };
  /* Two sessions cannot share a theatre's minutes: the time would belong to two owners. */
  const clash = existing.find((s) => s && str(s.theatreId) === theatreId && overlapMinutes(s.startAt, s.minutes, startAt, minutes) > 0);
  if (clash) return { ...base, ok: false, status: 409, error: "session_overlaps", detail: `${theatre.name} already has a session from ${clash.startAt} for ${clash.minutes} minutes.`, clashesWith: clash.id, written: 0 };
  const rec = TheatreSession({ id, theatreId, theatreName: theatre.name, startAt: new Date(ms(startAt)).toISOString(), minutes, owner: { kind: ownerKind, id: ownerId, name: ownerName || ownerId }, createdBy: resolved.actor.id, createdAt: new Date().toISOString() });
  try {
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, sessionId: id, session: { ...rec, version: out.record.version }, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { sessionId: id, written: 0 }) }; }
}

/** ctx: { migration, sessionId, reason, expectedVersion?, actorDeps, recordDeps } */
async function releaseTheatreSession(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const sessionId = str(ctx.sessionId), reason = str(ctx.reason).slice(0, 500);
  if (!sessionId) return { ...base, ok: false, status: 422, error: "session_required", written: 0 };
  if (reason.length < 3) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the session is released", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(TYPE, sessionId); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "session_not_found", written: 0 };
  if (current.releasedAt) return { ...base, ok: true, written: 0, skipped: "already_released", sessionId, version: current.version };
  const next = TheatreSession({ ...current, releasedAt: new Date().toISOString(), releasedBy: resolved.actor.id, releaseReason: reason });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, sessionId, releasedAt: next.releasedAt, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { sessionId, written: 0 }) }; }
}

const theatreOfCase = (c, theatres) => {
  const t = str(c && c.theatreId).toLowerCase();
  return t ? theatres.find((x) => x.id.toLowerCase() === t || str(x.name).toLowerCase() === t) || null : null;
};
const localDay = (t, offMs) => new Date(t + offMs).toISOString().slice(0, 10);

/**
 * PURE. The day's theatre use. input: { theatres, sessions, bookings, cases, settings, fromMs, toMs, offsetMs, nowMs,
 * unreadable: {Type: reason} }. Every figure carries the minutes it was divided from; every case missing a time is named.
 */
function computeTheatreUtilisation(input) {
  const i = input || {}, settings = i.settings || theatreSettings(null), bad = i.unreadable || {};
  const inWin = (t) => { const v = ms(t); return v != null && v >= i.fromMs && v <= i.toMs; };
  const theatres = (i.theatres || []).filter((t) => t.kind === "theatre");
  const liveBookings = (i.bookings || []).filter((b) => b && (b.state === "booked" || b.state === "completed"));
  const cases = (i.cases || []).filter((c) => c && c.stage !== "abandoned");
  const out = theatres.map((t) => {
    const sessions = (i.sessions || []).filter((s) => s && str(s.theatreId) === t.id && inWin(s.startAt))
      .sort((a, b) => ms(a.startAt) - ms(b.startAt));
    const bookings = liveBookings.filter((b) => str(b.resourceId) === t.id);
    const tCases = cases.filter((c) => theatreOfCase(c, theatres) === t && inWin(c.scheduledAt || (c.theatreTimes && c.theatreTimes.inRoomAt)));
    const missing = [];
    const used = [];
    for (const c of tCases) {
      const inAt = ms(c.theatreTimes && c.theatreTimes.inRoomAt), outAt = ms(c.theatreTimes && c.theatreTimes.outRoomAt);
      if (inAt == null || outAt == null) { missing.push({ caseId: c.id, procedure: c.procedure || null, scheduledAt: c.scheduledAt || null, missing: [inAt == null && "inRoomAt", outAt == null && "outRoomAt"].filter(Boolean) }); continue; }
      used.push({ caseId: c.id, procedure: c.procedure || null, scheduledAt: c.scheduledAt || null, inRoomAt: new Date(inAt).toISOString(), outRoomAt: new Date(outAt).toISOString(), minutes: (outAt - inAt) / MIN });
    }
    const sessionRows = sessions.map((s) => {
      const st = sessionStatus(s, settings, i.nowMs);
      const inSession = bookings.map((b) => ({ b, m: overlapMinutes(s.startAt, s.minutes, b.startAt, b.minutes) })).filter((x) => x.m > 0);
      const bookedMinutes = inSession.reduce((a, x) => a + x.m, 0);
      const ownerBookedMinutes = inSession.filter((x) => str(x.b.sessionOwnerId) === str(s.owner && s.owner.id)).reduce((a, x) => a + x.m, 0);
      const usedMinutes = used.reduce((a, u) => a + overlapMinutes(s.startAt, s.minutes, u.inRoomAt, u.minutes), 0);
      return {
        sessionId: s.id, startAt: s.startAt, minutes: s.minutes, owner: s.owner, status: st,
        releaseReason: s.releaseReason || null, releasedBy: s.releasedBy || null,
        bookedMinutes: r1(bookedMinutes), ownerBookedMinutes: r1(ownerBookedMinutes),
        releasedMinutes: st.state === "released" ? r1(Math.max(0, s.minutes - ownerBookedMinutes)) : 0,
        usedMinutes: r1(usedMinutes),
        bookedUtilisation: s.minutes > 0 ? r1((bookedMinutes / s.minutes) * 100) : null,
        usedUtilisation: s.minutes > 0 ? r1((usedMinutes / s.minutes) * 100) : null,
      };
    });
    const sessionMinutes = sessions.reduce((a, s) => a + s.minutes, 0);
    const bookedInSessions = sessionRows.reduce((a, s) => a + s.bookedMinutes, 0);
    const usedInSessions = sessionRows.reduce((a, s) => a + s.usedMinutes, 0);

    /* First case of each local day: the earliest scheduled case that day. On time when it was in the room no later than
     * its scheduled start plus the hospital's grace minutes. */
    const byDay = new Map();
    for (const c of tCases.filter((x) => ms(x.scheduledAt) != null)) {
      const d = localDay(ms(c.scheduledAt), i.offsetMs || 0);
      if (!byDay.has(d) || ms(c.scheduledAt) < ms(byDay.get(d).scheduledAt)) byDay.set(d, c);
    }
    const firstCases = [...byDay.entries()].sort().map(([day, c]) => {
      const inAt = ms(c.theatreTimes && c.theatreTimes.inRoomAt);
      const lateMinutes = inAt == null ? null : r1((inAt - ms(c.scheduledAt)) / MIN);
      return { day, caseId: c.id, procedure: c.procedure || null, scheduledAt: c.scheduledAt, inRoomAt: inAt == null ? null : new Date(inAt).toISOString(), lateMinutes,
        onTime: inAt == null || settings.firstCaseGraceMinutes == null ? null : lateMinutes <= settings.firstCaseGraceMinutes,
        missing: inAt == null ? ["inRoomAt"] : [] };
    });

    /* Turnover: from one case out of the room to the next case in the room, same theatre, same local day. */
    const turnovers = [], turnoverMissing = [];
    const ordered = tCases.filter((c) => ms(c.scheduledAt) != null || ms(c.theatreTimes && c.theatreTimes.inRoomAt) != null)
      .sort((a, b) => (ms(a.theatreTimes && a.theatreTimes.inRoomAt) ?? ms(a.scheduledAt)) - (ms(b.theatreTimes && b.theatreTimes.inRoomAt) ?? ms(b.scheduledAt)));
    for (let k = 1; k < ordered.length; k++) {
      const prev = ordered[k - 1], next = ordered[k];
      const dp = localDay(ms(prev.theatreTimes && prev.theatreTimes.inRoomAt) ?? ms(prev.scheduledAt), i.offsetMs || 0);
      const dn = localDay(ms(next.theatreTimes && next.theatreTimes.inRoomAt) ?? ms(next.scheduledAt), i.offsetMs || 0);
      if (dp !== dn) continue;
      const outAt = ms(prev.theatreTimes && prev.theatreTimes.outRoomAt), inAt = ms(next.theatreTimes && next.theatreTimes.inRoomAt);
      if (outAt == null || inAt == null) { turnoverMissing.push({ fromCaseId: prev.id, toCaseId: next.id, missing: [outAt == null && "outRoomAt", inAt == null && "inRoomAt"].filter(Boolean) }); continue; }
      turnovers.push({ fromCaseId: prev.id, toCaseId: next.id, outRoomAt: new Date(outAt).toISOString(), inRoomAt: new Date(inAt).toISOString(), minutes: r1((inAt - outAt) / MIN) });
    }

    return {
      theatreId: t.id, name: t.name, sessions: sessionRows,
      sessionMinutes, bookedMinutesInSessions: r1(bookedInSessions), usedMinutesInSessions: r1(usedInSessions),
      bookedUtilisation: sessionMinutes > 0 ? r1((bookedInSessions / sessionMinutes) * 100) : null,
      usedUtilisation: sessionMinutes > 0 ? r1((usedInSessions / sessionMinutes) * 100) : null,
      releasedMinutes: r1(sessionRows.reduce((a, s) => a + s.releasedMinutes, 0)),
      bookedMinutesOutsideSessions: r1(bookings.filter((b) => inWin(b.startAt)).reduce((a, b) => a + Math.max(0, Number(b.minutes || 0) - sessions.reduce((x, s) => x + overlapMinutes(s.startAt, s.minutes, b.startAt, b.minutes), 0)), 0)),
      cases: used, casesMissingTimes: missing,
      firstCases, firstCasesOnTime: firstCases.filter((f) => f.onTime === true).length, firstCasesLate: firstCases.filter((f) => f.onTime === false).length,
      turnovers, turnoverMissing,
    };
  });
  return {
    theatres: out, theatresConfigured: theatres.length > 0, settings,
    ...(bad.TheatreSession ? { sessionsUnreadable: bad.TheatreSession } : {}),
    ...(bad.ResourceBooking ? { bookingsUnreadable: bad.ResourceBooking } : {}),
    ...(bad.SurgicalCase ? { casesUnreadable: bad.SurgicalCase } : {}),
  };
}

/** ctx: { migration, resources, theatre (settings), from?, to?, utcOffsetMinutes?, now?, actorDeps, recordDeps } */
async function theatreUtilisation(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", theatres: [] };
  const off = (Number.isFinite(Number(ctx.utcOffsetMinutes)) && ctx.utcOffsetMinutes !== null && ctx.utcOffsetMinutes !== "" ? Number(ctx.utcOffsetMinutes) : 330) * MIN;
  const nowMs = ms(ctx.now) ?? Date.now();
  let fromMs = ms(ctx.from), toMs = ms(ctx.to);
  if (fromMs == null) { const d = localDay(nowMs, off); fromMs = Date.parse(d + "T00:00:00Z") - off; }
  if (toMs == null) toMs = fromMs + DAY - 1;
  if (toMs < fromMs || toMs - fromMs > 31 * DAY) return { ...base, ok: false, status: 422, error: "bad_window", detail: "from must be before to, at most 31 days apart", theatres: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, theatres: null };
  const rows = {}, unreadable = {};
  await Promise.all([TYPE, "ResourceBooking", "SurgicalCase"].map(async (t) => {
    // Every record (service.listAll, paged; the old read was the OLDEST 2,000): past 50,000 it throws (ListCeilingError) rather than answer short. ponytail: audit O20 is the upgrade if paging is slow.
    try { rows[t] = (await svc.listAll(t, { max: 50000, throwOnTruncate: true })).rows.filter(Boolean); }
    catch (e) { rows[t] = []; unreadable[t] = e instanceof GovernanceError ? "not readable with this role" : e && e.name === "ListCeilingError" ? "more records than can be read at once; the newest were not read" : "read failed"; }
  }));
  /* Sessions and bookings are what utilisation is divided by and from: without them there is no figure to show. */
  if (unreadable[TYPE] || unreadable.ResourceBooking) return { ...base, ok: false, status: unreadable[TYPE] === "not readable with this role" ? 403 : 502, error: "record_read_failed", detail: "The theatre sessions or bookings could not be read, so no utilisation is shown.", theatres: null };
  const report = computeTheatreUtilisation({ theatres: resolveResources(ctx.resources).resources, sessions: rows[TYPE], bookings: rows.ResourceBooking, cases: rows.SurgicalCase,
    settings: theatreSettings(ctx.theatre), fromMs, toMs, offsetMs: off, nowMs, unreadable });
  return { ...base, ok: true, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), ...report };
}

/* ---- NABH indicators 6 and 19 (compliance.js calls these) ---------------------------------------------------- */

const caseMs = (c, k) => ms(c && c[k]);
/** The time a case was first planned for: the first scheduled time, or when it was booked if it had none. */
const plannedAt = (c) => ms(c.firstScheduledAt) ?? ms(c.scheduledAt) ?? ms(Array.isArray(c.ledger) && c.ledger[0] && c.ledger[0].at);

/** PURE. Why a case counts as rescheduled, or null: cancelled before incision, or a start more than 4 hours after the
 *  first booked time (a recorded postponement, or the patient actually entering the theatre that late). */
function rescheduleOf(c) {
  const first = plannedAt(c);
  const moves = Array.isArray(c.reschedules) ? c.reschedules : [];
  if (moves.some((m) => m.kind === "cancelled")) return { kind: "cancelled" };
  const moved = moves.filter((m) => m.kind === "postponed" && ms(m.toStart) != null && first != null && ms(m.toStart) - first > POSTPONE_COUNTS_AFTER_MS);
  if (moved.length) return { kind: "postponed", hours: r1((ms(moved[moved.length - 1].toStart) - first) / HOUR) };
  const inAt = ms(c.theatreTimes && c.theatreTimes.inRoomAt);
  if (inAt != null && first != null && inAt - first > POSTPONE_COUNTS_AFTER_MS) return { kind: "started-late", hours: r1((inAt - first) / HOUR) };
  return null;
}

/** PURE. Month cell for #19. */
function rescheduleCell(cases, w) {
  const planned = (cases || []).filter((c) => { const t = plannedAt(c); return t != null && t >= w.fromMs && t <= w.toMs; });
  const n = planned.filter((c) => rescheduleOf(c)).length;
  return { numerator: n, denominator: planned.length, value: planned.length ? Math.round((n / planned.length) * 10000) / 100 : null };
}

/* NABH #6 remarks: "shall not include surgeries under LA". The technique is the one the anaesthesia record says was given,
 * else the one planned at the pre-anaesthetic checkup (both from migrate-surgery.js PAC_TECHNIQUE; compliance.js builds the
 * map). Of that closed list only local-with-monitoring is local anaesthesia; a regional block or spinal is not. */
const LOCAL_TECHNIQUES = Object.freeze(["local-with-monitoring"]);

/** PURE. Month cell for #6: cases with an incision in the month flagged by the surgeon as an unplanned return. With
 *  `techniqueOf` (caseId -> technique or null), cases under local anaesthesia are left out of both counts and counted
 *  beside, and cases with no technique recorded stay in and are counted beside. */
function unplannedReturnCell(cases, w, techniqueOf) {
  const inMonth = (cases || []).filter((c) => { const t = caseMs(c, "incisionAt"); return t != null && t >= w.fromMs && t <= w.toMs; });
  const tech = (c) => (techniqueOf ? techniqueOf.get(c.id) || null : null);
  const ops = techniqueOf ? inMonth.filter((c) => !LOCAL_TECHNIQUES.includes(tech(c))) : inMonth;
  const n = ops.filter((c) => c.unplannedReturn && c.unplannedReturn.value === true).length;
  return { numerator: n, denominator: ops.length, value: ops.length ? Math.round((n / ops.length) * 10000) / 100 : null, unreviewed: ops.filter((c) => !c.unplannedReturn).length,
    ...(techniqueOf ? { localAnaesthesiaExcluded: inMonth.length - ops.length, techniqueNotRecorded: ops.filter((c) => !tech(c)).length } : {}) };
}

export {
  TYPE, OWNER_KINDS, POSTPONE_COUNTS_AFTER_MS, theatreSettings, TheatreSession, sessionIdFor, sessionStatus, overlapMinutes, heldSessionFor,
  createTheatreSession, releaseTheatreSession, computeTheatreUtilisation, theatreUtilisation, rescheduleOf, rescheduleCell, unplannedReturnCell, LOCAL_TECHNIQUES,
};
