/* test/wardsynq-notify.test.mjs — attempted is not delivered.
 *
 * Every test here is a way a notification can appear to have worked when nobody was told. That is
 * the only interesting property of this module: it has no transport of its own and cannot acquire
 * one, so all it can do is refuse to lie about what happened.
 *
 * node --test test/wardsynq-notify.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Dispatcher, NotifyError } from "../wardsynq/wardsynq-notify.js";

const NOW = "2026-09-04T12:00:00.000Z";
const now = () => NOW;

test("a channel that confirms delivery is delivered", async () => {
  const d = new Dispatcher({ now, channels: { bleep: async () => ({ delivered: true, receipt: "b-1" }) } });
  const r = await d.send({ to: "dr-1" });
  assert.equal(r.delivered, true);
  assert.equal(r.attempts[0].receipt, "b-1");
  assert.equal(r.attempts[0].at, NOW);
});

test("ADVERSARIAL: no configured channel THROWS rather than quietly succeeding", async () => {
  const d = new Dispatcher({ now });
  await assert.rejects(() => d.send({}), (e) => e instanceof NotifyError && e.code === "NO_CHANNEL");
});

test("ADVERSARIAL: a channel that returns nothing has confirmed nothing", async () => {
  const d = new Dispatcher({ now, channels: { bleep: async () => {} } });
  const r = await d.send({});
  assert.equal(r.delivered, false, "an async no-op is the easiest way to fake a working escalation system");
  assert.match(r.attempts[0].detail, /delivery is unconfirmed/);
});

test("ADVERSARIAL: a channel that throws is a recorded failed attempt, not a crash", async () => {
  const d = new Dispatcher({ now, channels: { bleep: async () => { throw new Error("pager offline"); } } });
  const r = await d.send({});
  assert.equal(r.delivered, false);
  assert.match(r.attempts[0].detail, /pager offline/);
});

test("ADVERSARIAL: a channel cannot claim delivery with anything but true", async () => {
  for (const claim of ["yes", 1, {}, [], "true"]) {
    const d = new Dispatcher({ now, channels: { bleep: async () => ({ delivered: claim }) } });
    const r = await d.send({});
    assert.equal(r.delivered, false, `${JSON.stringify(claim)} is not a confirmation`);
  }
});

test("one broken channel does not stop the others", async () => {
  const d = new Dispatcher({
    now,
    channels: {
      bleep: async () => { throw new Error("offline"); },
      phone: async () => ({ delivered: true }),
    },
  });
  const r = await d.send({});
  assert.equal(r.delivered, true, "a broken pager is not a reason to skip the phone");
  assert.equal(r.attempts.length, 2);
});

test("naming a channel that does not exist is a recorded failure, not a silent skip", async () => {
  const d = new Dispatcher({ now, channels: { phone: async () => ({ delivered: true }) } });
  const r = await d.send({}, ["pager"]);
  assert.equal(r.delivered, false);
  assert.match(r.attempts[0].detail, /is not configured/);
});

test("a non-function channel entry is refused rather than called", async () => {
  const d = new Dispatcher({ now, channels: { bleep: "https://pager.example" } });
  const r = await d.send({});
  assert.equal(r.delivered, false);
  assert.match(r.attempts[0].detail, /is not configured/);
});

test("the payload reaches the channel unaltered", async () => {
  const seen = [];
  const d = new Dispatcher({ now, channels: { bleep: async (p) => { seen.push(p); return { delivered: true }; } } });
  await d.send({ to: "dr-1", reason: "NEWS2 7" });
  assert.deepEqual(seen[0], { to: "dr-1", reason: "NEWS2 7" });
});

test("named channels are attempted in the order given, and only those", async () => {
  const order = [];
  const chan = (n) => async () => { order.push(n); return { delivered: false }; };
  const d = new Dispatcher({ now, channels: { a: chan("a"), b: chan("b"), c: chan("c") } });
  await d.send({}, ["c", "a"]);
  assert.deepEqual(order, ["c", "a"]);
});

/* ---- retry, added 2026-09-10: opt-in, bounded, and provably zero-impact when not asked for ------ */

test("RETRY: with no opts, behaviour is EXACTLY as before - one attempt, no retriesUsed field at all", async () => {
  let calls = 0;
  const d = new Dispatcher({ now, channels: { pager: async () => { calls++; return { delivered: false }; } } });
  const { attempts } = await d.send({});
  assert.equal(calls, 1, "no retry happened just because the feature exists");
  assert.equal("retriesUsed" in attempts[0], false, "the shape is unchanged for a caller that never asked for retry - every existing consumer of this file sees nothing new");
});

test("RETRY: a channel that fails twice then succeeds is recorded as DELIVERED, with the real attempt count", async () => {
  let calls = 0;
  const d = new Dispatcher({ now, channels: { pager: async () => { calls++; return calls < 3 ? { delivered: false, detail: "transient" } : { delivered: true, receipt: "OK-3" }; } } });
  const { delivered, attempts } = await d.send({}, undefined, { retries: 3 });
  assert.equal(delivered, true, "the eventual success is what gets recorded, not the earlier failures");
  assert.equal(calls, 3);
  assert.equal(attempts[0].receipt, "OK-3", "the DELIVERING attempt's own receipt, not a stale one from an earlier failure");
  assert.equal(attempts[0].retriesUsed, 2, "two retries were actually needed before it landed");
});

test("RETRY: a channel that fails every time is STILL recorded as failed, honestly - retry never fakes delivery", async () => {
  let calls = 0;
  const d = new Dispatcher({ now, channels: { pager: async () => { calls++; throw new Error("gateway down"); } } });
  const { delivered, attempts } = await d.send({}, undefined, { retries: 3 });
  assert.equal(delivered, false);
  assert.equal(calls, 4, "the original attempt plus all 3 retries were genuinely made");
  assert.equal(attempts[0].retriesUsed, 3);
  assert.match(attempts[0].detail, /gateway down/);
});

test("RETRY: the count is clamped, so a caller cannot turn one notification into an unbounded loop", async () => {
  let calls = 0;
  const d = new Dispatcher({ now, channels: { pager: async () => { calls++; return { delivered: false }; } } });
  await d.send({}, undefined, { retries: 999 });
  assert.ok(calls <= 6, `clamped to a small bound, not ${calls} real attempts against a real provider`);
});
