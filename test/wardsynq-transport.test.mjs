/* test/wardsynq-transport.test.mjs — sent, delivered, and seen are three different things.
 *
 * The tests that matter are the ones asserting that a webhook returning 200 is NOT delivery, that a
 * notice reaching a device with nobody acknowledging it stays outstanding, and that a channel which
 * has never carried a message is UNVERIFIED rather than assumed fine. Those three confusions are how
 * a hospital comes to believe it has an escalation system.
 *
 * node --test test/wardsynq-transport.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DELIVERY, CHANNEL_HEALTH, TransportError,
  MemoryOutbox, stationQueueChannel, browserNotificationChannel, webhookChannel,
  Transport, SweepDriver,
} from "../wardsynq/wardsynq-transport.js";

const NOW = "2026-09-04T09:00:00.000Z";
const clock = (start = NOW) => {
  const s = { t: Date.parse(start) };
  return { now: () => new Date(s.t).toISOString(), advance: (m) => { s.t += m * 60000; } };
};

const okChannel = (name, sink) => ({
  name,
  send: async (n) => { if (sink) sink.push(n); return { delivered: true, receipt: `${name}-1` }; },
});
const deadChannel = (name) => ({ name, send: async () => ({ delivered: false, detail: "no answer" }) });
const throwingChannel = (name) => ({ name, send: async () => { throw new Error("gateway exploded"); } });

const notice = { title: "NEWS2 9, Bay 4", body: "Immediate review", patientId: "pat-1", urgency: "emergency" };

/* ------------------------------------------------------------------ ADVERSARIAL: the three states */

test("ADVERSARIAL: a webhook returning 200 is SENT, and is NOT delivery", async () => {
  const fetch = async () => ({ ok: true, status: 202 });
  const t = new Transport({ now: () => NOW, channels: [{ name: "webhook", send: webhookChannel({ url: "https://x", fetch }) }] });

  const n = await t.send(notice);
  assert.equal(n.state, DELIVERY.SENT);
  assert.notEqual(n.state, DELIVERY.DELIVERED,
    "a 2xx means a server accepted bytes; calling that delivery is how a ward believes in a path nobody has ever been paged by");
  assert.match(n.attempts[0].detail, /That is SENT, not delivered/);
});

test("ADVERSARIAL: DELIVERED is not SEEN, and only a human closes the loop", async () => {
  const t = new Transport({ now: () => NOW, channels: [okChannel("station")] });
  const n = await t.send(notice);
  assert.equal(n.state, DELIVERY.DELIVERED);

  const still = await t.outstanding();
  assert.equal(still.length, 1, "reaching a device is not reaching a person");
  assert.match(still[0].reading, /reached a device and no human has acknowledged it/);

  const seen = await t.acknowledge(n.id, { by: "nurse-7" });
  assert.equal(seen.state, DELIVERY.SEEN);
  assert.equal(seen.seenBy, "nurse-7");
  assert.equal((await t.outstanding()).length, 0);
});

test("an acknowledgement names a person", async () => {
  const t = new Transport({ now: () => NOW, channels: [okChannel("station")] });
  const n = await t.send(notice);
  await assert.rejects(() => t.acknowledge(n.id, {}), (e) => e instanceof TransportError && e.code === "NO_ACTOR");
  await assert.rejects(() => t.acknowledge("nope", { by: "x" }), (e) => e.code === "NO_NOTICE");
});

test("ADVERSARIAL: outstanding INCLUDES the delivered ones, because that is the dangerous state", async () => {
  const c = clock();
  const t = new Transport({ now: c.now, channels: [okChannel("station")] });
  await t.send(notice);
  c.advance(40);

  const late = await t.outstanding({ olderThanMinutes: 30 });
  assert.equal(late.length, 1);
  assert.equal(late[0].outstandingMinutes, 40,
    "a dashboard counting only failures shows zero while the pager lies face down on a desk");
});

/* ------------------------------------------------------------------ ADVERSARIAL: durability */

test("ADVERSARIAL: the notice is in the outbox BEFORE any transport is touched", async () => {
  const outbox = new MemoryOutbox();
  let sawInOutboxDuringSend = false;

  const t = new Transport({
    now: () => NOW, outbox,
    channels: [{
      name: "slow",
      send: async (n) => {
        // A crash here must still leave a record. Check what the outbox holds mid-flight.
        sawInOutboxDuringSend = (await outbox.get(n.id)) !== null;
        return { delivered: true };
      },
    }],
  });

  await t.send(notice);
  assert.equal(sawInOutboxDuringSend, true,
    "sending first and recording after leaves nothing at all when the process dies between the two");
});

test("a crash mid-send leaves a recoverable record saying the outcome is unknown", async () => {
  const outbox = new MemoryOutbox();
  const t = new Transport({ now: () => NOW, outbox, channels: [throwingChannel("pager")] });
  const n = await t.send(notice);

  const persisted = await outbox.get(n.id);
  assert.ok(persisted, "the decision to escalate survives even when every transport failed");
  assert.equal(persisted.state, DELIVERY.FAILED);
  assert.match(persisted.attempts[0].detail, /gateway exploded/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the ladder */

test("ADVERSARIAL: the ladder stops at the first CONFIRMED delivery, not the first non-throw", async () => {
  const reached = [];
  const t = new Transport({
    now: () => NOW,
    channels: [
      { name: "webhook", send: async () => ({ sent: true, delivered: false, detail: "accepted" }) },
      okChannel("station", reached),
      { name: "phone", send: async () => { reached.push("phone"); return { delivered: true }; } },
    ],
  });

  const n = await t.send(notice);
  assert.equal(n.state, DELIVERY.DELIVERED);
  assert.equal(n.attempts.length, 2, "the webhook's acceptance did not stop the ladder; the station's delivery did");
  assert.equal(reached.length, 1);
  assert.ok(!reached.includes("phone"), "paging four people for one patient is how a ward learns to ignore the fifth");
});

test("failover walks the whole ladder when nothing delivers", async () => {
  const t = new Transport({
    now: () => NOW,
    channels: [deadChannel("pager"), throwingChannel("sms"), deadChannel("phone")],
  });
  const n = await t.send(notice);
  assert.equal(n.state, DELIVERY.FAILED);
  assert.deepEqual(n.attempts.map((a) => a.channel), ["pager", "sms", "phone"]);
  assert.ok(n.attempts.every((a) => a.delivered === false));
});

test("channels are tried in tier order", async () => {
  const order = [];
  const mk = (name, tier) => ({ name, tier, send: async () => { order.push(name); return { delivered: false }; } });
  const t = new Transport({ now: () => NOW, channels: [mk("third", 3), mk("first", 1), mk("second", 2)] });
  await t.send(notice);
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("ADVERSARIAL: a transport with no channels refuses to exist", () => {
  assert.throws(() => new Transport({ channels: [] }), (e) => e instanceof TransportError && e.code === "NO_CHANNELS");
  try {
    new Transport({ channels: [] });
  } catch (e) {
    assert.match(e.message, /something upstream believes it works/);
  }
});

test("a notice needs a title, because an empty page is one nobody can act on", async () => {
  const t = new Transport({ now: () => NOW, channels: [okChannel("station")] });
  await assert.rejects(() => t.send({}), (e) => e.code === "NO_TITLE");
});

/* ------------------------------------------------------------------ ADVERSARIAL: silent channels */

test("ADVERSARIAL: a channel that has never succeeded is UNVERIFIED, not healthy", async () => {
  const t = new Transport({ now: () => NOW, channels: [okChannel("station"), deadChannel("pager")] });
  const before = t.channelHealth();

  assert.equal(before.channels.find((c) => c.name === "pager").state, CHANNEL_HEALTH.UNVERIFIED);
  assert.equal(before.channels.find((c) => c.name === "station").state, CHANNEL_HEALTH.UNVERIFIED);
  assert.equal(before.healthy, 0);
  assert.match(before.reading, /NO channel is currently known to work/);
  assert.match(before.channels[0].reading, /is not the same as healthy/);
});

test("verifying a channel is how a site proves it carries anything", async () => {
  const t = new Transport({ now: () => NOW, channels: [okChannel("station"), deadChannel("pager")] });

  const good = await t.verify("station", { by: "charge-nurse" });
  assert.equal(good.verified, true);
  assert.equal(t.channelHealth().channels.find((c) => c.name === "station").state, CHANNEL_HEALTH.HEALTHY);

  const bad = await t.verify("pager", { by: "charge-nurse" });
  assert.equal(bad.verified, false);
  assert.match(bad.note, /anything relying on it is relying on nothing/);
});

test("a verification is attributable and names a real channel", async () => {
  const t = new Transport({ now: () => NOW, channels: [okChannel("station")] });
  await assert.rejects(() => t.verify("station", {}), (e) => e.code === "NO_ACTOR");
  await assert.rejects(() => t.verify("nope", { by: "x" }), (e) => e.code === "NO_CHANNEL");
});

test("ADVERSARIAL: a channel that worked once and now fails is DEGRADED, then DOWN", async () => {
  let works = true;
  const flaky = { name: "pager", send: async () => (works ? { delivered: true } : { delivered: false, detail: "no answer" }) };
  const t = new Transport({ now: () => NOW, channels: [flaky] });

  await t.send(notice);
  assert.equal(t.channelHealth().channels[0].state, CHANNEL_HEALTH.HEALTHY);

  works = false;
  await t.send(notice);
  assert.equal(t.channelHealth().channels[0].state, CHANNEL_HEALTH.DEGRADED);
  await t.send(notice);
  await t.send(notice);
  assert.equal(t.channelHealth().channels[0].state, CHANNEL_HEALTH.DOWN,
    "an integration that broke three weeks ago looks exactly like one that works, until somebody dies");
});

test("a channel whose last success is stale is DEGRADED even with no failures", async () => {
  const c = clock();
  const t = new Transport({ now: c.now, channels: [okChannel("station")], staleAfterMs: 60 * 60 * 1000 });
  await t.send(notice);
  assert.equal(t.channelHealth().channels[0].state, CHANNEL_HEALTH.HEALTHY);
  c.advance(120);
  assert.equal(t.channelHealth().channels[0].state, CHANNEL_HEALTH.DEGRADED);
});

/* ------------------------------------------------------------------ the adapters */

test("the station queue is honest about what DELIVERED means for it", async () => {
  const queue = [];
  const send = stationQueueChannel(queue);
  const r = await send({ id: "n1", title: "x" });
  assert.equal(r.delivered, true);
  assert.equal(queue.length, 1);
  assert.match(r.detail, /not that anybody has looked at it/);
  assert.throws(() => stationQueueChannel(null), (e) => e.code === "NO_QUEUE");
});

test("the browser notification channel reports honestly when it cannot show anything", async () => {
  const denied = browserNotificationChannel({ Notification: { permission: "denied" } });
  const r = await denied({ id: "n1", title: "x" });
  assert.equal(r.delivered, false);
  assert.match(r.detail, /permission is "denied"/);

  const none = browserNotificationChannel({ Notification: null });
  assert.equal((await none({ id: "n", title: "x" })).delivered, false);

  const shown = [];
  class FakeNotification {
    static permission = "granted";
    constructor(title, opts) { shown.push({ title, opts }); }
  }
  const ok = browserNotificationChannel({ Notification: FakeNotification });
  const good = await ok({ id: "n1", title: "NEWS2 9", body: "Bay 4" });
  assert.equal(good.delivered, true);
  assert.equal(shown[0].opts.requireInteraction, true, "a clinical alert must not auto-dismiss");
  assert.match(good.detail, /a locked or logged-out machine reaches nobody/);
});

test("a webhook failure is reported rather than thrown", async () => {
  const send = webhookChannel({ url: "https://x", fetch: async () => ({ ok: false, status: 503 }) });
  const r = await send({ id: "n1" });
  assert.equal(r.delivered, false);
  assert.match(r.detail, /returned 503/);

  const boom = webhookChannel({ url: "https://x", fetch: async () => { throw new Error("DNS"); } });
  assert.equal((await boom({ id: "n" })).delivered, false);
  assert.throws(() => webhookChannel({}), (e) => e.code === "NO_URL");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the driver */

test("ADVERSARIAL: the sweeps that nothing was calling now get called", async () => {
  const swept = [];
  const driver = new SweepDriver({ intervalMs: 1000 });
  driver.add("deterioration", async () => { swept.push("deterioration"); return 1; });
  driver.add("bundles", async () => { swept.push("bundles"); return 2; });

  await driver.tick();
  assert.deepEqual(swept, ["deterioration", "bundles"],
    "every monitor in this build had a sweep() that nothing called on a timer, which is a correct re-escalation ladder that never re-escalates");
  assert.equal(driver.ticks, 1);
});

test("ADVERSARIAL: one throwing monitor does not stop the others", async () => {
  const swept = [];
  const driver = new SweepDriver({});
  driver.add("broken", async () => { throw new Error("monitor exploded"); });
  driver.add("working", async () => { swept.push("working"); });

  const results = await driver.tick();
  assert.deepEqual(swept, ["working"], "a ward has more than one patient");
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /monitor exploded/);
  assert.equal(driver.errors.length, 1);
});

test("the driver starts and stops on an injected timer", async () => {
  let fn = null;
  const driver = new SweepDriver({
    intervalMs: 500,
    setInterval: (f) => { fn = f; return 99; },
    clearInterval: () => { fn = null; },
  });
  driver.add("t", async () => {});
  driver.start();
  assert.equal(typeof fn, "function");
  driver.start();
  driver.stop();
  assert.equal(fn, null);
  assert.throws(() => driver.add("bad", "not a function"), (e) => e.code === "BAD_TASK");
});

/* ------------------------------------------------------------------ the seam to the monitors */

test("the transport plugs into the existing Dispatcher shape", async () => {
  const queue = [];
  const t = new Transport({ now: () => NOW, channels: [{ name: "station", send: stationQueueChannel(queue) }] });
  const channels = t.asDispatcherChannels();

  const r = await channels.transport({ reason: "NEWS2 9", to: "critical care outreach", escalation: { patientId: "pat-1" } });
  assert.equal(r.delivered, true);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].patientId, "pat-1");
  assert.ok(r.receipt.startsWith("ntc-"), "the receipt is the outbox id, so an escalation can be traced to its notice");
});

test("ADVERSARIAL: end to end, an undelivered escalation stays outstanding and visible", async () => {
  const c = clock();
  const t = new Transport({ now: c.now, channels: [deadChannel("pager"), deadChannel("sms")] });

  await t.send({ title: "NEWS2 9, Bay 4", patientId: "pat-1", urgency: "emergency" });
  c.advance(20);

  const out = await t.outstanding();
  assert.equal(out.length, 1);
  assert.equal(out[0].state, DELIVERY.FAILED);
  assert.match(out[0].reading, /every channel was tried and none delivered/);
  assert.match(t.channelHealth().reading, /NO channel is currently known to work/);
});
