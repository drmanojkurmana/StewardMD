/* The OPD dashboard's figures: GET /opd-insights (functions/_opd_insights.js).
 *
 * What these defend:
 *   - "vs yesterday" is yesterday AS IT STOOD at this time, through the same function as today (no two
 *     differently defined numbers subtracted),
 *   - registrations land in the hospital's hour, not UTC's,
 *   - the month strip counts each past day from sessions that already exist, and reading it never creates one,
 *   - the answer names nobody (counts and durations only), and it is queue.view on THIS hospital.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/opd-insights.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, ORG, api, seed, member, staffToken, uidFor, ENV, OWNER_A, HR_A, HR_B, VIEWER_A } from "./helpers/opd-router-harness.mjs";
import { insights, kpisAt, hourly, visitMix, monthDates, prevDate } from "../functions/_opd_insights.js";

const MIN = 60000, H = 3600000;

test("same time yesterday: only what had happened by now minus 24h counts", () => {
  const NOW = Date.parse("2026-09-25T06:30:00Z");       // 12:00 IST
  const Y = NOW - 24 * H;
  const yesterday = [
    { status: "completed", registeredAt: Y - 60 * MIN, consultStartAt: Y - 40 * MIN, consultEndAt: Y - 30 * MIN },
    { status: "completed", registeredAt: Y - 30 * MIN, consultStartAt: Y + 10 * MIN, consultEndAt: Y + 20 * MIN },   // seen AFTER the cutoff
    { status: "completed", registeredAt: Y + 60 * MIN, consultStartAt: Y + 70 * MIN, consultEndAt: Y + 80 * MIN },   // arrived after
    { status: "no_show", registeredAt: Y - 90 * MIN, noShowAt: Y - 10 * MIN },
  ];
  const k = kpisAt(yesterday, Y);
  assert.equal(k.registered, 3, "the afternoon arrival had not come yet");
  assert.equal(k.seen, 1, "the one seen after the cutoff had not been seen yet");
  assert.equal(k.doorToDoctor.medianMin, 20);
  assert.equal(k.abandonedPct, 50, "one completed, one no-show by then");
  const today = [
    { status: "completed", registeredAt: NOW - 50 * MIN, consultStartAt: NOW - 40 * MIN, consultEndAt: NOW - 30 * MIN, visitType: "new" },
    { status: "in_consultation", registeredAt: NOW - 20 * MIN, consultStartAt: NOW - 5 * MIN, visitType: "followup", priority: 1, priorityReason: "senior" },
    { status: "waiting", registeredAt: NOW - 3 * MIN, visitType: "new", priority: 2, priorityReason: "emergency" },
    { status: "no_show", registeredAt: NOW - 80 * MIN, noShowAt: NOW - 30 * MIN },
  ];
  const r = insights({ today, yesterday, month: [{ date: "2026-09-24", tickets: yesterday }], date: "2026-09-25", nowMs: NOW, offsetMin: 330 });
  assert.equal(r.delta.registered, 4 - 3);
  assert.equal(r.delta.seen, 2 - 1);
  assert.equal(r.delta.doorToDoctorMin, r.today.doorToDoctor.medianMin - 20);
  assert.equal(r.recallableNoShows, 1, "marked 30 minutes ago: still inside the recall window");
  assert.equal(r.currentHour, 12, "the hospital's hour (IST), not UTC's 6");
  assert.deepEqual(r.month.map((d) => [d.date, d.registered, d.seen]), [["2026-09-24", 4, 3], ["2026-09-25", 4, 2]]);
  assert.deepEqual(r.mix, { new: 3, followup: 1, priority: { senior: 1, emergency: 1 } });
});

test("hourly buckets on the hospital's clock; the month runs from the 1st to today", () => {
  const nine = Date.parse("2026-09-25T03:40:00Z");   // 09:10 IST
  const h = hourly([{ registeredAt: nine }, { registeredAt: nine + 5 * MIN }, { registeredAt: nine + H }, { registeredAt: 0 }], 330);
  assert.equal(h.length, 24);
  assert.equal(h[9], 2); assert.equal(h[10], 1);
  assert.equal(h.reduce((a, b) => a + b, 0), 3, "a ticket with no arrival time is not put in hour 0");
  assert.deepEqual(monthDates("2026-09-03"), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.equal(prevDate("2026-10-01"), "2026-09-30");
  assert.equal(kpisAt([], Date.now()).abandonedPct, null, "nobody finished is not nobody walked out");
  assert.deepEqual(visitMix([{ visitType: "appointment" }]), { new: 0, followup: 0, appointment: 1, priority: {} });
});

const ORG_A = "org-a", DOCTOR_A = "doctor-a@example.test", RECEPTION_A = "reception-a@example.test";
const ins = (who, org) => api(`/opd-insights?orgId=${org || ORG_A}`, "GET", null, who);

test("GET /opd-insights: the hospital's figures, counts only, and only for its own staff", async () => {
  seed();
  member(ORG_A, DOCTOR_A, "doctor"); member(ORG_A, RECEPTION_A, "reception");
  await ORG.createRoom(ENV, ORG_A, { name: "Room 1", assignment: { mode: "primary", primary: uidFor(DOCTOR_A), doctors: [uidFor(DOCTOR_A)] } }, "seed");
  const reception = await staffToken(ORG_A, RECEPTION_A, "reception");
  for (const name of ["Insight Alpha", "Insight Beta"]) {
    const r = await api("/pool", "POST", { orgId: ORG_A, name, phone: "9000000001" }, reception);
    assert.equal(r.__status, 200, JSON.stringify(r));
  }
  // Yesterday, as the hospital left it: two seen in a session that already exists.
  const yDate = prevDate(new Date(Date.now() + 19800000).toISOString().slice(0, 10)), yNow = Date.now() - 24 * H;
  docs.set("q_sessions/org-a__y", { fields: { hospitalId: ORG_A, doctorUid: "d", date: yDate, status: "active" }, updateTime: "t1" });
  docs.set("q_sessions/org-b__y", { fields: { hospitalId: "org-b", doctorUid: "d", date: yDate, status: "active" }, updateTime: "t1" });
  for (const [id, sid] of [["y1", "org-a__y"], ["y2", "org-a__y"], ["yb", "org-b__y"]])
    docs.set("q_tickets/" + id, { fields: { sessionId: sid, hospitalId: sid.slice(0, 5), status: "completed", registeredAt: yNow - 90 * MIN, consultStartAt: yNow - 60 * MIN, consultEndAt: yNow - 50 * MIN, encName: "enc:Yesterday Person" }, updateTime: "t1" });
  const sessionsBefore = [...docs.keys()].filter((k) => k.startsWith("q_sessions/")).length;

  const r = await ins(VIEWER_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.today.registered, 2);
  assert.equal(r.hourly.reduce((a, b) => a + b, 0), 2, "both registrations are in an hour");
  assert.equal(r.hourly[r.currentHour] >= 0, true);
  assert.equal(r.yesterday.registered, 2, "the other hospital's session on the same day is not counted");
  assert.equal(r.yesterday.seen, 2);
  assert.equal(r.delta.seen, 0 - 2, "nobody seen yet today against two by this time yesterday");
  const last = r.month[r.month.length - 1];
  assert.equal(last.date, r.date); assert.equal(last.registered, 2);
  if (yDate.slice(0, 7) === r.date.slice(0, 7)) assert.equal(r.month.find((d) => d.date === yDate).registered, 2);
  assert.ok(!/Insight|Yesterday Person|enc:|9000000001/.test(JSON.stringify(r)), "counts and durations only: no names or numbers");
  const sessionsAfter = [...docs.keys()].filter((k) => k.startsWith("q_sessions/")).length;
  assert.equal(sessionsAfter, sessionsBefore, "reading the month never creates a session for a past day");

  assert.notEqual((await ins(null)).__status, 200, "signed out is refused");
  assert.equal((await ins(HR_B)).__status, 403, "another hospital's admin is refused");
  assert.equal((await ins(OWNER_A, "org-b")).__status, 403, "an owner of one hospital cannot read another");
});
