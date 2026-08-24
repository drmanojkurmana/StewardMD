// FollowCare AI Voice Fallback — server I/O integration tests (Phase 1).
// Mocks _fbfirestore with an in-memory store (the test runner passes --experimental-test-module-mocks) so the
// REAL voice plumbing runs: settings round-trip + 1-call/day guard + engine-reuse on result + ambulance notify +
// already-responded cancel. Clinical scoring itself is covered by followcare-engine.test.mjs — here we assert the
// VOICE wiring, not the engine's numbers.
import { test, mock } from "node:test";
import assert from "node:assert";

// ---- in-memory Firestore mock ------------------------------------------------------------
const store = new Map();
let clock = 1;
const last = (p) => String(p).slice(String(p).lastIndexOf("/") + 1);
const smsCalls = [];

const fbMock = {
  fsGet: async (_env, path) => { const d = store.get(String(path).replace(/^\/+/, "")); return d ? { id: last(path), name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
  fsQuery: async (_env, coll, opts = {}) => {
    const out = [];
    for (const [p, d] of store) {
      if (!p.startsWith(coll + "/")) continue;
      if (opts.where && opts.where.field && d.fields[opts.where.field] !== opts.where.value) continue;
      out.push({ id: last(p), name: p, fields: { ...d.fields }, updateTime: d.updateTime });
      if (opts.limit && out.length >= opts.limit) break;
    }
    return out;
  },
  fsCommit: async (_env, writes) => {
    for (const w of writes || []) {  // preconditions first (atomic-ish)
      const cur = store.get(w.path);
      if (w.precond === "exists_false" && cur) throw Object.assign(new Error("pre"), { code: "precondition" });
      if (w.precond === "exists_true" && !cur) throw Object.assign(new Error("pre"), { code: "precondition" });
      if (w.precondUpdateTime && (!cur || cur.updateTime !== w.precondUpdateTime)) throw Object.assign(new Error("pre"), { code: "precondition" });
    }
    for (const w of writes || []) {
      if (w.op === "delete") { store.delete(w.path); continue; }
      const cur = store.get(w.path) || { fields: {}, updateTime: null };
      store.set(w.path, { fields: Object.assign({}, cur.fields, w.fields), updateTime: "t" + (clock++) });
    }
    return { ok: true };
  },
  wCreate: (_env, path, fields) => ({ op: "update", path: String(path), fields, precond: "exists_false" }),
  wUpdate: (_env, path, fields, opts = {}) => ({ op: "update", path: String(path), fields, precond: opts.exists ? "exists_true" : null, precondUpdateTime: opts.updateTime || null }),
  wDelete: (_env, path) => ({ op: "delete", path: String(path) }),
};
mock.module("../functions/_fbfirestore.js", { namedExports: fbMock });
mock.module("../functions/_followcare_sms.js", { namedExports: { sendSms: async (_env, p) => { smsCalls.push(p); return { ok: true, providerId: "mock" }; } } });
mock.module("../functions/_followcare_whatsapp.js", { namedExports: { sendWhatsApp: async () => ({ ok: true }), waConfigured: () => false } });

const V = await import("../functions/_followcare_voice.js");
// tzDateKey is the shared day-key helper the server uses (tzDateKey(ms, tz)); used here so the
// expected date is derived
// from NOW rather than hard-coded (see the NOW comment above).
const VoiceLib = (await import("../followcare-voice.js")).default;
const { encPHI, getEpisode } = await import("../functions/_followcare.js");

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");
const ENV = { FOLLOWCARE_PHI_KEY: KEY, FOLLOWCARE_TOKEN_SECRET: "x".repeat(40) };
// ANCHORED TO TODAY, not to a fixed date.
//
// submitVoiceResult() reads the real Date.now() rather than an injected clock, so a hard-coded NOW
// silently rots. This file was pinned to 2026-08-16; on 2026-08-18 real time passed the fixture's
// day-3 due time, so a call that should CANCEL ("the patient already responded") started scoring
// day 3 instead, and six tests here began failing every single day - unnoticed, because CI was
// already red. Deriving NOW from today keeps the intended property (09:30 IST, inside the morning
// window) without the expiry date.
const _today = new Date();
const NOW = Date.UTC(_today.getUTCFullYear(), _today.getUTCMonth(), _today.getUTCDate(), 4, 0);   // 09:30 IST today

async function seedEpisode(id, extra) {
  const phoneEnc = await encPHI(ENV, "919876543210");
  const nameEnc = await encPHI(ENV, "Ravi Kumar");
  // 60h overdue: comfortably past the minimum noResponseDays (2 days = 48h) these tests set,
  // so eligibility is satisfied and the tests exercise queueing rather than the threshold.
  const schedule = [{ dayOffset: 1, dueAtMs: NOW - 60 * 3600000 }, { dayOffset: 3, dueAtMs: NOW + 48 * 3600000 }];
  store.set("fc_episodes/" + id, { fields: Object.assign({
    hospitalId: "H1", doctorUid: "D1", pathwayId: "pneumonia", disease: "Pneumonia", status: "active",
    dischargeMs: NOW - 72 * 3600000, lang: "en", scheduleJson: JSON.stringify(schedule),
    lastDayDone: -1, lastScore: -1, phoneEnc, nameEnc, guardianEnc: "",
  }, extra || {}), updateTime: "t" + (clock++) });
}

/* NOTE (2026-08-24): every hospital seeded here sets noResponseDays explicitly (2 = the minimum the setting clamps to).
 *
 * Commit 8382a8a8 replaced the old "fallbackHours" eligibility rule (default 24h) with a doctor-set
 * "call after N days of no check-in" (default 3). These episodes are seeded 30 hours overdue, so
 * under the new default they are correctly NOT yet eligible - and six tests in this file, which are
 * about queueing/consuming/cancelling a call rather than about the threshold, started failing.
 * test/followcare-voice.test.mjs was updated for the new rule at the time; this server-side file was
 * missed, and then sat unnoticed inside a red CI.
 *
 * Setting it explicitly is the fix AND the point: these tests should never have depended on whatever
 * the default happened to be. The threshold itself is covered in followcare-voice.test.mjs. */
test("settings: set → get round-trips and clamps the daily cap to 1", async () => {
  await V.setHospitalSettings(ENV, "H1", { voice: { enabled: true, maxCallsPerDay: 9, noResponseDays: 2 }, ambulance: { enabled: true, phone: "918888888888", method: "sms", contactName: "ER desk" } }, "test");
  const s = await V.getHospitalSettings(ENV, "H1");
  assert.equal(s.voice.enabled, true);
  assert.equal(s.voice.maxCallsPerDay, 1);           // hard cap survives a hostile store
  assert.equal(s.ambulance.enabled, true);
  assert.equal(s.ambulance.phone, "918888888888");
});

test("queueVoiceCall: writes a call, consumes the day, and blocks a second same-day call", async () => {
  await seedEpisode("ep1");
  const s = await V.getHospitalSettings(ENV, "H1");
  const ep = await getEpisode(ENV, "ep1");
  const q = await V.queueVoiceCall(ENV, ep, s, NOW, { manual: false });
  assert.equal(q.ok, true);
  assert.ok(q.callId);
  const vc = store.get("fc_voice_calls/" + q.callId).fields;
  assert.equal(vc.status, "scheduled");
  assert.equal(vc.episodeId, "ep1");
  const ep2 = await getEpisode(ENV, "ep1");
  assert.equal(ep2.lastVoiceDate, VoiceLib.tzDateKey(NOW, s.voice.tz));   // day consumed at attempt (a later no-answer still counts)
  const q2 = await V.queueVoiceCall(ENV, ep2, s, NOW, {});   // second call, same day
  assert.equal(q2.ok, false);
  assert.equal(q2.error, "already_called_today");    // doctor cannot bypass
});

test("queueVoiceCall: opted-out and voice-disabled are hard blocks", async () => {
  await seedEpisode("ep_opt", { voiceOptOut: true });
  const s = await V.getHospitalSettings(ENV, "H1");
  const ep = await getEpisode(ENV, "ep_opt");
  assert.equal((await V.queueVoiceCall(ENV, ep, s, NOW, {})).error, "opted_out");
  const off = await V.getHospitalSettings(ENV, "H2");   // H2 has no settings → voice disabled by default
  await seedEpisode("ep_h2", { hospitalId: "H2" });
  const ep2 = await getEpisode(ENV, "ep_h2");
  assert.equal((await V.queueVoiceCall(ENV, ep2, off, NOW, {})).error, "voice_disabled");
});

test("submitVoiceResult: a completed call is a real check-in (advances lastDayDone) + ambulance notify fires", async () => {
  await seedEpisode("ep2");
  smsCalls.length = 0;
  const res = await V.submitVoiceResult(ENV, "ep2", {
    answers: { overall: "worse" }, patientStatement: "breathing difficulty", ambulanceRequested: true,
    durationMs: 62000, callId: "call-ep2", status: "completed",
  }, { notify: async () => {} });
  assert.equal(res.ok, true);
  assert.equal(res.scored, true);
  assert.ok(["green", "yellow", "orange", "red"].includes(res.escalation));
  const ep = await getEpisode(ENV, "ep2");
  assert.equal(ep.lastDayDone, 1);                              // the voice call counted as day-1 check-in
  assert.ok(store.get("fc_assessments/ep2_1"));                 // scored assessment persisted
  // Two messages go out and both are correct: the ambulance alert to the emergency contact, and a
  // separate acknowledgement to the patient (added after this test was written). Counting messages
  // made the test brittle and hid the real assertion, so identify them by recipient instead.
  const toAmbulance = smsCalls.filter(c => c.toE164 === "918888888888");
  assert.equal(toAmbulance.length, 1, "exactly one ambulance alert");
  assert.ok(toAmbulance[0].body.includes("AMBULANCE REQUESTED"));
  const toPatient = smsCalls.filter(c => c.toE164 !== "918888888888");
  assert.ok(toPatient.length <= 1, "at most one patient acknowledgement");
  assert.ok(!toPatient.some(c => c.body.includes("AMBULANCE REQUESTED")),
    "the ambulance alert must never be sent to the patient");
  const vc = store.get("fc_voice_calls/call-ep2").fields;
  assert.equal(vc.status, "completed");
  assert.equal(vc.ambulanceRequested, true);
  assert.equal(vc.patientStatement, "breathing difficulty");
});

test("submitVoiceResult: patient already responded → cancelled, never double-counts", async () => {
  await seedEpisode("ep3", { lastDayDone: 1 });   // day-1 already answered, day-3 not yet due
  const res = await V.submitVoiceResult(ENV, "ep3", { answers: { overall: "same" }, callId: "call-ep3", status: "completed" }, {});
  assert.equal(res.status, "cancelled");
  assert.equal(res.scored, false);
});

test("submitVoiceResult: a no-answer is recorded without running the engine", async () => {
  await seedEpisode("ep4");
  const res = await V.submitVoiceResult(ENV, "ep4", { status: "no_answer", callId: "call-ep4" }, {});
  assert.equal(res.scored, false);
  assert.equal(res.status, "no_answer");
  assert.ok(store.get("fc_voice_calls/call-ep4"));
  assert.equal((await getEpisode(ENV, "ep4")).lastDayDone, -1);   // no check-in advanced
});

test("runVoiceScheduler: enqueues eligible non-responders inside the window and flags GPU start", async () => {
  store.clear();
  await V.setHospitalSettings(ENV, "H1", { voice: { enabled: true, noResponseDays: 2 }, ambulance: { enabled: false } }, "test");
  await seedEpisode("s1");                          // eligible (30h overdue, unanswered)
  await seedEpisode("s2", { lastDayDone: 1 });      // responded → not eligible
  const sum = await V.runVoiceScheduler(ENV, NOW);
  assert.equal(sum.queued, 1);
  assert.equal(sum.gpuWouldStart, true);
  assert.ok(store.get("fc_episodes/s1").fields.lastVoiceDate);
  assert.ok(!store.get("fc_episodes/s2").fields.lastVoiceDate);
});

// ---- Phase 3: dialer queue + live classify + status ----
test("voiceQueueForDialing: returns scheduled calls with the ordered script + decrypted phone", async () => {
  store.clear();
  await V.setHospitalSettings(ENV, "H1", { voice: { enabled: true, noResponseDays: 2 } }, "test");
  await seedEpisode("d1");
  const s = await V.getHospitalSettings(ENV, "H1");
  const q = await V.queueVoiceCall(ENV, await getEpisode(ENV, "d1"), s, NOW, {});
  assert.equal(q.ok, true);
  const dq = await V.voiceQueueForDialing(ENV, NOW);
  assert.equal(dq.count, 1);
  const c = dq.calls[0];
  assert.equal(c.episodeId, "d1");
  assert.equal(c.phone, "919876543210");             // decrypted for the dialer
  assert.equal(c.firstName, "Ravi");
  assert.ok(Array.isArray(c.questions) && c.questions.length > 0);   // the same portal script
  assert.equal(c.dayOffset, 1);
});

test("voiceQueueForDialing: cancels a scheduled call whose patient has since responded (spec §4)", async () => {
  store.clear();
  await V.setHospitalSettings(ENV, "H1", { voice: { enabled: true, noResponseDays: 2 } }, "test");
  await seedEpisode("d2");
  const s = await V.getHospitalSettings(ENV, "H1");
  const q = await V.queueVoiceCall(ENV, await getEpisode(ENV, "d2"), s, NOW, {});
  // patient answers digitally before the dialer picks it up
  store.get("fc_episodes/d2").fields.lastDayDone = 1;
  const dq = await V.voiceQueueForDialing(ENV, NOW);
  assert.equal(dq.count, 0);
  assert.equal(store.get("fc_voice_calls/" + q.callId).fields.status, "cancelled");
});

test("classifyLive: engine-backed in-call signal (no second brain, read-only)", async () => {
  store.clear();
  await seedEpisode("c1");
  const r = await V.classifyLive(ENV, "c1", { overall: "worse" });
  assert.equal(r.ok, true);
  assert.ok(["green", "yellow", "orange", "red"].includes(r.escalation));
  assert.equal(typeof r.askAmbulance, "boolean");
  assert.equal((await V.classifyLive(ENV, "nope", {})).ok, false);
});

test("markVoiceStatus: patches a call record's status/timestamps", async () => {
  store.clear();
  store.set("fc_voice_calls/m1", { fields: { id: "m1", status: "scheduled" }, updateTime: "t0" });
  await V.markVoiceStatus(ENV, "m1", { status: "in_progress", startedMs: NOW });
  assert.equal(store.get("fc_voice_calls/m1").fields.status, "in_progress");
  assert.equal(store.get("fc_voice_calls/m1").fields.startedMs, NOW);
});
