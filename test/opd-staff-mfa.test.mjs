/* Two-step sign-in for hospital staff, through the real routes with an in-memory Firestore.
 *
 * node --test --experimental-test-module-mocks test/opd-staff-mfa.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => [...docs].filter(([p, d]) => p.startsWith(coll + "/") && (!opts?.where || String(d.fields[opts.where.field]) === String(opts.where.value))).map(([p, d]) => ({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime })),
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) { const cur = docs.get(w.update?.name); if (w.currentDocument?.updateTime && (!cur || cur.updateTime !== w.currentDocument.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" }); }
      for (const w of writes || []) { if (w.delete) { docs.delete(w.delete); continue; } const prev = docs.get(w.update.name); docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) }); }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wUpdate: (_e, path, fields, opts) => ({ update: { name: path, fields }, ...(opts?.updateTime ? { currentDocument: { updateTime: opts.updateTime } } : {}) }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const ORG = await import("../functions/_opd_org_store.js");
const A = await import("../functions/_opd_auth.js");

const ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url") };
const call = async (method, path, body, token) => {
  const headers = { "Content-Type": "application/json", ...(token ? { "X-Staff-Token": token } : {}) };
  const res = await onRequest({ request: new Request("https://x.test/api/queue/" + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }), env: ENV });
  return { status: res.status, ...(await res.json()) };
};
const step = () => Math.floor(Date.now() / A.TOTP_STEP_MS);
const pinLogin = (identity = "nurse1", pin = "4826") => call("POST", "auth/pin", { orgId: "org1", identity, pin });
const acts = () => [...docs].filter(([k]) => k.startsWith("q_events/")).map(([, d]) => d.fields.action);

async function seed() {
  docs.clear();
  docs.set("q_orgs/org1", { fields: { id: "org1", code: "SMD-ABC123", name: "Test", mode: "clinic", ownerUid: "owner" }, updateTime: "t0" });
  for (const [id, pin] of [["nurse1", "4826"], ["nurse2", "7391"]]) {
    await ORG.setMembership(undefined, "org1", id, { role: "nurse" }, "owner");
    assert.equal((await ORG.setMemberPin(undefined, "org1", id, pin, "owner")).ok, true);
  }
  await new Promise((r) => setTimeout(r, 2));
}

async function enrol(token) {
  const e = await call("POST", "mfa/enrol", {}, token);
  assert.equal(e.status, 200, JSON.stringify(e));
  assert.match(e.uri, /^otpauth:\/\/totp\/.+secret=[A-Z2-7]+/);
  const c = await call("POST", "mfa/confirm", { code: await A.totpAt(e.secret, step()) }, token);
  assert.equal(c.status, 200, JSON.stringify(c));
  return { secret: e.secret, recovery: c.recoveryCodes };
}

test("pure: TOTP matches the RFC 6238 SHA-1 test vectors and refuses a reused step", async () => {
  const s = A.base32Encode(new TextEncoder().encode("12345678901234567890"));
  assert.equal(await A.totpAt(s, Math.floor(59 / 30)), "287082");
  assert.equal(await A.totpAt(s, Math.floor(1111111109 / 30)), "081804");
  assert.equal(await A.totpAt(s, Math.floor(2000000000 / 30)), "279037");
  const now = 1111111109000, st = Math.floor(now / 30000);
  assert.equal(await A.verifyTotp(s, "081804", now, 0), st);
  assert.equal(await A.verifyTotp(s, "081804", now, st), 0, "the same step cannot be used twice");
  assert.equal(await A.verifyTotp(s, "12345", now, 0), 0);
});

test("switched on, a correct PIN is not enough: the code is asked for, and the ticket is not a session", async () => {
  await seed();
  const { token } = await pinLogin();
  const { secret } = await enrol(token);
  assert.ok(acts().includes("mfa:enabled"));
  assert.equal((await call("GET", "whoami?orgId=org1", null, token)).status, 401, "switching it on ends sessions signed in without it");

  const first = await pinLogin();
  assert.equal(first.status, 401);
  assert.equal(first.error, "mfa_required");
  assert.ok(!first.token, "no session before the second step");
  assert.equal((await call("GET", "whoami?orgId=org1", null, first.challenge)).status, 401, "a challenge can never be used as a session");

  const wrong = await call("POST", "auth/mfa", { challenge: first.challenge, code: "000000" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.error, "wrong_code");

  const code = await A.totpAt(secret, step() + 1);
  const ok = await call("POST", "auth/mfa", { challenge: first.challenge, code });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal((await call("GET", "whoami?orgId=org1", null, ok.token)).status, 200);

  const again = await pinLogin();
  const replay = await call("POST", "auth/mfa", { challenge: again.challenge, code });
  assert.equal(replay.status, 401, "a code that was already used is refused");
  assert.ok(acts().includes("mfa:ok") && acts().includes("mfa:failed"));
});

test("a backup code signs in once, and only once", async () => {
  await seed();
  const { recovery } = await enrol((await pinLogin()).token);
  assert.equal(recovery.length, 8);
  const a = await pinLogin();
  const used = await call("POST", "auth/mfa", { challenge: a.challenge, code: recovery[0] });
  assert.equal(used.status, 200);
  assert.equal(used.via, "backup");
  assert.equal(used.recoveryLeft, 7);
  const b = await pinLogin();
  assert.equal((await call("POST", "auth/mfa", { challenge: b.challenge, code: recovery[0] })).status, 401);
  assert.ok(!JSON.stringify([...docs.values()]).includes(recovery[1]), "backup codes are never stored as typed");
});

test("wrong codes lock the second step after five", async () => {
  await seed();
  await enrol((await pinLogin()).token);
  const { challenge } = await pinLogin();
  for (let i = 0; i < A.PIN_MAX_ATTEMPTS - 1; i++) assert.equal((await call("POST", "auth/mfa", { challenge, code: "000000" })).status, 401);
  assert.equal((await call("POST", "auth/mfa", { challenge, code: "000000" })).error, "locked");
  assert.equal((await call("POST", "auth/mfa", { challenge, code: "111111" })).status, 429);
});

test("it is always your own account: another nurse cannot turn yours off, and turning off needs a code", async () => {
  await seed();
  const t1 = (await pinLogin()).token;
  const { secret } = await enrol(t1);
  const t2 = (await pinLogin("nurse2", "7391")).token;
  // nurse2's disable acts on nurse2 (who has it off), never on nurse1.
  assert.notEqual((await call("POST", "mfa/disable", { code: await A.totpAt(secret, step() + 1), identity: "nurse1" }, t2)).status, 200);
  assert.equal((await ORG.mfaStatus(undefined, "org1", "nurse1")).enabled, true);

  const mine = (await call("POST", "auth/mfa", { challenge: (await pinLogin()).challenge, code: await A.totpAt(secret, step() + 1) })).token;
  assert.equal((await call("POST", "mfa/disable", { code: "000000" }, mine)).status, 422);
  assert.equal((await ORG.mfaStatus(undefined, "org1", "nurse1")).enabled, true, "a wrong code turns nothing off");
});

test("a lost phone: the admin's Reset access clears two-step sign-in along with the PIN", async () => {
  await seed();
  await enrol((await pinLogin()).token);
  assert.equal((await ORG.resetMemberAccess(undefined, "org1", "nurse1", "owner")).ok, true);
  assert.equal((await ORG.mfaStatus(undefined, "org1", "nurse1")).enabled, false);
  await ORG.setMemberPin(undefined, "org1", "nurse1", "5937", "owner");
  await new Promise((r) => setTimeout(r, 2));
  const back = await pinLogin("nurse1", "5937");
  assert.equal(back.status, 200, "signs in with the new PIN alone, and can set up the new phone");
  assert.ok(back.token);
});

test("doctor accounts are told this is for staff accounts, not silently accepted", async () => {
  const r = await call("GET", "mfa/status", null, null);
  assert.equal(r.status, 401);
});
