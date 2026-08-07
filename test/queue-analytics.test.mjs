// test/queue-analytics.test.mjs — pure settings merge/clamp + analytics aggregation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeConfig, aggregate, CONFIG_DEFAULTS } from "../functions/_queue_eta.js";

test("mergeConfig: defaults, prep clamped <= early, bad values fall back, booleans coerced", () => {
  const d = mergeConfig(null);
  assert.equal(d.early, 5); assert.equal(d.prep, 2); assert.equal(d.etaLearning, true);
  const c = mergeConfig({ early: 3, prep: 9, defaultConsultMin: 0, etaLearning: 0, smsEnabled: 1 });
  assert.equal(c.early, 3);
  assert.equal(c.prep, 3);                                   // clamped to <= early
  assert.equal(c.defaultConsultMin, CONFIG_DEFAULTS.defaultConsultMin);  // 0 -> default
  assert.equal(c.etaLearning, false);
  assert.equal(c.smsEnabled, true);
});

test("aggregate: counts, avg wait/consult, ETA accuracy (within 10 min), peak hours", () => {
  const now = 1_700_000_000_000;
  const tickets = [
    { status: "completed", registeredAt: now - 40 * 60000, consultStartAt: now - 30 * 60000, consultEndAt: now - 18 * 60000, etaStart: now - 32 * 60000 }, // wait 10, consult 12, eta off 2m -> hit
    { status: "completed", registeredAt: now - 60 * 60000, consultStartAt: now - 50 * 60000, consultEndAt: now - 40 * 60000, etaStart: now - 10 * 60000 }, // wait 10, consult 10, eta off 40m -> miss
    { status: "no_show" }, { status: "cancelled" },
    { status: "waiting", registeredAt: now - 5 * 60000 }
  ];
  const a = aggregate(tickets, now);
  assert.equal(a.total, 5);
  assert.equal(a.completed, 2); assert.equal(a.noShow, 1); assert.equal(a.cancelled, 1); assert.equal(a.waiting, 1);
  assert.equal(a.avgWaitMin, 10);
  assert.equal(a.avgConsultMin, 11);
  assert.equal(a.etaAccuracyPct, 50);              // 1 of 2 predictions within 10 min
  assert.ok(a.peakHours.length >= 1);
});
