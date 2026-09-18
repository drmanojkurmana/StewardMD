/* test/wardsynq-booking-window.test.mjs - the clash check reads the diary it needs, not the whole history (R6-4).
 *
 * The real route is driven: POST /api/queue/ward/book.
 *
 * Two things are pinned here, and the second is the one that matters clinically:
 *  - a hospital whose diary is past the old 50,000-record ceiling can still book, and a clash in the
 *    next fortnight is still refused, in a couple of pages rather than the whole type;
 *  - an appointment AMENDED while that newest-first read is walking (which the read itself can miss,
 *    repository.js:302-306) still refuses the double booking, because the last look before the append
 *    re-reads the newest page.
 *
 * The three adapters' newest-first paging is pinned in test/wardsynq-repository-window.test.mjs (R5-3).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-booking-window.test.mjs
 */
import { as, seed, H, T, NURSE } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const RW = await import("../functions/_wardsynq/read-window.js");

const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400000;
const TOMORROW = iso(Date.now() + DAY);

function appt(i, over) {
  const at = iso(Date.now() - (400 + i) * DAY);
  return {
    resourceType: "Appointment", id: "wsq-appt-old-" + i, version: 1,
    patientId: "p-old-" + i, clinicianId: "dr-b", startAt: at, minutes: 15, state: "completed",
    meta: { recordedAt: at }, writtenBy: { id: "seed", kind: "human", at },
    ...(over || {}),
  };
}

/** A diary bigger than the old read could hold, with the near-future appointments written last. */
async function seedDiary(count, extra) {
  seed({ enabled: true });
  for (let i = 0; i < count; i += 1000) {
    const batch = [];
    for (let j = i; j < Math.min(i + 1000, count); j++) batch.push(appt(j));
    await H.RECORD.append(T, batch, { idempotencyKey: "seed-old-" + i });
  }
  for (const r of extra || []) await H.RECORD.append(T, [r], { idempotencyKey: "seed-" + r.id });
}

const book = (body) => as(NURSE, "/ward/book", "POST", { orgId: "org-wsq", minutes: 30, ...body });

test("a clash in the next fortnight is refused on a diary far past the old whole-history ceiling", async () => {
  const held = {
    resourceType: "Appointment", id: "wsq-appt-held", version: 1, patientId: "p-held", clinicianId: "dr-a",
    startAt: TOMORROW, minutes: 30, state: "booked", meta: { recordedAt: iso(Date.now()) },
    writtenBy: { id: "seed", kind: "human", at: iso(Date.now()) },
  };
  await seedDiary(51000, [held]);

  const calls = [];
  const inner = H.RECORD.pageByType.bind(H.RECORD);
  H.RECORD.pageByType = async (tenantId, type, opts) => { calls.push({ type, newest: !!(opts && opts.newest) }); return inner(tenantId, type, opts); };

  const clash = await book({ patientId: "p-new", clinicianId: "dr-a", startAt: TOMORROW });
  assert.equal(clash.__status, 409, clash.__text);
  assert.equal(clash.error, "slot_taken");
  assert.equal(clash.clashesWith.appointmentId, "wsq-appt-held");
  assert.equal(clash.written, 0);

  const appts = calls.filter((c) => c.type === "Appointment");
  assert.ok(appts.length && appts.every((c) => c.newest), "the diary was read newest first");
  assert.ok(appts.length <= 4, `read ${appts.length} pages of a 51,000-record diary, not 51`);

  const free = await book({ patientId: "p-new", clinicianId: "dr-a", startAt: iso(Date.now() + 2 * DAY) });
  assert.equal(free.__status, 200, free.__text);
  assert.equal(free.written, 1);
  H.RECORD.pageByType = inner;
});

test("an appointment amended DURING the read cannot become a double booking", async () => {
  /* The cancelled appointment is written first, then enough history to push it off the newest page.
   * It is amended back to `booked` after that page is handed out, so the windowed read walks past it
   * exactly as repository.js warns - and the last look before the append still refuses. */
  const stale = {
    resourceType: "Appointment", id: "wsq-appt-stale", version: 1, patientId: "p-stale", clinicianId: "dr-a",
    startAt: TOMORROW, minutes: 30, state: "cancelled", meta: { recordedAt: iso(Date.now() - DAY) },
    writtenBy: { id: "seed", kind: "human", at: iso(Date.now() - DAY) },
  };
  seed({ enabled: true });
  await H.RECORD.append(T, [stale], { idempotencyKey: "seed-stale" });
  for (let i = 0; i < 2000; i += 1000) {
    const batch = [];
    for (let j = i; j < i + 1000; j++) batch.push(appt(j));
    await H.RECORD.append(T, batch, { idempotencyKey: "seed-old-" + i });
  }

  let pages = 0;
  const inner = H.RECORD.pageByType.bind(H.RECORD);
  H.RECORD.pageByType = async (tenantId, type, opts) => {
    const page = await inner(tenantId, type, opts);
    if (type === "Appointment" && opts && opts.newest && ++pages === 1) {
      await H.RECORD.append(T, [{ ...stale, version: 2, state: "booked", meta: { recordedAt: iso(Date.now()) } }], { idempotencyKey: "amend-stale" });
    }
    return page;
  };

  const res = await book({ patientId: "p-new", clinicianId: "dr-a", startAt: TOMORROW });
  H.RECORD.pageByType = inner;
  assert.equal(res.__status, 409, res.__text);
  assert.equal(res.error, "slot_taken");
  assert.equal(res.clashesWith.appointmentId, "wsq-appt-stale");
  assert.equal(res.written, 0);
  assert.equal(H.RECORD._rows.filter((r) => r.id === "wsq-appt-new" || (r.body && r.body.patientId === "p-new")).length, 0, "nothing was written for the second patient");
});

test("a blackout still refuses, and overbooking cannot override it", async () => {
  seed({ enabled: true });
  const at = iso(Date.now());
  await H.RECORD.append(T, [{ resourceType: "Blackout", id: "bo-1", version: 1, clinicianId: "dr-a", from: iso(Date.now()), to: iso(Date.now() + 3 * DAY), reason: "Leave", state: "active", meta: { recordedAt: at }, writtenBy: { id: "seed", kind: "human", at } }], { idempotencyKey: "seed-bo" });
  const res = await book({ patientId: "p-new", clinicianId: "dr-a", startAt: TOMORROW, overbook: true, overbookReason: "urgent" });
  assert.equal(res.__status, 409, res.__text);
  assert.equal(res.error, "blacked_out");
  assert.equal(res.written, 0);
});

test("the window itself: a slot inside it is read, an old one that was written long ago is not, and a store that cannot page back reads whole", async () => {
  const now = Date.now();
  const floor = now - RW.CLASH_LOOKBACK_MS;
  const writtenBefore = now - RW.WRITE_LOOKBACK_MS;
  const old = { startAt: iso(now - 500 * DAY), meta: { recordedAt: iso(now - 500 * DAY) } };
  assert.equal(RW.outsideClashWindow(old, floor, writtenBefore), true, "an old slot written long ago is behind the window");
  assert.equal(RW.outsideClashWindow({ startAt: iso(now + DAY) }, floor, writtenBefore), false, "tomorrow's slot is inside");
  assert.equal(RW.outsideClashWindow({ startAt: iso(now - 500 * DAY), meta: { recordedAt: iso(now) } }, floor, writtenBefore), false,
    "an old slot amended today is still read: the read pages by write order");
  assert.equal(RW.outsideClashWindow({ startAt: "" }, floor, writtenBefore), false, "no readable slot time is never judged behind");

  let asked = null;
  const noBackwards = { listAll: async (t, o) => { asked = { t, o }; return { rows: [], truncated: false }; } };
  await RW.readClashDiary(noBackwards, "Appointment", { fromMs: now, max: 50000, throwOnTruncate: true });
  assert.deepEqual(asked, { t: "Appointment", o: { max: 50000, throwOnTruncate: true } }, "a store with no backwards paging still reads whole");
});
