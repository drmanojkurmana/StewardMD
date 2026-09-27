/* SEC-11, SEC-13, SEC-15 (audit A11, A4, A17): the doors that take a secret from an unauthenticated
 * caller.
 *
 *  SEC-11  a burst of parallel portal-code guesses collided on one grant version and counted as about
 *          one attempt, a correct code in the burst answered 502 (an oracle for the code), and a
 *          missing grant answered differently from a used one (an oracle for grant ids).
 *  SEC-13  a known staff login answered a wrong PIN with attemptsLeft; an unknown one did not.
 *  SEC-15  nothing limited one address spraying guesses across many staff logins or portal grants.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec11-sec15-guessing.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { RecordService } = await import("../functions/_wardsynq/service.js");
const PA = await import("../functions/_wardsynq/patient-access.js");
const { resetMemory } = await import("../functions/_wardsynq/rate-limit.js");
const { onRequest: queueRouter } = await import("../functions/api/queue/[[path]].js");
const { onRequest: portalRouter } = await import("../functions/api/portal/[[path]].js");

beforeEach(() => resetMemory());

async function grantWorld(code) {
  const repo = new MemoryRepository();
  const ctx = { migration: { mode: "authoritative", tenantId: "t1" }, recordDeps: { repository: repo, pseudonym: async () => null }, config: { enabled: true } };
  const svc = new RecordService({ repository: repo, pseudonym: async () => null, tenant: { id: "t1" }, actor: PA.accessActor(), role: "x", roleSource: "x" });
  const grantId = "wsq-pacc-p1-" + Math.random().toString(36).slice(2);
  await svc.put(PA.AccessGrant({ id: grantId, patientId: "p1", issuedBy: "dr", issuedAt: new Date().toISOString(), codeHash: await PA.hashSecret(code, grantId) }));
  return { ctx, svc, grantId, redeem: (c, g) => PA.redeemCode(null, {}, { ...ctx, grantId: g || grantId, code: c }) };
}
const shape = (r) => JSON.stringify({ ok: r.ok, status: r.status, error: r.error, detail: r.detail, token: r.token });

test("SEC-11: a parallel burst compares at most MAX_ATTEMPTS codes, and every refusal is the same", async () => {
  const code = "40417311";
  const w = await grantWorld(code);
  const guesses = Array.from({ length: 199 }, (_, i) => String(10000000 + i)).concat([code]);
  const out = await Promise.all(guesses.map((c) => w.redeem(c)));
  const g = await w.svc.get(PA.GRANT_TYPE, w.grantId);
  assert.ok(Number(g.failedAttempts) <= PA.MAX_ATTEMPTS, `counted ${g.failedAttempts}`);
  const refusals = out.filter((r) => !r.ok);
  assert.equal(new Set(refusals.map(shape)).size, 1, "one refusal shape: " + [...new Set(refusals.map(shape))].join(" | "));
  assert.ok(!out.some((r) => r.status === 502));
  // Once the burst has used the tries, the right code is refused like any other.
  if (!out.some((r) => r.ok)) assert.equal(shape(await w.redeem(code)), shape(refusals[0]));
});

test("SEC-11: a missing, a used and a wrong-code grant all answer the same; the right code still works once", async () => {
  const w = await grantWorld("12345678");
  const wrong = await w.redeem("00000000");
  const missing = await w.redeem("12345678", "wsq-pacc-nobody-1");
  const ok = await w.redeem("12345678");
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const used = await w.redeem("12345678");
  assert.equal(shape(wrong), shape(missing));
  assert.equal(shape(wrong), shape(used));
  const g = await w.svc.get(PA.GRANT_TYPE, w.grantId);
  assert.equal(g.failedAttempts, 1, "the successful attempt is not counted as a failure");
});

const staffLogin = (body, ip) => queueRouter({ request: new Request("https://x/api/queue/auth/pin", { method: "POST", headers: { "Content-Type": "application/json", ...(ip ? { "CF-Connecting-IP": ip } : {}) }, body: JSON.stringify(body) }), env: H.ENV }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("SEC-13: a wrong PIN on a real login answers exactly like an unknown login", async () => {
  H.seed();
  await H.staffToken("org-a", "nurse-s13", "nurse");
  const unknown = await staffLogin({ orgId: "org-a", identity: "nobody-here", pin: "1111" });
  const known = await staffLogin({ orgId: "org-a", identity: "nurse-s13", pin: "1111" });
  assert.equal(known.status, unknown.status);
  assert.deepEqual(known.body, unknown.body);
});

test("SEC-15: one address spraying staff sign-ins is throttled across logins; another address is not", async () => {
  H.seed();
  let last;
  for (let i = 0; i < 61; i++) last = await staffLogin({ orgId: "org-a", identity: "name-" + i, pin: "1111" }, "203.0.113.9");
  assert.equal(last.status, 429, JSON.stringify(last.body));
  assert.equal(last.body.error, "rate_limited");
  const other = await staffLogin({ orgId: "org-a", identity: "name-x", pin: "1111" }, "198.51.100.7");
  assert.equal(other.status, 401);
});

test("SEC-15: the portal redeem door is throttled per grant and per address", async () => {
  H.seed();
  H.org("org-w", H.OWNER_A, { mode: "wardsynq", connectTenantId: "t-w" });
  H.ENV.CONNECT_DB = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }), batch: async () => [] };
  const redeem = (grantId, ip) => portalRouter({ request: new Request("https://x/api/portal/redeem", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ orgId: "org-w", grantId, code: "00000000" }) }), env: H.ENV, params: { path: ["redeem"] } }).then((r) => r.status);
  const perGrant = [];
  for (let i = 0; i < 11; i++) perGrant.push(await redeem("wsq-pacc-one", "192.0.2." + i));
  assert.notEqual(perGrant[0], 429);
  assert.equal(perGrant[10], 429, "the eleventh try at one grant, from anywhere, is refused");
  const perIp = [];
  for (let i = 0; i < 21; i++) perIp.push(await redeem("wsq-pacc-g" + i, "192.0.2.200"));
  assert.equal(perIp[20], 429, "the twenty-first redeem from one address is refused");
});
