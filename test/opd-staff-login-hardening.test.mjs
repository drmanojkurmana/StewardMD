/* Staff sign-in hardening, through the real route with an in-memory Firestore:
 *   - email + password sign-in locks after five wrong passwords (it had no limit at all);
 *   - every outcome (ok, failed, lockout, locked, refused) is audited, and the secret never is;
 *   - weak PINs and passwords are refused when an admin sets them.
 *
 * node --test --experimental-test-module-mocks test/opd-staff-login-hardening.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d } } : null; },
    fsQuery: async (_e, coll, opts) => [...docs].filter(([p, f]) => p.startsWith(coll + "/") && (!opts?.where || String(f[opts.where.field]) === String(opts.where.value))).map(([p, f]) => ({ id: p.slice(coll.length + 1), name: p, fields: { ...f } })),
    fsCommit: async (_e, writes) => { for (const w of writes || []) { if (w.delete) { docs.delete(w.delete); continue; } docs.set(w.update.name, { ...(docs.get(w.update.name) || {}), ...w.update.fields }); } return { ok: true }; },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const ORG = await import("../functions/_opd_org_store.js");
const { passwordProblem, pinProblem, passLocked, nextPassState, PIN_MAX_ATTEMPTS } = await import("../functions/_opd_auth.js");

const ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac" };
const post = async (path, body) => {
  const res = await onRequest({ request: new Request("https://x.test/api/queue/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env: ENV });
  return { status: res.status, ...(await res.json()) };
};
const audits = () => [...docs].filter(([k]) => k.startsWith("q_events/")).map(([, f]) => f);

async function seed() {
  docs.clear();
  docs.set("q_orgs/org1", { id: "org1", code: "SMD-ABC123", name: "Test", mode: "clinic", ownerUid: "owner" });
  await ORG.setMembership(undefined, "org1", "nurse1", { role: "nurse" }, "owner");
  assert.equal((await ORG.setMemberPin(undefined, "org1", "nurse1", "4826", "owner")).ok, true);
  assert.equal((await ORG.setMemberPassword(undefined, "org1", "nurse1", "nurse1@clinic.in", "Ward7-night-shift", "owner")).ok, true);
  docs.forEach((v, k) => { if (k.startsWith("q_events/")) docs.delete(k); });
}

test("password sign-in locks after five wrong passwords, and the right password is then refused too", async () => {
  await seed();
  for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) {
    const r = await post("auth/email", { email: "nurse1@clinic.in", password: "wrong-" + i });
    assert.equal(r.status, 401);
    assert.equal(r.attemptsLeft, PIN_MAX_ATTEMPTS - i);
  }
  assert.equal((await post("auth/email", { email: "nurse1@clinic.in", password: "wrong-last" })).status, 401);
  const locked = await post("auth/email", { email: "nurse1@clinic.in", password: "Ward7-night-shift" });
  assert.equal(locked.status, 429, "locked means locked, even for the right password");
  assert.equal(locked.error, "locked");
  assert.ok(!locked.token);
  // The PIN has its own counter: a password lockout does not lock the PIN.
  const pin = await post("auth/pin", { orgId: "org1", identity: "nurse1", pin: "4826" });
  assert.equal(pin.status, 200);
  assert.ok(pin.token);
});

test("a correct password resets the count, and every outcome is audited without the secret", async () => {
  await seed();
  await post("auth/email", { email: "nurse1@clinic.in", password: "wrong-1" });
  const ok = await post("auth/email", { email: "nurse1@clinic.in", password: "Ward7-night-shift" });
  assert.equal(ok.status, 200);
  assert.ok(ok.token);
  await post("auth/pin", { orgId: "org1", identity: "nurse1", pin: "0000" });
  await post("auth/pin", { orgId: "org1", identity: "nobody", pin: "4826" });

  const acts = audits().map((a) => a.action);
  for (const a of ["login:password_failed", "login:password_ok", "login:pin_failed", "login:pin_refused"]) assert.ok(acts.includes(a), a + " audited: " + acts.join(","));
  assert.ok(audits().every((a) => a.hospitalId === "org1"));
  const dump = JSON.stringify(audits());
  assert.ok(!dump.includes("Ward7-night-shift") && !dump.includes("wrong-1") && !dump.includes("4826"), "no secret is ever written to the audit");
});

test("an admin cannot set a weak PIN or password; the route reports it as a failure", async () => {
  await seed();
  assert.equal(pinProblem("1111") != null, true);
  assert.equal(pinProblem("1234") != null, true);
  assert.equal(pinProblem("12a4") != null, true);
  assert.equal(pinProblem("4826"), null);
  assert.equal(passwordProblem("short1") != null, true);
  assert.equal(passwordProblem("password123") != null, true);
  assert.equal(passwordProblem("nurse1-is-me-ok", "nurse1@clinic.in") != null, true);
  assert.equal(passwordProblem("Ward7-night-shift", "nurse1@clinic.in"), null);

  const r = await ORG.setMemberPin(undefined, "org1", "nurse1", "1234", "owner");
  assert.equal(r.ok, false);
  assert.equal(r.error, "weak_pin");
  const p = await ORG.setMemberPassword(undefined, "org1", "nurse1", "nurse1@clinic.in", "password123", "owner");
  assert.equal(p.error, "weak_password");
  // And the old PIN still works: a refused change changed nothing.
  assert.equal((await post("auth/pin", { orgId: "org1", identity: "nurse1", pin: "4826" })).status, 200);
});

const whoami = async (token) => (await onRequest({ request: new Request("https://x.test/api/queue/whoami?orgId=org1", { headers: { "X-Staff-Token": token } }), env: ENV })).status;

test("a reset, a disable or a new PIN ends sessions issued before it; restore does not revive them", async () => {
  ENV.FOLLOWCARE_PHI_KEY = Buffer.alloc(32, 7).toString("base64url");
  for (const [label, revoke] of [
    ["reset", () => ORG.resetMemberAccess(undefined, "org1", "nurse1", "owner")],
    ["new PIN", () => ORG.setMemberPin(undefined, "org1", "nurse1", "5937", "owner")],
    ["new password", () => ORG.setMemberPassword(undefined, "org1", "nurse1", "nurse1@clinic.in", "Another-long-one9", "owner")],
    ["disable", () => ORG.setMemberActive(undefined, "org1", "nurse1", false, "owner")],
  ]) {
    await seed();
    const { token } = await post("auth/pin", { orgId: "org1", identity: "nurse1", pin: "4826" });
    assert.ok(token);
    assert.equal(await whoami(token), 200, "the session works before " + label);
    await new Promise((r) => setTimeout(r, 2));
    assert.equal((await revoke()).ok, true);
    assert.equal(await whoami(token), 401, "the old session is dead after " + label);
    if (label === "disable") {
      await ORG.setMemberActive(undefined, "org1", "nurse1", true, "owner");
      assert.equal(await whoami(token), 401, "restoring the member does not bring the old session back");
    }
  }
  // A session signed in AFTER the change works.
  await seed();
  await ORG.setMemberPin(undefined, "org1", "nurse1", "5937", "owner");
  await new Promise((r) => setTimeout(r, 2));
  const fresh = await post("auth/pin", { orgId: "org1", identity: "nurse1", pin: "5937" });
  assert.equal(await whoami(fresh.token), 200);
});

test("pure: the password lockout machine mirrors the PIN one on its own fields", () => {
  const now = 1_000_000;
  let m = {};
  for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) m = { ...m, ...nextPassState(m, now, false) };
  assert.equal(passLocked(m, now).locked, true);
  assert.equal(passLocked(m, now + 16 * 60 * 1000).locked, false, "the lock lifts after 15 minutes");
  assert.deepEqual(nextPassState(m, now, true), { passAttempts: 0, passLockedUntil: 0 });
});

test("the screens that set a PIN or password show a refusal instead of 'Saved' / 'Clinic ready'", () => {
  const opd = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.match(opd, /throw new Error\(what\+" not set: "/);
  assert.match(opd, /toast\("PIN not set: "/);
  const q = readFileSync(new URL("../queue.js", import.meta.url), "utf8");
  assert.match(q, /Staff added, but the PIN was not set: /);
});
