// test/connect/onboard/sync.test.mjs — Automatic sync scheduler: isDue (pure), setSyncConfig (RBAC + bounds,
// persists into the SAME config JSON blob, no schema change), runDueSyncs (multi-tenant cron sweep: re-runs
// the capability probe for due connections only — see sync.js's header comment for why a scheduled sync
// refreshes reachability/capability rather than pulling patient data). Mirrors pull.test.mjs's deps-injection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { saveConnection, listConnections, getRow } from "../../../functions/_connect/onboard/store.js";
import { isDue, setSyncConfig, runDueSyncs } from "../../../functions/_connect/onboard/sync.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";
import { makeOnboardDb } from "./onboard-db.mjs";
import { makeMockFhir } from "../smart/mock-fhir-server.mjs";

const env = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==" };
const req = {};

// ---------- isDue: pure helper, no deps -------------------------------------------------------------------
const row = (config, status = "active") => ({ config: JSON.stringify(config), status });

test("isDue: not-due when interval is 0 or absent", () => {
  assert.equal(isDue(row({}), Date.now()), false);
  assert.equal(isDue(row({ syncIntervalMin: 0 }), Date.now()), false);
});

test("isDue: not-due when lastSyncAt is recent (interval not yet elapsed)", () => {
  const now = Date.now();
  const r = row({ syncIntervalMin: 60, lastSyncAt: new Date(now - 5 * 60000).toISOString() });  // synced 5 min ago
  assert.equal(isDue(r, now), false);
});

test("isDue: due when lastSyncAt is older than the interval", () => {
  const now = Date.now();
  const r = row({ syncIntervalMin: 60, lastSyncAt: new Date(now - 61 * 60000).toISOString() }); // 61 min ago, interval 60
  assert.equal(isDue(r, now), true);
});

test("isDue: due when never synced (lastSyncAt absent) and interval > 0", () => {
  assert.equal(isDue(row({ syncIntervalMin: 60 }), Date.now()), true);
});

test("isDue: not-due when status is revoked, even with an elapsed interval", () => {
  const now = Date.now();
  const r = row({ syncIntervalMin: 15, lastSyncAt: new Date(now - 3600_000).toISOString() }, "revoked");
  assert.equal(isDue(r, now), false);
});

// ---------- setSyncConfig ----------------------------------------------------------------------------------
const seedDb = (role = "admin") => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const deps = (db) => ({ db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }) });
const tokenBody = { name: "GIMSR EMR", type: "fhir", fhirBaseUrl: "https://fhir.example.org/r4", auth: { method: "token", token: "sekret-bearer-123" } };

test("setSyncConfig: a non-member actor is denied (fail-closed RBAC)", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", tokenBody);
  const intruderDeps = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "intruder", guest: false }) };
  await assert.rejects(() => setSyncConfig(intruderDeps, req, env, "t1", connectionId, { intervalMin: 60 }));
});

test("setSyncConfig: rejects negative, non-integer, below-floor, and above-ceiling intervals", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", tokenBody);
  const d = deps(db);
  await assert.rejects(() => setSyncConfig(d, req, env, "t1", connectionId, { intervalMin: -1 }), (e) => e instanceof OnboardError && e.klass === "invalid");
  await assert.rejects(() => setSyncConfig(d, req, env, "t1", connectionId, { intervalMin: 1.5 }), (e) => e.klass === "invalid");
  await assert.rejects(() => setSyncConfig(d, req, env, "t1", connectionId, { intervalMin: 5 }), (e) => e.klass === "invalid");      // below the 15-min floor
  await assert.rejects(() => setSyncConfig(d, req, env, "t1", connectionId, { intervalMin: 10081 }), (e) => e.klass === "invalid");  // above the 7-day ceiling
  await assert.rejects(() => setSyncConfig(d, req, env, "t1", connectionId, { intervalMin: "60" }), (e) => e.klass === "invalid");   // non-integer type
});

test("setSyncConfig: 0/absent turns sync OFF; a valid value persists and round-trips via list", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", tokenBody);
  const d = deps(db);
  const off = await setSyncConfig(d, req, env, "t1", connectionId, {});
  assert.equal(off.syncIntervalMin, 0);
  const on = await setSyncConfig(d, req, env, "t1", connectionId, { intervalMin: 60 });
  assert.equal(on.syncIntervalMin, 60);
  const list = await listConnections(d, req, env, "t1");
  assert.equal(list[0].syncIntervalMin, 60);
});

test("setSyncConfig: returns a safeView with NO sealed credential material, and leaves lastSyncAt untouched", async () => {
  const db = seedDb();
  const { connectionId } = await saveConnection(deps(db), req, env, "t1", tokenBody);
  const d = deps(db);
  const res = await setSyncConfig(d, req, env, "t1", connectionId, { intervalMin: 30 });
  const blob = JSON.stringify(res);
  for (const secret of ["sekret-bearer-123", "sealed"]) assert.equal(blob.includes(secret), false);
  assert.equal(res.lastSyncAt, null);              // never touched by the config setter
  const { config } = await getRow(db, "t1", connectionId);
  assert.equal(config.lastSyncAt, undefined);      // still absent in the stored row too
});

// ---------- runDueSyncs ------------------------------------------------------------------------------------
function seedTwoTenantDb() {
  return makeOnboardDb({
    connect_membership: [
      { user_id: "u1", tenant_id: "t1", role: "admin" },
      { user_id: "u2", tenant_id: "t2", role: "admin" },
    ],
    connect_tenant: [
      { id: "t1", mode: "sandbox", granted_scopes: "[]" },
      { id: "t2", mode: "sandbox", granted_scopes: "[]" },
    ],
  });
}
const dispatchFetch = (a, b) => (url, init) => (String(url).startsWith(a.base) ? a.fetch(url, init) : b.fetch(url, init));

test("runDueSyncs: runs only due connections across tenants, stamps lastSyncAt, writes a PHI-free audit, returns counts", async () => {
  const db = seedTwoTenantDb();
  const mockDue = makeMockFhir({ base: "https://fhir1.example.org" });
  const mockOff = makeMockFhir({ base: "https://fhir2.example.org" });
  const d1 = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: mockDue.fetch, now: () => Date.now() };
  const d2 = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u2", guest: false }), fetch: mockOff.fetch, now: () => Date.now() };

  const c1 = await saveConnection(d1, req, env, "t1", { name: "Due", type: "fhir", fhirBaseUrl: mockDue.base, auth: { method: "token", token: "mock-access-1" } });
  const c2 = await saveConnection(d2, req, env, "t2", { name: "NotDue", type: "fhir", fhirBaseUrl: mockOff.base, auth: { method: "token", token: "mock-access-1" } });
  await setSyncConfig(d1, req, env, "t1", c1.connectionId, { intervalMin: 60 });   // due: never synced, interval>0
  // c2 stays sync-OFF (interval 0/absent) -> never due.

  const now = Date.now();
  const runnerDeps = { db, secrets: makeSecrets(env), fetch: dispatchFetch(mockDue, mockOff) };
  const result = await runDueSyncs(runnerDeps, env, now, {});
  assert.equal(result.ok, true);
  assert.equal(result.due, 1);
  assert.equal(result.ran, 1);
  assert.equal(result.errors, 0);

  const list1 = await listConnections(d1, req, env, "t1");
  assert.ok(list1[0].lastSyncAt);              // stamped
  assert.equal(list1[0].lastTest.ok, true);    // the capability probe actually ran + was recorded
  const list2 = await listConnections(d2, req, env, "t2");
  assert.equal(list2[0].lastSyncAt, null);     // untouched — was never due

  const auditRows = db._tables.connect_audit_event || [];
  const synced = auditRows.filter((r) => r.action === "connect.onboard.synced");
  assert.equal(synced.length, 1);
  assert.equal(synced[0].outcome, "ok");
  const blob = JSON.stringify(auditRows) + JSON.stringify(result);
  for (const phi of ["Synthetic", "Testpatient", "P1", mockDue.base]) assert.equal(blob.includes(phi), false);
});

test("runDueSyncs: a connection whose refresh throws is recorded as an error and does NOT abort the batch", async () => {
  const db = seedTwoTenantDb();
  const mockGood = makeMockFhir({ base: "https://fhir-good.example.org" });
  const mockBad = makeMockFhir({ base: "https://fhir-bad.example.org" });
  const dGood = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: mockGood.fetch, now: () => Date.now() };
  const dBad = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u2", guest: false }), fetch: mockBad.fetch, now: () => Date.now() };

  const good = await saveConnection(dGood, req, env, "t1", { name: "Good", type: "fhir", fhirBaseUrl: mockGood.base, auth: { method: "token", token: "mock-access-1" } });
  const bad = await saveConnection(dBad, req, env, "t2", { name: "Bad", type: "fhir", fhirBaseUrl: mockBad.base, auth: { method: "token", token: "mock-access-1" } });
  await setSyncConfig(dGood, req, env, "t1", good.connectionId, { intervalMin: 15 });
  await setSyncConfig(dBad, req, env, "t2", bad.connectionId, { intervalMin: 15 });

  // Poison every UPDATE touching the "bad" connector so its refresh genuinely throws (an infra-level fault,
  // e.g. a D1 write failure) — proving the per-item catch handles a real throw, not just a probe {ok:false}.
  const poisoned = {
    _tables: db._tables,
    prepare(sql) {
      const inner = db.prepare(sql);           // same stmt object -> all()/first()/run() share its `binds` closure
      return {
        all: inner.all, first: inner.first, run: inner.run,   // no-bind callers (e.g. the initial SELECT-all) pass through
        bind: (...args) => {
          if (/^\s*UPDATE/i.test(sql) && args.includes(bad.connectionId)) {
            const boom = async () => { throw new Error("simulated write failure"); };
            return { all: boom, first: boom, run: boom };
          }
          return inner.bind(...args);
        },
      };
    },
  };

  const now = Date.now();
  const runnerDeps = { db: poisoned, secrets: makeSecrets(env), fetch: dispatchFetch(mockGood, mockBad) };
  let result;
  await assert.doesNotReject(async () => { result = await runDueSyncs(runnerDeps, env, now, {}); }, "one connection's failure must never abort the batch");
  assert.equal(result.due, 2);
  assert.equal(result.ran, 2);
  assert.equal(result.errors, 1);

  const list = await listConnections(dGood, req, env, "t1");
  assert.equal(list[0].lastTest.ok, true);     // the good connection still ran to completion

  const auditRows = db._tables.connect_audit_event || [];
  const synced = auditRows.filter((r) => r.action === "connect.onboard.synced");
  assert.equal(synced.length, 2);
  assert.ok(synced.some((r) => r.outcome === "error"));
  assert.ok(synced.some((r) => r.outcome === "ok"));
});

test("runDueSyncs: respects the `max` bound", async () => {
  const db = makeOnboardDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "admin" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
  });
  const mock = makeMockFhir({ base: "https://fhir.example.org" });
  const d = { db, secrets: makeSecrets(env), identifyFn: async () => ({ id: "u1", guest: false }), fetch: mock.fetch, now: () => Date.now() };
  for (let i = 0; i < 3; i++) {
    const c = await saveConnection(d, req, env, "t1", { name: "C" + i, type: "fhir", fhirBaseUrl: mock.base, auth: { method: "token", token: "mock-access-1" } });
    await setSyncConfig(d, req, env, "t1", c.connectionId, { intervalMin: 15 });
  }
  const result = await runDueSyncs(d, env, Date.now(), { max: 2 });
  assert.equal(result.due, 3);
  assert.equal(result.ran, 2);
});
