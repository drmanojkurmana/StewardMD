// test/connect/abdm/sweep-cron.test.mjs — Stage-6 Task-8: the reconciliation GC (state.sweep) wired to a
// cron-driven, flag-gated, admin-token-protected, no-op-safe + fail-safe POST /admin/sweep on the Connect
// HTTP surface. Proves the Worker cron's target endpoint runs the REAL sweep and can never crash the Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/[[path]].js";
import { makeMockDb } from "../../../functions/_connect/testkit.js";

const ADMIN = "s3cret-admin-token";

// A request to POST /api/connect/admin/sweep. `token` (when given) is sent as X-Admin-Token, mirroring the
// stewardmd-api Worker cron's shared-admin-token call. No body (the cron POSTs an empty body).
const sweepReq = (env, token) => ({
  request: new Request("https://x/api/connect/admin/sweep", {
    method: "POST",
    headers: token == null ? {} : { "X-Admin-Token": token },
  }),
  env,
  params: {},
});

// Minimal R2 stub — sweep only calls list/delete, and only for rows carrying a transaction_id.
const mockR2 = () => ({ list: async () => ({ objects: [] }), delete: async () => {}, get: async () => null, put: async () => {} });

// One already-terminal txn row so the REAL state.sweep has a victim to erase (txnsSwept/keysErased >= 1).
const seededDb = () => makeMockDb({
  connect_abdm_txn: [
    { request_id: "r-term", transaction_id: null, status: "FAILED", expires_at: "2020-01-01T00:00:00Z", eph_privkey_sealed: "SEALED" },
  ],
});

test("authorized + bindings present -> runs the REAL state.sweep and returns counts", async () => {
  const env = { CONNECT_FLAG: "1", UPDATES_ADMIN_TOKEN: ADMIN, CONNECT_DB: seededDb(), CONNECT_R2: mockR2() };
  const res = await onRequest(sweepReq(env, ADMIN));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // The real GC ran end-to-end: the seeded terminal row was swept + its sealed eph key erased.
  assert.equal(typeof body.txnsSwept, "number");
  assert.ok(body.txnsSwept >= 1, "the terminal txn row was swept");
  assert.ok(body.keysErased >= 1, "its sealed ephemeral key was erased");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("wrong admin token -> 403 and NO sweep (auth short-circuits before any DB access)", async () => {
  // A poison DB throws if the route ever reaches state.sweep. Getting 403 (not a fail-safe 200/ok:false)
  // proves auth is enforced BEFORE the sweep, so an unauthorized caller never touches the store.
  const poisonDb = { prepare() { throw new Error("db must not be touched by an unauthorized sweep"); } };
  const env = { CONNECT_FLAG: "1", UPDATES_ADMIN_TOKEN: ADMIN, CONNECT_DB: poisonDb, CONNECT_R2: mockR2() };
  const res = await onRequest(sweepReq(env, "WRONG-TOKEN"));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);   // sanitized
});

test("missing token -> 403 (no sweep)", async () => {
  const poisonDb = { prepare() { throw new Error("db must not be touched"); } };
  const env = { CONNECT_FLAG: "1", UPDATES_ADMIN_TOKEN: ADMIN, CONNECT_DB: poisonDb, CONNECT_R2: mockR2() };
  const res = await onRequest(sweepReq(env, null));
  assert.equal(res.status, 403);
});

test("missing bindings -> no-op-safe (clean 200, no crash) when Connect is flag-ON but unprovisioned", async () => {
  // Authorized, but the D1/R2 bindings are absent (Connect provisioned nowhere). Must NOT call sweep and
  // must NOT throw — a bare Worker cron hitting a half-provisioned env has to degrade to a clean no-op.
  const env = { CONNECT_FLAG: "1", UPDATES_ADMIN_TOKEN: ADMIN };   // no CONNECT_DB / CONNECT_R2
  const res = await onRequest(sweepReq(env, ADMIN));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.skipped, "bindings_absent");
});

test("flag OFF -> 404 (endpoint existence not leaked), even with a valid token + bindings", async () => {
  const env = { UPDATES_ADMIN_TOKEN: ADMIN, CONNECT_DB: seededDb(), CONNECT_R2: mockR2() };   // no CONNECT_FLAG
  const res = await onRequest(sweepReq(env, ADMIN));
  assert.equal(res.status, 404);
});

test("fail-safe: a sweep storage error is caught + audited metadata-only, returns cleanly (never rethrows)", async () => {
  // A D1 that throws on the sweep SELECT (and on the audit INSTALL). The route must swallow both: audit the
  // failure best-effort and return a clean {ok:false} — it must NEVER throw, or the Worker cron would crash.
  const throwingDb = { prepare() { const s = { bind: () => s, all: async () => { throw new Error("d1 down"); }, run: async () => { throw new Error("d1 down"); }, first: async () => { throw new Error("d1 down"); } }; return s; } };
  const env = { CONNECT_FLAG: "1", UPDATES_ADMIN_TOKEN: ADMIN, CONNECT_DB: throwingDb, CONNECT_R2: mockR2() };
  let res;
  await assert.doesNotReject(async () => { res = await onRequest(sweepReq(env, ADMIN)); }, "the route must never rethrow a sweep error");
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "sweep_failed");
});
