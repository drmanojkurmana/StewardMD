// FollowCare AI Voice Fallback — pure decision-layer unit tests (Phase 1).
// Mirrors the style of followcare-schedule/-server tests: pure functions, no I/O, no Firestore.
// Anchors are Asia/Kolkata (UTC+5:30, no DST): 09:00 IST = 03:30 UTC, 17:00 IST = 11:30 UTC.
import { test } from "node:test";
import assert from "node:assert";
import Voice from "../followcare-voice.js";

const TZ = "Asia/Kolkata";
const H = 3600000;
// 2026-08-16 wall-clock in IST → UTC ms
const T_0200 = Date.UTC(2026, 7, 15, 20, 30);  // 02:00 IST Aug 16 (before morning)
const T_0900 = Date.UTC(2026, 7, 16, 3, 30);   // 09:00 IST (morning start)
const T_0930 = Date.UTC(2026, 7, 16, 4, 0);    // 09:30 IST (in morning)
const T_1000 = Date.UTC(2026, 7, 16, 4, 30);   // 10:00 IST (morning end, exclusive)
const T_1030 = Date.UTC(2026, 7, 16, 5, 0);    // 10:30 IST (between windows)
const T_1700 = Date.UTC(2026, 7, 16, 11, 30);  // 17:00 IST (evening start)
const T_1900 = Date.UTC(2026, 7, 16, 13, 30);  // 19:00 IST (after evening)
const T_LATE = Date.UTC(2026, 7, 16, 23, 0);   // 04:30 IST Aug 17 (next tz day)

const S = Voice.defaultSettings();
function enabled(extra) { const s = Voice.normalizeSettings({ voice: Object.assign({ enabled: true }, extra) }); return s; }

// ---- settings normalization ----
test("normalizeSettings: defaults + HARD 1-call/day cap (never configurable above 1)", () => {
  const d = Voice.normalizeSettings({});
  assert.equal(d.voice.enabled, false);
  assert.equal(d.voice.maxCallsPerDay, 1);
  assert.equal(d.voice.tz, "Asia/Kolkata");
  assert.deepEqual([d.voice.morningStart, d.voice.morningEnd, d.voice.eveningStart, d.voice.eveningEnd], [9, 10, 17, 18]);
  // an attempt to raise the daily cap is clamped back to 1
  assert.equal(Voice.normalizeSettings({ voice: { maxCallsPerDay: 5 } }).voice.maxCallsPerDay, 1);
  // concurrency clamps into [1,50]
  assert.equal(Voice.normalizeSettings({ voice: { maxConcurrent: 999 } }).voice.maxConcurrent, 50);
  assert.equal(Voice.normalizeSettings({ voice: { maxConcurrent: 0 } }).voice.maxConcurrent, 1);
});

test("normalizeSettings: invalid windows fall back to defaults; bad tz → Asia/Kolkata; ambulance method sms|whatsapp", () => {
  const s = Voice.normalizeSettings({ voice: { morningStart: 12, morningEnd: 11, tz: "Not/AZone" }, ambulance: { enabled: true, method: "email", phone: "9876543210", contactName: "Front desk" } });
  assert.deepEqual([s.voice.morningStart, s.voice.morningEnd], [9, 10]);  // end<=start → reset
  assert.equal(s.voice.tz, "Asia/Kolkata");
  assert.equal(s.ambulance.enabled, true);
  assert.equal(s.ambulance.method, "sms");   // unknown method coerced
  assert.equal(s.ambulance.phone, "9876543210");
});

// ---- tz date key (the once-per-day guard's key) ----
test("tzDateKey: YYYY-MM-DD in hospital tz, handles the UTC↔IST day boundary", () => {
  assert.equal(Voice.tzDateKey(T_0200, TZ), "2026-08-16");
  assert.equal(Voice.tzDateKey(T_1900, TZ), "2026-08-16");
  assert.equal(Voice.tzDateKey(T_LATE, TZ), "2026-08-17");   // 23:00 UTC = 04:30 IST next day
});

// ---- window math ----
test("withinWindow: inside 09–10 and 17–18 IST only; end is exclusive", () => {
  const s = enabled();
  assert.equal(Voice.withinWindow(T_0900, s), true);
  assert.equal(Voice.withinWindow(T_0930, s), true);
  assert.equal(Voice.withinWindow(T_1000, s), false);   // exactly 10:00 is out (call must finish inside)
  assert.equal(Voice.withinWindow(T_1030, s), false);
  assert.equal(Voice.withinWindow(T_1700, s), true);
  assert.equal(Voice.withinWindow(T_1900, s), false);
  assert.equal(Voice.withinWindow(T_0200, s), false);
});

test("nextCallWindow: now if inside; else next window start (evening→next morning rolls the day)", () => {
  const s = enabled();
  assert.deepEqual(Voice.nextCallWindow(T_0930, s), { startMs: T_0930, within: true });
  // before morning → today 09:00
  assert.deepEqual(Voice.nextCallWindow(T_0200, s), { startMs: T_0900, within: false });
  // between windows → today 17:00
  assert.deepEqual(Voice.nextCallWindow(T_1030, s), { startMs: T_1700, within: false });
  // after evening → tomorrow 09:00 IST = Aug 17 03:30 UTC
  assert.deepEqual(Voice.nextCallWindow(T_1900, s), { startMs: Date.UTC(2026, 7, 17, 3, 30), within: false });
});

// ---- once-per-day guard ----
test("guardOncePerDay: blocks a second call on the same tz calendar day (doctor cannot bypass)", () => {
  assert.equal(Voice.guardOncePerDay({ lastVoiceDate: "2026-08-16" }, T_0930, TZ).ok, false);
  assert.equal(Voice.guardOncePerDay({ lastVoiceDate: "2026-08-15" }, T_0930, TZ).ok, true);
  assert.equal(Voice.guardOncePerDay({ lastVoiceDate: "" }, T_0930, TZ).ok, true);
  // same UTC-relative but crossing the IST midnight into a new day → allowed again
  assert.equal(Voice.guardOncePerDay({ lastVoiceDate: "2026-08-16" }, T_LATE, TZ).ok, true);
});

// ---- eligibility truth table ----
// A patient with a day-1 check-in that came due `overdueH` hours ago and is unanswered.
function ep(overdueH, extra) {
  return Object.assign({ schedule: [{ dayOffset: 1, dueAtMs: T_0930 - overdueH * H }, { dayOffset: 3, dueAtMs: T_0930 + 48 * H }], lastDayDone: -1, status: "active", voiceOptOut: false }, extra || {});
}

test("voiceEligible: enabled + due + overdue past fallbackHours → eligible (auto)", () => {
  const r = Voice.voiceEligible(ep(30), T_0930, enabled());
  assert.deepEqual(r, { eligible: true, reason: "auto" });
});

test("voiceEligible: still inside the digital fallback window → not eligible (auto), but manual overrides", () => {
  assert.equal(Voice.voiceEligible(ep(2), T_0930, enabled()).eligible, false);
  assert.equal(Voice.voiceEligible(ep(2), T_0930, enabled()).reason, "within_fallback");
  const m = Voice.voiceEligible(ep(2), T_0930, enabled(), { manual: true });
  assert.deepEqual(m, { eligible: true, reason: "manual" });
});

test("voiceEligible: hard blocks — disabled, opted out, recovered, nothing due", () => {
  assert.equal(Voice.voiceEligible(ep(30), T_0930, Voice.normalizeSettings({ voice: { enabled: false } })).reason, "voice_disabled");
  assert.equal(Voice.voiceEligible(ep(30, { voiceOptOut: true }), T_0930, enabled()).reason, "opted_out");
  assert.equal(Voice.voiceEligible(ep(30, { status: "recovered" }), T_0930, enabled()).reason, "recovered");
  // patient already answered the only due day → nothing due (never call someone who responded)
  assert.equal(Voice.voiceEligible(ep(30, { lastDayDone: 1 }), T_0930, enabled()).reason, "nothing_due");
  // manual cannot override a patient who has responded / has nothing outstanding
  assert.equal(Voice.voiceEligible(ep(30, { lastDayDone: 1 }), T_0930, enabled(), { manual: true }).reason, "nothing_due");
});
