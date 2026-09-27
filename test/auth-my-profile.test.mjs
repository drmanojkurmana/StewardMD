/* POST /api/auth/my-profile - the caller's OWN profile doc, read server-side.
 *
 * Owner, 2026-09-27: Profile showed every professional detail as "Offline" while Registration beside
 * it said Verified. The Firebase web SDK read hung inside the iOS WebView; this endpoint is the same
 * document through the server's admin credential. What must hold: it is keyed only by the uid in the
 * VERIFIED token (never by anything in the request), it returns only a fixed list of fields, and a
 * failed read is an error, never an empty profile.
 *
 * node --test --experimental-test-module-mocks test/auth-my-profile.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realAuth = await import("../functions/_fbauth.js");
const realFs = await import("../functions/_fbfirestore.js");
const realAdmin = await import("../functions/_fbadmin.js");
const docs = new Map();
let failRead = false, reads = [];
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseToken: async (tok) => (tok === "good-token" ? "uid-A" : null) },
});
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    ...realFs,
    fsGet: async (_e, path) => { reads.push(path); if (failRead) throw new Error("fs_get_failed"); return docs.has(path) ? { fields: docs.get(path) } : null; },
  },
});
mock.module("../functions/_fbadmin.js", {
  namedExports: { ...realAdmin, mergeUserClaims: async () => {}, lookupUidByEmail: async () => null, setUserPassword: async () => {}, getUserClaims: async (_e, uid) => (uid === "uid-A" ? { phoneVerified: true } : {}) },
});

const { onRequestPost } = await import("../functions/api/auth/[[path]].js");
const env = { CASES_KV: { get: async () => null, put: async () => {}, delete: async () => {} } };
async function call(token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await onRequestPost({ request: new Request("https://x/api/auth/my-profile", { method: "POST", headers, body: JSON.stringify(body || {}) }), env, params: { path: ["my-profile"] } });
  return { status: res.status, body: await res.json() };
}

test("returns the caller's own profile, from the uid in the verified token", async () => {
  docs.set("users/uid-A/profile/self", { hospital: "KGH", degree: "MD", phone: "8897298117", regNo: "APMC 1" });
  reads = [];
  const r = await call("good-token");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.profile.hospital, "KGH");
  assert.equal(r.body.phoneVerified, true);
  assert.deepEqual(reads, ["users/uid-A/profile/self"]);
});

test("the request cannot choose whose profile is read", async () => {
  docs.set("users/uid-B/profile/self", { hospital: "SOMEONE ELSE" });
  reads = [];
  const r = await call("good-token", { uid: "uid-B", path: "users/uid-B/profile/self" });
  assert.equal(r.body.profile.hospital, "KGH");
  assert.deepEqual(reads, ["users/uid-A/profile/self"], "only the token's uid is ever read");
});

test("no token, or a bad one: refused, nothing read", async () => {
  reads = [];
  assert.equal((await call(null)).status, 401);
  assert.equal((await call("forged")).status, 401);
  assert.deepEqual(reads, []);
});

test("only the listed fields leave the server", async () => {
  docs.set("users/uid-A/profile/self", { hospital: "KGH", internalNote: "never", fcmToken: "never", phoneVerifiedNumber: "8897298117" });
  const r = await call("good-token");
  assert.equal(r.body.profile.hospital, "KGH");
  assert.equal(r.body.profile.phoneVerifiedNumber, "8897298117");
  assert.equal(r.body.profile.internalNote, undefined);
  assert.equal(r.body.profile.fcmToken, undefined);
});

test("a failed read is an error, never an empty profile that would overwrite the saved copy", async () => {
  failRead = true;
  const r = await call("good-token");
  failRead = false;
  assert.equal(r.body.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.body.profile, undefined);
});
