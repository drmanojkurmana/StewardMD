/* Plan item 15: the owner's day close.
 *
 * What these defend:
 *   - each room's day is reported apart (who saw how many, how long a consult took, how long patients waited),
 *   - the exceptions an owner asks about are counted: who was put ahead of the queue and why, offline check-ins,
 *   - it names no patient, and it is the owner's and administrator's read, not the desk's,
 *   - money that could not be read is said, never drawn as zero.
 *
 * node --test --experimental-test-module-mocks test/opd-day-close.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayClose } from "../functions/_queue_eta.js";

const NOW = Date.parse("2026-09-25T12:00:00Z"), MIN = 60000;
const done = (sid, door, consult, o) => ({ sessionId: sid, status: "completed", registeredAt: NOW - (door + consult + 30) * MIN, calledAt: NOW - (consult + 30) * MIN, consultStartAt: NOW - (consult + 30) * MIN, consultEndAt: NOW - 30 * MIN, ...(o || {}) });

test("each room apart, busiest first; the exceptions counted by reason; nobody named", () => {
  const rows = [
    done("s1", 20, 8), done("s1", 30, 12, { priority: 1, priorityReason: "senior" }), done("s1", 25, 10),
    done("s2", 60, 15, { priority: 2, priorityReason: "emergency" }), { sessionId: "s2", status: "no_show", registeredAt: NOW - 90 * MIN },
    { sessionId: "pool", status: "waiting", registeredAt: NOW - 5 * MIN, offline: true, token: "OA-1", encName: "enc:Asha" },
  ];
  const c = dayClose(rows, NOW, { s1: { room: "Room 1", doctor: "Dr Rao" }, s2: { room: "Room 2", doctor: "Dr Iyer" }, pool: { room: "Walk-in pool", doctor: "" } });
  assert.equal(c.pulse.registered, 6);
  assert.deepEqual(c.rooms.map((r) => [r.room, r.seen, r.noShow]), [["Room 1", 3, 0], ["Room 2", 1, 1], ["Walk-in pool", 0, 0]]);
  assert.equal(c.rooms[0].consultMedianMin, 10, "the middle consult of the room, not an average");
  assert.equal(c.rooms[0].doctor, "Dr Rao");
  assert.deepEqual(c.priority, { senior: 1, emergency: 1 }, "who went ahead, and why");
  assert.equal(c.offline, 1);
  assert.ok(!/Asha|enc:|OA-1/.test(JSON.stringify(c)), "counts and durations only");
});

const { seedHospital, as, ORG, OTHER_ORG, ADMIN, DOCTOR, NURSE } = await import("./_wardsynq-alert-harness.mjs");

test("GET /day-close: signed out 401, another hospital 403, the desk refused; the owner gets the day with its date", async () => {
  seedHospital();
  assert.equal((await as(null, `/day-close?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(ADMIN, `/day-close?orgId=${OTHER_ORG}`)).__status, 403);
  assert.equal((await as(NURSE, `/day-close?orgId=${ORG}`)).__status, 403, "the day's money is not the desk's read");
  assert.equal((await as(DOCTOR, `/day-close?orgId=${ORG}`)).__status, 200, "a doctor of the hospital holds analytics.view");
  const r = await as(ADMIN, `/day-close?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.close.pulse.registered, 0);
  assert.deepEqual(r.close.rooms, []);
  assert.ok(!/patient|name|mrn/i.test(JSON.stringify(r.close)), "names nobody");
});

test("the console: Close the day for analytics.view, money unread said out loud, rupees in Indian grouping, print", () => {
  const h = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.match(h, /can\("analytics\.view"\)\?'<button class="ghost" id="dayclose">Close the day<\/button>'/);
  assert.match(h, /Do not read this as no takings/);
  assert.match(h, /toLocaleString\("en-IN"\)/);
  assert.match(h, /id="dcPrint"/);
  assert.match(h, /api\("day-close\?orgId="/);
});
