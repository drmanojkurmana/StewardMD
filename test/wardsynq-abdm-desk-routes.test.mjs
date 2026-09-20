/* test/wardsynq-abdm-desk-routes.test.mjs - owner S6 phase A5: ABHA at the WardSynQ registration desk.
 *
 * Routes, through the real router: GET "/ward/abdm-desk", POST "/ward/abha" (one step of verifying or creating an
 * ABHA) and POST "/patient/register" with an abhaProof. The ABHA V3 client (functions/_connect/abdm/abha.js) runs for
 * real; only the socket is replaced: globalThis.fetch answers as the sandbox gateway and the ABHA service would.
 * Contracts: the official M1 Postman collection (18-08-2025) as pinned in test/connect/abdm/abha-m1.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-abdm-desk-routes.test.mjs
 */
import { as, seed, docs, H, ENV, ORG_ID, OTHER, ADMIN, NURSE, HR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { makeAbdmDb } = await import("../functions/_connect/abdm/abdm-testkit.js");
const { abhaHashFor } = await import("../functions/_connect/abdm/abha-link.js");
const { makeSecrets } = await import("../functions/_connect/secrets.js");
const { mintAbhaProof, readAbhaProof, abhaDesk } = await import("../functions/_wardsynq/abdm-desk.js");
const { isValidAbhaNumber } = await import("../functions/_opd_patient.js");

const HFR = "IN2810006668";
const TENANT = "tenant-wsq";
const ADDRESS = "ramesh@sbx";
const AADHAAR = "999912345678";
// A 14-digit ABHA number with a correct Verhoeff check digit, so the registration's own validation accepts it.
const NUMBER = (() => { for (let d = 0; d < 10; d++) if (isValidAbhaNumber("9123456789012" + d)) return "9123456789012" + d; throw new Error("no check digit"); })();
const PG = "pg@example.test";   // pg_resident: holds queue.add but is not in owner A5's ABHA desk table

const sanitize = (x) => String(x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);

/* ---- the hospital -------------------------------------------------------------------------------------- */

function setup() {
  seed();
  docs.get(`q_orgs/${ORG_ID}`).fields.regionProfile = { hfrId: HFR };
  docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(PG))}`, { fields: { orgId: ORG_ID, identity: idFor(PG), role: "pg_resident", active: true }, updateTime: "t1" });
  ENV.CONNECT_DB = makeAbdmDb({ connect_tenant: [
    { id: TENANT, name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: ORG_ID } }) },
    { id: "tenant-other", name: "Other", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: OTHER } }) },
  ] });
  ENV.ABDM_CLIENT_SECRET = "bridge-secret";
  ENV.CONNECT_HMAC_SALT = Buffer.from("connect-test-hmac-salt-key-1234").toString("base64");
  ENV.CONNECT_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
  return ENV.CONNECT_DB;
}
const saveProfile = (settings) => as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "abdm", provider: "shared-bridge", settings: { hfrFacilityId: HFR, status: "draft", ...(settings || {}) } });
async function connect() {
  for (const s of [{}, { status: "submitted" }, { status: "sandbox-linked", hipId: HFR, hiuId: HFR }]) {
    const r = await saveProfile(s);
    assert.equal(r.__status, 200, r.__text);
  }
}
const table = (name) => (ENV.CONNECT_DB._tables[name] || []);

/* ---- the socket ------------------------------------------------------------------------------------------ */

async function rsaKeys() {
  const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-1" }, true, ["encrypt", "decrypt"]);
  return { spki: Buffer.from(await crypto.subtle.exportKey("spki", kp.publicKey)).toString("base64"), privateKey: kp.privateKey };
}
const decrypt = async (keys, b64) => new TextDecoder().decode(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, keys.privateKey, Buffer.from(b64, "base64")));
const reply = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });

const PROFILE = { ABHANumber: NUMBER.replace(/^(\d{2})(\d{4})(\d{4})(\d{4})$/, "$1-$2-$3-$4"), preferredAbhaAddress: ADDRESS, name: "Ramesh Kumar",
  gender: "M", dayOfBirth: "12", monthOfBirth: "05", yearOfBirth: "1985", mobile: "9876543210", profilePhoto: "PHOTO-BYTES-DO-NOT-LEAK", kycVerified: "true" };

/** Answers as ABDM would, records every call. */
function abdmSocket(keys) {
  const calls = [];
  const f = async (url, init) => {
    const u = new URL(String(url)), i = init || {};
    let body = null; try { body = i.body ? JSON.parse(i.body) : null; } catch { body = null; }
    calls.push({ url: u.origin + u.pathname, method: i.method || "GET", headers: i.headers || {}, body, raw: i.body || "" });
    if (u.href === "https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions") return reply({ accessToken: "gw-token", expiresIn: 600 });
    if (u.href === "https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate") return reply({ publicKey: keys.spki });
    if (u.pathname === "/abha/api/v3/profile/login/request/otp") return reply({ txnId: "txn-verify-1", message: "OTP sent" });
    if (u.pathname === "/abha/api/v3/profile/login/verify") return reply({ token: "x-token-secret", authResult: "success" });
    if (u.pathname === "/abha/api/v3/profile/account") return reply(PROFILE);
    if (u.pathname === "/abha/api/v3/enrollment/request/otp") return reply({ txnId: "txn-enrol-1", message: "OTP sent to Aadhaar mobile" });
    return reply({ error: "unexpected " + u.pathname }, 404);
  };
  f.calls = calls;
  return f;
}
async function withSocket(sock, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = sock;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
const step = (who, body) => as(who, "/ward/abha", "POST", { orgId: ORG_ID, ...body });

/* ---- who may use the desk ------------------------------------------------------------------------------- */

test("negative authorization: no session 401; hr (no queue.add) 403; another hospital's admin 403; nothing written or sent", async () => {
  setup();
  await connect();
  const sock = abdmSocket(await rsaKeys());
  const before = writesNow(), docsBefore = docs.size;
  await withSocket(sock, async () => {
    assert.equal((await as(null, `/ward/abdm-desk?orgId=${ORG_ID}`)).__status, 401);
    assert.equal((await step(null, { step: "verify-otp", abhaId: NUMBER })).__status, 401);
    assert.equal((await as(null, "/patient/register", "POST", { orgId: ORG_ID, name: "No Session", mobile: "9876500101", gender: "male", ageYears: 30 })).__status, 401);
    for (const who of [HR, OTHER_ADMIN]) {
      const g = await as(who, `/ward/abdm-desk?orgId=${ORG_ID}`);
      assert.equal(g.__status, 403, `${who}: ${g.__text}`);
      const p = await step(who, { step: "consent", agreed: ["aadhaar-auth"] });
      assert.equal(p.__status, 403, `${who}: ${p.__text}`);
      const reg = await as(who, "/patient/register", "POST", { orgId: ORG_ID, name: "Refused Person", mobile: "9876500102", gender: "male", ageYears: 30, abhaNumber: NUMBER, abhaProof: "x.y" });
      assert.equal(reg.__status, 403, `${who}: ${reg.__text}`);
    }
  });
  assert.equal(sock.calls.length, 0, "nothing reached ABDM");
  assert.equal(writesNow(), before);
  assert.equal(docs.size, docsBefore, "no patient, ticket or counter was written");
  assert.equal(table("connect_abdm_enrol_consent").length, 0);
  assert.equal(table("connect_audit_event").length, 0);
});

test("owner A5: a role that registers patients but is not in the ABHA desk table is refused abha_role_refused, before ABDM", async () => {
  setup();
  await connect();
  const sock = abdmSocket(await rsaKeys());
  await withSocket(sock, async () => {
    const st = await as(PG, `/ward/abdm-desk?orgId=${ORG_ID}`);
    assert.equal(st.__status, 200, st.__text);
    assert.deepEqual([st.connection.connected, st.canVerify, st.canCreate], [true, false, false]);
    for (const [s, what] of [["verify-otp", /cannot verify/], ["consent", /cannot create/], ["enrol-otp", /cannot create/]]) {
      const r = await step(PG, { step: s, abhaId: NUMBER, agreed: [], aadhaar: AADHAAR });
      assert.equal(r.__status, 403, r.__text);
      assert.equal(r.error, "abha_role_refused");
      assert.match(r.message, what);
    }
  });
  assert.equal(sock.calls.length, 0);
  assert.equal(table("connect_abdm_enrol_consent").length, 0);
  // The pure door agrees for a role that holds neither (pharmacy registers nobody).
  const direct = await abhaDesk(null, ENV, { role: "pharmacy", step: "verify-otp", body: {} });
  assert.equal(direct.error, "abha_role_refused");
  // And an unknown step is not a step.
  assert.equal((await step(NURSE, { step: "search-everyone" })).error, "unknown_step");
});

/* ---- not connected ---------------------------------------------------------------------------------------- */

test("not connected: the status says so with its code; a step answers 409 abdm_not_connected and nothing is sent", async () => {
  setup();
  const sock = abdmSocket(await rsaKeys());
  await withSocket(sock, async () => {
    const st = await as(NURSE, `/ward/abdm-desk?orgId=${ORG_ID}`);
    assert.equal(st.__status, 200, st.__text);
    assert.equal(st.connection.connected, false);
    assert.equal(st.connection.code, "not_set_up");
    assert.match(st.connection.reason, /not set up for this hospital/);
    assert.deepEqual([st.canVerify, st.canCreate], [true, true]);
    const r = await step(NURSE, { step: "verify-otp", abhaId: NUMBER });
    assert.equal(r.__status, 409, r.__text);
    assert.equal(r.error, "abdm_not_connected");
    assert.equal(r.code, "not_set_up");
    // Linked but without the shared bridge credential on this server: still not connected, still nothing sent.
    await connect();
    delete ENV.ABDM_CLIENT_SECRET;
    const noBridge = await step(NURSE, { step: "verify-otp", abhaId: NUMBER });
    assert.equal(noBridge.__status, 409);
    assert.equal(noBridge.code, "bridge_not_configured");
  });
  assert.equal(sock.calls.length, 0, "no fetch was made");
});

/* ---- verify an existing ABHA ------------------------------------------------------------------------------- */

test("verify: the loginId and OTP leave RSA-encrypted, the profile call carries Authorization and X-token, the answer has profile and proof but no token or photo", async () => {
  const db = setup();
  await connect();
  const keys = await rsaKeys();
  const sock = abdmSocket(keys);
  await withSocket(sock, async () => {
    const st = await as(NURSE, `/ward/abdm-desk?orgId=${ORG_ID}`);
    assert.deepEqual(st.connection, { connected: true, code: "connected", env: "sandbox", hfrFacilityId: HFR, hipId: HFR, hiuId: HFR });

    const otp = await step(NURSE, { step: "verify-otp", abhaId: NUMBER });
    assert.equal(otp.__status, 200, otp.__text);
    assert.deepEqual([otp.txnId, otp.addressFlow, otp.otpSystem], ["txn-verify-1", false, "abdm"]);
    const session = sock.calls.find((c) => c.url === "https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions");
    assert.ok(session && session.method === "POST", "a gateway session was opened first");
    assert.equal(session.body.clientSecret, "bridge-secret");
    assert.ok(sock.calls.some((c) => c.url === "https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate" && c.method === "GET"));
    const send = sock.calls.find((c) => c.url === "https://abhasbx.abdm.gov.in/abha/api/v3/profile/login/request/otp");
    assert.equal(send.body.loginHint, "abha-number");
    assert.ok(!send.raw.includes(NUMBER), "the ABHA number is not sent in the clear");
    assert.equal(await decrypt(keys, send.body.loginId), NUMBER, "loginId is RSA-OAEP ciphertext of the number");
    assert.equal(send.headers.Authorization, "Bearer gw-token");

    const ok = await step(NURSE, { step: "verify-confirm", txnId: otp.txnId, otp: "123456", addressFlow: false, otpSystem: "abdm" });
    assert.equal(ok.__status, 200, ok.__text);
    const verify = sock.calls.find((c) => c.url === "https://abhasbx.abdm.gov.in/abha/api/v3/profile/login/verify");
    assert.ok(!verify.raw.includes("123456"), "the OTP is not sent in the clear");
    assert.equal(await decrypt(keys, verify.body.authData.otp.otpValue), "123456");
    const prof = sock.calls.find((c) => c.url === "https://abhasbx.abdm.gov.in/abha/api/v3/profile/account");
    assert.equal(prof.method, "GET");
    assert.equal(prof.headers.Authorization, "Bearer gw-token");
    assert.equal(prof.headers["X-token"], "Bearer x-token-secret");

    assert.equal(ok.profile.abhaNumber, NUMBER);
    assert.equal(ok.profile.abhaAddress, ADDRESS);
    assert.equal(ok.profile.name, "Ramesh Kumar");
    assert.equal(ok.linkedTo, null);
    assert.ok(!("photo" in ok.profile));
    assert.ok(!ok.__text.includes("x-token-secret") && !ok.__text.includes("PHOTO-BYTES"), "no user token and no photo in the answer");
    assert.deepEqual(await readAbhaProof(ENV, ok.proof, ORG_ID), { abhaNumber: NUMBER, abhaAddress: ADDRESS });
    assert.equal(await readAbhaProof(ENV, ok.proof, OTHER), null, "the proof is this hospital's only");

    // The same ABHA already bound to a patient here: the desk is told which one.
    db._tables.connect_abha_link = [{ tenant_id: TENANT, patient_abha_hash: await abhaHashFor(ENV, TENANT, NUMBER), abha_last4: NUMBER.slice(-4), abha_address_sealed: null, patient_ref: "MRN-EXISTING-1", created_at: "t", updated_at: "t" }];
    const again = await step(NURSE, { step: "verify-confirm", txnId: otp.txnId, otp: "123456", otpSystem: "abdm" });
    assert.equal(again.__status, 200, again.__text);
    assert.equal(again.linkedTo, "MRN-EXISTING-1");
  });
  const audit = JSON.stringify(table("connect_audit_event"));
  assert.ok(table("connect_audit_event").some((e) => e.action === "abdm.abha.verified" && e.outcome === "ok"));
  assert.ok(!audit.includes(NUMBER) && !audit.includes(ADDRESS) && !audit.includes("123456"), "audit rows carry no ABHA and no OTP");
});

/* ---- consent before the Aadhaar OTP --------------------------------------------------------------------------- */

test("create: no Aadhaar OTP without a recorded consent; with one it proceeds encrypted; a consent is single use", async () => {
  setup();
  await connect();
  const keys = await rsaKeys();
  const sock = abdmSocket(keys);
  const aadhaarOtpCalls = () => sock.calls.filter((c) => c.url === "https://abhasbx.abdm.gov.in/abha/api/v3/enrollment/request/otp");
  await withSocket(sock, async () => {
    const none = await step(NURSE, { step: "enrol-otp", aadhaar: AADHAAR });
    assert.equal(none.__status, 422, none.__text);
    assert.equal(none.error, "consent_required");
    const forged = await step(NURSE, { step: "enrol-otp", aadhaar: AADHAAR, consentId: "not-a-consent" });
    assert.equal(forged.error, "consent_required");
    assert.equal(aadhaarOtpCalls().length, 0, "no Aadhaar OTP was requested");

    const text = await step(NURSE, { step: "consent-text", patientName: "Ramesh Kumar" });
    assert.equal(text.__status, 200, text.__text);
    const incomplete = await step(NURSE, { step: "consent", agreed: ["aadhaar-auth"] });
    assert.equal(incomplete.__status, 422, "a half-ticked consent is not recorded");
    assert.equal(table("connect_abdm_enrol_consent").length, 0);
    const agreed = text.consent.clauses.filter((c) => c.defaultChecked).map((c) => c.id).concat(text.consent.attestations.map((a) => a.id));
    const consent = await step(NURSE, { step: "consent", agreed });
    assert.equal(consent.__status, 200, consent.__text);
    assert.equal(table("connect_abdm_enrol_consent").length, 1);
    assert.equal(table("connect_abdm_enrol_consent")[0].tenant_id, TENANT);

    const sent = await step(NURSE, { step: "enrol-otp", aadhaar: AADHAAR, consentId: consent.consentId });
    assert.equal(sent.__status, 200, sent.__text);
    assert.equal(sent.txnId, "txn-enrol-1");
    const call = aadhaarOtpCalls()[0];
    assert.ok(!call.raw.includes(AADHAAR), "the Aadhaar number is not sent in the clear");
    assert.equal(await decrypt(keys, call.body.loginId), AADHAAR);

    const reused = await step(NURSE, { step: "enrol-otp", aadhaar: AADHAAR, consentId: consent.consentId });
    assert.equal(reused.__status, 422, reused.__text);
    assert.equal(reused.error, "consent_required");
    assert.match(reused.message, /already been used/);
    assert.equal(aadhaarOtpCalls().length, 1, "the reused consent sent nothing");
  });
  assert.ok(!JSON.stringify(ENV.CONNECT_DB._tables).includes(AADHAAR), "the Aadhaar number is stored nowhere");
});

/* ---- registration with a proof --------------------------------------------------------------------------------- */

const regBody = (over) => ({ orgId: ORG_ID, name: "Ramesh Kumar", mobile: "9876543210", gender: "male", ageYears: 41, abhaNumber: NUMBER, abhaAddress: ADDRESS, abhaConsent: true, ...(over || {}) });

test("registration: a forged, expired or other-hospital proof is 422 abha_proof_invalid and no patient is registered", async () => {
  setup();
  await connect();
  const good = await mintAbhaProof(ENV, { orgId: ORG_ID, abhaNumber: NUMBER, abhaAddress: ADDRESS });
  const [body, sig] = good.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ o: ORG_ID, n: NUMBER, a: ADDRESS, x: Date.now() + 3600000 })).toString("base64url");
  const bad = [
    `${body}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`,
    `${forgedBody}.${sig}`,
    await mintAbhaProof(ENV, { orgId: ORG_ID, abhaNumber: NUMBER, abhaAddress: ADDRESS, now: Date.now() - 31 * 60 * 1000 }),
    await mintAbhaProof(ENV, { orgId: OTHER, abhaNumber: NUMBER, abhaAddress: ADDRESS }),
    await mintAbhaProof(ENV, { orgId: ORG_ID, abhaNumber: "91000000000000", abhaAddress: ADDRESS }),
  ];
  const before = writesNow(), docsBefore = docs.size;
  for (const proof of bad) {
    const r = await as(NURSE, "/patient/register", "POST", regBody({ abhaProof: proof }));
    assert.equal(r.__status, 422, r.__text);
    assert.equal(r.error, "abha_proof_invalid");
    assert.ok(!r.mrn);
  }
  assert.equal(docs.size, docsBefore, "no patient, no MR number counter, nothing");
  assert.equal(writesNow(), before);
  assert.equal(table("connect_abha_link").length, 0);
});

test("registration: a valid proof registers and binds the ABHA (HMAC, last four, sealed address, the MRN); a second MRN is refused before one is issued", async () => {
  setup();
  await connect();
  const proof = await mintAbhaProof(ENV, { orgId: ORG_ID, abhaNumber: NUMBER, abhaAddress: ADDRESS });
  const r = await as(NURSE, "/patient/register", "POST", regBody({ abhaProof: proof }));
  assert.equal(r.__status, 200, r.__text);
  assert.ok(r.ok && r.mrn, r.__text);
  assert.equal(r.abhaLink.ok, true, JSON.stringify(r.abhaLink));
  assert.equal(r.abhaLink.created, true);

  const rows = table("connect_abha_link");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.tenant_id, TENANT);
  assert.equal(row.patient_abha_hash, await abhaHashFor(ENV, TENANT, NUMBER));
  assert.equal(row.abha_last4, NUMBER.slice(-4));
  assert.equal(row.patient_ref, r.mrn);
  assert.ok(row.abha_address_sealed && !row.abha_address_sealed.includes(ADDRESS), "the address is sealed");
  assert.equal(await makeSecrets(ENV).open(row.abha_address_sealed), ADDRESS);
  assert.ok(!JSON.stringify(row).includes(NUMBER), "no raw ABHA number in the binding");
  const linked = table("connect_audit_event").filter((e) => e.action === "abdm.abha.linked");
  assert.equal(linked.length, 1);
  assert.equal(linked[0].outcome, "ok");

  // The same ABHA, a different person at the desk: refused before any MR number is issued.
  const docsBefore = docs.size, writes = writesNow();
  const second = await as(NURSE, "/patient/register", "POST", regBody({ name: "Another Person", mobile: "9876500222", abhaProof: await mintAbhaProof(ENV, { orgId: ORG_ID, abhaNumber: NUMBER, abhaAddress: ADDRESS }) }));
  assert.equal(second.__status, 409, second.__text);
  assert.equal(second.error, "abha_already_linked");
  assert.equal(second.mrn, r.mrn, "the desk is told which record to open");
  assert.equal(docs.size, docsBefore, "the patient store is unchanged: no second MR number");
  assert.equal(writesNow(), writes);
  assert.equal(table("connect_abha_link").length, 1);

  // A typed ABHA without a proof is registered as typed and never bound as verified.
  const typedNumber = (() => { for (let d = 0; d < 10; d++) if (isValidAbhaNumber("9199999999999" + d)) return "9199999999999" + d; })();
  const typed = await as(NURSE, "/patient/register", "POST", regBody({ name: "Typed Person", mobile: "9876500333", abhaNumber: typedNumber, abhaAddress: "typed@sbx" }));
  assert.equal(typed.__status, 200, typed.__text);
  assert.equal(typed.abhaLink, undefined);
  assert.equal(table("connect_abha_link").length, 1);

  const audit = JSON.stringify(table("connect_audit_event")) + JSON.stringify(H.RECORD.audit);
  assert.ok(!audit.includes(NUMBER) && !audit.includes(ADDRESS), "no audit row carries the raw ABHA");
});
