/* test/clientlog.test.mjs — client crash/error telemetry: PHI-scrubbing + KV ring buffer + dedup.
 * node --test test/clientlog.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeClientLog, scrubUrl, recordClientError, getClientErrors, clearClientErrors, CLIENTLOG_KEY } from "../functions/_clientlog.js";

function fakeStore() { const m = new Map(); return { get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); return Promise.resolve(); } }; }
const NOW = 1786000000000;

test("scrubUrl strips query/fragment + collapses id-like segments (no PHI leaks)", () => {
  assert.equal(scrubUrl("/opd/patient/137202485/labs?token=abc#x"), "/opd/patient/:id/labs");
  assert.equal(scrubUrl("/home"), "/home");
});

test("sanitizeClientLog clamps sizes, whitelists level, keeps only metadata", () => {
  const r = sanitizeClientLog({ level: "boom", message: "x".repeat(500), stack: "s".repeat(3000), url: "/p/deadbeef99?q=1", build: "gold1", platform: "android", ua: "UA", uidHash: "h" }, NOW);
  assert.equal(r.level, "error");                 // invalid level -> error
  assert.equal(r.message.length, 300);            // clamped
  assert.equal(r.stack.length, 1500);
  assert.equal(r.url, "/p/:id");                  // scrubbed
  assert.equal(r.ts, NOW);
  assert.ok(!("email" in r) && !("uid" in r));    // never a raw uid/email
});

test("recordClientError writes newest-first to the ring buffer", async () => {
  const s = fakeStore();
  await recordClientError(s, { message: "A", build: "b1", stack: "l1" }, NOW);
  await recordClientError(s, { message: "B", build: "b1", stack: "l1" }, NOW + 1);
  const list = await getClientErrors(s);
  assert.equal(list.length, 2);
  assert.equal(list[0].message, "B");             // newest first
});

test("dedup: same signature bumps count + moves to top, not a new row", async () => {
  const s = fakeStore();
  await recordClientError(s, { message: "loop", build: "b1", stack: "at foo" }, NOW);
  await recordClientError(s, { message: "other", build: "b1", stack: "at bar" }, NOW + 1);
  await recordClientError(s, { message: "loop", build: "b1", stack: "at foo" }, NOW + 2);
  const list = await getClientErrors(s);
  assert.equal(list.length, 2, "the repeated error must not create a 3rd row");
  assert.equal(list[0].message, "loop");
  assert.equal(list[0].count, 2);
  assert.equal(list[0].firstTs, NOW);             // preserves first-seen
});

test("empty message is dropped; clear empties the buffer", async () => {
  const s = fakeStore();
  await recordClientError(s, { message: "", build: "b1" }, NOW);
  assert.equal((await getClientErrors(s)).length, 0);
  await recordClientError(s, { message: "keep", build: "b1" }, NOW);
  assert.equal((await getClientErrors(s)).length, 1);
  await clearClientErrors(s);
  assert.equal((await getClientErrors(s)).length, 0);
});
