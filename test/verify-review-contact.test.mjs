/* test/verify-review-contact.test.mjs - the manual-review email must say WHO the account is.
 *
 * Owner 2026-09-28, screenshot: a medical-student review arrived with an Apple Hide My Email
 * address, "Name read: -", "Confidence 0", and nothing else. "How can I know who is it? No name no
 * details." The account had more on file (profile name, mobile), the email never looked. Also the
 * student card was read with the registration-CERTIFICATE prompt, which returned no name.
 *
 * Pure contact card tests, then one end-to-end run of the student review path through onRequest
 * with Firebase, Gemini and Resend faked, asserting on the email Resend would have been sent.
 *
 * node --test --experimental-test-module-mocks test/verify-review-contact.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mocks (before ANY import that reaches _fbfirestore / _fbadmin, or the real ones get cached) ----
const realAuth = await import("../functions/_fbauth.js");
const realFs = await import("../functions/_fbfirestore.js");
const realAdmin = await import("../functions/_fbadmin.js");
const profiles = new Map();
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseToken: async (tok) => (tok ? "uid-student" : null) },
});
mock.module("../functions/_fbfirestore.js", {
  namedExports: { ...realFs, fsGet: async (_e, path) => (profiles.has(path) ? { fields: profiles.get(path) } : null) },
});
mock.module("../functions/_fbadmin.js", {
  namedExports: { ...realAdmin, mergeUserClaims: async () => ({}), getUserClaims: async () => ({}) },
});

const { contactFrom, contactHtml, isAppleRelay, isAnonymous, gatherReviewContact, escHtml } = await import("../functions/_review_contact.js");
const { onRequest } = await import("../functions/api/verify-doctor.js");

const RELAY = "8tky8vr5rp@privaterelay.appleid.com";
const APPLE_TOKEN = { email: RELAY, firebase: { sign_in_provider: "apple.com" } };

// ---- pure ----------------------------------------------------------------------------------------
test("Apple relay detection matches anchor-email.js (appleid.com and subdomains only)", () => {
  assert.equal(isAppleRelay(RELAY), true);
  assert.equal(isAppleRelay("x@appleid.com"), true);
  assert.equal(isAppleRelay("x@notappleid.com"), false);
  assert.equal(isAppleRelay("doc@gmail.com"), false);
  assert.equal(isAppleRelay(""), false);
});

test("profile name + OTP-verified mobile give a name and a WhatsApp link", () => {
  const c = contactFrom({
    email: RELAY, token: APPLE_TOKEN,
    profile: { name: "Somasreekar Marella", phone: "9876543210", hospital: "GIMSR", city: "Visakhapatnam", state: "AP", smdId: "SMD-ABC234" },
    lifecycle: { phone: "919876543210", phoneVerifiedAt: 1 },
  });
  assert.equal(c.name, "Somasreekar Marella");
  assert.equal(c.nameSource, "profile");
  assert.equal(c.phone, "919876543210");
  assert.equal(c.phoneVerified, true);
  assert.equal(c.whatsapp, "https://wa.me/919876543210");
  assert.equal(c.relay, true);
  assert.equal(c.realEmail, "", "a privaterelay address is not a real email");
  assert.equal(c.provider, "apple.com");
  assert.equal(c.place, "Visakhapatnam, AP");
  assert.equal(isAnonymous(c), false);
});

test("a typed but unverified profile number is still shown, flagged as not verified", () => {
  const c = contactFrom({ email: RELAY, profile: { name: "A", phone: "98765 43210" } });
  assert.equal(c.phone, "919876543210");
  assert.equal(c.phoneVerified, false);
  assert.match(contactHtml(c), /typed, not verified/);
});

test("the OTP-verified number wins over a different number typed into the profile", () => {
  const c = contactFrom({ profile: { phone: "9000000001" }, lifecycle: { phone: "919876543210", phoneVerifiedAt: 5 } });
  assert.equal(c.phone, "919876543210");
  assert.equal(c.phoneVerified, true);
});

test("an anchored real email is offered; a Google account email counts as real", () => {
  const a = contactFrom({ email: RELAY, profile: { anchorEmail: "Soma@Gmail.com", anchorEmailVerified: true } });
  assert.equal(a.realEmail, "soma@gmail.com");
  assert.equal(a.realEmailVerified, true);
  assert.match(contactHtml(a), /mailto:soma@gmail\.com/);
  const g = contactFrom({ email: "doc@gmail.com" });
  assert.equal(g.realEmail, "doc@gmail.com");
  assert.equal(g.relay, false);
});

test("sign-in display name is the fallback when the profile has none", () => {
  const c = contactFrom({ token: { name: "Soma M" } });
  assert.equal(c.name, "Soma M");
  assert.equal(c.nameSource, "sign-in");
  assert.match(contactHtml(c), /from sign-in/);
});

test("nothing on file: says so plainly, and explains the relay address", () => {
  const c = contactFrom({ email: RELAY, token: APPLE_TOKEN });
  assert.equal(isAnonymous(c), true);
  const html = contactHtml(c);
  assert.match(html, /No name, mobile or real email/);
  assert.match(html, /Apple Hide My Email/);
  assert.match(html, /Sign in with Apple for Email Communication/);
});

test("user-typed values cannot inject markup into the owner's inbox", () => {
  const c = contactFrom({ profile: { name: '<a href="https://evil">Verify</a>', hospital: "<img src=x>" } });
  const html = contactHtml(c);
  assert.ok(!html.includes("<a href=\"https://evil\""), "raw anchor must be escaped");
  assert.ok(!html.includes("<img"), "raw img must be escaped");
  assert.ok(html.includes("&lt;a href=&quot;https://evil&quot;&gt;"));
  assert.equal(escHtml(`'"&`), "&#39;&quot;&amp;");
});

test("no em-dash in the contact block", () => {
  const full = contactHtml(contactFrom({ email: RELAY, token: APPLE_TOKEN, profile: { name: "A", phone: "9876543210", hospital: "H", degree: "MBBS", smdId: "SMD-X" } }));
  const empty = contactHtml(contactFrom({ email: RELAY }));
  assert.ok(!/—/.test(full + empty));
});

test("gather: reads only the caller's profile + lifecycle, and survives both failing", async () => {
  const reads = [];
  const c = await gatherReviewContact({}, "uid-1", { email: RELAY, token: APPLE_TOKEN }, {
    fsGet: async (_e, path) => { reads.push(path); return { fields: { name: "Soma" } }; },
    getLifecycle: async (_e, uid) => { reads.push("lc:" + uid); return { phone: "919876543210", phoneVerifiedAt: 1 }; },
  });
  assert.deepEqual(reads.sort(), ["lc:uid-1", "users/uid-1/profile/self"]);
  assert.equal(c.name, "Soma");
  assert.equal(c.phoneVerified, true);

  const d = await gatherReviewContact({}, "uid-1", { email: RELAY, token: APPLE_TOKEN }, {
    fsGet: async () => { throw new Error("fs down"); },
    getLifecycle: async () => { throw new Error("kv down"); },
  });
  assert.equal(d.relay, true);
  assert.equal(isAnonymous(d), true);
});

// ---- end to end: student review through onRequest -----------------------------------------------
function memKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.has(k) ? m.get(k) : null; if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fakeToken = (payload) => b64url({ alg: "none" }) + "." + b64url(payload) + ".sig";

async function runStudentReview({ profile, lifecycle, geminiJson }) {
  const kv = memKV();
  profiles.clear();
  if (profile) profiles.set("users/uid-student/profile/self", profile);
  if (lifecycle) await kv.put("lifecycle:u:uid-student", JSON.stringify(lifecycle));
  const sent = { gemini: [], resend: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes("generativelanguage.googleapis.com")) {
      sent.gemini.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiJson || {}) }] } }] }), { status: 200 });
    }
    if (url.includes("api.resend.com")) { sent.resend.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const env = { GEMINI_API_KEY: "k", FIREBASE_SERVICE_ACCOUNT: "{}", RESEND_API_KEY: "r", VERIFY_ADMIN_TOKEN: "s", CASES_KV: kv, MAIK_KV: kv };
    const req = new Request("https://stewardmd.in/api/verify-doctor", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: fakeToken(APPLE_TOKEN), image: Buffer.from("jpeg").toString("base64"), mime: "image/jpeg", role: "student" }),
    });
    const res = await onRequest({ request: req, env });
    return { res: await res.json(), sent, kv };
  } finally { globalThis.fetch = realFetch; }
}

test("student review email names the account and links WhatsApp (Apple Hide My Email)", async () => {
  const { res, sent, kv } = await runStudentReview({
    profile: { name: "Somasreekar Marella", phone: "9876543210", hospital: "GIMSR Visakhapatnam" },
    lifecycle: { firstSeen: 1, phone: "919876543210", phoneVerifiedAt: 2 },
    geminiJson: { full_name: "SOMASREEKAR MARELLA", institution: "GIMSR Visakhapatnam", course: "MBBS", years: "2022-2027", looks_valid: true, confidence: 0.9 },
  });
  assert.equal(res.status, "pending_review");
  assert.equal(res.reason, "medical_student_id");

  // The card was read as a college ID, not a registration certificate.
  assert.equal(sent.gemini.length, 1);
  const prompt = sent.gemini[0].contents[0].parts[0].text;
  assert.match(prompt, /medical college student ID card/);
  assert.doesNotMatch(prompt, /registration certificate/);

  assert.equal(sent.resend.length, 1);
  const mail = sent.resend[0];
  assert.match(mail.subject, /Somasreekar Marella/, "the subject names the person, not the relay address");
  assert.match(mail.html, /Who is this/);
  assert.match(mail.html, /Somasreekar Marella/);
  assert.match(mail.html, /\+919876543210 \(OTP verified\)/);
  assert.match(mail.html, /https:\/\/wa\.me\/919876543210/);
  assert.match(mail.html, /College read<\/b><\/td><td>GIMSR Visakhapatnam · MBBS · 2022-2027/);
  assert.match(mail.html, /SOMASREEKAR MARELLA/, "name read off the card");
  assert.match(mail.html, /Apple Hide My Email account/);
  assert.match(mail.html, /Verify &amp; grant access/, "approve/block buttons still present");

  const rec = JSON.parse(kv.m.get("icu:doctor:uid-student"));
  assert.equal(rec.extractedName, "SOMASREEKAR MARELLA");
  assert.equal(rec.extractedInstitution, "GIMSR Visakhapatnam");
});

test("nothing on file and nothing read: the email says the card is the only identification", async () => {
  const { res, sent } = await runStudentReview({ geminiJson: { full_name: "", looks_valid: true, confidence: 0 } });
  assert.equal(res.status, "pending_review");
  const mail = sent.resend[0];
  assert.match(mail.html, /No name, mobile or real email on this account yet/);
  assert.match(mail.subject, /privaterelay\.appleid\.com/, "falls back to the sign-in email");
});

test("a multi-line profile name cannot break the subject header", async () => {
  const { sent } = await runStudentReview({ profile: { name: "Soma\r\nBcc: x@y.z" }, geminiJson: { full_name: "", looks_valid: true, confidence: 0 } });
  assert.doesNotMatch(sent.resend[0].subject, /[\r\n]/);
  assert.match(sent.resend[0].subject, /Soma Bcc: x@y\.z/);
});

test("a card-read name is escaped in the email (it comes from a user-supplied image)", async () => {
  const { sent } = await runStudentReview({ geminiJson: { full_name: "<b>x</b>", looks_valid: true, confidence: 0.5 } });
  assert.ok(!sent.resend[0].html.includes("<b>x</b>"));
  assert.ok(sent.resend[0].html.includes("&lt;b&gt;x&lt;/b&gt;"));
});
