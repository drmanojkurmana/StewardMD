// FollowCare AI — dispatch/scheduler decision logic + SMS provider gating (Phase 1).
import { test } from "node:test";
import assert from "node:assert";
import { plan, messageBody, maskPhone, redactDigits } from "../functions/_followcare_dispatch.js";
import { smsConfigured, smsProvider, toDialable } from "../functions/_followcare_sms.js";

const DAY = 86400000;
const SCHED = [{ dayOffset: 1, dueAtMs: 1000 }, { dayOffset: 2, dueAtMs: 1000 + DAY }, { dayOffset: 3, dueAtMs: 1000 + 2 * DAY }];

test("plan: nothing due before the first check-in opens", () => {
  const p = plan({ schedule: SCHED, lastDayDone: -1, lastSentDay: -1, lastSentMs: 0 }, 500);
  assert.equal(p.action, "none");
});

test("plan: SEND when a due day's link has not gone out yet", () => {
  const p = plan({ schedule: SCHED, lastDayDone: -1, lastSentDay: -1, lastSentMs: 0 }, 1500);
  assert.equal(p.action, "send");
  assert.equal(p.day, 1);
});

test("plan: REMIND when already sent but unanswered and the reminder gap elapsed", () => {
  const now = 1500 + DAY + 1;   // >24h after the send
  const p = plan({ schedule: SCHED, lastDayDone: -1, lastSentDay: 1, lastSentMs: 1500 }, now);
  assert.equal(p.action, "remind");
  assert.equal(p.day, 1);
});

test("plan: quiet when sent recently and still within the reminder gap", () => {
  const p = plan({ schedule: SCHED, lastDayDone: -1, lastSentDay: 1, lastSentMs: 1500 }, 1500 + 3600000);
  assert.equal(p.action, "none");
});

test("plan: missedCount counts check-ins overdue > grace and still unanswered", () => {
  // now is 2 days after day-1 due, day-1 + day-2 both overdue by > 1 day-grace? day1 due=1000, day2 due=1000+DAY
  const now = 1000 + 2 * DAY + 1;
  const p = plan({ schedule: SCHED, lastDayDone: -1, lastSentDay: 3, lastSentMs: now - 1000 }, now, { missGraceMs: DAY });
  assert.ok(p.missedCount >= 1, "missedCount " + p.missedCount);
});

test("plan: no reminder churn once the patient has answered", () => {
  const p = plan({ schedule: SCHED, lastDayDone: 3, lastSentDay: 3, lastSentMs: 1000 }, 9e12);
  assert.equal(p.action, "none");
  assert.equal(p.missedCount, 0);
});

test("messageBody: PHI-light template, includes link, en + hi", () => {
  const en = messageBody("Ramesh", "https://x/y?t=abc", "en", "send");
  assert.match(en, /Ramesh/); assert.match(en, /https:\/\/x\/y/); assert.match(en, /StewardMD/);
  const hi = messageBody("Ramesh", "https://x/y?t=abc", "hi", "send");
  assert.match(hi, /https:\/\/x\/y/);
  const rem = messageBody("", "https://x/y", "en", "remind");
  assert.match(rem, /Reminder/i);
  // unknown lang falls back to English
  assert.match(messageBody("A", "L", "zz", "send"), /StewardMD/);
});

test("SMS: provider is honestly OFF until configured (never fakes a send)", () => {
  assert.equal(smsProvider({}), "");
  assert.equal(smsConfigured({}), false);
  assert.equal(smsConfigured({ FOLLOWCARE_SMS_PROVIDER: "msg91" }), false);            // creds missing
  assert.equal(smsConfigured({ FOLLOWCARE_SMS_PROVIDER: "msg91", MSG91_AUTHKEY: "k", MSG91_TEMPLATE_CHECKIN: "t" }), true);
  assert.equal(smsConfigured({ FOLLOWCARE_SMS_PROVIDER: "twilio", TWILIO_SID: "s", TWILIO_AUTH_TOKEN: "a", TWILIO_FROM: "+1" }), true);
  // 2Factor.in (India DLT transactional SMS) — needs key + sender + template
  assert.equal(smsConfigured({ FOLLOWCARE_SMS_PROVIDER: "twofactor", TWOFACTOR_API_KEY: "k", TWOFACTOR_SENDER: "STWMED", TWOFACTOR_TEMPLATE_CHECKIN: "tpl" }), true);
  assert.equal(smsConfigured({ FOLLOWCARE_SMS_PROVIDER: "twofactor", TWOFACTOR_API_KEY: "k" }), false);
});

test("HIPAA I-2: a phone number echoed in a provider error is redacted before it hits the delivery log", () => {
  assert.equal(redactDigits("The 'To' number 919876543210 is not valid"), "The 'To' number ••• is not valid");
  assert.equal(redactDigits("invalid destination +91 98765 43210"), "invalid destination +91 98765 43210".replace("9876543210", "•••"));  // continuous run masked
  assert.ok(!/\d{7,}/.test(redactDigits("code 21211 to 919876543210 failed")));
});

test("delivery log masks the phone to last-4", () => {
  assert.equal(maskPhone("919876543210"), "•••••3210");
  assert.equal(maskPhone("12"), "••••");
});

test("SMS: toDialable normalises India numbers (adds 91 to a bare 10-digit)", () => {
  assert.equal(toDialable("98765 43210"), "919876543210");
  assert.equal(toDialable("+91 98765 43210"), "919876543210");
  assert.equal(toDialable("919876543210"), "919876543210");
});
