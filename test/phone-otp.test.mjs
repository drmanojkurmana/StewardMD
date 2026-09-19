/* test/phone-otp.test.mjs - mobile-number verification: number rules, the WhatsApp -> SMS delivery
 * chain, the OTP record rules (throttle, tries, expiry, daily cap) and the route wiring.
 *
 * Owner request 2026-09-19: "after sign in ask every signup phone number verified by WhatsApp with
 * backup SMS". node --test test/phone-otp.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone, maskPhone, deliverOtp, phoneStart, phoneVerify, phoneVerifyEnabled, smsAvailable,
  otpKey, capKey, TTL, MAX_TRIES, DAILY_CAP, RESEND_THROTTLE,
} from "../functions/_phone_otp.js";

function memKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
const WHO = { uid: "u1", name: "Asha", email: "a@x.in" };

test("normalizePhone: India-first, tolerant of how numbers are typed, strict about what is a number", () => {
  assert.equal(normalizePhone("9876543210"), "919876543210", "bare 10 digits get 91");
  assert.equal(normalizePhone("+91 98765 43210"), "919876543210");
  assert.equal(normalizePhone("098765 43210"), "919876543210", "trunk 0 dropped");
  assert.equal(normalizePhone("+1 415 555 0123"), "14155550123", "other countries pass through");
  assert.equal(normalizePhone("12345"), "", "too short");
  assert.equal(normalizePhone("919123456789012345"), "", "too long");
  assert.equal(normalizePhone("911234567890"), "", "an Indian mobile starts 6-9");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone("9876543210", "44"), "449876543210", "default country code is configurable");
});

test("maskPhone shows the country code and the last four only", () => {
  assert.equal(maskPhone("919876543210"), "+91 ******3210");
  assert.equal(maskPhone("14155550123"), "+1 ******0123");
  assert.equal(maskPhone("12"), "");
});

test("PHONE_VERIFY_ON defaults on and can be switched off without a deploy", () => {
  assert.equal(phoneVerifyEnabled({}), true);
  assert.equal(phoneVerifyEnabled({ PHONE_VERIFY_ON: "0" }), false);
  assert.equal(phoneVerifyEnabled({ PHONE_VERIFY_ON: "false" }), false);
  assert.equal(phoneVerifyEnabled({ PHONE_VERIFY_ON: "1" }), true);
});

/* ── delivery chain ─────────────────────────────────────────────────────────────────────────── */
function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url: String(url), o }); return handler(String(url), o, calls.length); };
  return fn(calls).finally(() => { globalThis.fetch = real; });
}
const WA = { FOLLOWCARE_WA_PROVIDER: "custom", FOLLOWCARE_WA_URL: "https://bsp.example/send", FOLLOWCARE_WA_BODY: '{"to":"{{to}}","text":"{{text}}","code":"{{link}}"}' };
const SMS2F = { FOLLOWCARE_SMS_PROVIDER: "twofactor", TWOFACTOR_API_KEY: "k2f" };
const res = (ok, body) => ({ ok, status: ok ? 200 : 500, text: async () => body });

test("auto: WhatsApp first when configured, and the code goes in the BSP body", () =>
  withFetch((url) => res(true, "{}"), async (calls) => {
    const r = await deliverOtp({ ...WA, ...SMS2F }, { phone: "919876543210", code: "123456", channel: "auto" });
    assert.deepEqual(r, { ok: true, channel: "whatsapp" });
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://bsp.example/send");
    const body = JSON.parse(calls[0].o.body);
    assert.equal(body.to, "919876543210"); assert.equal(body.code, "123456"); assert.match(body.text, /123456 is your StewardMD verification code/);
  }));

test("auto: WhatsApp fails -> SMS backup (2Factor OTP API), reported as a fallback", () =>
  withFetch((url) => url.indexOf("bsp.example") >= 0 ? res(false, "err") : res(true, '{"Status":"Success","Details":"sid"}'), async (calls) => {
    const r = await deliverOtp({ ...WA, ...SMS2F }, { phone: "919876543210", code: "123456", channel: "auto" });
    assert.deepEqual(r, { ok: true, channel: "sms", fellBack: true });
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /^https:\/\/2factor\.in\/API\/V1\/k2f\/SMS\/9876543210\/123456$/, "10-digit number, code, default OTP template");
  }));

test("auto with no WhatsApp provider: straight to SMS, not a fallback; template name honoured", () =>
  withFetch(() => res(true, '{"Status":"Success"}'), async (calls) => {
    const r = await deliverOtp({ ...SMS2F, TWOFACTOR_TEMPLATE_OTP: "STEWARDMD_OTP" }, { phone: "919876543210", code: "654321", channel: "auto" });
    assert.deepEqual(r, { ok: true, channel: "sms", fellBack: false });
    assert.match(calls[0].url, /\/654321\/STEWARDMD_OTP$/);
  }));

test("channel sms skips WhatsApp even when it is configured", () =>
  withFetch(() => res(true, '{"Status":"Success"}'), async (calls) => {
    const r = await deliverOtp({ ...WA, ...SMS2F }, { phone: "919876543210", code: "111111", channel: "sms" });
    assert.equal(r.channel, "sms"); assert.equal(calls.length, 1); assert.match(calls[0].url, /2factor/);
  }));

test("a custom WhatsApp OTP body (PHONE_OTP_WA_BODY) replaces the FollowCare one", () =>
  withFetch(() => res(true, "{}"), async (calls) => {
    await deliverOtp({ ...WA, PHONE_OTP_WA_BODY: '{"template":"otp","params":["{{link}}"],"dst":"{{to}}"}' }, { phone: "919876543210", code: "222222" });
    assert.deepEqual(JSON.parse(calls[0].o.body), { template: "otp", params: ["222222"], dst: "919876543210" });
  }));

test("nothing configured: no_channel, no network, never throws", () =>
  withFetch(() => { throw new Error("must not be called"); }, async (calls) => {
    assert.deepEqual(await deliverOtp({}, { phone: "919876543210", code: "1" }), { ok: false, channel: null, reason: "no_channel" });
    assert.equal(calls.length, 0);
    assert.equal(smsAvailable({}), false); assert.equal(smsAvailable(SMS2F), true);
  }));

test("other SMS providers get the code through sendSms (msg91 recipient var2)", () =>
  withFetch(() => res(true, '{"type":"success"}'), async (calls) => {
    const r = await deliverOtp({ FOLLOWCARE_SMS_PROVIDER: "msg91", MSG91_AUTHKEY: "a", MSG91_TEMPLATE_CHECKIN: "t" }, { phone: "919876543210", code: "333333", channel: "sms", name: "Asha" });
    assert.equal(r.ok, true);
    const p = JSON.parse(calls[0].o.body);
    assert.equal(p.recipients[0].var2, "333333"); assert.equal(p.recipients[0].code, "333333");
  }));

/* ── OTP record rules ───────────────────────────────────────────────────────────────────────── */
function deps(store, deliverResult) {
  const sent = [];
  return { store, sent, defaultCc: "91", deliver: async (phone, code, name, channel) => { sent.push({ phone, code, channel }); return typeof deliverResult === "function" ? deliverResult(channel) : (deliverResult || { ok: true, channel: "whatsapp" }); } };
}

test("phoneStart: validates, stores a 6-digit code with a TTL, counts the number's daily cap, masks the reply", async () => {
  const store = memKV(); const d = deps(store);
  assert.equal((await phoneStart(WHO, { phone: "12" }, d)).error, "bad-phone");
  const r = await phoneStart(WHO, { phone: "98765 43210" }, d);
  assert.equal(r.ok, true); assert.equal(r.channel, "whatsapp"); assert.equal(r.to, "+91 ******3210"); assert.equal(r.ttl, TTL);
  const rec = await store.get(otpKey("u1"), "json");
  assert.match(rec.code, /^\d{6}$/); assert.equal(rec.phone, "919876543210"); assert.equal(rec.tries, 0);
  assert.equal(await store.get(capKey("919876543210")), "1");
  assert.equal(d.sent[0].code, rec.code);
});

test("phoneStart: 30 s throttle per account; a same-window resend by SMS carries the SAME code", async () => {
  const store = memKV(); const d = deps(store, (ch) => ({ ok: true, channel: ch === "sms" ? "sms" : "whatsapp" }));
  await phoneStart(WHO, { phone: "9876543210" }, d);
  const again = await phoneStart(WHO, { phone: "9876543210", channel: "sms" }, d);
  assert.equal(again.error, "too-soon"); assert.ok(again.retryAfter > 0 && again.retryAfter <= RESEND_THROTTLE);
  // Age the record past the throttle and resend by SMS: same code, sms channel.
  const rec = await store.get(otpKey("u1"), "json"); rec.sentAt -= 31; await store.put(otpKey("u1"), JSON.stringify(rec));
  const sms = await phoneStart(WHO, { phone: "9876543210", channel: "sms" }, d);
  assert.equal(sms.ok, true); assert.equal(sms.channel, "sms");
  assert.equal(d.sent[1].code, d.sent[0].code, "one code per window, whichever channel carries it");
  assert.equal(d.sent[1].channel, "sms");
});

test("phoneStart: the per-number daily cap stops at DAILY_CAP, whoever asks", async () => {
  const store = memKV(); const d = deps(store);
  await store.put(capKey("919876543210"), String(DAILY_CAP));
  const r = await phoneStart({ uid: "someone-else" }, { phone: "9876543210" }, d);
  assert.equal(r.error, "daily-cap"); assert.equal(r.status, 429); assert.equal(d.sent.length, 0);
});

test("phoneStart: delivery failure is a soft 200 with a reason, and the code stays for a retry", async () => {
  const store = memKV();
  const r = await phoneStart(WHO, { phone: "9876543210" }, deps(store, { ok: false, channel: null, reason: "no_channel" }));
  assert.equal(r.ok, false); assert.equal(r.error, "no-channel"); assert.equal(r.status, undefined);
  assert.ok(await store.get(otpKey("u1"), "json"));
  const r2 = await phoneStart(WHO, { phone: "9876543210" }, deps(memKV(), { ok: false, channel: null, reason: "sms_failed" }));
  assert.equal(r2.error, "send-failed"); assert.equal(r2.reason, "sms_failed");
});

test("phoneVerify: mismatch counts down, the fifth wrong guess burns the code, the right code verifies once and calls onVerified with the number", async () => {
  const store = memKV(); const d = deps(store);
  await phoneStart(WHO, { phone: "9876543210" }, d);
  const code = d.sent[0].code, wrong = code === "000000" ? "111111" : "000000";
  let verified = null;
  const v = { store, onVerified: async (p) => { verified = p; } };
  assert.equal((await phoneVerify(WHO, { code: "12" }, v)).error, "bad-code");
  for (let i = 1; i < MAX_TRIES; i++) {
    const r = await phoneVerify(WHO, { code: wrong }, v);
    assert.equal(r.error, "mismatch"); assert.equal(r.triesLeft, MAX_TRIES - i);
  }
  const locked = await phoneVerify(WHO, { code: wrong }, v);
  assert.equal(locked.error, "locked", "the fifth wrong guess"); assert.equal(locked.status, 429);
  assert.equal(await store.get(otpKey("u1"), "json"), null, "code burnt");
  assert.equal(verified, null);

  await store.put(capKey("919876543210"), "0");
  const rec0 = { code: "424242", phone: "919876543210", exp: Math.floor(Date.now() / 1000) + 100, tries: 0, sentAt: 0 };
  await store.put(otpKey("u1"), JSON.stringify(rec0));
  const ok = await phoneVerify(WHO, { code: "42 42 42" }, v);
  assert.deepEqual(ok, { ok: true, verified: true, to: "+91 ******3210" });
  assert.equal(verified, "919876543210");
  assert.equal((await phoneVerify(WHO, { code: "424242" }, v)).error, "expired", "a code verifies once");
});

test("phoneVerify: an expired record is refused and removed", async () => {
  const store = memKV();
  await store.put(otpKey("u1"), JSON.stringify({ code: "111111", phone: "919876543210", exp: Math.floor(Date.now() / 1000) - 1, tries: 0 }));
  assert.equal((await phoneVerify(WHO, { code: "111111" }, { store })).error, "expired");
  assert.equal(await store.get(otpKey("u1")), null);
});

test("the auth route wires phone-start / phone-verify before the email gate and honours the kill switch", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../functions/api/auth/[[path]].js", import.meta.url), "utf8");
  const phoneAt = src.indexOf('action === "phone-start"'), gateAt = src.indexOf('error: "no-email-on-account"');
  assert.ok(phoneAt > 0 && gateAt > phoneAt, "phone routes reachable by a Hide-My-Email account");
  assert.match(src, /phoneVerifyEnabled\(env\)/);
  assert.match(src, /mergeUserClaims\(env, who\.uid, \{ phoneVerified: true \}\)/);
  assert.match(src, /markPhoneVerified\(env, who\.uid, phone\)/);
});
