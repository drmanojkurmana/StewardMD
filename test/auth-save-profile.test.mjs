/* POST /api/auth/save-profile - the caller's OWN profile doc, written server-side.
 *
 * Owner, 2026-10-10, iPhone with full signal: "Complete your profile" answered "Couldn't reach your
 * account". The Firebase web SDK does not run in the iOS WebView, so Save had no document to write to.
 * This is the same document through the admin credential. What must hold: keyed ONLY by the uid in the
 * VERIFIED token, only the form's fields are written (never regNo, smdId or phone-verification fields),
 * an incomplete form is refused, and a failed write is an error, not a silent success.
 *
 * node --test --experimental-test-module-mocks test/auth-save-profile.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realAuth = await import("../functions/_fbauth.js");
const realFs = await import("../functions/_fbfirestore.js");
const realAdmin = await import("../functions/_fbadmin.js");
let commits = [], failWrite = false;
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifyFirebaseToken: async (tok) => (tok === "good-token" ? "uid-A" : null) } });
mock.module("../functions/_fbfirestore.js", { namedExports: { ...realFs, fsCommit: async (_e, writes) => { if (failWrite) throw new Error("fs_commit_failed"); commits.push(writes); return { ok: true }; } } });
mock.module("../functions/_fbadmin.js", { namedExports: { ...realAdmin, mergeUserClaims: async () => {}, lookupUidByEmail: async () => null, setUserPassword: async () => {}, getUserClaims: async () => ({}) } });

const { onRequestPost } = await import("../functions/api/auth/[[path]].js");
const env = { CASES_KV: { get: async () => null, put: async () => {}, delete: async () => {} } };
async function call(token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await onRequestPost({ request: new Request("https://x/api/auth/save-profile", { method: "POST", headers, body: JSON.stringify(body || {}) }), env, params: { path: ["save-profile"] } });
  return { status: res.status, body: await res.json() };
}
const FORM = { role: "doctor", name: "MK Kumar", phone: "8897298117", state: "Andhra Pradesh", city: "Kurnool", hospital: "Tata Medical Center", degree: "MBBS", speciality: "Internal Medicine" };
const fieldsOf = (w) => Object.keys(w.update.fields).sort();

test("writes the caller's own profile, from the uid in the verified token", async () => {
  commits = [];
  const r = await call("good-token", FORM);
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.equal(commits.length, 1); assert.equal(commits[0].length, 1);
  assert.match(commits[0][0].update.name, /users\/uid-A\/profile\/self$/);
  assert.deepEqual(fieldsOf(commits[0][0]), ["city", "degree", "hospital", "name", "phone", "profileComplete", "role", "speciality", "state", "updatedAt"]);
  assert.deepEqual(commits[0][0].updateMask.fieldPaths.sort(), fieldsOf(commits[0][0]), "a patch: nothing else on the document is touched");
});

test("the request cannot choose whose profile is written", async () => {
  commits = [];
  await call("good-token", { ...FORM, uid: "uid-B", path: "users/uid-B/profile/self" });
  assert.match(commits[0][0].update.name, /users\/uid-A\//);
  assert.ok(!/uid-B/.test(JSON.stringify(commits)));
});

test("server-owned fields cannot be written through it", async () => {
  commits = [];
  await call("good-token", { ...FORM, regNo: "APMC 1", smdId: "SMD-FAKE", phoneVerifiedAt: 1, phoneVerifiedNumber: "x", isAdmin: true });
  const f = fieldsOf(commits[0][0]);
  for (const k of ["regNo", "smdId", "phoneVerifiedAt", "phoneVerifiedNumber", "isAdmin"]) assert.ok(!f.includes(k), k + " must not be writable");
});

test("no token, or a bad one: refused, nothing written", async () => {
  commits = [];
  assert.equal((await call(null, FORM)).status, 401);
  assert.equal((await call("forged", FORM)).status, 401);
  assert.deepEqual(commits, []);
});

test("an incomplete form is refused", async () => {
  commits = [];
  assert.equal((await call("good-token", { ...FORM, name: "" })).status, 400);
  assert.equal((await call("good-token", { ...FORM, hospital: "" })).status, 400);
  assert.equal((await call("good-token", { ...FORM, phone: "123" })).status, 400);
  assert.deepEqual(commits, []);
});

test("a failed write is an error, never a silent success", async () => {
  failWrite = true;
  const r = await call("good-token", FORM);
  failWrite = false;
  assert.equal(r.status, 502); assert.equal(r.body.ok, false);
});

/* ── patch mode: ONE field edited from the Profile page (owner, 2026-10-10: "Couldn't save, check your connection" saving the college) ── */
test("patch: one field is written, nothing else, and the form is not marked complete by it", async () => {
  commits = [];
  const r = await call("good-token", { patch: true, hospital: "Kurnool Medical College" });
  assert.equal(r.status, 200);
  assert.deepEqual(fieldsOf(commits[0][0]), ["hospital", "updatedAt"], "only what was sent, plus the time");
  assert.ok(!fieldsOf(commits[0][0]).includes("profileComplete"));
  assert.deepEqual(commits[0][0].updateMask.fieldPaths.sort(), ["hospital", "updatedAt"]);
});
test("patch: a changed registration number is stored as unverified and awaiting its certificate", async () => {
  commits = [];
  await call("good-token", { patch: true, regNo: " APMC 12345 ", verified: true, regNoPendingCert: false });
  const w = commits[0][0], f = w.update.fields;
  assert.deepEqual(fieldsOf(w), ["regNo", "regNoPendingCert", "updatedAt", "verified"]);
  assert.equal(f.regNo.stringValue, "APMC 12345"); assert.equal(f.verified.booleanValue, false); assert.equal(f.regNoPendingCert.booleanValue, true);
});
test("patch: invalid or empty edits are refused; server-owned fields still cannot be written", async () => {
  commits = [];
  assert.equal((await call("good-token", { patch: true })).status, 400, "nothing to save");
  assert.equal((await call("good-token", { patch: true, hospital: "  " })).status, 400);
  assert.equal((await call("good-token", { patch: true, phone: "12" })).status, 400);
  assert.equal((await call("good-token", { patch: true, name: "" })).status, 400);
  assert.deepEqual(commits, []);
  await call("good-token", { patch: true, city: "Kurnool", smdId: "SMD-FAKE", phoneVerifiedAt: 1, isAdmin: true });
  assert.deepEqual(fieldsOf(commits[0][0]), ["city", "updatedAt"]);
});
test("patch: still needs a valid sign-in and cannot pick whose profile", async () => {
  commits = [];
  assert.equal((await call(null, { patch: true, city: "x" })).status, 401);
  await call("good-token", { patch: true, city: "Kurnool", uid: "uid-B" });
  assert.match(commits[0][0].update.name, /users\/uid-A\//);
});
