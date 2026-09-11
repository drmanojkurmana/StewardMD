/* test/wardsynq-sms-channel.test.mjs — TASK 5.4: the SMS escalation channel adapter.
 * node --test test/wardsynq-sms-channel.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stewardmdSmsChannel, FREE_TEXT_PROVIDERS } from "../wardsynq/adapters/wardsynq-sms-channel.js";

const NOTICE = { id: "ntc-1", title: "Critical potassium 6.8", body: "Ward 4B, Bed 12" };

test("no SMS provider configured - fails cleanly, never claims delivery", async () => {
  const channel = stewardmdSmsChannel({ env: {}, resolvePhone: async () => "+911234567890" });
  const r = await channel(NOTICE);
  assert.equal(r.delivered, false);
  assert.match(r.detail, /no SMS provider/i);
});

test("a DLT-template-locked provider (msg91/2Factor) refuses free text, and names exactly why", async () => {
  for (const provider of ["msg91", "twofactor"]) {
    const channel = stewardmdSmsChannel({ env: { FOLLOWCARE_SMS_PROVIDER: provider }, resolvePhone: async () => "+911234567890" });
    const r = await channel(NOTICE);
    assert.equal(r.delivered, false);
    assert.match(r.detail, /DLT-approved template/, provider);
    assert.match(r.detail, /check-in/, provider + " must name the real reason, not a generic refusal");
  }
});

test("no phone number resolvable - fails per-notice, not a channel-wide failure", async () => {
  const channel = stewardmdSmsChannel({ env: { FOLLOWCARE_SMS_PROVIDER: "twilio" }, resolvePhone: async () => null });
  const r = await channel(NOTICE);
  assert.equal(r.delivered, false);
  assert.match(r.detail, /no phone number/i);
});

test("resolvePhone throwing is caught and reported, not left to crash the ladder", async () => {
  const channel = stewardmdSmsChannel({
    env: { FOLLOWCARE_SMS_PROVIDER: "twilio" },
    resolvePhone: async () => { throw new Error("rota lookup failed"); },
  });
  const r = await channel(NOTICE);
  assert.equal(r.delivered, false);
  assert.match(r.detail, /rota lookup failed/);
});

test("a free-text provider (Twilio/Gupshup) accepting the message is SENT, never DELIVERED", async () => {
  let sentBody = null;
  const channel = stewardmdSmsChannel({
    env: { FOLLOWCARE_SMS_PROVIDER: "twilio" },
    resolvePhone: async () => "+911234567890",
    sendSmsFn: async (env, msg) => { sentBody = msg.body; return { ok: true, providerId: "SM123" }; },
  });
  const r = await channel(NOTICE);
  assert.equal(r.delivered, false, "a carrier accepting a message is not a phone buzzing");
  assert.equal(r.sent, true);
  assert.equal(r.receipt, "sms:SM123");
  assert.match(sentBody, /Critical potassium 6\.8/);
  assert.match(sentBody, /Ward 4B, Bed 12/);
});

test("the gateway refusing the message is reported with its own real reason, not fabricated", async () => {
  const channel = stewardmdSmsChannel({
    env: { FOLLOWCARE_SMS_PROVIDER: "gupshup" },
    resolvePhone: async () => "+911234567890",
    sendSmsFn: async () => ({ ok: false, detail: "invalid destination" }),
  });
  const r = await channel(NOTICE);
  assert.equal(r.delivered, false);
  assert.equal(r.detail, "invalid destination");
});

test("sendSms throwing is caught, not left to crash the ladder", async () => {
  const channel = stewardmdSmsChannel({
    env: { FOLLOWCARE_SMS_PROVIDER: "twilio" },
    resolvePhone: async () => "+911234567890",
    sendSmsFn: async () => { throw new Error("network down"); },
  });
  const r = await channel(NOTICE);
  assert.equal(r.delivered, false);
  assert.match(r.detail, /network down/);
});

test("constructing without resolvePhone refuses loudly rather than silently carrying nothing", () => {
  assert.throws(() => stewardmdSmsChannel({ env: {} }), /resolvePhone/);
});

test("FREE_TEXT_PROVIDERS names exactly the providers this channel can carry a clinical body through", () => {
  assert.deepEqual(FREE_TEXT_PROVIDERS, ["twilio", "gupshup"]);
});
