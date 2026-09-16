/* test/wardsynq-patient-engage.test.mjs - patient reminders (SMS, WhatsApp), portal self-booking and feedback.
 *
 * A mocked-fetch contract test pins the WhatsApp Business Cloud API request to Meta's documented shape, and the
 * real routes are driven: POST /api/queue/ward/connector-save (kind whatsapp), GET and POST
 * /api/queue/ward/comm-preference, GET /api/queue/ward/comm-log, POST /api/queue/ward/comm-run,
 * POST /api/queue/ward/comm-retry, GET /api/queue/ward/feedback-dashboard, POST /api/queue/ward/feedback-recovery,
 * POST /api/portal/booking-options, /api/portal/booking-book, /api/portal/booking-cancel, /api/portal/booking-reschedule,
 * /api/portal/comm-preferences, /api/portal/comm-preference-set, /api/portal/feedback-pending,
 * /api/portal/feedback-open and /api/portal/feedback-submit.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-patient-engage.test.mjs
 */
import { as, seed, docs, H, ENV, T, ORG_ID, ADMIN, NURSE, HR, CASHIER, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("../functions/_wardsynq/patient-messaging.js");
const F = await import("../functions/_wardsynq/patient-feedback.js");
const B = await import("../functions/_wardsynq/online-booking.js");
const { AccessGrant, hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { onRequest: portalRouter } = await import("../functions/api/portal/[[path]].js");

const Q = `?orgId=${ORG_ID}`;
const NOW = new Date().toISOString();
let seq = 0;
async function put(rec) { await H.RECORD.append(T, [{ version: 1, ...rec }], { idempotencyKey: "seed-" + (++seq) + "-" + Math.random() }); }
async function patient(id) { await put({ resourceType: "Patient", id, mrn: "MRN-" + id, name: "Test Patient " + id, dob: "1980-01-01", meta: { recordedAt: NOW } }); }
async function grant(id, patientId, proxy) {
  const token = "tok-" + id;
  await put(AccessGrant({ id, patientId, issuedBy: "dr:1", issuedAt: NOW, codeHash: await hashSecret("00000000", id), redeemedAt: NOW, tokenHash: await hashSecret(token, id), proxy: proxy || null }));
  return { grantId: id, token };
}
async function portal(sub, body) {
  const res = await portalRouter({ request: new Request("https://x/api/portal/" + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: ORG_ID, ...body }) }), env: ENV, params: { path: [sub] } });
  const j = await res.json().catch(() => ({}));
  j.__status = res.status;
  return j;
}
const smsPort = (answers) => { const calls = []; return { calls, missing: [], send: async (to, templateName, vars) => { calls.push({ to, templateName, vars }); return answers.shift() || { ok: true, providerId: "2f-1" }; } }; };
const run = (cfg, ports, extra) => M.runPatientMessaging({ repository: H.RECORD, tenantId: T, orgId: ORG_ID, orgName: "WSQ Ward Hospital", commsCfg: cfg, off: 0, ports, ...(extra || {}) });
const ALWAYS = { start: "00:00", end: "00:00" };
const apptCfg = (over) => ({ enabled: true, quietHours: ALWAYS, portalUrl: "https://wardsynq.example/wardsynq/site/portal.html", types: { appointment: { enabled: true, offsetsHours: [24, 2], smsTemplate: "APPT_REMINDER", whatsappTemplate: "appt_reminder", whatsappLanguage: "en" } }, ...(over || {}) });

/* ---- the WhatsApp adapter's contract ------------------------------------------------------------------------ */

test("contract WhatsApp Cloud API: endpoint, bearer token, template body; only an accepted message is sent", async () => {
  const calls = [];
  const reply = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const [status, body] = reply.shift(); return new Response(JSON.stringify(body), { status }); };
  const spec = M.WHATSAPP_KIND.providers.meta_cloud;
  const args = { settings: { phoneNumberId: "106540352242922", apiVersion: "v21.0" }, secrets: { accessToken: "EAAG-never-leak" }, to: "919876543210", templateName: "appt_reminder", language: "en", params: ["17 Sep 2026 10:30", "WSQ Ward Hospital"], fetchImpl };
  reply.push([200, { messaging_product: "whatsapp", contacts: [{ input: "919876543210", wa_id: "919876543210" }], messages: [{ id: "wamid.HBgM", message_status: "accepted" }] }]);
  assert.deepEqual(await spec.sendTemplate(args), { ok: true, providerId: "wamid.HBgM" });
  assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/106540352242922/messages");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer EAAG-never-leak");
  assert.deepEqual(JSON.parse(calls[0].init.body), { messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "template",
    template: { name: "appt_reminder", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "17 Sep 2026 10:30" }, { type: "text", text: "WSQ Ward Hospital" }] }] } });
  reply.push([200, { messages: [{ id: "wamid.2", message_status: "held_for_quality_assessment" }] }]);
  const held = await spec.sendTemplate(args);
  assert.equal(held.ok, false); assert.equal(held.reason, "PROVIDER_HELD");
  reply.push([400, { error: { code: 132001, message: "Template name does not exist in the translation" } }]);
  const bad = await spec.sendTemplate(args);
  assert.deepEqual([bad.ok, bad.reason, bad.retry], [false, "PROVIDER_REFUSED", false]);
  assert.match(bad.detail, /132001/);
  reply.push([503, {}]);
  assert.equal((await spec.sendTemplate(args)).retry, true);
  assert.equal((await spec.sendTemplate({ ...args, fetchImpl: async () => { throw new Error("down"); } })).reason, "PROVIDER_UNREACHABLE");
  assert.equal(spec.validate({ phoneNumberId: "abc", apiVersion: "v21.0" }, { accessToken: true }), "The phone number ID is digits only.");
  assert.equal(spec.validate({ phoneNumberId: "106540352242922", apiVersion: "v21.0" }, { accessToken: true }), null);
});

test("pure: settings default off, quiet hours wrap midnight, mobile numbers, durations, and a later reminder supersedes an earlier one", () => {
  const s = M.settingsOf({});
  assert.equal(s.enabled, false);
  assert.ok(M.MESSAGE_TYPES.every((t) => s.types[t].enabled === false));
  const q = { start: "21:00", end: "08:00" };
  assert.equal(M.inQuietHours(Date.parse("2026-09-16T22:00:00Z"), 0, q), true);
  assert.equal(M.inQuietHours(Date.parse("2026-09-16T07:59:00Z"), 0, q), true);
  assert.equal(M.inQuietHours(Date.parse("2026-09-16T12:00:00Z"), 0, q), false);
  assert.equal(M.inQuietHours(Date.parse("2026-09-16T16:00:00Z"), 330, q), true, "21:30 at +05:30");
  assert.equal(M.normaliseMobile("98765 43210"), "919876543210");
  assert.equal(M.normaliseMobile("123"), null);
  assert.deepEqual(["5 days", "2 weeks", "1 month", "as needed"].map(M.durationDays), [5, 14, 30, null]);
  const now = Date.parse("2026-09-16T10:00:00Z");
  const appts = [{ id: "a1", patientId: "p1", state: "booked", startAt: "2026-09-17T09:00:00Z" }, { id: "a2", patientId: "p1", state: "booked", startAt: "2026-09-16T11:00:00Z" }, { id: "a3", patientId: "p1", state: "cancelled", startAt: "2026-09-16T11:00:00Z" }];
  const c = M.dueCandidates(M.settingsOf(apptCfg()), { appointments: appts }, now, 0, "H", false);
  assert.deepEqual(c.map((x) => x.key), ["a1-24h", "a2-2h"], "a1 is inside its 24-hour window; a2's 2-hour reminder replaces its 24-hour one; a cancelled one gets none");
  assert.deepEqual(c[0].vars, ["17 Sep 2026 09:00", "H"], "a date and the hospital, nothing clinical");
  const labs = M.dueCandidates(M.settingsOf({ enabled: true, types: { labReady: { enabled: true } } }), { reports: [{ id: "r1", patientId: "p", status: "final", verifiedAt: "2026-09-16T09:00:00Z" }, { id: "r2", patientId: "p", status: "final", critical: true, verifiedAt: "2026-09-16T09:00:00Z" }, { id: "r3", patientId: "p", status: "preliminary" }] }, now, 0, "H", false);
  assert.deepEqual(labs.map((x) => x.key), ["r1"], "never a critical result, never a preliminary one");
});

test("sending: no consent is skipped, sent only on the provider's word, a refusal retries then fails, quiet hours hold, an opt-out stops it", async () => {
  seed();
  const start = new Date(Date.now() + 20 * 3600000).toISOString();
  for (const p of ["p1", "p2", "p3"]) await put({ resourceType: "Appointment", id: "appt-" + p, patientId: p, clinicianId: "dr", startAt: start, minutes: 15, state: "booked" });
  await M.setPreference({ repository: H.RECORD, tenantId: T, patientId: "p2", channel: "sms", optedIn: true, mobile: "9876543210", source: "portal", by: "patient:p2" });
  await M.setPreference({ repository: H.RECORD, tenantId: T, patientId: "p3", channel: "sms", optedIn: true, mobile: "9876500000", source: "portal", by: "patient:p3" });
  const sms = smsPort([]);
  const answer = sms.send;
  sms.send = (to, t, v) => (to === "919876500000" ? (sms.calls.push({ to, templateName: t, vars: v }), Promise.resolve({ ok: false, status: 500 })) : answer(to, t, v));
  const first = await run(apptCfg(), { sms });
  assert.deepEqual([first.created, first.skipped, first.sent, first.failed], [3, 1, 1, 1]);
  const log = await M.messageLog(null, null, { migration: { tenantId: T }, recordDeps: { repository: H.RECORD }, wsqCfg: { patientComms: apptCfg() }, smsMissing: [], whatsappConnected: false });
  const by = Object.fromEntries(log.messages.map((m) => [m.patientId, m]));
  assert.deepEqual([by.p1.status, by.p1.reason], ["skipped", "NO_CONSENT"]);
  assert.equal(by.p2.status, "sent"); assert.equal(by.p2.to, "********3210", "the log masks the number");
  assert.deepEqual([by.p3.status, by.p3.reason], ["retrying", "PROVIDER_REFUSED"], "a 500 is not sent");
  assert.ok(sms.calls.every((c) => c.templateName === "APPT_REMINDER"));
  const again = await run(apptCfg(), { sms });
  assert.deepEqual([again.created, again.sent], [0, 0], "nothing is created or sent twice, and a retry waits its turn");

  // An opt-out between queueing and sending: the retry is skipped, not sent.
  const cur = await H.RECORD.latest(T, M.MESSAGE_TYPE, by.p3.id);
  await H.RECORD.append(T, [{ ...cur, version: cur.version + 1, nextAttemptAt: new Date(Date.now() - 1000).toISOString() }]);
  await M.setPreference({ repository: H.RECORD, tenantId: T, patientId: "p3", channel: "sms", optedIn: false, source: "portal", by: "patient:p3" });
  const third = await run(apptCfg(), { sms });
  assert.equal(third.skipped, 1);
  assert.equal((await H.RECORD.latest(T, M.MESSAGE_TYPE, by.p3.id)).reason, "OPTED_OUT");

  // Quiet hours hold; SMS not configured fails with the reason and is never marked sent.
  seed();
  await put({ resourceType: "Appointment", id: "appt-q", patientId: "q1", clinicianId: "dr", startAt: start, minutes: 15, state: "booked" });
  await M.setPreference({ repository: H.RECORD, tenantId: T, patientId: "q1", channel: "sms", optedIn: true, mobile: "9876543211", source: "portal", by: "patient:q1" });
  const hh = new Date().toISOString().slice(11, 13);
  const held = await run(apptCfg({ quietHours: { start: `${hh}:00`, end: `${String((Number(hh) + 1) % 24).padStart(2, "0")}:00` } }), { sms: smsPort([]) });
  assert.equal(held.held, 1); assert.equal(held.sent, 0);
  const off = await run(apptCfg(), { sms: { missing: ["This hospital's DLT sender ID is not set."], send: async () => { throw new Error("must not be called"); } } });
  assert.equal(off.failed, 1);
  const failed = await H.RECORD.latest(T, M.MESSAGE_TYPE, "msg-appointment-appt-q-24h");
  assert.deepEqual([failed.status, failed.reason, failed.sentAt || null], ["failed", "SMS_NOT_CONFIGURED", null]);
});

test("NEGATIVE routes: no session 401, wrong role 403 with nothing written, another hospital 403", async () => {
  seed();
  await patient("pat-1");
  const before = writesNow();
  assert.equal((await as(null, `/ward/comm-log${Q}`)).__status, 401);
  assert.equal((await as(NURSE, `/ward/comm-log${Q}`)).__status, 403);
  assert.equal((await as(NURSE, "/ward/comm-run", "POST", { orgId: ORG_ID })).__status, 403);
  assert.equal((await as(CASHIER, "/ward/comm-preference", "POST", { orgId: ORG_ID, patientId: "pat-1", channel: "sms", optedIn: true, mobile: "9876543210", note: "form" })).__status, 403);
  assert.equal((await as(NURSE, `/ward/feedback-dashboard${Q}`)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, "/ward/feedback-recovery", "POST", { orgId: ORG_ID, id: "x", status: "resolved", note: "x" })).__status, 403);
  assert.equal((await as(OTHER_ADMIN, "/ward/comm-preference", "POST", { orgId: ORG_ID, patientId: "pat-1", channel: "sms", optedIn: true, mobile: "9876543210", note: "form" })).__status, 403);
  assert.equal(writesNow(), before);
  assert.equal((await portal("comm-preference-set", { grantId: "nope", token: "nope", channel: "sms", optedIn: true, mobile: "9876543210" })).__status, 404, "portal access off: nothing to reach");
});

test("staff record consent with how it was given; WhatsApp connector token sealed and never returned; Send due now sends over WhatsApp", async () => {
  seed({ utcOffsetMinutes: 0, patientComms: apptCfg({ channels: ["whatsapp", "sms"] }) });
  await patient("pat-1");
  assert.equal((await as(NURSE, "/ward/comm-preference", "POST", { orgId: ORG_ID, patientId: "pat-1", channel: "whatsapp", optedIn: true, mobile: "9876543210" })).error, "note_required");
  assert.equal((await as(NURSE, "/ward/comm-preference", "POST", { orgId: ORG_ID, patientId: "ghost", channel: "whatsapp", optedIn: true, mobile: "9876543210", note: "x" })).__status, 404);
  const saved = await as(NURSE, "/ward/comm-preference", "POST", { orgId: ORG_ID, patientId: "pat-1", channel: "whatsapp", optedIn: true, mobile: "9876543210", note: "Signed the messaging consent at registration" });
  assert.equal(saved.__status, 200, saved.__text);
  assert.equal(saved.preference.channels.whatsapp.mobile, "********3210");
  const read = await as(NURSE, `/ward/comm-preference${Q}&patientId=pat-1`);
  assert.equal(read.preference.channels.whatsapp.optedIn, true);

  const conn = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "whatsapp", provider: "meta_cloud", settings: { phoneNumberId: "106540352242922", apiVersion: "v21.0" }, secrets: { accessToken: "EAAG-sealed-token-0001" } });
  assert.equal(conn.__status, 200, conn.__text);
  assert.ok(!conn.__text.includes("EAAG-sealed-token-0001"));
  await put({ resourceType: "Appointment", id: "appt-w", patientId: "pat-1", clinicianId: "dr", startAt: new Date(Date.now() + 3 * 3600000).toISOString(), minutes: 15, state: "booked" });
  const calls = [];
  ENV.WSQ_COMMS_FETCH = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ messages: [{ id: "wamid.OK", message_status: "accepted" }] }), { status: 200 }); };
  try {
    const sent = await as(ADMIN, "/ward/comm-run", "POST", { orgId: ORG_ID });
    assert.equal(sent.__status, 200, sent.__text);
    assert.deepEqual([sent.created, sent.sent], [1, 1]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.Authorization, "Bearer EAAG-sealed-token-0001");
    assert.equal(JSON.parse(calls[0].init.body).to, "919876543210");
  } finally { delete ENV.WSQ_COMMS_FETCH; }
  const log = await as(HR, `/ward/comm-log${Q}`);
  assert.equal(log.__status, 200, log.__text);
  assert.equal(log.whatsappConnected, true);
  assert.equal(log.messages[0].status, "sent");
  assert.ok(!log.__text.includes("9876543210") && !log.__text.includes("EAAG"), "no full number and no token on the screen's data");
  assert.ok(log.readiness.appointment.sms.length >= 1, "SMS names what is missing (the API key and sender here)");
  assert.equal((await as(ADMIN, "/ward/comm-retry", "POST", { orgId: ORG_ID, id: log.messages[0].id })).error, "not_retryable");
});

test("feedback: an invitation per finished stay, the link opens one survey, a low score reaches service recovery", async () => {
  const fb = { enabled: true, lowScoreAtOrBelow: 6, surveys: { discharge: { questions: [{ id: "food", text: "How was the food?", kind: "rating5" }] } } };
  seed({ feedback: fb, patientComms: { enabled: true, quietHours: ALWAYS, portalUrl: "https://wardsynq.example/wardsynq/site/portal.html", types: { feedback: { enabled: true, smsTemplate: "FEEDBACK" } } }, alerts: { sms: { senderId: "WSQHSP" } } });
  await put({ resourceType: "Encounter", id: "enc-1", patientId: "pat-1", class: "IPD", status: "finished", periodStart: "2026-09-10T00:00:00Z", periodEnd: new Date(Date.now() - 3600000).toISOString(), location: { ward: "Ward A" } });
  await M.setPreference({ repository: H.RECORD, tenantId: T, patientId: "pat-1", channel: "sms", optedIn: true, mobile: "9876543210", source: "portal", by: "patient:pat-1" });
  const sms = smsPort([]);
  const r = await M.runPatientMessaging({ repository: H.RECORD, tenantId: T, orgId: ORG_ID, orgName: "WSQ Ward Hospital", commsCfg: { enabled: true, quietHours: ALWAYS, portalUrl: "https://wardsynq.example/wardsynq/site/portal.html", types: { feedback: { enabled: true, smsTemplate: "FEEDBACK" } } }, feedbackCfg: fb, off: 0, ports: { sms } });
  assert.deepEqual([r.invites, r.sent], [1, 1]);
  assert.equal((await M.runPatientMessaging({ repository: H.RECORD, tenantId: T, orgId: ORG_ID, orgName: "H", commsCfg: { enabled: true, quietHours: ALWAYS, types: { feedback: { enabled: true, smsTemplate: "FEEDBACK" } } }, feedbackCfg: fb, off: 0, ports: { sms } })).invites, 0, "one invitation per stay");
  const link = sms.calls[0].vars[1];
  const token = /survey=([A-Za-z0-9_-]+)/.exec(link)[1];
  assert.ok(link.startsWith("https://wardsynq.example/wardsynq/site/portal.html#org=org-wsq&survey="));
  const opened = await portal("feedback-open", { surveyToken: token });
  assert.equal(opened.__status, 200, JSON.stringify(opened));
  assert.equal(opened.state, "open"); assert.equal(opened.survey.questions[0].text, "How was the food?");
  assert.ok(!JSON.stringify(opened).includes("pat-1"), "the survey page never learns who the patient is");
  assert.equal((await portal("feedback-open", { surveyToken: "x".repeat(32) })).__status, 404);
  assert.equal((await portal("feedback-submit", { surveyToken: token, answers: { nps: 11 } })).error, "bad_answers");
  const done = await portal("feedback-submit", { surveyToken: token, answers: { nps: 3, comment: "Waited four hours for discharge papers", answers: { food: 2 } } });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal((await portal("feedback-submit", { surveyToken: token, answers: { nps: 9 } })).__status, 409, "answered once");
  const dash = await as(ADMIN, `/ward/feedback-dashboard${Q}`);
  assert.equal(dash.__status, 200, dash.__text);
  assert.deepEqual([dash.responses, dash.nps, dash.byDepartment[0].department, dash.recoveryQueue.length], [1, -100, "Ward A", 1]);
  const id = dash.recoveryQueue[0].id;
  assert.equal((await as(ADMIN, "/ward/feedback-recovery", "POST", { orgId: ORG_ID, id, status: "resolved" })).error, "note_required");
  assert.equal((await as(ADMIN, "/ward/feedback-recovery", "POST", { orgId: ORG_ID, id, status: "resolved", note: "Called the family and apologised; discharge paperwork now starts at the morning round" })).__status, 200);
  assert.equal((await as(ADMIN, `/ward/feedback-dashboard${Q}`)).recoveryQueue.length, 0);
});

/* ---- online booking ---------------------------------------------------------------------------------------- */

const SESSION_CFG = { enabled: true, minHoursBefore: 1, maxDaysAhead: 2, cancelHoursBefore: 2, rescheduleHoursBefore: 2, maxUpcoming: 2,
  sessions: [{ id: "gm", clinicianId: "dr-rao", clinicianName: "Dr Rao", department: "General medicine", weekdays: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:30", slotMinutes: 30 }] };

test("pure booking: only published slots from the notice onward, and a slot held by an appointment or a blackout is not free", () => {
  const s = B.bookingSettings(SESSION_CFG);
  const now = Date.parse("2026-09-16T10:10:00Z");
  const slots = B.publishedSlots(s, now, 0);
  assert.equal(slots[0].startAt, "2026-09-16T11:30:00.000Z", "one hour's notice, on the slot grid");
  assert.ok(slots.every((x) => x.clinicianId === "dr-rao" && x.minutes === 30));
  const free = B.freeSlots(slots.slice(0, 3), [{ clinicianId: "dr-rao", state: "booked", startAt: "2026-09-16T11:30:00.000Z", minutes: 30 }, { clinicianId: "dr-rao", state: "cancelled", startAt: "2026-09-16T12:00:00.000Z", minutes: 30 }],
    [{ subjectId: "dr-rao", state: "active", from: "2026-09-16T12:30:00.000Z", to: "2026-09-16T13:00:00.000Z" }]);
  assert.deepEqual(free.map((x) => x.startAt).slice(0, 1), ["2026-09-16T12:00:00.000Z"]);
  assert.equal(B.bookingSettings({ enabled: true, sessions: [{ clinicianId: "x", department: "d", weekdays: [1], start: "12:00", end: "09:00" }] }).sessions.length, 0, "a session that ends before it starts is ignored");
});

test("portal booking: book a published slot, two patients racing for one slot get one booking, cancel and reschedule within the rules", async () => {
  seed({ patientAccess: { enabled: true }, onlineBooking: SESSION_CFG, utcOffsetMinutes: 0 });
  const a = await grant("g-a", "pat-a"), b = await grant("g-b", "pat-b");
  const proxy = await grant("g-p", "pat-a", { relatedPersonId: "rp-1", name: "Son", relationship: "son", sections: ["bills"] });
  assert.equal((await portal("booking-options", { grantId: "g-a", token: "wrong" })).__status, 401);
  assert.equal((await portal("booking-options", proxy)).__status, 403, "a proxy without the appointments section");
  const opts = await portal("booking-options", a);
  assert.equal(opts.__status, 200, JSON.stringify(opts));
  assert.equal(opts.enabled, true); assert.deepEqual(opts.departments, ["General medicine"]);
  const slot = opts.slots[2];
  assert.equal((await portal("booking-book", { ...a, clinicianId: "dr-rao", startAt: new Date(Date.parse(slot.startAt) + 60000).toISOString() })).error, "not_a_published_slot");
  const [ra, rb] = await Promise.all([portal("booking-book", { ...a, clinicianId: "dr-rao", startAt: slot.startAt }), portal("booking-book", { ...b, clinicianId: "dr-rao", startAt: slot.startAt })]);
  const oks = [ra, rb].filter((x) => x.ok);
  assert.equal(oks.length, 1, JSON.stringify([ra, rb]));
  assert.equal([ra, rb].find((x) => !x.ok).error, "slot_taken");
  const winner = ra.ok ? a : b;
  const appts = (await H.RECORD.latestByType(T, "Appointment", 100)).filter((x) => x.state === "booked");
  assert.equal(appts.length, 1, "no double booking");
  assert.equal(appts[0].bookedVia, "portal");
  const after = await portal("booking-options", winner);
  assert.ok(!after.slots.some((x) => x.startAt === slot.startAt), "the booked slot is no longer offered");
  const mine = after.mine[0];
  assert.deepEqual([mine.canCancel, mine.canReschedule], [true, true]);
  const moved = await portal("booking-reschedule", { ...winner, appointmentId: mine.appointmentId, clinicianId: "dr-rao", startAt: opts.slots[5].startAt });
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  const now = await portal("booking-options", winner);
  assert.equal(now.mine.length, 1); assert.equal(now.mine[0].startAt, opts.slots[5].startAt);
  assert.ok(now.slots.some((x) => x.startAt === slot.startAt), "the old slot is offered again");
  const loser = ra.ok ? b : a;
  assert.equal((await portal("booking-cancel", { ...loser, appointmentId: now.mine[0].appointmentId })).__status, 404, "another patient's appointment");
  // An appointment the desk booked is changed by the desk.
  await put({ resourceType: "Appointment", id: "desk-1", patientId: winner === a ? "pat-a" : "pat-b", clinicianId: "dr-rao", startAt: opts.slots[8].startAt, minutes: 30, state: "booked" });
  assert.equal((await portal("booking-cancel", { ...winner, appointmentId: "desk-1" })).error, "booked_by_hospital");
  assert.equal((await portal("booking-cancel", { ...winner, appointmentId: now.mine.find((x) => x.online).appointmentId })).__status, 200);
});

test("portal consent and pending surveys: the patient sets their own, a proxy may look and may not change", async () => {
  seed({ patientAccess: { enabled: true }, feedback: { enabled: true } });
  const me = await grant("g-me", "pat-me");
  const proxy = await grant("g-px", "pat-me", { relatedPersonId: "rp-2", name: "Daughter", relationship: "daughter", sections: ["messages"] });
  const set = await portal("comm-preference-set", { ...me, channel: "sms", optedIn: true, mobile: "9876543210" });
  assert.equal(set.__status, 200, JSON.stringify(set));
  assert.equal((await H.RECORD.latest(T, M.PREFERENCE_TYPE, "pref-pat-me")).channels.sms.source, "portal");
  assert.equal((await portal("comm-preference-set", { ...proxy, channel: "sms", optedIn: false })).__status, 403);
  const seen = await portal("comm-preferences", proxy);
  assert.deepEqual([seen.preference.channels.sms.optedIn, seen.canChange], [true, false]);
  const pending = await portal("feedback-pending", me);
  assert.deepEqual([pending.__status, pending.surveys], [200, []]);
});
