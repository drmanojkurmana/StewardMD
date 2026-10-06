/* PrepNucleus on the phone (prep-native.js) pure helpers: the widget snapshot, the next reminder time, the reminder
 * notification, Live Activity decisions and the sync status line.
 * What must hold: the snapshot counts today's done items and names the first unfinished one; a reminder time already
 * past today (or this minute) is tomorrow, built in local time; the notification has the stable id, the PrepNucleus
 * title, the plan's count only on the plan's own day, and the prep route; the Live Activity starts only when the student
 * starts the plan and the system allows it, updates while it runs, and ends when the plan is done or on a new day.
 * node --test test/prep-native.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const N = require("../prep-native.js");

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

test("snapshot: done, total, next and the local day", () => {
  const now = at(2026, 10, 6, 9, 15);
  const d = N.snapshot({ score: 42, exam: "NEET-PG", daysLeft: 30, items: [{ label: "Review 4 due questions", done: true }, { label: "Lesson: Brachial plexus", done: false }, { label: "20 new questions", done: false }], now });
  assert.deepEqual(d, { v: 1, score: 42, exam: "NEET-PG", daysLeft: 30, done: 1, total: 3, next: "Lesson: Brachial plexus", day: "2026-10-06", updated: now });
  const e = N.snapshot({ score: 0, exam: "FMGE", daysLeft: null, items: [], now });
  assert.equal(e.total, 0); assert.equal(e.next, null); assert.equal(e.daysLeft, null);
  assert.equal(N.snapshot({ items: [{ label: "a", done: true }], now }).next, null, "all done: no next");
});

test("nextAt: later today, past today is tomorrow, this minute is tomorrow, month and year roll", () => {
  assert.equal(N.nextAt("07:30", at(2026, 10, 6, 6, 0)), at(2026, 10, 6, 7, 30));
  assert.equal(N.nextAt("07:30", at(2026, 10, 6, 8, 0)), at(2026, 10, 7, 7, 30));
  assert.equal(N.nextAt("07:30", at(2026, 10, 6, 7, 30)), at(2026, 10, 7, 7, 30));
  assert.equal(N.nextAt("00:00", at(2026, 10, 31, 23, 59)), at(2026, 11, 1, 0, 0));
  assert.equal(N.nextAt("21:00", at(2026, 12, 31, 22, 0)), at(2027, 1, 1, 21, 0));
  const t = new Date(N.nextAt("18:45", at(2026, 3, 28, 20, 0)));
  assert.deepEqual([t.getHours(), t.getMinutes(), t.getDate()], [18, 45, 29], "local wall time is kept");
  assert.equal(N.nextAt(null, Date.now()), null);
  assert.equal(N.nextAt("25:00", Date.now()), null);
  assert.equal(N.nextAt("7:30", Date.now()), null);
});

test("reminderPayload: stable id, title, count only on the plan's day, prep route", () => {
  const p = N.reminderPayload("07:30", at(2026, 10, 6, 6, 0), "2026-10-06", 3);
  assert.equal(p.id, N.NOTIF_ID); assert.equal(p.title, "PrepNucleus"); assert.equal(p.body, "Today's plan: 3 items");
  assert.equal(p.schedule.at.getTime(), at(2026, 10, 6, 7, 30));
  assert.deepEqual(p.extra, { route: "prep" });
  assert.equal(N.reminderPayload("07:30", at(2026, 10, 6, 6, 0), "2026-10-06", 1).body, "Today's plan: 1 item");
  assert.equal(N.reminderPayload("07:30", at(2026, 10, 6, 9, 0), "2026-10-06", 3).body, "Today's plan is ready", "tomorrow's reminder does not carry today's count");
  assert.equal(N.reminderPayload("07:30", at(2026, 10, 6, 6, 0), null, 0).body, "Today's plan is ready");
  assert.equal(N.reminderPayload(null, Date.now(), null, 0), null);
  assert.ok(N.NOTIF_ID > 2147483000 && N.NOTIF_ID <= 2147483647, "above other ids, a Java int");
});

test("activityAction: start only on start and when allowed, update, end when done or a new day", () => {
  const d = { day: "2026-10-06", done: 1, total: 3 };
  const off = { supported: true, enabled: true, active: false };
  assert.equal(N.activityAction(off, null, d, true), "start");
  assert.equal(N.activityAction(off, null, d, false), null, "never starts on its own");
  assert.equal(N.activityAction({ supported: true, enabled: false, active: false }, null, d, true), null, "the system setting is respected");
  assert.equal(N.activityAction({ supported: false, enabled: false, active: false }, null, d, true), null);
  assert.equal(N.activityAction(off, null, { day: d.day, done: 3, total: 3 }, true), null, "nothing left: no start");
  assert.equal(N.activityAction(off, null, { day: d.day, done: 0, total: 0 }, true), null, "no plan: no start");
  const on = { supported: true, enabled: true, active: true };
  assert.equal(N.activityAction(on, "2026-10-06", d, false), "update");
  assert.equal(N.activityAction(on, "2026-10-06", { day: d.day, done: 3, total: 3 }, false), "end");
  assert.equal(N.activityAction(on, "2026-10-05", d, false), "end", "yesterday's activity ends");
  assert.equal(N.activityAction(on, null, d, false), "end", "an activity this phone did not start today ends");
  assert.equal(N.activityAction(null, null, d, true), null);
});

test("ago and syncLine", () => {
  const now = at(2026, 10, 6, 12, 0);
  assert.equal(N.ago(now - 10e3, now), "just now");
  assert.equal(N.ago(now - 120e3, now), "2 min ago");
  assert.equal(N.ago(now - 3 * 3600e3, now), "3 h ago");
  assert.equal(N.ago(at(2026, 10, 2, 9, 0), now), "on 2 Oct");
  assert.equal(N.syncLine({ signedIn: false, on: false }, now), "Sign in to sync");
  assert.equal(N.syncLine({ signedIn: true, on: false }, now), "Off. Progress stays on this phone.");
  assert.equal(N.syncLine({ signedIn: true, on: true, busy: true }, now), "Syncing");
  assert.equal(N.syncLine({ signedIn: true, on: true, at: now - 120e3 }, now), "Last synced 2 min ago");
  assert.equal(N.syncLine({ signedIn: true, on: true, at: null }, now), "Not synced yet");
  assert.equal(N.syncLine({ signedIn: true, on: true, err: "No connection" }, now), "Last sync failed: No connection");
  for (const s of ["Sign in to sync", N.syncLine({ signedIn: true, on: false }, now)]) assert.ok(!/—|–/.test(s), "no dashes");
});
