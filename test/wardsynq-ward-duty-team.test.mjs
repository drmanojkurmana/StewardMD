/* Owner decision 2026-09-15: a critical result's level-2 alert goes to the WARD TEAM ON DUTY in the patient's ward,
 * and nurses, residents and consultants mark themselves on or off duty. Through the real routers:
 *   GET/POST /api/queue/roster/duty-status  (the caller's own status; identity from the credential)
 *   GET      /api/queue/roster/duty         (the rota screen: who is on and off duty per ward, staff.admin)
 *   GET      /api/queue/ward/alert-cover    (the ward board: who level 2 would tell now, counts per role)
 * and the level-2 dispatch itself (/api/push/notice/<nid>/decline escalates to the overdue tier).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-ward-duty-team.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  H, docs, seedHospital, as, pushAs, admittedPatient, registerDevice, releasePotassium, loopOf, idFor, sanitize,
  ORG, OTHER_ORG, DOCTOR, NURSE, SUPERVISOR, LAB, ADMIN, OFFDUTY, OTHER_DOCTOR, WARD,
} from "./_wardsynq-alert-harness.mjs";

const ON = { alerts: { push: { enabled: true } } };
const T = "tenant-wsq";
const RESIDENT = "resident@example.test";
const statusDocs = () => [...docs.keys()].filter((k) => k.startsWith("q_duty_status/"));
const dutyEvents = () => [...docs.entries()].filter(([k, d]) => k.startsWith("q_events/") && String(d.fields.action).startsWith("roster:duty_")).map(([, d]) => d.fields);
function seed(cfg) {
  seedHospital(cfg || ON);
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(RESIDENT))}`, { fields: { orgId: ORG, identity: idFor(RESIDENT), role: "resident", active: true }, updateTime: "t1" });
}
const set = (who, body, orgId) => as(who, "/roster/duty-status", "POST", { orgId: orgId || ORG, ...body });

test("POST /api/queue/roster/duty-status refusals: no session 401; someone else's status 403; another hospital 403; a role outside the ward team 403; nothing written", async () => {
  seed();
  assert.equal((await set(null, { status: "off" })).__status, 401);
  const other = await set(NURSE, { status: "off", identity: idFor(OFFDUTY) });
  assert.equal(other.__status, 403, JSON.stringify(other));
  assert.equal(other.error, "not_your_status");
  assert.equal((await set(OTHER_DOCTOR, { status: "off" })).__status, 403, "a doctor of another hospital, at this one");
  assert.equal((await set(NURSE, { status: "off" }, OTHER_ORG)).__status, 403, "this hospital's nurse, at another hospital");
  for (const who of [LAB, SUPERVISOR, ADMIN]) {
    const r = await set(who, { status: "on", unit: WARD });
    assert.equal(r.__status, 403, who + " " + JSON.stringify(r));
    assert.equal(r.error, "not_ward_team");
  }
  // LT-04: READING is allowed to everyone in the hospital (the ward home asks on every open); it says there is
  // no duty status for this role. Only marking duty is the ward team's.
  for (const who of [LAB, ADMIN]) {
    const g = await as(who, "/roster/duty-status?orgId=" + ORG);
    assert.equal(g.__status, 200, who + " " + JSON.stringify(g));
    assert.deepEqual([g.ok, g.notWardTeam, g.status], [true, true, null]);
  }
  assert.equal((await as(null, "/roster/duty-status?orgId=" + ORG)).__status, 401, "no session");
  assert.equal((await as(NURSE, "/roster/duty-status?orgId=" + OTHER_ORG)).__status, 403, "another hospital");
  assert.deepEqual(statusDocs(), []);
  assert.deepEqual(dutyEvents(), []);
});

test("POST /api/queue/roster/duty-status: a rostered nurse goes off duty until her shift ends, audited in the chained event log; a resident with no shift goes on duty for a ward he chooses for 12 hours", async () => {
  seed();
  const off = await set(NURSE, { status: "off" });
  assert.equal(off.__status, 200, JSON.stringify(off));
  assert.equal(off.status.status, "off");
  assert.equal(off.status.basis, "shift", "the harness rosters her on a 12-hour shift now");
  assert.ok(Date.parse(off.status.expiresAt) > Date.now() && Date.parse(off.status.expiresAt) <= Date.now() + 12 * 3600000);
  const row = docs.get(`q_duty_status/${sanitize(ORG)}__${sanitize(idFor(NURSE))}`).fields;
  assert.deepEqual([row.identity, row.status, row.orgId], [idFor(NURSE), "off", ORG]);
  const ev = dutyEvents();
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].action, ev[0].actor, ev[0].hospitalId], ["roster:duty_off", idFor(NURSE), ORG]);
  assert.ok(ev[0].rowHash && ev[0].chainSeq >= 1, "linked into the hospital's event-log chain");

  assert.equal((await set(RESIDENT, { status: "on" })).error, "ward_required", "no shift and no ward chosen");
  const bad = await set(RESIDENT, { status: "on", unit: "Nowhere Ward" });
  assert.deepEqual([bad.__status, bad.error], [422, "unknown_ward"]);
  assert.equal((await set(RESIDENT, { status: "maybe" })).error, "bad_status");
  const on = await set(RESIDENT, { status: "on", unit: WARD });
  assert.equal(on.__status, 200, JSON.stringify(on));
  assert.deepEqual([on.status.status, on.status.unit, on.status.basis], ["on", WARD, "hours"]);
  assert.ok(Math.abs(Date.parse(on.status.expiresAt) - (Date.now() + 12 * 3600000)) < 60000, "12 hours");
  const mine = await as(RESIDENT, "/roster/duty-status?orgId=" + ORG);
  assert.equal(mine.__status, 200);
  assert.deepEqual([mine.status.status, mine.status.unit, mine.rota], ["on", WARD, null]);
  assert.ok(mine.wards.includes(WARD));
  assert.equal(dutyEvents().length, 2);
});

test("POST /api/queue/roster/duty-status: when the audit row cannot be written the status is not written either, and the answer says so", async () => {
  seed();
  // A chain head that cannot be read: the one commit carrying the status and its audit row never happens.
  docs.set(`q_audit_chain_head/${ORG}`, { fields: { seq: "broken", hash: "" }, updateTime: "t1" });
  const r = await set(NURSE, { status: "off" });
  assert.equal(r.__status, 503, JSON.stringify(r));
  assert.equal(r.error, "duty_status_not_saved");
  assert.deepEqual(statusDocs(), []);
});

test("level 2 through the real rota: the nurse marked off duty is not told, the resident marked on duty in the ward is, the notice keeps the rule and the counts per role", async () => {
  seed();
  assert.equal((await set(NURSE, { status: "off" })).__status, 200);
  assert.equal((await set(RESIDENT, { status: "on", unit: WARD })).__status, 200);
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "w".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.2));
  const d = await pushAs(DOCTOR, "/notice/" + loop.notifications[0].nid + "/decline", "POST", {});
  assert.equal(d.escalatedTo, "overdue", JSON.stringify(d));
  const over = (await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).notifications.at(-1);
  assert.ok(!over.recipients.includes(ORG + "~" + idFor(NURSE)), "off duty overrides the rota");
  assert.ok(over.recipients.includes(ORG + "~" + idFor(RESIDENT)), "on duty by his own mark, in this ward");
  assert.ok(over.recipients.includes(ORG + "~" + idFor(DOCTOR)), "the consultant on the rota");
  assert.ok(!over.recipients.includes(ORG + "~" + idFor(OFFDUTY)), "a nurse neither rostered nor marked");
  assert.deepEqual(over.wardRule, { rule: "all-on-duty-ward-team", source: "default", ward: WARD, counts: { nurse: 0, resident: 1, consultant: 1 }, recipients: over.recipients.length });
});

test("GET /api/queue/ward/alert-cover: counts per role now for the ward board; 401 without a session, 403 at another hospital", async () => {
  seed();
  assert.equal((await as(null, "/ward/alert-cover?orgId=" + ORG)).__status, 401);
  assert.equal((await as(OTHER_DOCTOR, "/ward/alert-cover?orgId=" + ORG)).__status, 403);
  const before = await as(LAB, "/ward/alert-cover?orgId=" + ORG + "&ward=" + encodeURIComponent(WARD));
  assert.equal(before.__status, 200, JSON.stringify(before));
  assert.deepEqual(before.wards, [{ rule: "all-on-duty-ward-team", source: "default", ward: WARD, counts: { nurse: 1, resident: 0, consultant: 1 }, total: 2 }]);
  await set(NURSE, { status: "off" });
  await set(DOCTOR, { status: "off" });
  const after = await as(NURSE, "/ward/alert-cover?orgId=" + ORG);
  assert.equal(after.__status, 200);
  const medA = after.wards.find((w) => w.ward === WARD);
  assert.deepEqual([medA.total, medA.counts], [0, { nurse: 0, resident: 0, consultant: 0 }], "a ward with nobody on duty is visible before an alert happens");
  assert.ok(!JSON.stringify(after).includes(idFor(NURSE)), "counts, never names");
  // LT-04: how many shifts the rota defines, so the ward home can tell an admin what to set up.
  assert.ok(after.shiftsDefined >= 1, JSON.stringify(after.shiftsDefined));
  for (const k of [...docs.keys()].filter((x) => x.startsWith("q_roster_shifts/"))) docs.delete(k);
  assert.equal((await as(NURSE, "/ward/alert-cover?orgId=" + ORG)).shiftsDefined, 0, "a rota with no shifts says 0, not unknown");
});

test("GET /api/queue/roster/duty: the manager sees who is on and off duty per ward; a nurse 403; no session 401", async () => {
  seed();
  await set(NURSE, { status: "off" });
  await set(RESIDENT, { status: "on", unit: WARD });
  assert.equal((await as(null, "/roster/duty?orgId=" + ORG)).__status, 401);
  assert.equal((await as(NURSE, "/roster/duty?orgId=" + ORG)).__status, 403);
  const r = await as(ADMIN, "/roster/duty?orgId=" + ORG);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const medA = r.wards.find((w) => w.ward === WARD);
  const by = Object.fromEntries(medA.people.map((p) => [p.identity, p.via]));
  assert.deepEqual([by[idFor(DOCTOR)], by[idFor(SUPERVISOR)], by[idFor(RESIDENT)], by[idFor(NURSE)]], ["rota", "rota", "self", undefined]);
  assert.deepEqual(r.off.map((o) => [o.identity, o.role]), [[idFor(NURSE), "nurse"]]);
});
