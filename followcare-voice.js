/* FollowCare AI — Voice Fallback decision layer (PURE, deterministic, no I/O).
 *
 * The single source of truth for "should we place an AI wellbeing call, when, and is it allowed?".
 * Shared by the client (patient-record badge + call button) and the server (voice scheduler), so the
 * browser and the cron never disagree. No network, no PHI, no Firestore — just the episode summary + the
 * per-hospital settings. Mirrors followcare-schedule.js (IIFE + module.exports).
 *
 * The clinical decision itself is NOT here — that stays with FollowCareEngine/Assessment (reused server-side).
 * This module only decides eligibility, the call window, and the hard 1-call-per-day guard.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var HOUR = 3600000, DAY = 86400000;

  // ---- settings ----------------------------------------------------------------------------
  function clampInt(x, lo, hi, dflt) { x = Number(x); if (!isFinite(x)) return dflt; x = Math.round(x); return Math.max(lo, Math.min(hi, x)); }
  function safeTz(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: String(tz) }); return String(tz); } catch (e) { return "Asia/Kolkata"; } }

  function defaultSettings() {
    return {
      voice: { enabled: false, morningStart: 9, morningEnd: 10, eveningStart: 17, eveningEnd: 18, tz: "Asia/Kolkata", maxConcurrent: 5, fallbackHours: 24, maxCallsPerDay: 1 },
      ambulance: { enabled: false, contactName: "", phone: "", method: "sms" }
    };
  }
  // Merge a raw (possibly partial / hostile) settings object with defaults. The 1-call/day cap is a hard
  // safety invariant (spec §28.1) — it is NEVER honoured above 1 no matter what a caller stores.
  function normalizeSettings(raw) {
    raw = raw || {}; var rv = raw.voice || {}, ra = raw.ambulance || {};
    var v = {
      enabled: !!rv.enabled,
      morningStart: clampInt(rv.morningStart, 0, 23, 9),
      morningEnd: clampInt(rv.morningEnd, 1, 24, 10),
      eveningStart: clampInt(rv.eveningStart, 0, 23, 17),
      eveningEnd: clampInt(rv.eveningEnd, 1, 24, 18),
      tz: safeTz(rv.tz || "Asia/Kolkata"),
      maxConcurrent: clampInt(rv.maxConcurrent, 1, 50, 5),
      fallbackHours: clampInt(rv.fallbackHours, 0, 240, 24),
      maxCallsPerDay: 1
    };
    if (v.morningEnd <= v.morningStart) { v.morningStart = 9; v.morningEnd = 10; }
    if (v.eveningEnd <= v.eveningStart) { v.eveningStart = 17; v.eveningEnd = 18; }
    var a = {
      enabled: !!ra.enabled,
      contactName: String(ra.contactName || "").slice(0, 120),
      phone: String(ra.phone || "").slice(0, 24),
      method: (ra.method === "whatsapp") ? "whatsapp" : "sms"
    };
    return { voice: v, ambulance: a };
  }

  // ---- timezone helpers (Intl-only; no dependency) -----------------------------------------
  // Offset (ms) such that (wall-clock-in-tz read as UTC) - actualUtc. IST = +5:30 → +19800000.
  function tzOffsetMs(ms, tz) {
    var dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var p = {}; dtf.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var h = (p.hour === "24") ? 0 : Number(p.hour);
    var asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, Number(p.minute), Number(p.second));
    return asUTC - ms;
  }
  // "YYYY-MM-DD" in tz — the per-calendar-day key for the 1-call/day guard.
  function tzDateKey(ms, tz) {
    var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day;
  }
  // Absolute UTC ms for a wall-clock (y,mo,d,hour) in tz. Exact for no-DST zones (IST); one refine handles
  // most DST cases. ponytail: ±1h possible exactly at a DST transition — refine loop, not a lib, is enough here.
  function wallToUtc(y, mo, d, hour, tz) {
    var guess = Date.UTC(y, mo - 1, d, hour, 0, 0);
    var off = tzOffsetMs(guess, tz);
    var utc = guess - off;
    var off2 = tzOffsetMs(utc, tz);
    if (off2 !== off) utc = guess - off2;
    return utc;
  }
  function windowsForDate(dateKey, v) {
    var p = dateKey.split("-"), y = +p[0], mo = +p[1], d = +p[2], out = [];
    if (v.morningEnd > v.morningStart) out.push({ start: wallToUtc(y, mo, d, v.morningStart, v.tz), end: wallToUtc(y, mo, d, v.morningEnd, v.tz) });
    if (v.eveningEnd > v.eveningStart) out.push({ start: wallToUtc(y, mo, d, v.eveningStart, v.tz), end: wallToUtc(y, mo, d, v.eveningEnd, v.tz) });
    return out;
  }
  // now if inside a window, else the next window start. startMs === 0 means "no window configured".
  function nextCallWindow(ms, settings) {
    var v = (settings && settings.voice) || defaultSettings().voice;
    var today = windowsForDate(tzDateKey(ms, v.tz), v);
    for (var i = 0; i < today.length; i++) if (ms >= today[i].start && ms < today[i].end) return { startMs: ms, within: true };
    var cands = today.map(function (w) { return w.start; }).filter(function (s) { return s > ms; });
    if (!cands.length) cands = windowsForDate(tzDateKey(ms + DAY, v.tz), v).map(function (w) { return w.start; }).filter(function (s) { return s > ms; });
    return { startMs: cands.length ? Math.min.apply(null, cands) : 0, within: false };
  }
  function withinWindow(ms, settings) { return nextCallWindow(ms, settings).within; }

  // ---- 1-call-per-day guard ----------------------------------------------------------------
  function guardOncePerDay(ep, ms, tz) {
    var today = tzDateKey(ms, tz);
    if (ep && ep.lastVoiceDate && ep.lastVoiceDate === today) return { ok: false, reason: "already_called_today" };
    return { ok: true, reason: "" };
  }

  // ---- eligibility -------------------------------------------------------------------------
  // Due check-ins the patient has NOT answered yet (dueAtMs<=now && dayOffset>lastDayDone), earliest first.
  // Same "unanswered" definition the digital dispatcher uses — a voice call never targets a responded patient.
  function dueUnanswered(ep, ms) {
    var done = (ep.lastDayDone == null) ? -1 : ep.lastDayDone;
    return (ep.schedule || []).filter(function (s) { return s.dueAtMs <= ms && s.dayOffset > done; }).sort(function (a, b) { return a.dueAtMs - b.dueAtMs; });
  }
  // Should this episode get an AI call now? opts.manual = a doctor-initiated call (skips the digital-fallback
  // wait, but keeps every other guard — a doctor still cannot call a responded patient or bypass 1/day).
  function voiceEligible(ep, ms, settings, opts) {
    opts = opts || {}; var v = (settings && settings.voice) || {};
    if (!v.enabled) return { eligible: false, reason: "voice_disabled" };
    if (ep.voiceOptOut) return { eligible: false, reason: "opted_out" };
    if (ep.status === "recovered" || ep.status === "closed") return { eligible: false, reason: ep.status };
    var due = dueUnanswered(ep, ms);
    if (!due.length) return { eligible: false, reason: "nothing_due" };
    if (!opts.manual) {
      var fallbackMs = (v.fallbackHours == null ? 24 : v.fallbackHours) * HOUR;
      if ((ms - due[0].dueAtMs) < fallbackMs) return { eligible: false, reason: "within_fallback" };
    }
    return { eligible: true, reason: opts.manual ? "manual" : "auto" };
  }

  var API = {
    defaultSettings: defaultSettings, normalizeSettings: normalizeSettings,
    tzOffsetMs: tzOffsetMs, tzDateKey: tzDateKey, wallToUtc: wallToUtc,
    withinWindow: withinWindow, nextCallWindow: nextCallWindow,
    guardOncePerDay: guardOncePerDay, dueUnanswered: dueUnanswered, voiceEligible: voiceEligible,
    _version: 1
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareVoice = API;
})();
