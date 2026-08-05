// test/thorex-analyze-proxy.test.mjs — the NEW /api/thorex/v1/cxr/analyze secure-egress proxy route
// (security H1). Drives onRequest with fake Request/env (fundx-backend.test.mjs pattern). Proves the
// auth gate fires BEFORE any upstream forward, and the routing/method gates. (Past-auth paths — 503
// unconfigured, rate-limit, size-cap — need a real Firebase token and are covered by S4 code review.)
import { test } from "node:test";
import assert from "node:assert";
import * as Router from "../functions/api/thorex/[[path]].js";

function ctx(method, path, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.origin != null) headers.Origin = opts.origin;
  if (opts.auth) headers.Authorization = "Bearer " + opts.auth;
  const request = new Request("https://stewardmd.in" + path, { method, headers, body: opts.body });
  return { request, env: opts.env || {} };
}

test("OPTIONS /api/thorex/v1/cxr/analyze → 204 preflight", async () => {
  const r = await Router.onRequest(ctx("OPTIONS", "/api/thorex/v1/cxr/analyze", { origin: "capacitor://localhost" }));
  assert.equal(r.status, 204);
});

test("POST analyze with NO auth token → 401, even with the upstream env set (auth before any forward)", async () => {
  const r = await Router.onRequest(ctx("POST", "/api/thorex/v1/cxr/analyze", { origin: "capacitor://localhost", env: { THOREX_ANALYZE_URL: "https://backend.invalid" } }));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "signin_required");
});

test("GET analyze → 404 (the route is POST-only)", async () => {
  const r = await Router.onRequest(ctx("GET", "/api/thorex/v1/cxr/analyze", { origin: "capacitor://localhost" }));
  assert.equal(r.status, 404);
});

test("POST to an unknown thorex segment → 404", async () => {
  const r = await Router.onRequest(ctx("POST", "/api/thorex/bogus", { origin: "capacitor://localhost" }));
  assert.equal(r.status, 404);
});
