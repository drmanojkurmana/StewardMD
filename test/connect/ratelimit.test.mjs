// test/connect/ratelimit.test.mjs — per-tenant throttle (spec §3.5, ADR-D8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAndCount, rlKey, loadLimit, setLimit, enforce, RateLimited, DEFAULT_LIMITS } from "../../functions/_connect/enterprise/ratelimit.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb, makeMockKv } from "../../functions/_connect/testkit.js";

const idFn = (id) => async () => ({ id, guest: false });
const seed = () => makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox" }], connect_membership: [{ user_id: "u-admin", tenant_id: "t1", role: "admin" }, { user_id: "u-clin", tenant_id: "t1", role: "clinician" }] });

test("rl key is tenant+action+window ONLY — no patientRef / PHI", () => {
  const k = rlKey("t1", "context:load", 1_700_000_000_000, 3600);
  assert.ok(k.startsWith("connect:rl:t1:context:load:"));
  assert.equal(k.includes("P1"), false);
  assert.equal(k.includes("MRN"), false);
});

test("counter allows under the limit and blocks at the limit", async () => {
  const kv = makeMockKv();
  const cfg = { windowSec: 60, maxCount: 2 };
  const a = await checkAndCount(kv, "t1", "context:load", 1000, cfg); assert.equal(a.ok, true);
  const b = await checkAndCount(kv, "t1", "context:load", 1000, cfg); assert.equal(b.ok, true);
  const c = await checkAndCount(kv, "t1", "context:load", 1000, cfg); assert.equal(c.ok, false);   // exceeded
  assert.equal(c.limit, 2);
});

test("counter FAILS OPEN on a KV infra error (never denies a clinical call)", async () => {
  const brokenKv = { get: async () => { throw new Error("kv down"); }, put: async () => {}, delete: async () => {} };
  const r = await checkAndCount(brokenKv, "t1", "context:load", 1000, { windowSec: 60, maxCount: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.degraded, true);
});

test("setLimit is fail-CLOSED (admin ok, clinician denied)", async () => {
  const r = await setLimit({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1", { action: "context:load", windowSec: 60, maxCount: 5 });
  assert.equal(r.ok, true);
  await assert.rejects(() => setLimit({ db: seed(), identifyFn: idFn("u-clin") }, {}, {}, "t1", { action: "context:load", windowSec: 60, maxCount: 5 }), PermissionError);
});

test("loadLimit returns the configured row, else the default", async () => {
  const db = makeMockDb({ connect_tenant_limits: [{ tenant_id: "t1", action: "context:load", window_sec: 30, max_count: 9 }] });
  assert.deepEqual(await loadLimit(db, "t1", "context:load"), { windowSec: 30, maxCount: 9 });
  assert.deepEqual(await loadLimit(db, "t1", "maik:attach"), DEFAULT_LIMITS["maik:attach"]);
});

test("enforce throws RateLimited past the limit + writes a ratelimit.block audit event", async () => {
  const db = makeMockDb({ connect_tenant_limits: [{ tenant_id: "t1", action: "maik:attach", window_sec: 60, max_count: 1 }] });
  const deps = { db, kv: makeMockKv() };
  await enforce(deps, {}, "t1", "maik:attach", "u1");                     // 1st ok
  await assert.rejects(() => enforce(deps, {}, "t1", "maik:attach", "u1"), RateLimited);   // 2nd blocked
  assert.ok((db._tables.connect_audit_event || []).some((r) => JSON.stringify(r).includes("ratelimit.block")));
});

test("enforce fails OPEN when the counter KV is down (never denies a clinical action)", async () => {
  const brokenKv = { get: async () => { throw new Error("kv down"); }, put: async () => {}, delete: async () => {} };
  const r = await enforce({ db: makeMockDb({}), kv: brokenKv }, {}, "t1", "maik:attach", "u1");
  assert.equal(r.ok, true);
});
