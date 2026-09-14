/* S3 P0 server alert path: a critical result, released with the hospital's push setting on, reaches the
 * right clinicians' phones as a thin push; with it off nothing is sent. PUSH-01, 02, 03, 06, 07, 08 and the
 * SMS fallback (owner decision O4). Real routers: /api/queue/ward/release-result, /api/queue/ward/acknowledge,
 * /api/queue/ops/tick-all, /api/queue/ward/alert-status, /api/push/register-member, /api/push/notice/<nid>/decline.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-alert-dispatch.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  H, ENV, KV, sent, docs, seedHospital, as, pushAs, admittedPatient, registerDevice, releasePotassium, loopOf, tickAll, idFor, OFFDUTY,
  ORG, DOCTOR, NURSE, SUPERVISOR, LAB, ADMIN, PATIENT_NAME, WARD, BED,
} from "./_wardsynq-alert-harness.mjs";
// Loaded after the harness has registered its module mocks: a static import would link the real Firestore first.
const { runTick } = await import("../functions/_wardsynq/ops-tick.js");
const { notifyDepsFor } = await import("../functions/_wardsynq/alert-deps.js");
const { thinPayload, PAYLOAD_KEYS } = await import("../functions/_wardsynq/push-alerts.js");
const { sendNativeToTokens } = await import("../functions/_nativepush.js");

const ON = { alerts: { push: { enabled: true } } };
const T = "tenant-wsq";
const apns = () => sent.filter((s) => s.kind === "apns");

test("PUSH-01: a critical result with alerts on is pushed to the resolved clinicians, recorded on the loop as SENT, never delivered", async () => {
  seedHospital(ON);
  const p = await admittedPatient();
  const reg = await registerDevice(DOCTOR, "a".repeat(64));
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const r = await releasePotassium(p, 7.2);
  assert.equal(r.criticalCheck.checked, true);
  const loop = await loopOf(r);
  assert.equal(loop.notifications.length, 1, JSON.stringify(loop.notifications));
  const n = loop.notifications[0];
  assert.match(n.nid, /^[0-9a-f]{32}$/);
  assert.equal(n.level, "due");
  assert.ok(n.recipients.includes(ORG + "~" + idFor(DOCTOR)), "the ordering doctor, who is also on duty");
  assert.ok(!n.recipients.includes(ORG + "~" + idFor(NURSE)), "a nurse is not on the due tier");
  assert.equal(n.sent, 1); assert.equal(n.total, 1);
  assert.equal(loop.notification.channels[0].channel, "mobile");
  assert.equal(loop.notification.delivered, false, "a gateway accepting is SENT, not delivered");
  assert.notEqual(loop.notification.reason, "NO_CHANNEL");
  assert.equal(apns().length, 1);
  assert.ok(await KV.current.get("push:notice:" + n.nid), "the nid resolves server-side");
  assert.equal(loop.state, "open", "sending acknowledges nothing");
});

test("flag off: nothing is sent, no notice is minted, and the loop says NO_CHANNEL as before", async () => {
  seedHospital({});
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "b".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.3));
  assert.equal(apns().length, 0);
  assert.equal(loop.notification.reason, "NO_CHANNEL");
  assert.deepEqual(loop.notifications, []);
  assert.equal([...KV.current.m.keys()].filter((k) => k.startsWith("push:notice:")).length, 0);
});

test("PUSH-02: nobody resolved is recorded as NO_RECIPIENT, the loop stays open, and the Admin status lists it", async () => {
  seedHospital({ ...ON, criticalEscalation: { levels: { due: { orderer: false, roles: [] } } } });
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "c".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.4));
  assert.equal(loop.notification.reason, "NO_RECIPIENT");
  assert.equal(loop.notification.delivered, false);
  assert.equal(loop.notifications[0].reason, "NO_RECIPIENT");
  assert.equal(loop.state, "open");
  assert.equal(apns().length, 0);
  const st = await as(ADMIN, "/ward/alert-status?orgId=" + ORG);
  assert.equal(st.__status, 200, JSON.stringify(st));
  assert.equal(st.enabled, true);
  assert.ok(st.failures.some((f) => f.loopId === loop.id && f.reason === "NO_RECIPIENT"));
  assert.equal(st.levels.hospitalSet, true);
  assert.equal(st.levels.approval, null, "a hospital's own ladder does not carry the defaults' sign-off");
  assert.equal(st.defaults.approval.approvedBy, "Dr Manoj Kurmana");
  assert.ok(!JSON.stringify(st).includes(PATIENT_NAME) && !JSON.stringify(st).includes(p.mrn), "ids only on the Admin status");
});

test("PUSH-03: what crosses APNs and FCM carries five data keys, ward and bed in the text, and never the patient", async () => {
  assert.deepEqual(Object.keys(thinPayload("critical", "f".repeat(32), { ward: WARD, bed: BED }).data).sort(), [...PAYLOAD_KEYS].sort());
  assert.equal(thinPayload("free text <b>", "x").title, "WardSynQ: urgent result", "titles come from the fixed table");
  seedHospital(ON);
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "d".repeat(64));
  await releasePotassium(p, 7.5);
  const wire = apns()[0];
  const body = JSON.parse(wire.body);
  assert.deepEqual(Object.keys(body).sort(), ["aps", "kind", "nid", "type", "url", "urgency", "v"].sort());
  assert.equal(body.aps.alert.body, `Ward ${WARD}, bed ${BED}. Open StewardMD to view.`);
  for (const phi of [PATIENT_NAME, "Alertpath", p.mrn, p.patientId, "7.5", "Potassium", "WSQ Ward Hospital"]) {
    assert.ok(!wire.body.includes(phi), "APNs payload must not contain " + phi);
  }
  // The same message through FCM, as an Android token would receive it.
  sent.length = 0;
  await sendNativeToTokens(ENV, [{ key: "push:native:x", token: "android-token", platform: "android" }], thinPayload("critical", "e".repeat(32), { ward: WARD, bed: BED }));
  const fcm = JSON.parse(sent.find((s) => s.kind === "fcm").body).message;
  assert.deepEqual(Object.keys(fcm.data).sort(), ["kind", "nid", "tag", "type", "url", "urgency", "v"].sort());
  assert.ok(!JSON.stringify(fcm).includes(PATIENT_NAME));
});

test("PUSH-06: acknowledging (human, with an action) stops every further push for the loop", async () => {
  seedHospital(ON);
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "g".repeat(64));
  const r = await releasePotassium(p, 7.6, 45);
  const loop = await loopOf(r);
  const noAction = await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: loop.id });
  assert.equal(noAction.__status, 422, "an acknowledgement needs the sentence saying what was done");
  const ack = await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: loop.id, action: "Repeat K sent, ECG done, calcium gluconate given." });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  sent.length = 0;
  const t = await tickAll();
  assert.equal(t.__status, 200, JSON.stringify(t));
  assert.equal(apns().length, 0, "an acknowledged loop is never chased");
  const d = await pushAs(DOCTOR, "/notice/" + loop.notifications[0].nid + "/decline", "POST", {});
  assert.equal(d.__status, 409, "nothing to pass on once acknowledged");
});

test("PUSH-07: declining sends the next tier at once; the tiers are cumulative; the top tier has nobody further", async () => {
  seedHospital({ ...ON, criticalEscalation: { levels: { escalate: { contacts: [idFor(ADMIN)] } } } });
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "h".repeat(64));
  await registerDevice(NURSE, "i".repeat(64));
  await registerDevice(SUPERVISOR, "j".repeat(64));
  await registerDevice(ADMIN, "k".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.7));
  sent.length = 0;
  const d = await pushAs(DOCTOR, "/notice/" + loop.notifications[0].nid + "/decline", "POST", { reason: "In theatre" });
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.equal(d.escalatedTo, "overdue");
  let l = await H.RECORD.latest(T, "CriticalResultLoop", loop.id);
  assert.equal(l.escalatedLevel, "overdue");
  assert.equal(l.escalations.at(-1).cause, "declined");
  const over = l.notifications.at(-1);
  assert.equal(over.level, "overdue");
  for (const who of [DOCTOR, NURSE, SUPERVISOR]) assert.ok(over.recipients.includes(ORG + "~" + idFor(who)), "overdue tells " + who);
  assert.ok(!over.recipients.includes(ORG + "~" + idFor(ADMIN)), "named contacts wait for the top tier");
  assert.equal(apns().length, 3);
  assert.ok(l.notifications[0].receipts.some((x) => x.kind === "declined" && x.by === ORG + "~" + idFor(DOCTOR)));

  const d2 = await pushAs(NURSE, "/notice/" + over.nid + "/decline", "POST", {});
  assert.equal(d2.escalatedTo, "escalate");
  l = await H.RECORD.latest(T, "CriticalResultLoop", loop.id);
  assert.ok(l.notifications.at(-1).recipients.includes(ORG + "~" + idFor(ADMIN)));
  const d3 = await pushAs(ADMIN, "/notice/" + l.notifications.at(-1).nid + "/decline", "POST", {});
  assert.equal(d3.__status, 200);
  assert.equal(d3.escalatedTo, null);
  assert.match(d3.detail, /top of the ladder/);
  assert.equal((await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).state, "open");
});

test("level 2 nurse rule (owner 2026-09-14): the real rota; the off-duty nurse and a nurse on duty in another ward are not told; the notice names the rule and the counts", async () => {
  seedHospital({ ...ON, criticalEscalation: { level2NurseRule: "all-on-duty-nurses-in-ward" } });
  // A nurse on duty now in Surgical B, around the clock, as the harness rosters Medical A.
  docs.set(`q_members/${ORG}__surg-nurse`, { fields: { orgId: ORG, identity: "surg-nurse", role: "nurse", active: true }, updateTime: "t1" });
  for (const [id, start, end] of [["sday", "00:00", "12:00"], ["snight", "12:00", "00:00"]]) {
    docs.set(`q_roster_shifts/${ORG}__${id}`, { fields: { orgId: ORG, shiftId: id, name: id, unit: "Surgical B", start, end, minimum: {}, active: true }, updateTime: "t1" });
    for (const n of [-1, 0, 1]) {
      const day = new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      docs.set(`q_roster_assign/s-${id}-${n}`, { fields: { orgId: ORG, orgMonth: ORG + "|" + day.slice(0, 7), identity: "surg-nurse", date: day, shiftId: id, status: "active" }, updateTime: "t1" });
    }
  }
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "p".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.2));
  assert.equal(loop.notifications[0].wardRule, undefined, "level 1 has no ward rule");
  const d = await pushAs(DOCTOR, "/notice/" + loop.notifications[0].nid + "/decline", "POST", {});
  assert.equal(d.escalatedTo, "overdue", JSON.stringify(d));
  const over = (await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).notifications.at(-1);
  assert.ok(over.recipients.includes(ORG + "~" + idFor(NURSE)), "the nurse on duty in the patient's ward");
  assert.ok(!over.recipients.includes(ORG + "~" + idFor(OFFDUTY)), "a nurse with no shift now");
  assert.ok(!over.recipients.includes(ORG + "~nurse1"), "a nurse member who is not rostered");
  assert.ok(!over.recipients.includes(ORG + "~surg-nurse"), "a nurse on duty in another ward");
  assert.deepEqual(over.wardRule, { rule: "all-on-duty-nurses-in-ward", source: "hospital", key: "level2NurseRule", ward: WARD, counts: { nurse: 1 }, recipients: over.recipients.length });
  const st = await as(ADMIN, "/ward/alert-status?orgId=" + ORG);
  assert.deepEqual([st.wardRule.rule, st.wardRule.source, st.wardRule.key], ["all-on-duty-nurses-in-ward", "hospital", "level2NurseRule"]);
  assert.match(st.wardRule.note, /until a Nurse-in-Charge role or assignment is implemented/);
});

test("level 2 with nobody of the ward team on duty in the ward and no other recipient on the tier: NO_RECIPIENT, loud, with zero per role named", async () => {
  seedHospital({ ...ON, criticalEscalation: { levels: { due: { orderer: false, roles: [] }, overdue: { orderer: false, roles: ["nurse"] } } } });
  // The ward's rostered nurse and doctor come off the rota: only the supervisor, who is not in the ward team, is left.
  for (const k of [...docs.keys()]) if (k.startsWith("q_roster_assign/") && [idFor(NURSE), idFor(DOCTOR)].includes(docs.get(k).fields.identity)) docs.delete(k);
  const p = await admittedPatient();
  const loop = await loopOf(await releasePotassium(p, 7.3, 45));
  assert.equal(loop.notifications[0].reason, "NO_RECIPIENT");
  const t = await tickAll();
  assert.equal(t.__status, 200, JSON.stringify(t));
  const l = await H.RECORD.latest(T, "CriticalResultLoop", loop.id);
  const over = l.notifications.at(-1);
  assert.equal(over.level, "overdue", JSON.stringify(l.notifications));
  assert.equal(over.reason, "NO_RECIPIENT");
  assert.deepEqual(over.recipients, []);
  assert.deepEqual(over.wardRule, { rule: "all-on-duty-ward-team", source: "default", ward: WARD, counts: { nurse: 0, resident: 0, consultant: 0 }, recipients: 0 });
  assert.equal(l.state, "open");
  const st = await as(ADMIN, "/ward/alert-status?orgId=" + ORG);
  assert.ok(st.failures.some((f) => f.loopId === loop.id && f.level === "overdue" && f.reason === "NO_RECIPIENT"), "named on the Admin card");
});

test("PUSH-08: the worker tick escalates with nobody using the ward; refuses anyone but the worker; WSQ_TICK_OFF stops it", async () => {
  seedHospital(ON);
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "l".repeat(64));
  await registerDevice(NURSE, "m".repeat(64));
  const r = await releasePotassium(p, 7.8, 45);
  const before = await loopOf(r);
  sent.length = 0;

  assert.equal((await tickAll({})).__status, 401, "no credential");
  const staff = await tickAll({ "Cf-Access-Authenticated-User-Email": ADMIN });
  assert.equal(staff.__status, 403, "a hospital admin is not the worker");
  assert.equal((await H.RECORD.latest(T, "CriticalResultLoop", before.id)).version, before.version, "nothing written by a refused tick");

  ENV.WSQ_TICK_OFF = "1";
  try {
    const off = await tickAll();
    assert.equal(off.skipped, "WSQ_TICK_OFF");
    assert.equal(apns().length, 0);
  } finally { delete ENV.WSQ_TICK_OFF; }

  const t = await tickAll();
  assert.equal(t.__status, 200, JSON.stringify(t));
  assert.equal(t.results.find((x) => x.orgId === ORG).escalated, 1);
  const after = await H.RECORD.latest(T, "CriticalResultLoop", before.id);
  assert.equal(after.escalatedLevel, "overdue");
  assert.equal(after.notifications.at(-1).level, "overdue");
  assert.equal(apns().length, 2, "doctor and nurse phones");
});

test("O4 SMS fallback: a push no phone confirmed within its window goes by SMS once, ward and bed only; a delivered receipt stops it", async () => {
  const sms = { senderId: "WSQHSP", templateName: "WSQ_CRITICAL" };
  seedHospital({ alerts: { push: { enabled: true }, sms } });
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "n".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.9));
  sent.length = 0;
  const org = { id: ORG, wardsynq: { alerts: { push: { enabled: true }, sms } } };
  const later = Date.now() + 29 * 60000;
  await runTick(H.RECORD, T, { nowMs: later, notifyDeps: notifyDepsFor(ENV, org, T, H.RECORD) });
  assert.equal(sent.filter((s) => s.kind === "sms").length, 0, "inside the window nothing is texted");

  const t = await runTick(H.RECORD, T, { nowMs: Date.now() + 31 * 60000, notifyDeps: notifyDepsFor(ENV, org, T, H.RECORD) });
  const texts = sent.filter((s) => s.kind === "sms");
  assert.equal(texts.length, 1, JSON.stringify(t));
  const form = new URLSearchParams(texts[0].body);
  assert.equal(form.get("From"), "WSQHSP"); assert.equal(form.get("TemplateName"), "WSQ_CRITICAL");
  assert.equal(form.get("To"), "9876500001");
  assert.equal(form.get("VAR1"), WARD); assert.equal(form.get("VAR2"), BED);
  assert.ok(!texts[0].body.includes("Alertpath") && !texts[0].body.includes(p.mrn));
  const l = await H.RECORD.latest(T, "CriticalResultLoop", loop.id);
  assert.equal(l.notifications[0].sms.sent, 1);
  await runTick(H.RECORD, T, { nowMs: Date.now() + 33 * 60000, notifyDeps: notifyDepsFor(ENV, org, T, H.RECORD) });
  assert.deepEqual((await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).notifications[0].sms, l.notifications[0].sms, "once per notice");

  // A second loop whose phone said delivered is not texted.
  const loop2 = await loopOf(await releasePotassium(p, 115, 0, "Sodium"));
  const rc = await pushAs(DOCTOR, "/wardsynq-receipt", "POST", { noticeId: loop2.notifications[0].nid, kind: "delivered" });
  assert.equal(rc.__status, 200, JSON.stringify(rc));
  sent.length = 0;
  await runTick(H.RECORD, T, { nowMs: Date.now() + 31 * 60000, notifyDeps: notifyDepsFor(ENV, org, T, H.RECORD) });
  assert.equal(sent.filter((s) => s.kind === "sms").length, 0);
});

test("O4 SMS not configured: recorded on the notice and named exactly on the Admin status", async () => {
  seedHospital(ON);
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "o".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.1));
  const org = { id: ORG, wardsynq: ON };
  const env = { ...ENV, TWOFACTOR_API_KEY: "" };
  Object.defineProperty(env, "PUSH_KV", { get: () => KV.current });
  await runTick(H.RECORD, T, { nowMs: Date.now() + 31 * 60000, notifyDeps: notifyDepsFor(env, org, T, H.RECORD) });
  const n = (await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).notifications[0];
  assert.equal(n.sms.reason, "SMS_NOT_CONFIGURED");
  assert.ok(n.sms.missing.some((m) => /TWOFACTOR_API_KEY/.test(m)));
  assert.ok(n.sms.missing.some((m) => /sender ID/.test(m)) && n.sms.missing.some((m) => /template name/.test(m)));
  assert.equal(sent.filter((s) => s.kind === "sms").length, 0);
  const st = await as(ADMIN, "/ward/alert-status?orgId=" + ORG);
  assert.equal(st.sms.ready, false);
  assert.ok(st.sms.missing.some((m) => /template name/.test(m)));
  assert.ok(st.failures.some((f) => f.sms && f.reason === "SMS_NOT_CONFIGURED"));
  assert.equal(st.levels.approval.decision, "O5", "the defaults carry the owner's sign-off");
});

test("GET /api/queue/ward/alert-status: phones are read from the device registrations of everyone on duty and every named contact; a failed read says so", async () => {
  seedHospital({ ...ON, criticalEscalation: { levels: { escalate: { contacts: ["cmo-contact"] } } } });
  await registerDevice(DOCTOR, "d".repeat(64));
  const st = await as(ADMIN, "/ward/alert-status?orgId=" + ORG);
  assert.equal(st.__status, 200, JSON.stringify(st));
  assert.equal(st.phones.ok, true, JSON.stringify(st.phones));
  assert.deepEqual(st.phones.noDevice.map((p) => [p.identity, p.why, p.role]).sort(), [
    [idFor(NURSE), "on duty", "nurse"], [idFor(SUPERVISOR), "on duty", "supervisor"], ["cmo-contact", "named contact", null],
  ].sort(), "no alert has been sent, yet the people the ladder would tell without a phone are listed");
  assert.equal(st.phones.checked, 4, "doctor, nurse, supervisor on duty and the contact; the off-duty nurse and the lab are not on the ladder now");
  assert.deepEqual(st.noDevice, [], "the per-alert list is still only what alerts recorded");

  const get = KV.current.get;
  KV.current.get = async (k, t) => { if (String(k).startsWith("push:who:")) throw new Error("kv down"); return get(k, t); };
  try {
    const down = await as(ADMIN, "/ward/alert-status?orgId=" + ORG);
    assert.equal(down.__status, 200);
    assert.equal(down.phones.ok, false, "a failed read is a failure, never an empty list");
    assert.equal(down.phones.noDevice, undefined);
  } finally { KV.current.get = get; }
  assert.equal((await as(null, "/ward/alert-status?orgId=" + ORG)).__status, 401);
  assert.equal((await as(NURSE, "/ward/alert-status?orgId=" + ORG)).__status, 403, "still staff.admin only");
});
