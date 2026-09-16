/* functions/_wardsynq/hr-attendance.js - staff attendance against the rota (gap wave 2026-09-16, HR).
 *
 * THREE WAYS IN, ONE RECORD. A staff member clocks in and out from the app (the rota shift it belongs to is
 * found on the server, never taken from the caller), a supervisor corrects or adds a record with a reason,
 * or a biometric device's CSV export is imported after a column-mapping step. Each is a
 * `_wardsynq_hr_attendance` record in the hospital's append-only store: every change is a new version in
 * the same append as its audit row, and a correction keeps what it replaced.
 *
 * NOT A RecordService TYPE, on purpose (the bug-reports.js reasoning): that door needs a clinical actor and
 * `hr` has none, and a type in RESOURCE_TYPES is readable through the raw record door by every emr.view role.
 * Staff data is not the chart. The route decides who (functions/api/queue/[[path]].js): clock and own
 * records for any member, everything else staff.admin (admin, hr).
 *
 * THE MONTHLY SUMMARY IS COMPUTED, NEVER STORED. Each rostered shift is present, late, left early, no
 * clock-out, absent (its end has passed with no attendance), in progress or upcoming. Absent is never
 * inferred for a shift that has not ended. A read that hit its scan cap says partial, so a short month is
 * never read as a full one.
 *
 * NO PHI. Staff identities only; audit rows name record ids, counts and months, never a clock time with a name.
 */

import { VersionConflictError } from "./repository.js";
import { span as shiftSpan } from "../_roster.js";

const TYPE = "_wardsynq_hr_attendance";
const PAGE = 1000, MAX_PAGES = 10;
const MAX_CSV_BYTES = 2 * 1024 * 1024, MAX_CSV_ROWS = 20000;
const EARLY_CLOCK_MINUTES = 120;       // a clock-in this long before a shift starts still belongs to it
const PAIR_WITHIN_HOURS = 18;          // two device punches further apart than this are not one shift
const DUPLICATE_WITHIN_MS = 2 * 60000; // a punch this close to a recorded clock-in is the same punch

const str = (v) => (v == null ? "" : String(v).trim());
const clip = (v, n) => str(v).slice(0, n);
const offsetOf = (cfg) => (cfg && cfg.utcOffsetMinutes != null ? Number(cfg.utcOffsetMinutes) || 0 : 330);
const auditEvent = (action, actor, scope) => ({ ts: new Date().toISOString(), actor: str(actor), connectorId: "wardsynq-hr", action, outcome: "ok", scope });
const refuse = (status, error, message) => ({ ok: false, status, error, message });
const readFailed = refuse(502, "attendance_read_failed", "Attendance could not be read, so nothing was changed.");
const writeFailed = (e) => e instanceof VersionConflictError
  ? refuse(409, "version_conflict", "This attendance record changed at the same moment. Reload and try again; nothing was saved.")
  : refuse(502, "attendance_write_failed", "The attendance change could not be saved, so it was not made.");
const noStore = (mig) => !mig || mig.mode === "off" || !mig.tenantId;
const notHospital = refuse(404, "not_a_wardsynq_hospital", "Attendance is kept for a WardSynQ hospital.");

async function h16(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str(text)));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PURE. Local date (YYYY-MM-DD), month and minute-of-axis for an instant at the hospital's offset. */
const localIso = (ms, off) => new Date(ms + off * 60000).toISOString();
const localDate = (ms, off) => localIso(ms, off).slice(0, 10);
const localMinute = (ms, off) => Math.floor((ms + off * 60000) / 60000);
const digits = (iso) => str(iso).replace(/[^0-9]/g, "").slice(0, 14);

/** PURE. "YYYY-MM-DDTHH:MM[:SS]" read as the hospital's local time -> UTC ms, or NaN. An ISO with a zone is taken as is. */
function parseLocal(v, off) {
  const s = str(v);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return NaN;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isFinite(ms) ? ms - off * 60000 : NaN;
}

function monthsBack(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}
const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(str(m));
function lastDay(month) { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }

/** Every record whose id starts with prefix, following pages. { rows, partial } or throws. */
async function readPrefix(repo, tenantId, prefix) {
  const rows = [];
  let before;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await repo.pageByIdPrefix(tenantId, TYPE, prefix, { limit: PAGE, ...(before ? { before } : {}) });
    rows.push(...(page.records || []));
    if (!page.next) return { rows, partial: false };
    before = page.next;
  }
  return { rows, partial: true };
}

/** PURE. What a screen sees of one attendance record. */
function summaryOf(r) {
  return {
    id: r.id, identity: r.identity, date: r.date, clockIn: r.clockIn, clockOut: r.clockOut || null, source: r.source,
    shift: r.shift || null, voided: r.voided === true, corrections: (r.corrections || []).length,
    lastCorrection: (r.corrections || []).slice(-1)[0] || null, importBatch: r.importBatch || null, version: r.version,
  };
}

/** PURE. The rota shift a clock-in at nowMs belongs to: the caller's assignment whose window (from two hours
 * before its start to its end) holds now, the nearest start first. Null when none does. */
function shiftFor(nowMs, off, shifts, assignments, identity) {
  const at = localMinute(nowMs, off);
  let best = null;
  for (const a of assignments || []) {
    if (!a || a.status === "cancelled" || a.identity !== identity) continue;
    const s = shifts && shifts[a.shiftId];
    if (!s) continue;
    const [start, end] = shiftSpan(a.date, s);
    if (at < start - EARLY_CLOCK_MINUTES || at >= end) continue;
    if (!best || Math.abs(at - start) < Math.abs(at - best.startMin)) best = { startMin: start, a, s };
  }
  return best ? { assignmentId: best.a.id, shiftId: best.a.shiftId, name: best.s.name || best.a.shiftId, unit: best.s.unit || "", date: best.a.date, start: best.s.start, end: best.s.end } : null;
}

async function openRecordOf(repo, tenantId, identity, nowMs, off) {
  const h = await h16(identity);
  const month = localDate(nowMs, off).slice(0, 7);
  const [a, b] = await Promise.all([readPrefix(repo, tenantId, `att-${month}-${h}-`), readPrefix(repo, tenantId, `att-${monthsBack(month, 1)}-${h}-`)]);
  const open = [...a.rows, ...b.rows].filter((r) => r && r.identity === identity && !r.voided && !r.clockOut)
    .sort((x, y) => String(y.clockIn).localeCompare(String(x.clockIn)));
  return { open: open[0] || null, h };
}

/**
 * The caller clocks in or out. ctx: { migration, recordDeps, identity (the caller's membership, from the
 * credential), action "in"|"out", rota: { assignmentsBetween(from, to) }, wsqCfg, nowMs? }
 */
async function clockAttendance(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const identity = str(ctx.identity), action = str(ctx.action);
  if (!identity) return refuse(403, "not_staff", "Only a staff member of this hospital clocks in. The hospital's owner account has no attendance.");
  if (action !== "in" && action !== "out") return refuse(422, "bad_action", "Clock in or clock out.");
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, off = offsetOf(ctx.wsqCfg);
  const nowMs = Number(ctx.nowMs) || Date.now();
  let open, h;
  try { ({ open, h } = await openRecordOf(repo, tenantId, identity, nowMs, off)); } catch { return readFailed; }
  const at = new Date(nowMs).toISOString();

  if (action === "in") {
    if (open && nowMs - Date.parse(open.clockIn) < 24 * 3600000) return { ...refuse(409, "already_clocked_in", "You are already clocked in. Clock out first."), open: summaryOf(open) };
    let shift = null, rotaNote = null;
    try {
      const today = localDate(nowMs, off), yesterday = localDate(nowMs - 86400000, off);
      const r = await ctx.rota.assignmentsBetween(yesterday, today);
      if (r && r.ok) shift = shiftFor(nowMs, off, r.shifts, r.assignments, identity);
      else rotaNote = "The rota could not be read, so this clock-in is not linked to a shift.";
    } catch { rotaNote = "The rota could not be read, so this clock-in is not linked to a shift."; }
    const date = localDate(nowMs, off);
    const rec = { resourceType: TYPE, id: `att-${date.slice(0, 7)}-${h}-${digits(at)}`, version: 1, identity, date, clockIn: at, clockOut: null,
      source: "app", shift, corrections: [], voided: false, createdAt: at, createdBy: identity, writtenBy: { id: identity, kind: "human", at } };
    try { await repo.append(tenantId, [rec], { audit: auditEvent("hr.attendance.clock_in", identity, { id: rec.id, linkedToShift: !!shift }) }); }
    catch (e) { return writeFailed(e); }
    return { ok: true, attendance: summaryOf(rec), ...(shift ? {} : { note: rotaNote || "No rota shift of yours is due now, so this clock-in is not linked to a shift." }) };
  }

  if (!open) return refuse(409, "not_clocked_in", "You are not clocked in.");
  if (nowMs - Date.parse(open.clockIn) >= 24 * 3600000) return refuse(409, "open_too_long", "Your last clock-in is more than 24 hours old. Ask your supervisor to correct it.");
  const next = { ...open, version: open.version + 1, clockOut: at, writtenBy: { id: identity, kind: "human", at } };
  try { await repo.append(tenantId, [next], { audit: auditEvent("hr.attendance.clock_out", identity, { id: next.id }) }); }
  catch (e) { return writeFailed(e); }
  return { ok: true, attendance: summaryOf(next) };
}

/**
 * A supervisor corrects a record, voids it, or adds a missing one. A reason is required and kept with what
 * it replaced. ctx: { migration, recordDeps, actorId, wsqCfg, members, id?, identity?, clockIn?, clockOut?, void?, reason, nowMs? }
 * clockIn/clockOut are the hospital's local time ("YYYY-MM-DDTHH:MM") or a zoned ISO.
 */
async function correctAttendance(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const reason = clip(ctx.reason, 300);
  if (!reason) return refuse(422, "reason_required", "Say why this attendance is being corrected.");
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, off = offsetOf(ctx.wsqCfg);
  const nowMs = Number(ctx.nowMs) || Date.now(), at = new Date(nowMs).toISOString();
  const inMs = ctx.clockIn ? parseLocal(ctx.clockIn, off) : NaN, outMs = ctx.clockOut ? parseLocal(ctx.clockOut, off) : NaN;
  if (ctx.clockIn && !Number.isFinite(inMs)) return refuse(422, "bad_clock_in", "The clock-in time is not a date and time.");
  if (ctx.clockOut && !Number.isFinite(outMs)) return refuse(422, "bad_clock_out", "The clock-out time is not a date and time.");
  const checkTimes = (i, o) => {
    if (i > nowMs + 5 * 60000 || (Number.isFinite(o) && o > nowMs + 5 * 60000)) return refuse(422, "future_time", "Attendance cannot be recorded in the future.");
    if (Number.isFinite(o) && o <= i) return refuse(422, "out_before_in", "Clock-out must be after clock-in.");
    if (Number.isFinite(o) && o - i > 24 * 3600000) return refuse(422, "too_long", "One attendance record cannot be longer than 24 hours.");
    return null;
  };

  if (!str(ctx.id)) {
    const identity = str(ctx.identity);
    if (!(ctx.members || []).some((m) => m && m.identity === identity && m.active !== false)) return refuse(422, "unknown_staff", "That is not an active staff member of this hospital.");
    if (!Number.isFinite(inMs)) return refuse(422, "clock_in_required", "A record added by hand needs its clock-in time.");
    const bad = checkTimes(inMs, outMs); if (bad) return bad;
    const clockIn = new Date(inMs).toISOString(), date = localDate(inMs, off);
    const rec = { resourceType: TYPE, id: `att-${date.slice(0, 7)}-${await h16(identity)}-${digits(clockIn)}`, version: 1, identity, date, clockIn,
      clockOut: Number.isFinite(outMs) ? new Date(outMs).toISOString() : null, source: "manual", shift: null,
      corrections: [{ at, by: str(ctx.actorId), reason, kind: "added", before: null, after: { clockIn, clockOut: Number.isFinite(outMs) ? new Date(outMs).toISOString() : null } }],
      voided: false, createdAt: at, createdBy: str(ctx.actorId), writtenBy: { id: str(ctx.actorId), kind: "human", at } };
    let cur;
    try { cur = await repo.latest(tenantId, TYPE, rec.id); } catch { return readFailed; }
    if (cur) return refuse(409, "already_recorded", "An attendance record with that clock-in already exists. Correct it instead.");
    try { await repo.append(tenantId, [rec], { audit: auditEvent("hr.attendance.added", ctx.actorId, { id: rec.id }) }); }
    catch (e) { return writeFailed(e); }
    return { ok: true, attendance: summaryOf(rec) };
  }

  let cur;
  try { cur = await repo.latest(tenantId, TYPE, str(ctx.id)); } catch { return readFailed; }
  if (!cur) return refuse(404, "attendance_not_found", "No such attendance record at this hospital.");
  const before = { clockIn: cur.clockIn, clockOut: cur.clockOut || null, voided: cur.voided === true };
  let next;
  if (ctx.void === true) {
    if (cur.voided) return { ok: true, unchanged: true, attendance: summaryOf(cur) };
    next = { ...cur, voided: true };
  } else {
    const i = Number.isFinite(inMs) ? inMs : Date.parse(cur.clockIn);
    const o = Number.isFinite(outMs) ? outMs : (cur.clockOut ? Date.parse(cur.clockOut) : NaN);
    const bad = checkTimes(i, o); if (bad) return bad;
    next = { ...cur, clockIn: new Date(i).toISOString(), clockOut: Number.isFinite(o) ? new Date(o).toISOString() : null, date: localDate(i, off), voided: false };
    if (next.clockIn === cur.clockIn && next.clockOut === (cur.clockOut || null) && !cur.voided) return { ok: true, unchanged: true, attendance: summaryOf(cur) };
  }
  next = { ...next, version: cur.version + 1, writtenBy: { id: str(ctx.actorId), kind: "human", at },
    corrections: [...(cur.corrections || []), { at, by: str(ctx.actorId), reason, kind: ctx.void === true ? "voided" : "corrected", before, after: { clockIn: next.clockIn, clockOut: next.clockOut, voided: next.voided } }] };
  try { await repo.append(tenantId, [next], { audit: auditEvent(ctx.void === true ? "hr.attendance.voided" : "hr.attendance.corrected", ctx.actorId, { id: next.id, version: next.version }) }); }
  catch (e) { return writeFailed(e); }
  return { ok: true, attendance: summaryOf(next) };
}

/* ---- device CSV import --------------------------------------------------------------------------------- */

/** PURE. RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF. Returns rows of strings. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** PURE. A device's date and time, in the hospital's local time, to UTC ms. dateOrder: ymd | dmy | mdy. NaN when unreadable. */
function deviceTime(dateText, timeText, dateOrder, off) {
  const text = (str(dateText) + " " + str(timeText)).trim();
  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
  if (!m) return NaN;
  let y, mo, d;
  if (dateOrder === "dmy") [d, mo, y] = [m[1], m[2], m[3]];
  else if (dateOrder === "mdy") [mo, d, y] = [m[1], m[2], m[3]];
  else [y, mo, d] = [m[1], m[2], m[3]];
  if (String(y).length !== 4) return NaN;
  let hh = +m[4];
  if (m[7]) { if (hh > 12) return NaN; hh = (hh % 12) + (/pm/i.test(m[7]) ? 12 : 0); }
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || hh > 23 || +m[5] > 59) return NaN;
  const ms = Date.UTC(+y, +mo - 1, +d, hh, +m[5], +(m[6] || 0));
  if (new Date(ms).getUTCDate() !== +d) return NaN;
  return ms - off * 60000;
}
const IN_RE = /^(in|i|0|check ?in|c\/in|entry|clock ?in)$/i, OUT_RE = /^(out|o|1|check ?out|c\/out|exit|clock ?out)$/i;

/**
 * PURE. From parsed CSV rows and a column mapping to attendance pairs.
 * mapping: { staffColumn, timeColumn, dateColumn?, directionColumn?, dateOrder?, hasHeader? } (column indexes).
 * members: [{identity, employeeId}]. Returns { pairs, unreadable: [line], unknownStaff: [code], duplicatesInFile, orphanOuts, openWithoutOut }.
 */
function pairPunches(rows, mapping, members, off) {
  const col = (k) => (mapping[k] === undefined || mapping[k] === null || mapping[k] === "" ? -1 : Number(mapping[k]));
  const staffC = col("staffColumn"), timeC = col("timeColumn"), dateC = col("dateColumn"), dirC = col("directionColumn");
  const byCode = new Map();
  for (const m of members || []) {
    if (!m || m.active === false) continue;
    if (str(m.employeeId)) byCode.set(str(m.employeeId).toLowerCase(), m.identity);
    byCode.set(str(m.identity).toLowerCase(), m.identity);
  }
  const unreadable = [], unknown = new Set(), punches = new Map();
  let duplicatesInFile = 0;
  const start = mapping.hasHeader === false ? 0 : 1;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i], line = i + 1;
    const code = str(r[staffC]);
    const ms = deviceTime(dateC >= 0 ? r[dateC] : "", r[timeC], str(mapping.dateOrder) || "ymd", off);
    if (!code || !Number.isFinite(ms)) { unreadable.push(line); continue; }
    const identity = byCode.get(code.toLowerCase());
    if (!identity) { unknown.add(code); continue; }
    const dirText = dirC >= 0 ? str(r[dirC]) : "";
    const dir = dirC < 0 ? null : IN_RE.test(dirText) ? "in" : OUT_RE.test(dirText) ? "out" : "unknown";
    if (dir === "unknown") { unreadable.push(line); continue; }
    const list = punches.get(identity) || [];
    if (list.some((p) => Math.abs(p.ms - ms) < 60000 && p.dir === dir)) { duplicatesInFile++; continue; }
    list.push({ ms, dir, line });
    punches.set(identity, list);
  }
  const pairs = [];
  let orphanOuts = 0, openWithoutOut = 0;
  for (const [identity, list] of punches) {
    list.sort((a, b) => a.ms - b.ms);
    let open = null;
    for (const p of list) {
      const closes = open && p.ms - open.ms <= PAIR_WITHIN_HOURS * 3600000 && (p.dir === null || p.dir === "out");
      if (closes) { pairs.push({ identity, inMs: open.ms, outMs: p.ms }); open = null; continue; }
      if (p.dir === "out") { orphanOuts++; continue; }
      if (open) { pairs.push({ identity, inMs: open.ms, outMs: null }); openWithoutOut++; }
      open = p;
    }
    if (open) { pairs.push({ identity, inMs: open.ms, outMs: null }); openWithoutOut++; }
  }
  return { pairs, unreadable, unknownStaff: [...unknown].sort(), duplicatesInFile, orphanOuts, openWithoutOut };
}

/**
 * The device import, in three steps on one route. Without a mapping: the headers and a few rows, to choose
 * columns from. With a mapping: a preview of what would be written and why the rest would not. With
 * commit:true and confirmCount equal to the preview's count: written, in batches, each batch audited.
 * ctx: { migration, recordDeps, actorId, wsqCfg, members, csv, mapping?, commit?, confirmCount?, nowMs? }
 */
async function importDeviceAttendance(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const csv = String(ctx.csv == null ? "" : ctx.csv);
  if (!csv.trim()) return refuse(422, "csv_required", "Choose the device's CSV export.");
  if (csv.length > MAX_CSV_BYTES) return refuse(413, "csv_too_large", "The file is larger than 2 MB. Export a shorter period.");
  const rows = parseCsv(csv);
  if (rows.length > MAX_CSV_ROWS) return refuse(413, "csv_too_many_rows", `The file has more than ${MAX_CSV_ROWS} rows. Export a shorter period.`);
  if (!ctx.mapping || typeof ctx.mapping !== "object") {
    return { ok: true, step: "map", headers: (rows[0] || []).map((h) => clip(h, 60)), sample: rows.slice(1, 6).map((r) => r.map((x) => clip(x, 60))), rowCount: Math.max(0, rows.length - 1) };
  }
  const mp = ctx.mapping;
  if (mp.staffColumn === undefined || mp.staffColumn === "" || mp.timeColumn === undefined || mp.timeColumn === "") return refuse(422, "mapping_incomplete", "Choose which column holds the staff code and which holds the time.");
  if (mp.dateOrder && !["ymd", "dmy", "mdy"].includes(str(mp.dateOrder))) return refuse(422, "bad_date_order", "The date order is year-month-day, day-month-year or month-day-year.");
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, off = offsetOf(ctx.wsqCfg);
  const nowMs = Number(ctx.nowMs) || Date.now();
  const p = pairPunches(rows, mp, ctx.members, off);
  const future = p.pairs.filter((x) => x.inMs > nowMs + 5 * 60000);

  const candidates = [];
  const existingByPrefix = new Map();
  let partial = false, duplicatesInStore = 0;
  try {
    for (const x of p.pairs) {
      if (x.inMs > nowMs + 5 * 60000) continue;
      const h = await h16(x.identity), month = localDate(x.inMs, off).slice(0, 7), prefix = `att-${month}-${h}-`;
      if (!existingByPrefix.has(prefix)) { const got = await readPrefix(repo, tenantId, prefix); existingByPrefix.set(prefix, got.rows); partial = partial || got.partial; }
      const clash = existingByPrefix.get(prefix).some((r) => r && !r.voided && r.identity === x.identity && Math.abs(Date.parse(r.clockIn) - x.inMs) <= DUPLICATE_WITHIN_MS);
      if (clash) { duplicatesInStore++; continue; }
      const clockIn = new Date(x.inMs).toISOString();
      candidates.push({ id: `att-${month}-${h}-${digits(clockIn)}`, identity: x.identity, date: localDate(x.inMs, off), clockIn, clockOut: x.outMs ? new Date(x.outMs).toISOString() : null });
    }
  } catch { return readFailed; }
  const preview = {
    step: "preview", toWrite: candidates.length, duplicatesInStore, duplicatesInFile: p.duplicatesInFile, unreadableLines: p.unreadable.slice(0, 50), unreadableCount: p.unreadable.length,
    unknownStaff: p.unknownStaff.slice(0, 100), unknownStaffCount: p.unknownStaff.length, orphanOuts: p.orphanOuts, withoutClockOut: p.openWithoutOut, inFuture: future.length,
    sample: candidates.slice(0, 50).map((c) => ({ identity: c.identity, date: c.date, clockIn: c.clockIn, clockOut: c.clockOut })), partial,
  };
  if (ctx.commit !== true) return { ok: true, ...preview };
  if (partial) return { ...refuse(409, "store_too_large_to_check", "Existing attendance for these months could not be read in full, so duplicates cannot be ruled out and nothing was imported."), ...preview };
  if (Number(ctx.confirmCount) !== candidates.length) return { ...refuse(409, "preview_changed", "What would be imported changed since the preview. Preview again; nothing was imported."), ...preview };
  if (!candidates.length) return { ok: true, ...preview, step: "done", written: 0 };
  const at = new Date(nowMs).toISOString();
  const batchId = `imp-${digits(at)}-${(await h16(csv)).slice(0, 8)}`;
  let written = 0;
  for (let i = 0; i < candidates.length; i += 200) {
    const chunk = candidates.slice(i, i + 200).map((c) => ({ resourceType: TYPE, version: 1, ...c, source: "device", shift: null, corrections: [], voided: false, importBatch: batchId,
      createdAt: at, createdBy: str(ctx.actorId), writtenBy: { id: str(ctx.actorId), kind: "human", at } }));
    try { await repo.append(tenantId, chunk, { audit: auditEvent("hr.attendance.imported", ctx.actorId, { batchId, records: chunk.length, from: i }) }); }
    catch (e) {
      return { ...refuse(e instanceof VersionConflictError ? 409 : 502, "import_incomplete", `The import stopped after ${written} of ${candidates.length} records. The rest were not saved; importing the same file again adds only what is missing.`), ...preview, written, batchId };
    }
    written += chunk.length;
  }
  return { ok: true, ...preview, step: "done", written, batchId };
}

/* ---- monthly summary ------------------------------------------------------------------------------------ */

/**
 * PURE. Each rostered shift in the month against attendance.
 * -> { rows: [{assignmentId, identity, date, shiftId, shift, start, end, status, flags[], attendanceId, clockIn, clockOut}], unrostered: [...], people: {identity: totals} }
 */
function monthSummary({ month, shifts, assignments, attendance, off, nowMs, graceMinutes, identity }) {
  const grace = Number.isFinite(Number(graceMinutes)) ? Number(graceMinutes) : 10;
  const now = localMinute(nowMs, off);
  const from = `${month}-01`, to = lastDay(month);
  const att = (attendance || []).filter((r) => r && !r.voided && (!identity || r.identity === identity));
  const used = new Set();
  const rows = [];
  const asg = (assignments || []).filter((a) => a && a.status !== "cancelled" && a.date >= from && a.date <= to && (!identity || a.identity === identity) && shifts[a.shiftId])
    .sort((a, b) => (a.date + a.identity).localeCompare(b.date + b.identity));
  for (const a of asg) {
    const s = shifts[a.shiftId];
    const [start, end] = shiftSpan(a.date, s);
    const minuteOf = (iso) => localMinute(Date.parse(iso), off);
    let match = att.find((r) => !used.has(r.id) && r.identity === a.identity && r.shift && r.shift.assignmentId === a.id);
    if (!match) match = att.find((r) => {
      if (used.has(r.id) || r.identity !== a.identity) return false;
      const i = minuteOf(r.clockIn), o = r.clockOut ? minuteOf(r.clockOut) : i + 1;
      return i < end + 120 && o > start - EARLY_CLOCK_MINUTES;
    });
    const row = { assignmentId: a.id, identity: a.identity, date: a.date, shiftId: a.shiftId, shift: s.name || a.shiftId, unit: s.unit || "", start: s.start, end: s.end, flags: [], attendanceId: null, clockIn: null, clockOut: null };
    if (!match) row.status = end <= now ? "absent" : start > now ? "upcoming" : "not_clocked_in";
    else {
      used.add(match.id);
      Object.assign(row, { attendanceId: match.id, clockIn: match.clockIn, clockOut: match.clockOut || null });
      const i = minuteOf(match.clockIn), o = match.clockOut ? minuteOf(match.clockOut) : null;
      if (i > start + grace) row.flags.push("late");
      if (o !== null && o < end - grace) row.flags.push("left_early");
      if (o === null && end <= now) row.flags.push("no_clock_out");
      row.status = o === null && end > now ? "in_progress" : row.flags.length ? row.flags[0] : "present";
    }
    rows.push(row);
  }
  const unrostered = att.filter((r) => !used.has(r.id) && r.date >= from && r.date <= to).map(summaryOf);
  const people = {};
  const tot = (id) => (people[id] = people[id] || { rostered: 0, present: 0, late: 0, leftEarly: 0, noClockOut: 0, absent: 0, upcoming: 0, unrostered: 0 });
  for (const r of rows) {
    const t = tot(r.identity); t.rostered++;
    if (r.status === "absent") t.absent++;
    else if (r.status === "upcoming" || r.status === "not_clocked_in") t.upcoming++;
    else t.present++;
    if (r.flags.includes("late")) t.late++;
    if (r.flags.includes("left_early")) t.leftEarly++;
    if (r.flags.includes("no_clock_out")) t.noClockOut++;
  }
  for (const u of unrostered) tot(u.identity).unrostered++;
  return { rows, unrostered, people };
}

const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : (/^[=+\-@]/.test(s) ? `'${s}` : s); };
function summaryCsv(sum, members, off) {
  const who = new Map((members || []).map((m) => [m.identity, m]));
  const t = (iso) => (iso ? localIso(Date.parse(iso), off).slice(0, 16).replace("T", " ") : "");
  const lines = [["Staff", "Employee ID", "Date", "Shift", "Unit", "Start", "End", "Clock in", "Clock out", "Status"].join(",")];
  for (const r of sum.rows) {
    const m = who.get(r.identity) || {};
    lines.push([m.displayName || r.identity, m.employeeId || "", r.date, r.shift, r.unit, r.start, r.end, t(r.clockIn), t(r.clockOut), [r.status, ...r.flags.filter((f) => f !== r.status)].join(" ")].map(csvCell).join(","));
  }
  for (const u of sum.unrostered) {
    const m = who.get(u.identity) || {};
    lines.push([m.displayName || u.identity, m.employeeId || "", u.date, "", "", "", "", t(u.clockIn), t(u.clockOut), "not_rostered"].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * The month for the hospital (staff.admin) or for one person (their own view). ctx: { migration, recordDeps, month,
 * identity? (self only), rota: { assignmentsBetween }, wsqCfg, members?, format? "csv", nowMs? }
 */
async function attendanceMonth(request, env, ctx) {
  if (noStore(ctx.migration)) return notHospital;
  const month = str(ctx.month);
  if (!validMonth(month)) return refuse(422, "month_required", "Choose a month.");
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId, off = offsetOf(ctx.wsqCfg);
  const identity = str(ctx.identity) || null;
  let attendance = [], partial = false, rota;
  try {
    const prefixes = identity ? [`att-${monthsBack(month, 1)}-${await h16(identity)}-`, `att-${month}-${await h16(identity)}-`] : [`att-${monthsBack(month, 1)}-`, `att-${month}-`];
    for (const pre of prefixes) { const got = await readPrefix(repo, tenantId, pre); attendance.push(...got.rows); partial = partial || got.partial; }
  } catch { return readFailed; }
  try { rota = await ctx.rota.assignmentsBetween(`${month}-01`, lastDay(month)); } catch { rota = null; }
  if (!rota || !rota.ok) return refuse(502, "rota_read_failed", "The rota could not be read, so attendance cannot be compared with it.");
  const sum = monthSummary({ month, shifts: rota.shifts || {}, assignments: rota.assignments, attendance, off, nowMs: Number(ctx.nowMs) || Date.now(), graceMinutes: ctx.wsqCfg && ctx.wsqCfg.hr && ctx.wsqCfg.hr.lateGraceMinutes, identity });
  const out = { ok: true, month, partial: partial || !!rota.partial, graceMinutes: Number((ctx.wsqCfg && ctx.wsqCfg.hr && ctx.wsqCfg.hr.lateGraceMinutes) ?? 10), ...sum,
    records: attendance.filter((r) => r && (!identity || r.identity === identity) && str(r.date).slice(0, 7) === month).map(summaryOf).sort((a, b) => String(b.clockIn).localeCompare(String(a.clockIn))) };
  if (str(ctx.format) === "csv") out.csv = summaryCsv(sum, ctx.members, off);
  return out;
}

export { TYPE as ATTENDANCE_TYPE, parseLocal, shiftFor, parseCsv, deviceTime, pairPunches, monthSummary, summaryCsv, clockAttendance, correctAttendance, importDeviceAttendance, attendanceMonth };
