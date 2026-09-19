/* test/maik-feedback.test.mjs — "Was this helpful?" answer feedback storage.
 *
 * Owner: "was this helpful button feedback stores where?" (nowhere durable before this) and "if
 * someone press no ask them please tell why help us improve and store their feedback". Two things
 * must hold: every tap (up or down) lands in the aggregate immediately, and a reason typed a moment
 * later amends that SAME row rather than creating a second, duplicate entry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeFeedback, recordFeedback, amendFeedbackReason, getFeedback, getFeedbackAgg, clearFeedback } from "../functions/_maik_feedback.js";

function fakeStore() { const m = new Map(); return { get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); return Promise.resolve(); } }; }
const NOW = 1786000000000;

test("sanitizeFeedback clamps sizes, whitelists helpful, assigns an id", () => {
  const r = sanitizeFeedback({ helpful: "down", question: "q".repeat(500), reason: "r".repeat(600), engine: "local-engine-name-too-long", pack: "p".repeat(60) }, NOW);
  assert.equal(r.helpful, "down");
  assert.equal(r.question.length, 300);
  assert.equal(r.reason.length, 500);
  assert.equal(r.engine.length, 20);
  assert.equal(r.pack.length, 40);
  assert.equal(r.ts, NOW);
  assert.ok(r.id && typeof r.id === "string");
});

test("an invalid/missing helpful value is dropped, not stored as junk", () => {
  const r = sanitizeFeedback({ helpful: "meh", question: "q" }, NOW);
  assert.equal(r.helpful, null);
});

test("recordFeedback writes newest-first and returns the entry's id", async () => {
  const s = fakeStore();
  const id1 = await recordFeedback(s, { helpful: "up", question: "A" }, NOW);
  const id2 = await recordFeedback(s, { helpful: "down", question: "B" }, NOW + 1);
  assert.ok(id1 && id2 && id1 !== id2);
  const list = await getFeedback(s);
  assert.equal(list.length, 2);
  assert.equal(list[0].question, "B");   // newest first
});

test("the aggregate counts every tap immediately, before any reason is typed", async () => {
  const s = fakeStore();
  await recordFeedback(s, { helpful: "up", question: "A" }, NOW);
  await recordFeedback(s, { helpful: "down", question: "B" }, NOW + 1);
  await recordFeedback(s, { helpful: "down", question: "C" }, NOW + 2);
  const agg = await getFeedbackAgg(s);
  assert.equal(agg.up, 1);
  assert.equal(agg.down, 2);
  assert.equal(agg.total, 3);
  assert.equal(agg.withReason, 0, "no reason has been typed yet");
});

test("amendFeedbackReason attaches a reason to the SAME entry, not a new one, and bumps withReason once", async () => {
  const s = fakeStore();
  const id = await recordFeedback(s, { helpful: "down", question: "Wrong dose shown" }, NOW);
  const ok = await amendFeedbackReason(s, id, "It said 500 mg but the guideline says 250 mg", NOW + 5000);
  assert.equal(ok, true);
  const list = await getFeedback(s);
  assert.equal(list.length, 1, "the reason must not create a second row");
  assert.equal(list[0].reason, "It said 500 mg but the guideline says 250 mg");
  assert.equal((await getFeedbackAgg(s)).withReason, 1);
  // Amending again with a different reason must not double-count withReason.
  await amendFeedbackReason(s, id, "actually it was the route, not the dose", NOW + 6000);
  assert.equal((await getFeedbackAgg(s)).withReason, 1);
  assert.equal((await getFeedback(s))[0].reason, "actually it was the route, not the dose");
});

test("amending an unknown id is a no-op, never throws, never invents a row", async () => {
  const s = fakeStore();
  await recordFeedback(s, { helpful: "down", question: "A" }, NOW);
  const ok = await amendFeedbackReason(s, "does-not-exist", "reason", NOW + 1);
  assert.equal(ok, false);
  assert.equal((await getFeedback(s)).length, 1);
});

test("clearFeedback empties both the entries and the aggregate", async () => {
  const s = fakeStore();
  await recordFeedback(s, { helpful: "down", question: "A" }, NOW);
  await clearFeedback(s);
  assert.equal((await getFeedback(s)).length, 0);
  assert.equal((await getFeedbackAgg(s)).total, 0);
});

test("no store bound (fail-open, mirrors _clientlog.js) never throws", async () => {
  assert.equal(await recordFeedback(null, { helpful: "up" }, NOW), null);
  assert.deepEqual(await getFeedback(null), []);
  assert.equal((await getFeedbackAgg(null)).total, 0);
  assert.equal(await amendFeedbackReason(null, "x", "y"), false);
});
