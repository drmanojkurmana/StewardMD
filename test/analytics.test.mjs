/* test/analytics.test.mjs — privacy-safe analytics: allow-list + daily counters + aggregation.
 * node --test test/analytics.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedEvent, recordEvent, getAnalytics } from "../functions/_analytics.js";

function fakeStore() { const m = new Map(); return { get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); return Promise.resolve(); } }; }
const NOW = Date.parse("2026-08-16T10:00:00Z");
const DAY = 86400000;

test("allow-list: only known events count; free-text/PHI-ish names are dropped", () => {
  assert.equal(isAllowedEvent("app_open"), true);
  assert.equal(isAllowedEvent("scribe_saved"), true);
  assert.equal(isAllowedEvent("patient_John_Doe_137202485"), false);   // never count arbitrary names
  assert.equal(isAllowedEvent(""), false);
});

test("recordEvent increments allowed events, ignores disallowed", async () => {
  const s = fakeStore();
  await recordEvent(s, "app_open", NOW);
  await recordEvent(s, "app_open", NOW);
  await recordEvent(s, "scribe_saved", NOW);
  await recordEvent(s, "evil_free_text", NOW);   // dropped
  const a = await getAnalytics(s, 1, NOW);
  assert.equal(a.totals.app_open, 2);
  assert.equal(a.totals.scribe_saved, 1);
  assert.equal(a.totals.evil_free_text, undefined);
  assert.equal(a.grandTotal, 3);
});

test("getAnalytics aggregates across days", async () => {
  const s = fakeStore();
  await recordEvent(s, "maik_ask", NOW);
  await recordEvent(s, "maik_ask", NOW - DAY);       // yesterday
  await recordEvent(s, "insulin_calc", NOW - 2 * DAY);
  const a = await getAnalytics(s, 7, NOW);
  assert.equal(a.totals.maik_ask, 2);
  assert.equal(a.totals.insulin_calc, 1);
  assert.equal(a.grandTotal, 3);
  assert.equal(a.days.length, 7);
});
