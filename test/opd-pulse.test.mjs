/* The OPD pulse: the numbers the desk and the owner act on, hospital-wide. PURE half.
 *
 * What these tests defend is the reason the figures were chosen, not the arithmetic:
 *
 *   - the AVERAGE hides the patient who has been there three hours; median and p90 do not,
 *   - one combined "wait" blames everybody, so it is split into the desk's half and the doctor's,
 *   - the hall is measured LIVE against now, because it is the only half still worth acting on,
 *   - "nobody has finished yet" must never render as "nobody abandoned" (null, not zero).
 *
 * node --test test/opd-pulse.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { opdPulse } from "../functions/_queue_eta.js";

const NOW = Date.parse("2026-09-21T11:00:00.000Z");
const min = (n) => n * 60000;
const t = (o) => ({ status: "completed", registeredAt: 0, calledAt: 0, consultStartAt: 0, consultEndAt: 0, ...o });
// Seen after `door` minutes, of which `desk` were before being called.
const seen = (door, desk, consult) => t({
  registeredAt: NOW - min(door + 60), calledAt: NOW - min(door + 60 - desk),
  consultStartAt: NOW - min(60), consultEndAt: NOW - min(60 - (consult || 10)),
});

test("median and p90, not the average: one three-hour wait is visible instead of averaged away", () => {
  const rows = [seen(10, 4), seen(12, 5), seen(11, 4), seen(10, 3), seen(180, 120)];
  const p = opdPulse(rows, NOW);
  assert.equal(p.doorToDoctor.medianMin, 11, "the middle patient, not dragged up by the outlier");
  assert.equal(p.doorToDoctor.p90Min, 180, "the patient about to complain at the desk is the p90");
  assert.equal(p.doorToDoctor.n, 5);
});

test("the wait is split: the desk's half and the doctor's half are reported apart", () => {
  // Registered 60 min ago, called after 45 (desk), seen 15 min after that (doctor).
  const rows = [t({ registeredAt: NOW - min(60), calledAt: NOW - min(15), consultStartAt: NOW })];
  const p = opdPulse(rows, NOW);
  assert.equal(p.deskWait.medianMin, 45, "door to called is the desk");
  assert.equal(p.doctorWait.medianMin, 15, "called to seen is the doctor");
  assert.equal(p.doorToDoctor.medianMin, 60, "and the whole is still reported");
});

test("the hall is measured live: longest wait and the over-30 and over-60 counts come from now", () => {
  const rows = [
    t({ status: "waiting", registeredAt: NOW - min(75) }),
    t({ status: "registered", registeredAt: NOW - min(40) }),
    t({ status: "called", registeredAt: NOW - min(31) }),
    t({ status: "waiting", registeredAt: NOW - min(5) }),
    t({ status: "completed", registeredAt: NOW - min(200), consultStartAt: NOW - min(190) }),   // gone home, not in the hall
  ];
  const p = opdPulse(rows, NOW);
  assert.equal(p.waiting, 4, "registered, waiting and called are all still in the hall");
  assert.equal(p.waitingNow.longestMin, 75);
  assert.equal(p.waitingNow.over30, 3);
  assert.equal(p.waitingNow.over60, 1);
  /* Nearest-rank, so an even count takes the LOWER middle (5, 31, 40, 75 -> 31), the same rule that
   * makes p90 land on the worst wait rather than interpolating away from it. */
  assert.equal(p.waitingNow.medianMin, 31, "the middle of the people actually sitting there");
});

test("abandonment is a rate over what finished, and is null before anything finishes", () => {
  assert.equal(opdPulse([t({ status: "waiting", registeredAt: NOW })], NOW).abandonedPct, null,
    "nobody has finished yet is not nobody abandoned");
  const p = opdPulse([t({ status: "completed" }), t({ status: "completed" }), t({ status: "completed" }), t({ status: "no_show" })], NOW);
  assert.equal(p.abandonedPct, 25);
  assert.equal(p.noShow, 1);
});

test("open work waiting on a result or a follow-up is counted, and apart from the hall", () => {
  const p = opdPulse([
    t({ status: "investigation", registeredAt: NOW - min(30) }),
    t({ status: "followup", registeredAt: NOW - min(30) }),
    t({ status: "waiting", registeredAt: NOW - min(30) }),
  ], NOW);
  assert.equal(p.held, 2, "sent for a test, or booked back: still the hospital's open work");
  assert.equal(p.waiting, 1, "but not people sitting in the hall");
  assert.equal(p.waitingNow.over30, 1, "and only the one in the hall is counted as waiting 30 minutes");
});

test("an empty OPD reads as empty, never as a zero-minute wait", () => {
  const p = opdPulse([], NOW);
  assert.equal(p.registered, 0);
  assert.equal(p.doorToDoctor.medianMin, null, "no wait was measured, which is not a wait of zero");
  assert.equal(p.waitingNow.longestMin, 0, "nobody is waiting, which IS zero");
  assert.equal(p.abandonedPct, null);
});

test("recalls are counted: a no-show brought back is work the desk did twice", () => {
  assert.equal(opdPulse([t({ recallCount: 2 }), t({ recallCount: 1 }), t({})], NOW).recalls, 3);
});

/* ---- the route: GET /api/queue/opd-pulse ------------------------------------------------------- */

const { seedHospital, as, ORG, OTHER_ORG, ADMIN, DOCTOR } = await import("./_wardsynq-alert-harness.mjs");
const pulse = (who, org) => as(who, `/opd-pulse?orgId=${org || ORG}`);

test("the pulse is the board's summary: same authority, and never another hospital's", async () => {
  seedHospital();
  assert.equal((await pulse(null)).__status, 401, "signed out sees nothing");
  const other = await pulse(ADMIN, OTHER_ORG);
  assert.equal(other.__status, 403, "an admin of one hospital cannot read another's OPD");

  const r = await pulse(ADMIN);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.ok(r.pulse, "the pulse is returned");
  // A hospital with nothing registered today reads as empty, and its waits read as "not measured".
  assert.equal(r.pulse.registered, 0);
  assert.equal(r.pulse.doorToDoctor.medianMin, null);
  assert.equal(r.pulse.abandonedPct, null);
  // It names nobody: this is meant for a screen the whole desk can see.
  const body = JSON.stringify(r.pulse);
  assert.ok(!/patient|name|mrn/i.test(body), "counts and durations only: " + body.slice(0, 200));
});

test("a doctor of the hospital may read it too: it is the queue they are working", async () => {
  seedHospital();
  assert.equal((await pulse(DOCTOR)).__status, 200);
});

/* ---- plan item 6: visits that did not reach the clinical record ------------------------------- */
test("plan item 10: a patient back from a test with the result ready is counted as results back", () => {
  const p = opdPulse([t({ status: "waiting", resultReadyAt: NOW - min(5), registeredAt: NOW - min(90) }), t({ status: "investigation" }), t({ status: "completed", resultReadyAt: NOW })], NOW);
  assert.equal(p.resultsBack, 1, "only one still waiting to be seen with the result");
  assert.equal(p.held, 1, "the other is still at the lab");
});

test("a visit whose record sync failed is counted, so it is seen instead of silently missing", () => {
  const p = opdPulse([t({ encounterSync: "failed" }), t({ encounterSync: "ok" }), t({})], NOW);
  assert.equal(p.syncFailed, 1);
});

test("POST /opd-reconcile: the desk's authority, never another hospital, and it says what it did", async () => {
  seedHospital();
  assert.equal((await as(null, "/opd-reconcile", "POST", { orgId: ORG })).__status, 401);
  assert.equal((await as(ADMIN, "/opd-reconcile", "POST", { orgId: OTHER_ORG })).__status, 403);
  const r = await as(ADMIN, "/opd-reconcile", "POST", { orgId: ORG });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual([r.retried, r.landed, r.stillFailed], [0, 0, 0], "nothing failed, nothing retried");
});
