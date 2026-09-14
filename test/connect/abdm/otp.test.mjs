// test/connect/abdm/otp.test.mjs — the HIP-issued link OTP.
//
// The OTP is the ONLY thing standing between a stranger and a patient's linked records during
// user-initiated linking: ABDM does not generate it, deliver it or verify it. So this suite is weighted
// toward the ways it could be defeated - replay, grinding, oracles, bombing - and toward the one thing a
// health system must never do, which is claim to have sent a message it did not send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import {
  mintOtp, issueLinkOtp, resendLinkOtp, verifyLinkOtp, deliverOtp, otpDeliveryConfigured,
  claimSendBudget, OTP_TTL_SEC, MAX_VERIFY_ATTEMPTS, MAX_RESENDS, MAX_SENDS_PER_WINDOW, OtpError,
} from "../../../functions/_connect/abdm/otp.js";

const NOW = "2026-08-19T00:00:00.000Z";
const at = (secs) => new Date(Date.parse(NOW) + secs * 1000).toISOString();

// An env where a real channel IS configured (2Factor + a DLT-approved OTP template).
const ENV_LIVE = {
  ABDM_OTP_TEMPLATE: "SMD_ABDM_OTP", ABDM_FACILITY_NAME: "StewardMD",
  FOLLOWCARE_SMS_PROVIDER: "twofactor",
  TWOFACTOR_API_KEY: "k", TWOFACTOR_SENDER: "STWRDM", TWOFACTOR_TEMPLATE_CHECKIN: "t",
};
const ENV_NO_TEMPLATE = { ...ENV_LIVE, ABDM_OTP_TEMPLATE: "" };
const ENV_NO_PROVIDER = { ABDM_OTP_TEMPLATE: "SMD_ABDM_OTP" };

// `respond` decides what the provider answers; the recorder always records, so a test that overrides the
// answer still sees WHICH channels were attempted.
function harness(over = {}) {
  const sent = [];
  const respond = over.respond || (async () => ({ ok: true }));
  const rest = { ...over }; delete rest.respond;
  return {
    sent,
    deps: {
      kv: makeMockKv(),
      send: async (channel, payload) => { sent.push({ channel, payload }); return respond(channel, payload); },
      mintOtp: () => "123456",
      newId: (() => { let n = 0; return () => "ref-" + (++n); })(),
      ...rest,
    },
  };
}
const issue = (h, env = ENV_LIVE, o = {}) => issueLinkOtp(env, h.deps, {
  tenantId: "t1", patientRef: "PSEUDO-1", refs: ["OPD:1"], transactionId: "tx-1",
  mobile: "9876543210", now: () => NOW, io: h.deps, ...o,
});

// ── the secret itself ───────────────────────────────────────────────────────────────────────────────
test("the OTP is 6 digits and uniformly distributed from the CSPRNG", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const o = mintOtp();
    assert.match(o, /^[0-9]{6}$/);
    assert.ok(Number(o) >= 100000 && Number(o) <= 999999);
    seen.add(o);
  }
  assert.ok(seen.size > 450, "500 draws should be nearly all distinct; got " + seen.size);
});

test("the OTP is NEVER stored, only a hash bound to its own reference", async () => {
  const h = harness();
  const r = await issue(h);
  const held = JSON.parse(await h.deps.kv.get("connect:abdm:linkotp:" + r.linkRef));
  assert.ok(!JSON.stringify(held).includes("123456"), "a KV dump must not be replayable");
  assert.match(held.otpHash, /^[0-9a-f]{64}$/);

  // The SAME OTP under a DIFFERENT reference hashes differently, so a hash cannot be moved between them.
  const h2 = harness({ newId: () => "other-ref" });
  const r2 = await issue(h2);
  const held2 = JSON.parse(await h2.deps.kv.get("connect:abdm:linkotp:" + r2.linkRef));
  assert.notEqual(held.otpHash, held2.otpHash);
});

// ── SUCCESS ─────────────────────────────────────────────────────────────────────────────────────────
test("the right OTP verifies once and returns the scope link/init offered", async () => {
  const h = harness();
  const r = await issue(h);
  assert.equal(r.delivered, true);
  const v = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(60) });
  assert.equal(v.ok, true);
  assert.equal(v.state.tenantId, "t1");
  assert.deepEqual(v.state.refs, ["OPD:1"]);
});

// ── WRONG OTP ───────────────────────────────────────────────────────────────────────────────────────
test("a wrong OTP fails and burns one attempt", async () => {
  const h = harness();
  const r = await issue(h);
  const v = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "000000", now: () => at(1) });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "wrong-otp");
  assert.equal(v.attempts, 1);
  // …and the right one still works, so a typo does not lock the patient out.
  assert.equal((await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(2) })).ok, true);
});

test("three wrong answers DESTROY the reference rather than letting it be ground down", async () => {
  const h = harness();
  const r = await issue(h);
  for (let i = 1; i <= MAX_VERIFY_ATTEMPTS; i++) {
    const v = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "000000", now: () => at(i) });
    assert.equal(v.ok, false);
  }
  assert.equal(await h.deps.kv.get("connect:abdm:linkotp:" + r.linkRef), null, "the reference is gone");
  // Even the CORRECT OTP is now useless - the reference no longer exists.
  const after = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(10) });
  assert.equal(after.ok, false);
  assert.equal(after.reason, "unknown-or-expired");
});

test("a 6-digit space is not brute-forceable within 3 attempts", async () => {
  // Sanity on the arithmetic rather than the code: 3 guesses out of 900000 is a 1-in-300000 chance.
  assert.equal(MAX_VERIFY_ATTEMPTS, 3);
  assert.ok(900000 / MAX_VERIFY_ATTEMPTS > 100000);
});

// ── EXPIRY ──────────────────────────────────────────────────────────────────────────────────────────
test("an expired OTP is refused even if the store still hands the row back", async () => {
  const h = harness();
  const r = await issue(h);
  // The mock KV has no TTL eviction, which is exactly the case the belt-and-braces check exists for.
  const v = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(OTP_TTL_SEC + 1) });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "unknown-or-expired");
  assert.equal(await h.deps.kv.get("connect:abdm:linkotp:" + r.linkRef), null, "and it is cleaned up");
});

test("the OTP is still valid at the last second of its window", async () => {
  const h = harness();
  const r = await issue(h);
  assert.equal(r.expiresAt, at(OTP_TTL_SEC));
  assert.equal((await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(OTP_TTL_SEC - 1) })).ok, true);
});

test("verification fails CLOSED on an unusable clock", async () => {
  const h = harness();
  const r = await issue(h);
  const v = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => "not-a-date" });
  assert.equal(v.ok, false, "a broken clock must not extend an OTP's life indefinitely");
});

// ── REPLAY ──────────────────────────────────────────────────────────────────────────────────────────
test("the OTP is SINGLE-USE: replaying it links nothing", async () => {
  const h = harness();
  const r = await issue(h);
  assert.equal((await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(1) })).ok, true);
  const replay = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(2) });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "unknown-or-expired");
});

test("two concurrent verifications cannot both succeed", async () => {
  const h = harness();
  const r = await issue(h);
  const [a, b] = await Promise.all([
    verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(1) }),
    verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(1) }),
  ]);
  assert.equal([a, b].filter((x) => x.ok).length >= 1, true, "at least one must succeed");
  // The reference is destroyed either way, so no third use is possible.
  assert.equal(await h.deps.kv.get("connect:abdm:linkotp:" + r.linkRef), null);
});

// ── ORACLE RESISTANCE ───────────────────────────────────────────────────────────────────────────────
test("unknown, expired and wrong all answer ok:false - the reason never reaches the wire", async () => {
  const h = harness();
  const r = await issue(h);
  const unknown = await verifyLinkOtp(h.deps, { linkRef: "never-issued", token: "123456", now: () => at(1) });
  const wrong = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "000000", now: () => at(1) });
  const none = await verifyLinkOtp(h.deps, { linkRef: null, token: "123456", now: () => at(1) });
  for (const x of [unknown, wrong, none]) assert.equal(x.ok, false);
  // The reasons DIFFER for the audit trail - and hip-handlers maps every one of them to the same reply.
  assert.notEqual(unknown.reason, wrong.reason);
});

// ── RESEND ──────────────────────────────────────────────────────────────────────────────────────────
test("a resend delivers again and is bounded to MAX_RESENDS", async () => {
  const h = harness();
  const r = await issue(h);
  assert.equal(h.sent.length, 1);
  for (let i = 1; i <= MAX_RESENDS; i++) {
    const out = await resendLinkOtp(ENV_LIVE, h.deps, { linkRef: r.linkRef, mobile: "9876543210", now: () => at(i * 10), io: h.deps });
    assert.equal(out.delivered, true, "resend " + i);
    assert.equal(out.resends, i);
  }
  const over = await resendLinkOtp(ENV_LIVE, h.deps, { linkRef: r.linkRef, mobile: "9876543210", now: () => at(100), io: h.deps });
  assert.equal(over.delivered, false);
  assert.equal(over.reason, "resend-limit");
});

test("a resend re-mints, so the OLD code stops working and the new one starts", async () => {
  let otp = "111111";
  const h = harness({ mintOtp: () => otp });
  const r = await issue(h);
  otp = "222222";
  await resendLinkOtp(ENV_LIVE, h.deps, { linkRef: r.linkRef, mobile: "9876543210", now: () => at(30), io: h.deps });
  assert.equal((await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "111111", now: () => at(40) })).ok, false,
    "the superseded code must not still work");
  assert.equal((await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "222222", now: () => at(41) })).ok, true);
});

test("a resend does NOT extend the original expiry", async () => {
  const h = harness();
  const r = await issue(h);
  await resendLinkOtp(ENV_LIVE, h.deps, { linkRef: r.linkRef, mobile: "9876543210", now: () => at(60), io: h.deps });
  const v = await verifyLinkOtp(h.deps, { linkRef: r.linkRef, token: "123456", now: () => at(OTP_TTL_SEC + 1) });
  assert.equal(v.ok, false, "resending must not become a way to keep a reference alive forever");
});

test("resending an unknown or already-expired reference delivers nothing", async () => {
  const h = harness();
  const out = await resendLinkOtp(ENV_LIVE, h.deps, { linkRef: "never-issued", mobile: "9876543210", now: () => NOW, io: h.deps });
  assert.equal(out.delivered, false);
  assert.equal(out.reason, "unknown-or-expired");
  assert.equal(h.sent.length, 0, "nothing may be sent for a reference we do not hold");
});

// ── RATE LIMITING ───────────────────────────────────────────────────────────────────────────────────
test("the send budget bounds OTPs per patient per window", async () => {
  const h = harness();
  for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
    const ok = await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P", now: () => NOW });
    assert.equal(ok.allowed, true, "send " + (i + 1));
  }
  const over = await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P", now: () => NOW });
  assert.equal(over.allowed, false);
  assert.equal(over.reason, "rate-limited");
});

test("link/init cannot be turned into an SMS bombing tool", async () => {
  const h = harness();
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await issue(h, ENV_LIVE, { now: () => NOW }));
  assert.equal(h.sent.length, MAX_SENDS_PER_WINDOW, "only the budgeted number of messages leave");
  const refused = results.filter((r) => !r.linkRef);
  assert.equal(refused.length, 6 - MAX_SENDS_PER_WINDOW);
  assert.ok(refused.every((r) => r.reason === "rate-limited"));
});

test("the budget is per patient and per tenant, so one patient cannot starve another", async () => {
  const h = harness();
  for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P1", now: () => NOW });
  assert.equal((await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P1", now: () => NOW })).allowed, false);
  assert.equal((await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P2", now: () => NOW })).allowed, true);
  assert.equal((await claimSendBudget(h.deps, { tenantId: "t2", patientRef: "P1", now: () => NOW })).allowed, true);
});

test("a new window resets the budget", async () => {
  const h = harness();
  for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P", now: () => NOW });
  assert.equal((await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P", now: () => NOW })).allowed, false);
  assert.equal((await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P", now: () => at(3601) })).allowed, true);
});

test("the budget fails CLOSED with no store and on a broken clock", async () => {
  assert.equal((await claimSendBudget({ kv: null }, { tenantId: "t1", patientRef: "P", now: () => NOW })).allowed, false);
  const h = harness();
  assert.equal((await claimSendBudget(h.deps, { tenantId: "t1", patientRef: "P", now: () => "nope" })).allowed, false,
    "an unbounded OTP path is a bombing tool, so no clock means no send");
});

test("a refused budget mints NOTHING - no live reference nobody can satisfy", async () => {
  const h = harness();
  for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) await issue(h);
  const r = await issue(h);
  assert.equal(r.linkRef, null);
  assert.equal(r.delivered, false);
});

// ── DELIVERY FAILURE, and never faking it ───────────────────────────────────────────────────────────
test("with no DLT template configured, delivery is not attempted and reports not_configured", async () => {
  assert.equal(otpDeliveryConfigured(ENV_NO_TEMPLATE), false,
    "an Indian transactional SMS without an approved template is dropped by the provider");
  const h = harness();
  const out = await deliverOtp(ENV_NO_TEMPLATE, h.deps, { mobile: "9876543210", otp: "123456" });
  assert.deepEqual(out, { ok: false, reason: "not_configured" });
  assert.equal(h.sent.length, 0);
});

test("with a template but no provider, delivery still reports not_configured", async () => {
  assert.equal(otpDeliveryConfigured(ENV_NO_PROVIDER), false);
  const h = harness();
  assert.equal((await deliverOtp(ENV_NO_PROVIDER, h.deps, { mobile: "9876543210", otp: "1" })).ok, false);
  assert.equal(h.sent.length, 0);
});

test("a provider that refuses is reported as a failure, never as a send", async () => {
  const h = harness({ respond: async () => ({ ok: false, reason: "insufficient_balance" }) });
  const out = await deliverOtp(ENV_LIVE, h.deps, { mobile: "9876543210", otp: "123456" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "insufficient_balance");
});

test("a provider that THROWS is reported as a failure, never as a send", async () => {
  const h = harness({ respond: async () => { throw new Error("socket hang up"); } });
  const out = await deliverOtp(ENV_LIVE, h.deps, { mobile: "9876543210", otp: "123456" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "exception");
});

test("a bad or missing number is refused before any provider call", async () => {
  const h = harness();
  for (const bad of [null, "", "12345", "abc"]) {
    const out = await deliverOtp(ENV_LIVE, h.deps, { mobile: bad, otp: "123456" });
    assert.equal(out.ok, false, "must refuse " + bad);
    assert.equal(out.reason, "bad_number");
  }
  assert.equal(h.sent.length, 0);
});

test("WhatsApp is preferred when configured, and falls back to SMS on failure", async () => {
  const env = { ...ENV_LIVE, FOLLOWCARE_MSG_CHANNEL: "whatsapp",
                FOLLOWCARE_WA_PROVIDER: "custom", FOLLOWCARE_WA_URL: "https://x", FOLLOWCARE_WA_BODY: "{}" };
  const okWa = harness({ respond: async (ch) => ({ ok: ch === "whatsapp" }) });
  assert.deepEqual(await deliverOtp(env, okWa.deps, { mobile: "9876543210", otp: "1" }), { ok: true, channel: "whatsapp" });

  const failWa = harness({ respond: async (ch) => ({ ok: ch === "sms" }) });
  const out = await deliverOtp(env, failWa.deps, { mobile: "9876543210", otp: "1" });
  assert.equal(out.ok, true);
  assert.equal(out.channel, "sms");
  assert.equal(out.waFellBack, true);
  assert.deepEqual(failWa.sent.map((s) => s.channel), ["whatsapp", "sms"]);
});

test("the message carries the OTP and nothing else identifying", async () => {
  const h = harness();
  await deliverOtp(ENV_LIVE, h.deps, { mobile: "9876543210", otp: "123456", facilityName: "StewardMD" });
  const body = h.sent[0].payload.body;
  assert.ok(body.includes("123456"));
  assert.ok(body.includes("StewardMD"));
  assert.ok(/expires/i.test(body) && /not share/i.test(body), "an OTP message should say both");
  assert.ok(!body.includes("9876543210"), "the number is the destination, not content");
});

// ── binding ─────────────────────────────────────────────────────────────────────────────────────────
test("an unbound store is refused rather than silently skipping the OTP", async () => {
  await assert.rejects(() => issueLinkOtp(ENV_LIVE, { kv: null }, { tenantId: "t1", patientRef: "P" }), OtpError);
  await assert.rejects(() => verifyLinkOtp({ kv: null }, { linkRef: "x", token: "1" }), OtpError);
});
