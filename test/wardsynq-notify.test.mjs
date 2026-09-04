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
