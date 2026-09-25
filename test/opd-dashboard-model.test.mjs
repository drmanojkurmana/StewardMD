/* The OPD operations dashboard's pure builders (opd-dashboard.js).
 *
 * What these defend:
 *   - a delta says which way is better in words and an arrow, never colour alone, and "not measured" is not zero,
 *   - Collected today is hidden when billing is off and says so when the money could not be read,
 *   - a failed pulse read says so instead of drawing a quiet clinic,
 *   - occupancy puts emergencies first and counts every status,
 *   - the Tasks inbox only lists what has a count and an action,
 *   - nothing app-facing carries an em dash.
 *
 * node --test test/opd-dashboard-model.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const D = createRequire(import.meta.url)("../opd-dashboard.js");

const pulse = { ok: true, pulse: { registered: 40, seen: 25, noShow: 2, abandonedPct: 7, doorToDoctor: { medianMin: 22, p90Min: 50 }, waitingNow: { longestMin: 40, medianMin: 15 }, consult: { medianMin: 8 }, syncFailed: 2, resultsBack: 1 } };

test("deltas: better or worse in words and an arrow; null is 'no figure', 0 is 'same'", () => {
  assert.deepEqual(D.deltaChip(3, "up"), { text: "+3 vs yesterday", dir: "up", tone: "good" });
  assert.equal(D.deltaChip(-4, "down", "m").tone, "good", "a shorter wait is better");
  assert.equal(D.deltaChip(2, "down", "%").tone, "bad");
  assert.equal(D.deltaChip(0, "up").text, "Same as yesterday");
  assert.equal(D.deltaChip(null, "up").text, "No figure yesterday");
});

test("KPI strip: money hidden when billing is off, said when unread; a failed read is not a quiet clinic", () => {
  const ins = { delta: { seen: 5, doorToDoctorMin: -2, abandonedPct: null } };
  const k = D.modelKpis(pulse, ins, null);
  assert.deepEqual(k.tiles.map((t) => t.key), ["seen", "d2d", "dnw"], "no Collected tile without billing");
  assert.equal(k.tiles[0].value, 25); assert.equal(k.tiles[0].suffix, "/40");
  assert.match(k.tiles[1].sub, /9 in 10 within 50m/);
  assert.equal(k.tiles[2].delta.text, "No figure yesterday");
  const withMoney = D.modelKpis(pulse, ins, { net: 1234500, count: 9, refunds: { count: 1, total: 20000 } });
  assert.equal(withMoney.tiles[1].value, "₹12,345");
  assert.match(withMoney.tiles[1].sub, /9 bills .* refunded/);
  assert.equal(D.modelKpis(pulse, ins, { unread: true }).tiles[1].value, null);
  assert.ok(D.modelKpis({ failed: true }).failed);
  assert.match(D.kpiHtml(D.modelKpis({ failed: true })), /Do not read this as a quiet clinic/);
  assert.match(D.kpiHtml(D.modelKpis({ ok: true, pulse: { doorToDoctor: {} } }, null, null)), /not yet/, "not measured is drawn as not yet, never 0m");
});

test("occupancy: emergencies first, every status counted, long waits flagged, pool reads To route", () => {
  const now = Date.now();
  const o = D.modelOccupancy([
    { t: { id: "a", status: "waiting", registeredAt: now - 70 * 60000 } },
    { t: { id: "b", status: "in_consultation", registeredAt: now - 10 * 60000 } },
    { t: { id: "c", status: "waiting", priority: 2, priorityReason: "emergency", registeredAt: now - 5 * 60000 } },
    { t: { id: "d", registeredAt: now - 2 * 60000 }, pool: true },
    { t: { id: "e", status: "waiting", resultReadyAt: now, registeredAt: now - 30 * 60000 } },
  ], now);
  assert.equal(o.rows[0].t.id, "c");
  assert.equal(o.rows[0].prio, "Emergency");
  assert.deepEqual(o.counts, { all: 5, wait: 2, treat: 1, route: 1, results: 1 });
  assert.equal(o.rows.find((r) => r.t.id === "a").long, true);
  assert.equal(o.rows.find((r) => r.t.id === "b").long, false, "in the room is not waiting");
  assert.equal(o.rows.find((r) => r.t.id === "d").status.label, "To route");
});

test("hours, month and mix", () => {
  const h = new Array(24).fill(0); h[9] = 4; h[10] = 8; h[11] = 2;
  const m = D.modelHours({ hourly: h, currentHour: 11 });
  assert.equal(m.bars[0].hour, 8); assert.equal(m.bars.at(-1).hour, 20);
  assert.equal(m.bars.find((b) => b.hour === 11).now, true);
  assert.equal(m.bars.find((b) => b.hour === 10).busiest, true);
  const cal = D.modelMonth({ date: "2026-09-03", month: [{ date: "2026-09-01", registered: 10, seen: 9 }, { date: "2026-09-02", registered: 0, seen: 0 }, { date: "2026-09-03", registered: 4, seen: 1 }] });
  assert.equal(cal.cells.filter(Boolean).length, 30);
  assert.equal(cal.cells.filter((c) => c && c.today).length, 1);
  assert.equal(cal.cells.filter((c) => c && c.closed).length, 1, "a closed day is a past day that had patients");
  assert.equal(cal.cells[0], null, "1 Sep 2026 is a Tuesday: Monday is blank");
  const mix = D.modelMix({ mix: { new: 6, followup: 3, priority: { senior: 2, emergency: 1 } } });
  assert.deepEqual(mix.segs.map((s) => [s.key, s.pct]), [["new", 67], ["followup", 33]]);
  assert.equal(mix.priority[0].key, "senior");
  assert.match(D.mixHtml(mix), /Senior citizen/);
});

test("tasks: only what has a count, each with its existing action", () => {
  const t = D.modelTasks({ pulse, followups: { unbooked: 3, overdue: 1 }, offline: { pending: 0, review: 0 }, unpaid: 2, recallable: 0, refunds: 0 });
  assert.deepEqual(t.map((x) => x.action), ["reconcile", "results", "schedule", "billing"]);
  assert.match(D.tasksHtml([]), /Nothing needs you right now/);
});

test("no em dash in the dashboard's app-facing text", () => {
  for (const f of ["opd-dashboard.js", "opd-dashboard.css"]) assert.ok(!/—/.test(readFileSync(new URL("../" + f, import.meta.url), "utf8")), f);
});

test("wardsynq.com ships the dashboard: build-wardsynq-site.sh copies both files", () => {
  const sh = readFileSync(new URL("../scripts/build-wardsynq-site.sh", import.meta.url), "utf8");
  for (const f of ["opd-dashboard.js", "opd-dashboard.css"]) assert.match(sh, new RegExp("\\b" + f.replace(".", "\\.") + "\\b"), f);
});
