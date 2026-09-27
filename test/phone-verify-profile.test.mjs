/* POST /api/auth/phone-verify stamps the verified number on the profile doc, server-side.
 *
 * Owner, 2026-09-28: "after verifying it it still didnt verify the number and profile status still shows
 * checking". The code was accepted (claim set), but phoneVerifiedNumber - what Profile's "Verified" reads -
 * was written only by the app through the Firebase SDK, which never lands inside the iOS WebView.
 *
 * node --test --experimental-test-module-mocks test/phone-verify-profile.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realAuth = await import("../functions/_fbauth.js");
const realFs = await import("../functions/_fbfirestore.js");
const realAdmin = await import("../functions/_fbadmin.js");
const commits = [];
let failCommit = false;
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifyFirebaseToken: async (tok) => (tok === "good-token" ? "uid-A" : null) } });
mock.module("../functions/_fbfirestore.js", {
  namedExports: { ...realFs, fsGet: async () => null, fsCommit: async (_e, writes) => { if (failCommit) throw new Error("fs_commit_failed"); commits.push(writes); return { ok: true }; } },
});
mock.module("../functions/_fbadmin.js", { namedExports: { ...realAdmin, mergeUserClaims: async () => {}, getUserClaims: async () => ({}) } });
mock.module("../functions/_lifecycle.js", { namedExports: { markPhoneVerified: async () => {}, checkPhoneAvailable: async () => ({ ok: true }), bindPhone: async () => ({ ok: true }) } });
mock.module("../functions/_aibudget.js", { namedExports: { clearBudgetCache: async () => {} } });
mock.module("../functions/_trial_ledger.js", { namedExports: { warmTrialMode: async () => "off", phoneTrialPatch: async () => ({}) } });

const { onRequestPost } = await import("../functions/api/auth/[[path]].js");
const m = new Map();
const env = { CASES_KV: { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } } };
async function verify(code) {
  m.set("otp:phone:uid-A", JSON.stringify({ code: "123456", phone: "919876543210", exp: Math.floor(Date.now() / 1000) + 600, tries: 0 }));
  const res = await onRequestPost({ request: new Request("https://x/api/auth/phone-verify", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer good-token" }, body: JSON.stringify({ code }) }), env, params: { path: ["phone-verify"] } });
  return { status: res.status, body: await res.json() };
}

test("the right code writes phone + phoneVerifiedNumber + phoneVerifiedAt to the caller's own profile doc", async () => {
  commits.length = 0;
  const r = await verify("123456");
  assert.equal(r.body.ok, true);
  assert.equal(commits.length, 1);
  const w = commits[0][0];
  assert.match(w.update.name, /\/documents\/users\/uid-A\/profile\/self$/);
  assert.deepEqual(w.updateMask.fieldPaths.sort(), ["phone", "phoneVerifiedAt", "phoneVerifiedNumber"]);
  assert.equal(w.update.fields.phoneVerifiedNumber.stringValue, "+919876543210");
  assert.equal(w.update.fields.phone.stringValue, "+919876543210");
  assert.equal(w.currentDocument, undefined, "creates the doc when a new account has none yet");
});

test("a wrong code writes nothing; a failed profile write still verifies (the claim is the account's truth)", async () => {
  commits.length = 0;
  assert.equal((await verify("000000")).body.ok, false);
  assert.equal(commits.length, 0);
  failCommit = true;
  const r = await verify("123456");
  failCommit = false;
  assert.equal(r.body.ok, true);
});
