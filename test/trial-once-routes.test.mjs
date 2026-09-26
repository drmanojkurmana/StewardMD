/* test/trial-once-routes.test.mjs - the once-per-doctor free week, through the real routes.
 *
 * Firebase admin, email and the certificate reader are mocked; the KV is in memory. Covers the two
 * doors that grant Pro and are reachable without the live NMC register:
 *   - the owner's approve (/api/verifications/approve)
 *   - the pending-review grant (/api/verify-doctor, intern path -> manual review)
 * Plan: vault/plans/One-Time-Trial.md. node --test --experimental-test-module-mocks test/trial-once-routes.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLAIMS = new Map();   // uid -> claims
const realAdmin = await import("../functions/_fbadmin.js");
const realAuth = await import("../functions/_fbauth.js");
const realEmail = await import("../functions/_email.js");
mock.module("../functions/_fbadmin.js", { namedExports: { ...realAdmin,
  getUserClaims: async (env, uid) => ({ ...(CLAIMS.get(uid) || {}) }),
  mergeUserClaims: async (env, uid, patch) => {
    const c = { ...(CLAIMS.get(uid) || {}) };
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete c[k]; else c[k] = patch[k]; }
    CLAIMS.set(uid, c);
  },
  lookupUidByEmail: async () => null, setUserPassword: async () => {}, serviceAccountToken: async () => "",
  setUserClaims: async () => {}, getUserRecord: async () => null, setUserDisabled: async () => {}, deleteUser: async () => {},
  lookupUserByUid: async () => null, summarizeUser: (u) => u,
} });
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth,
  verifyFirebaseToken: async (tok) => (String(tok).startsWith("tok-") ? String(tok).slice(4) : null),
  verifiedClaimsFor: async () => null,
} });
mock.module("../functions/_email.js", { namedExports: { ...realEmail,
  emailVerified: async () => {}, emailFailed: async () => {}, emailOtp: async () => {}, emailResetCode: async () => {},
  emailTempPassword: async () => {}, emailProConfirmation: async () => {},
} });

function memKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const verifications = await import("../functions/api/verifications/[[path]].js");
const verifyDoctor = await import("../functions/api/verify-doctor.js");

function env(store, mode) {
  return { CASES_KV: store, MAIK_KV: store, TRIAL_PEPPER: "pep", TRIAL_ONCE_ON: mode, VERIFY_ADMIN_TOKEN: "admintok",
           GEMINI_API_KEY: "g", FIREBASE_SERVICE_ACCOUNT: "{}" };
}
async function approve(e, uid, regNo, force) {
  const req = new Request("https://x/api/verifications/approve", { method: "POST", headers: { "X-Admin-Token": "admintok", "Content-Type": "application/json" }, body: JSON.stringify({ uid, regNo, force }) });
  const r = await verifications.onRequest({ request: req, env: e, params: { path: ["approve"] } });
  return { status: r.status, body: await r.json() };
}
// The certificate reader (Gemini) answers with a readable name; the intern role goes straight to review.
function withGemini(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"full_name":"Asha Rao","registration_number":"","looks_valid":true,"confidence":0.9}' }] } }] }) });
  return fn().finally(() => { globalThis.fetch = real; });
}
async function upload(e, uid, hw) {
  const req = new Request("https://x/api/verify-doctor", { method: "POST", headers: { "Content-Type": "application/json", "X-SMD-HW": hw, "CF-Connecting-IP": "203.0.113.4" },
    body: JSON.stringify({ idToken: "tok-" + uid, image: "aGVsbG8=", mime: "image/jpeg", role: "intern" }) });
  const r = await verifyDoctor.onRequest({ request: req, env: e });
  return r.json();
}

test("approve: first account gets the week; a second account with the same reg is refused unless forced, then gets no week", async () => {
  CLAIMS.clear(); const store = memKV(); const e = env(store, "1");
  store._m.set("icu:doctor:old", JSON.stringify({ uid: "old", extractedRegNo: "KMC 1" }));
  const a = await approve(e, "old", "KMC 1");
  assert.equal(a.status, 200); assert.ok(CLAIMS.get("old").verifiedAt, "old account: verified with its week");
  store._m.set("icu:doctor:new", JSON.stringify({ uid: "new", extractedRegNo: "KMC 1" }));
  const b = await approve(e, "new", "KMC 1");
  assert.equal(b.status, 409); assert.equal(b.body.error, "registration_already_claimed"); assert.equal(b.body.ownerUid, "old");
  assert.equal(CLAIMS.get("new"), undefined, "nothing written on refusal");
  const c = await approve(e, "new", "KMC 1", true);
  assert.equal(c.status, 200);
  assert.equal(CLAIMS.get("new").verified, true); assert.ok(CLAIMS.get("new").trialDenied); assert.equal(CLAIMS.get("new").verifiedAt, undefined,
    "moved to the new sign-in, verified, but the free week is not given twice");
});

test("approve: reject -> re-approve does not restart the week", async () => {
  CLAIMS.clear(); const store = memKV(); const e = env(store, "1");
  store._m.set("icu:doctor:u", JSON.stringify({ uid: "u" }));
  await approve(e, "u", "KMC 9");
  const first = CLAIMS.get("u").verifiedAt;
  CLAIMS.set("u", { verified: false });   // what doReject leaves
  await new Promise((r) => setTimeout(r, 5));
  await approve(e, "u", "KMC 9");
  assert.equal(CLAIMS.get("u").verifiedAt, first);
});

test("flag off: approve behaves exactly as before (no ledger, no refusal)", async () => {
  CLAIMS.clear(); const store = memKV(); const e = env(store, "0");
  await approve(e, "a", "KMC 5"); store._m.set("icu:reg:KMC_5", "a");
  const b = await approve(e, "b", "KMC 5");
  assert.equal(b.status, 200); assert.ok(CLAIMS.get("b").verifiedAt);
  assert.equal([...store._m.keys()].some((k) => k.startsWith("trial:")), false);
});

test("pending review: the first account on a device gets 7 days; a second account on the same phone gets review but no free access", () => withGemini(async () => {
  CLAIMS.clear(); const store = memKV(); const e = env(store, "1");
  const a = await upload(e, "a", "hw-androidid-777");
  assert.equal(a.status, "pending_review"); assert.equal(a.provisionalDays, 7); assert.ok(CLAIMS.get("a").provUntil > Date.now());
  const b = await upload(e, "b", "hw-androidid-777");
  assert.equal(b.status, "pending_review", "the review still happens"); assert.equal(b.trialUsed, true);
  assert.equal(b.provisionalUntil, ""); assert.equal(CLAIMS.get("b").provUntil, undefined); assert.ok(CLAIMS.get("b").trialDenied);
  assert.equal(JSON.parse(store._m.get("icu:doctor:b")).status, "pending");
}));

test("pending review: a re-upload does not extend the pending week", () => withGemini(async () => {
  CLAIMS.clear(); const store = memKV(); const e = env(store, "1");
  await upload(e, "a", "hw-dev-1234567");
  const until = CLAIMS.get("a").provUntil;
  store._m.set("trial:uid:a", JSON.stringify({ at: Date.now() - 3 * 86400000 }));
  await upload(e, "a", "hw-dev-1234567");
  assert.ok(CLAIMS.get("a").provUntil < until, "runs from the first grant, not the re-upload");
}));
