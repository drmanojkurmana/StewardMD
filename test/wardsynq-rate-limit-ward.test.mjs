/* test/wardsynq-rate-limit-ward.test.mjs — TASK 9.15/9.1: the clinical door had no throttle.
 *
 * rate-limit.js was a good fixed-window limiter wired to exactly two SMART endpoints. Everything
 * under /api/queue/ward/* was uncounted, including the two routes that read in BULK:
 *
 *   GET /ward/backup    the whole hospital's record, page by page
 *   GET /ward/downtime  a whole ward's charts
 *
 * An authenticated account could pull the entire record store in a loop and nothing anywhere would
 * count it, let alone stop it. That is the shape that turns one compromised staff session into a
 * bulk exfiltration tool, and it is the reason the BULK tier is tight while the clinical tiers are
 * deliberately not.
 *
 * THE ASYMMETRY IS THE SAFETY ARGUMENT, AND THESE TESTS HOLD BOTH HALVES OF IT. A limiter that
 * refuses a nurse charting during an arrest is a patient-safety hazard dressed as a security
 * control, so the write tier sits far above any human rate and this file proves that a burst of
 * ordinary clinical work is NOT refused. A limiter nobody can trip is not a control, so it also
 * proves the bulk tier IS.
 *
 * Driven through the real onRequest, the real capability check and the real limiter.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-rate-limit-ward.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, p) => { const d = docs.get(p); return d ? { id: p, name: p, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, out = [];
      for (const [p, d] of docs) {
        if (!p.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime });
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, p, f) => ({ update: { name: p, fields: f }, currentDocument: { exists: false } }),
    wUpdate: (_e, p, f) => ({ update: { name: p, fields: f } }),
    wDelete: (_e, p) => ({ delete: p }),
    fsProject: () => "t", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT = { id: "rl-tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "rl-org" } }) };
const tenantDb = { prepare: () => ({ bind: (...a) => ({
  first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
  all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
}) }), batch: async () => [] };
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { resetMemory } = await import("../functions/_wardsynq/rate-limit.js");

const ORG = "rl-org";
const ADMIN = "rl-admin@example.test", NURSE = "rl-nurse@example.test", OTHER = "rl-other@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (e) => "cfa:" + createHash("sha256").update(e.toLowerCase()).digest("hex").slice(0, 24);

let ENV;
function seed() {
  docs.clear(); clock = 1; resetMemory();
  RECORD = new MemoryRepository();
  ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "rl-secret-that-is-long-enough-for-hmac",
    FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "RL", name: "Hospital A", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [NURSE, "nurse"], [OTHER, "admin"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function call(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET",
    headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  j.__retryAfter = res.headers.get("Retry-After");
  return j;
}

/* ---- 1: the bulk door is rationed ------------------------------------------------------------------ */

test("1. ADVERSARIAL: a whole-hospital export cannot be pulled in a loop", async () => {
  seed();
  let refusedAt = null, lastOk = 0;
  for (let i = 1; i <= 40; i++) {
    const r = await call(ADMIN, `/ward/backup?orgId=${ORG}&since=0&limit=10`);
    if (r.__status === 429) { refusedAt = i; assert.equal(r.error, "rate_limited"); assert.equal(r.tier, "bulk"); break; }
    lastOk = i;
  }
  assert.ok(refusedAt !== null, `the bulk export was never throttled across 40 requests (last ok: ${lastOk})`);
  assert.ok(refusedAt <= 13, `the bulk tier should ration at 12/min; it refused at ${refusedAt}`);
});

test("2. a throttled caller is told how long to wait, in a header and in the body", async () => {
  seed();
  let last = null;
  for (let i = 0; i < 20; i++) { last = await call(ADMIN, `/ward/backup?orgId=${ORG}&since=0&limit=10`); if (last.__status === 429) break; }
  assert.equal(last.__status, 429);
  assert.ok(Number(last.__retryAfter) >= 1, "a 429 without Retry-After is one a client has to guess at");
  assert.ok(last.retryAfterSeconds >= 1);
  /* The message must not read as a clinical failure, because a ward reading "429" on a screen
   * cannot tell a quota from an outage. */
  assert.match(last.message, /bound automated abuse, not clinical work/);
  assert.ok(last.store, "the report says which store counted, so nobody reads memory as a global cap");
});

test("3. the downtime pack is bulk too, because it reads a whole ward", async () => {
  seed();
  let refused = false;
  for (let i = 0; i < 20; i++) {
    const r = await call(ADMIN, `/ward/downtime?orgId=${ORG}&ward=Ward+A`);
    if (r.__status === 429) { refused = true; assert.equal(r.tier, "bulk"); break; }
  }
  assert.ok(refused, "a whole-ward read must be rationed on the same tier as a whole-hospital one");
});

/* ---- 4: and clinical work is NOT ------------------------------------------------------------------- */

test("4. THE SAFETY HALF: a burst of ordinary clinical reads is never refused", async () => {
  seed();
  /* Far more than a clinician produces in a minute, and far below the tier. A limiter that refused
   * this would be a patient-safety hazard wearing a security control's clothes. */
  for (let i = 0; i < 120; i++) {
    const r = await call(NURSE, `/ward/list?orgId=${ORG}`);
    assert.notEqual(r.__status, 429, `clinical read ${i + 1} was rate limited, which must never happen at this volume`);
  }
});

test("5. the tiers are counted separately, so exhausting the bulk quota leaves care working", async () => {
  seed();
  for (let i = 0; i < 20; i++) await call(ADMIN, `/ward/backup?orgId=${ORG}&since=0&limit=10`);
  const bulk = await call(ADMIN, `/ward/backup?orgId=${ORG}&since=0&limit=10`);
  assert.equal(bulk.__status, 429, "the bulk quota is spent");
  const clinical = await call(ADMIN, `/ward/list?orgId=${ORG}`);
  assert.notEqual(clinical.__status, 429, "and the ward can still be read - a spent export quota must not close the chart");
});

test("6. the counter is per ACTOR, not per hospital: one abuser cannot lock out their colleagues", async () => {
  seed();
  for (let i = 0; i < 20; i++) await call(ADMIN, `/ward/backup?orgId=${ORG}&since=0&limit=10`);
  assert.equal((await call(ADMIN, `/ward/backup?orgId=${ORG}&since=0&limit=10`)).__status, 429);
  const colleague = await call(OTHER, `/ward/backup?orgId=${ORG}&since=0&limit=10`);
  assert.notEqual(colleague.__status, 429, "a second admin has their own quota");
});

/* ---- 7: emergency access is bounded but never scarce ------------------------------------------------ */

test("7. break-glass is rationed against scripted abuse, well above what a real shift produces", async () => {
  seed();
  /* The first several must always succeed or be refused for a CLINICAL reason (a missing patient,
   * an insufficient justification) - never for a quota. Refusing a genuine emergency to enforce a
   * limit would be the worse failure of the two. */
  for (let i = 0; i < 10; i++) {
    const r = await call(NURSE, `/ward/break-glass?orgId=${ORG}`, "POST",
      { patientId: `rl-pat-${i}`, reason: "Unconscious patient brought in by ambulance, identity unconfirmed." });
    assert.notEqual(r.__status, 429, `emergency request ${i + 1} was refused for a quota, which must not happen this early`);
  }
});

/* ---- 8: authorization still comes first ------------------------------------------------------------- */

test("8. the throttle never becomes an authorization bypass", async () => {
  seed();
  /* A nurse has no staff.admin, so the export is 403 - and it must stay 403 however many times it is
   * asked, never degrading into a 429 that a caller could read as "authorized but busy". */
  for (let i = 0; i < 20; i++) {
    const r = await call(NURSE, `/ward/backup?orgId=${ORG}&since=0&limit=10`);
    assert.equal(r.__status, 403, `request ${i + 1} should be refused on authority, not on quota`);
  }
});
