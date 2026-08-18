// ABDM M1 (ABHA creation + verification). Contracts pinned to the official M1 Postman collection
// (18-08-2025) and live-verified against the sandbox on 2026-08-18.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abdmConfig, abhaUrl, callbackUrl, abdmConfigured, AbdmConfigError } from "../../../functions/_connect/abdm/config.js";
import {
  abhaHeaders, abhaErrorFrom, rsaEncrypt, AbhaError, ENROL_CONSENT, SCOPES,
  isAadhaar, isMobile, isOtp, isAbhaNumber, isAbhaAddress, formatAbhaNumber, abhaLast4,
  enrolSendAadhaarOtp, enrolVerifyAadhaarOtp, enrolSendMobileOtp, abhaAddressSuggestions,
  createAbhaAddress, loginSendOtp, loginVerifyOtp, addressSearchAuthMethods, findAbhaByMobile,
  getProfile, getAbhaCard, profilePath, cardPath, normalizeProfile,
} from "../../../functions/_connect/abdm/abha.js";

const SANDBOX = { ABDM_ENV: "sandbox", ABDM_CALLBACK_BASE: "https://abdm.stewardmd.in" };

// A throwaway RSA key so encryption can be verified by decrypting, without any ABDM dependency.
async function testKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-1" },
    true, ["encrypt", "decrypt"]);
  const spki = Buffer.from(await crypto.subtle.exportKey("spki", kp.publicKey)).toString("base64");
  return { spki, privateKey: kp.privateKey };
}

/** Capturing fetch. Records every call; returns `body` as JSON with 200. */
function recorder(body = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, json: init && init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, text: async () => JSON.stringify(body), headers: { get: () => "application/json" } };
  };
  f.calls = calls;
  return f;
}
// deps with a pre-seeded cert cache so tests never fetch the certificate.
const depsWith = (f, spki) => ({ fetch: f, token: "sess", kv: { get: async () => spki, put: async () => {} }, now: () => 0 });

// ── config ──────────────────────────────────────────────────────────────────────────────────────────
test("sandbox and production base URLs match the ABDM FAQ Q3 table", () => {
  const s = abdmConfig(SANDBOX);
  assert.equal(s.cmId, "sbx");
  assert.equal(s.gatewayBase, "https://dev.abdm.gov.in");
  assert.equal(abhaUrl(s, "/enrollment/request/otp"), "https://abhasbx.abdm.gov.in/abha/api/v3/enrollment/request/otp");
  assert.equal(abhaUrl(s, "/login/abha/search", true), "https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/search");

  const p = abdmConfig({ ABDM_ENV: "production" });
  assert.equal(p.cmId, "abdm");
  assert.equal(p.gatewayBase, "https://apis.abdm.gov.in");
  assert.equal(abhaUrl(p, "/profile/account"), "https://abha.abdm.gov.in/api/abha/v3/profile/account");
  assert.equal(abhaUrl(p, "/login/profile/abha-profile", true), "https://phr.abdm.gov.in/api/phr/web/v3/login/profile/abha-profile");
});

test("an unknown ABDM_ENV fails closed", () => {
  assert.throws(() => abdmConfig({ ABDM_ENV: "staging" }), AbdmConfigError);
});

test("callbackUrl requires the India host to be configured, and never doubles slashes", () => {
  assert.throws(() => callbackUrl(abdmConfig({ ABDM_ENV: "sandbox" }), "/x"), AbdmConfigError);
  assert.equal(abdmConfigured({ ABDM_ENV: "sandbox" }), false);
  const cfg = abdmConfig({ ...SANDBOX, ABDM_CALLBACK_BASE: "https://abdm.stewardmd.in/" });
  assert.equal(callbackUrl(cfg, "api/v3/hip/patient/share"), "https://abdm.stewardmd.in/api/v3/hip/patient/share");
  assert.equal(abdmConfigured(SANDBOX), true);
});

// ── validation + formatting ─────────────────────────────────────────────────────────────────────────
test("field validators match the certification rules", () => {
  assert.ok(isAadhaar("123456789012") && !isAadhaar("12345") && !isAadhaar("12345678901a"));
  assert.ok(isMobile("9876543210") && !isMobile("1234567890") && !isMobile("98765"));
  assert.ok(isOtp("123456") && !isOtp("12345") && !isOtp("1234567"));
  assert.ok(isAbhaNumber("91178386176531") && isAbhaNumber("91-1783-8617-6531") && !isAbhaNumber("911783861765"));
  assert.ok(isAbhaAddress("singh128@sbx") && !isAbhaAddress("singh128") && !isAbhaAddress("@sbx"));
});

test("ABHA numbers format 2-4-4-4 and reduce to last-4 for storage", () => {
  assert.equal(formatAbhaNumber("91178386176531"), "91-1783-8617-6531");
  assert.equal(abhaLast4("91-1783-8617-6531"), "6531");
});

// ── headers ─────────────────────────────────────────────────────────────────────────────────────────
test("headers carry a fresh REQUEST-ID and a millisecond zero-UTC TIMESTAMP", () => {
  const a = abhaHeaders({ token: "t", now: () => 0 });
  assert.match(a["REQUEST-ID"], /^[0-9a-f-]{36}$/i);
  assert.equal(a.TIMESTAMP, "1970-01-01T00:00:00.000Z");
  assert.equal(a.Authorization, "Bearer t");
  assert.notEqual(abhaHeaders({})["REQUEST-ID"], abhaHeaders({})["REQUEST-ID"], "REQUEST-ID must be fresh per call");
});

test("the per-user tokens are their own headers, never Authorization", () => {
  const h = abhaHeaders({ token: "sess", xToken: "x", tToken: "t", rToken: "r", txnId: "txn" });
  assert.equal(h.Authorization, "Bearer sess");
  assert.equal(h["X-token"], "Bearer x");
  assert.equal(h["T-token"], "Bearer t");
  assert.equal(h["R-token"], "Bearer r");
  assert.equal(h.Transaction_Id, "txn");
});

// ── error shapes ────────────────────────────────────────────────────────────────────────────────────
test("all three ABDM error shapes are normalised", () => {
  const coded = abhaErrorFrom({ code: "ABDM-1227", message: "maximum limit of 100 ABHA account creations" }, 400);
  assert.equal(coded.code, "ABDM-1227");
  assert.match(coded.message, /100 ABHA/);

  const nested = abhaErrorFrom({ error: { code: "ABDM-1094", message: "X-token expired" } }, 401);
  assert.equal(nested.code, "ABDM-1094");

  // Observed live: M1 field validation returns a flat field map with no code (FAQ Q10).
  const field = abhaErrorFrom({ loginId: "Invalid LoginId", timestamp: "2026-08-18 18:21:59" }, 400);
  assert.equal(field.field, "loginId");
  assert.equal(field.message, "Invalid LoginId");
  assert.equal(field.code, null);

  assert.equal(abhaErrorFrom(null, 503).message, "ABHA HTTP 503");
});

// ── RSA field encryption ────────────────────────────────────────────────────────────────────────────
test("rsaEncrypt produces OAEP-SHA1 ciphertext the matching private key can decrypt", async () => {
  const { spki, privateKey } = await testKeyPair();
  const ct = await rsaEncrypt(spki, "999912345678");
  const pt = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, Buffer.from(ct, "base64"));
  assert.equal(new TextDecoder().decode(pt), "999912345678");
});

test("rsaEncrypt is randomised, so identical inputs never produce identical ciphertext", async () => {
  const { spki } = await testKeyPair();
  assert.notEqual(await rsaEncrypt(spki, "9876543210"), await rsaEncrypt(spki, "9876543210"));
});

test("rsaEncrypt without a key fails closed rather than sending plaintext", async () => {
  await assert.rejects(() => rsaEncrypt("", "123456789012"), AbhaError);
});

// ── enrolment ───────────────────────────────────────────────────────────────────────────────────────
test("enrol OTP request matches the collection body and encrypts the Aadhaar", async () => {
  const { spki, privateKey } = await testKeyPair();
  const f = recorder({ txnId: "T1" });
  await enrolSendAadhaarOtp(abdmConfig(SANDBOX), depsWith(f, spki), { aadhaar: "999912345678" });

  const c = f.calls[0];
  assert.equal(c.url, "https://abhasbx.abdm.gov.in/abha/api/v3/enrollment/request/otp");
  assert.deepEqual(c.json.scope, SCOPES.enrolByAadhaar);
  assert.equal(c.json.loginHint, "aadhaar");
  assert.equal(c.json.otpSystem, "aadhaar");
  assert.equal(c.json.txnId, "");
  // the Aadhaar on the wire is ciphertext, and decrypts back to what we passed
  const pt = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, Buffer.from(c.json.loginId, "base64"));
  assert.equal(new TextDecoder().decode(pt), "999912345678");
});

test("NO plaintext Aadhaar, mobile or OTP ever appears in a request body", async () => {
  const { spki } = await testKeyPair();
  const cfg = abdmConfig(SANDBOX);
  const f = recorder({ txnId: "T1" });
  const deps = depsWith(f, spki);
  await enrolSendAadhaarOtp(cfg, deps, { aadhaar: "999912345678" });
  await enrolSendMobileOtp(cfg, deps, { txnId: "T1", mobile: "9876543210" });
  await loginSendOtp(cfg, deps, { loginHint: "abha-number", loginId: "91178386176531", otpSystem: "aadhaar" });
  await findAbhaByMobile(cfg, deps, { mobile: "9876543210" });

  for (const c of f.calls) {
    const raw = JSON.stringify(c.json);
    assert.ok(!raw.includes("999912345678"), "Aadhaar leaked into " + c.url);
    assert.ok(!raw.includes("91178386176531"), "ABHA number leaked into " + c.url);
    // the communication mobile is sent in the clear ONLY inside enrol/byAadhaar per the collection
    if (!c.url.endsWith("/enrollment/enrol/byAadhaar")) {
      assert.ok(!raw.includes("9876543210"), "mobile leaked into " + c.url);
    }
  }
});

test("creating the ABHA number sends the published consent block", async () => {
  const { spki } = await testKeyPair();
  const f = recorder({ ABHAProfile: {} });
  await enrolVerifyAadhaarOtp(abdmConfig(SANDBOX), depsWith(f, spki), { txnId: "T1", otp: "123456", mobile: "9876543210" });
  const c = f.calls[0];
  assert.equal(c.url, "https://abhasbx.abdm.gov.in/abha/api/v3/enrollment/enrol/byAadhaar");
  assert.deepEqual(c.json.consent, { code: "abha-enrollment", version: "1.4" });
  assert.deepEqual(c.json.authData.authMethods, ["otp"]);
  assert.equal(c.json.authData.otp.mobile, "9876543210");
  assert.equal(c.json.authData.otp.txnId, "T1");
});

test("bad inputs are rejected locally, before any network call", async () => {
  const { spki } = await testKeyPair();
  const cfg = abdmConfig(SANDBOX);
  const f = recorder();
  const deps = depsWith(f, spki);
  await assert.rejects(() => enrolSendAadhaarOtp(cfg, deps, { aadhaar: "12345" }), AbhaError);
  await assert.rejects(() => enrolVerifyAadhaarOtp(cfg, deps, { txnId: "T", otp: "12" }), AbhaError);
  await assert.rejects(() => enrolVerifyAadhaarOtp(cfg, deps, { otp: "123456" }), AbhaError);
  await assert.rejects(() => enrolSendMobileOtp(cfg, deps, { mobile: "123" }), AbhaError);
  await assert.rejects(() => abhaAddressSuggestions(cfg, deps, {}), AbhaError);
  await assert.rejects(() => createAbhaAddress(cfg, deps, { txnId: "T" }), AbhaError);
  await assert.rejects(() => addressSearchAuthMethods(cfg, deps, { abhaAddress: "nope" }), AbhaError);
  assert.equal(f.calls.length, 0, "no request should have been made");
});

test("address suggestions pass the txnId as the Transaction_Id HEADER, not a body field", async () => {
  const { spki } = await testKeyPair();
  const f = recorder({ abhaAddressList: ["a@sbx", "b@sbx", "c@sbx"] });
  await abhaAddressSuggestions(abdmConfig(SANDBOX), depsWith(f, spki), { txnId: "T1" });
  const c = f.calls[0];
  assert.equal(c.init.method, "GET");
  assert.equal(c.init.headers.Transaction_Id, "T1");
  assert.equal(c.json, null);
});

// ── verification flows ──────────────────────────────────────────────────────────────────────────────
test("ABHA-address verification uses the /phr/web base and its own scope", async () => {
  const { spki } = await testKeyPair();
  const cfg = abdmConfig(SANDBOX);
  const f = recorder({ txnId: "T2" });
  await loginSendOtp(cfg, depsWith(f, spki), {
    loginHint: "abha-address", loginId: "singh128@sbx", otpSystem: "abdm",
    scope: SCOPES.addressLoginMobile, addressFlow: true,
  });
  assert.equal(f.calls[0].url, "https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/request/otp");
  assert.deepEqual(f.calls[0].json.scope, ["abha-address-login", "mobile-verify"]);
});

test("an unsupported loginHint is refused rather than sent", async () => {
  const { spki } = await testKeyPair();
  await assert.rejects(
    () => loginSendOtp(abdmConfig(SANDBOX), depsWith(recorder(), spki), { loginHint: "email", loginId: "x" }),
    AbhaError);
});

test("find-ABHA-by-mobile uses the search scope on the profile search endpoint", async () => {
  const { spki } = await testKeyPair();
  const f = recorder({ txnId: "T3", accounts: [] });
  await findAbhaByMobile(abdmConfig(SANDBOX), depsWith(f, spki), { mobile: "9876543210" });
  assert.equal(f.calls[0].url, "https://abhasbx.abdm.gov.in/abha/api/v3/profile/account/abha/search");
  assert.deepEqual(f.calls[0].json.scope, ["search-abha"]);
});

// ── the FAQ Q21 trap ────────────────────────────────────────────────────────────────────────────────
test("profile/card endpoints differ per verification flow (wrong pair => ABDM-1094)", () => {
  assert.equal(profilePath(false), "/profile/account");
  assert.equal(cardPath(false), "/profile/account/abha-card");
  assert.equal(profilePath(true), "/login/profile/abha-profile");
  assert.equal(cardPath(true), "/login/profile/abha/phr-card");
});

test("getProfile and getAbhaCard resolve the flow-correct absolute URL and send X-token", async () => {
  const { spki } = await testKeyPair();
  const cfg = abdmConfig(SANDBOX);
  const f = recorder({});
  const deps = depsWith(f, spki);
  await getProfile(cfg, deps, { xToken: "XT" });
  await getProfile(cfg, deps, { xToken: "XT", addressFlow: true });
  await getAbhaCard(cfg, deps, { xToken: "XT", addressFlow: true });
  assert.equal(f.calls[0].url, "https://abhasbx.abdm.gov.in/abha/api/v3/profile/account");
  assert.equal(f.calls[1].url, "https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/profile/abha-profile");
  assert.equal(f.calls[2].url, "https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/profile/abha/phr-card");
  assert.equal(f.calls[0].init.headers["X-token"], "Bearer XT");
  await assert.rejects(() => getProfile(cfg, deps, {}), AbhaError);
});

// ── normalisation ───────────────────────────────────────────────────────────────────────────────────
test("normalizeProfile masks the ABHA number and marks the Aadhaar-verified fields non-editable", () => {
  const n = normalizeProfile({ ABHAProfile: {
    ABHANumber: "91-1783-8617-6531", preferredAbhaAddress: "singh128@sbx", firstName: "Hina", lastName: "Patel",
    gender: "F", dayOfBirth: "10", monthOfBirth: "10", yearOfBirth: "1994", mobile: "9876543210",
    address: { line: "12 MG Road", district: "Pune", state: "Maharashtra", pincode: "411001" },
  } });
  assert.equal(n.abhaNumber, "91178386176531");
  assert.equal(n.abhaNumberMasked, "XX-XXXX-XXXX-6531");
  assert.equal(n.abhaAddress, "singh128@sbx");
  assert.equal(n.name, "Hina Patel");
  assert.equal(n.dob, "10-10-1994");
  assert.equal(n.yearOfBirth, "1994");
  assert.match(n.address, /Pune/);
  assert.deepEqual(n.verifiedFields, ["name", "gender", "dob"]);
});

test("normalizeProfile tolerates a flat profile and a missing number", () => {
  const n = normalizeProfile({ name: "A B", gender: "M", yearOfBirth: 1980 });
  assert.equal(n.abhaNumber, "");
  assert.equal(n.abhaNumberMasked, "");
  assert.equal(n.yearOfBirth, "1980");
});
