// test/connect/abdm/gateway.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENDPOINTS, AbdmError, requestId, gatewayHeaders } from "../../../functions/_connect/abdm/gateway.js";

test("ENDPOINTS is the single config seam holding the required gateway paths", () => {
  for (const k of ["sessions", "consentInit", "consentFetch", "hiRequest", "hiNotify"]) {
    assert.equal(typeof ENDPOINTS[k], "string");
    assert.ok(ENDPOINTS[k].startsWith("/"), k + " is a path");
  }
});

test("requestId is a fresh UUID each call (gateway rejects reuse)", () => {
  const a = requestId(), b = requestId();
  assert.match(a, /^[0-9a-f-]{36}$/i);
  assert.notEqual(a, b);
});

test("gatewayHeaders attaches Authorization + X-CM-ID + fresh REQUEST-ID + TIMESTAMP + X-HIU-ID", () => {
  const h = gatewayHeaders({ token: "tok", cmId: "sbx", hiuId: "SMD_HIU", now: () => new Date(0) });
  assert.equal(h.authorization, "Bearer tok");
  assert.equal(h["X-CM-ID"], "sbx");
  assert.equal(h["X-HIU-ID"], "SMD_HIU");
  assert.equal(h.TIMESTAMP, "1970-01-01T00:00:00.000Z");
  assert.match(h["REQUEST-ID"], /^[0-9a-f-]{36}$/i);
});

test("gatewayHeaders omits X-HIU-ID/X-HIP-ID when not given (HIP vs HIU disambiguation)", () => {
  const h = gatewayHeaders({ token: "tok", cmId: "sbx", now: () => new Date(0) });
  assert.equal("X-HIU-ID" in h, false);
  assert.equal("X-HIP-ID" in h, false);
});

import { makeMockGateway } from "./mock-gateway.mjs";

test("mock gateway answers a session call and records it; hiRequest returns 202", async () => {
  const g = makeMockGateway({ sessionExpiresIn: 300 });
  const s = await g.fetch("https://x" + ENDPOINTS.sessions, { method: "POST", body: JSON.stringify({ clientId: "c", clientSecret: "s", grantType: "client_credentials" }) });
  assert.equal(s.status, 200);
  const body = await s.json();
  assert.ok(body.accessToken);
  assert.equal(body.expiresIn, 300);
  const r = await g.fetch("https://x" + ENDPOINTS.hiRequest, { method: "POST", headers: { "REQUEST-ID": "u1" }, body: "{}" });
  assert.equal(r.status, 202);
  assert.ok(g.calls.some((c) => c.path === ENDPOINTS.hiRequest && c.headers["REQUEST-ID"] === "u1"));
});

test("mock gateway can be told to fail the session (fail-closed path)", async () => {
  const g = makeMockGateway({ failSession: true });
  const s = await g.fetch("https://x" + ENDPOINTS.sessions, { method: "POST", body: "{}" });
  assert.equal(s.status, 401);
});

test("mock gateway stores independent adversarial delivery knobs for Stage 4", () => {
  const g = makeMockGateway();
  g.setBehavior({ outOfOrder: true, duplicate: true });   // independent flags combine
  assert.equal(g.behavior.outOfOrder, true);
  assert.equal(g.behavior.duplicate, true);
  assert.equal(g.behavior.partial, false);                // untouched flags stay default
});

import { makeGateway } from "../../../functions/_connect/abdm/gateway.js";

function kvMock() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, String(v)) }; }
const secretsMock = (over = {}) => ({ get: async (n) => ({ ABDM_CLIENT_ID: "cid", ABDM_CLIENT_SECRET: "csec", ...over }[n] ?? null) });
const deps = (mock, over = {}) => ({ baseUrl: "https://sbx", cmId: "sbx", hiuId: "SMD_HIU", fetch: mock.fetch, kv: kvMock(), now: () => new Date(1000), secrets: secretsMock(), ...over });

test("session() obtains + caches a token; a second call reuses cache (no 2nd session HTTP)", async () => {
  const mock = makeMockGateway({ sessionExpiresIn: 300 });
  const gw = makeGateway(deps(mock));
  const t1 = await gw.session();
  const t2 = await gw.session();
  assert.equal(t1, t2);
  assert.equal(mock.calls.filter((c) => c.path === ENDPOINTS.sessions).length, 1);  // cached — one session call only
});

test("session() refreshes once the cached token has expired", async () => {
  const mock = makeMockGateway({ sessionExpiresIn: 300 });
  let t = 1000; const gw = makeGateway(deps(mock, { now: () => new Date(t) }));
  await gw.session();
  t += 400000;                       // jump past exp (300-30s)
  await gw.session();
  assert.equal(mock.calls.filter((c) => c.path === ENDPOINTS.sessions).length, 2);  // refreshed
});

test("session() fails closed on missing creds", async () => {
  const mock = makeMockGateway();
  const gw = makeGateway(deps(mock, { secrets: secretsMock({ ABDM_CLIENT_ID: null }) }));
  await assert.rejects(() => gw.session(), AbdmError);
});

test("session() fails closed on a non-2xx session response", async () => {
  const mock = makeMockGateway({ failSession: true });
  const gw = makeGateway(deps(mock));
  await assert.rejects(() => gw.session(), AbdmError);
});

test("post() attaches a fresh REQUEST-ID + auth header and returns { status, body } on 202", async () => {
  const mock = makeMockGateway();
  const gw = makeGateway(deps(mock));
  const r = await gw.post("hiRequest", { hiRequest: { consent: { id: "c1" } } });
  assert.equal(r.status, 202);          // Stage-4 distinguishes 202-accept from 200-inline
  assert.deepEqual(r.body, {});         // fire-and-forget: empty body
  const call = mock.calls.find((c) => c.path === ENDPOINTS.hiRequest);
  assert.ok(call.headers["REQUEST-ID"]);
  assert.equal(call.headers.authorization, "Bearer mock-token-1");
  assert.equal(call.headers["X-HIU-ID"], "SMD_HIU");
});

test("post() fails closed on an unknown endpoint key (no fetch)", async () => {
  const mock = makeMockGateway();
  const gw = makeGateway(deps(mock));
  await assert.rejects(() => gw.post("bogus", {}), AbdmError);
  assert.equal(mock.calls.length, 0);      // threw before any fetch (not even a session call)
});

// ── V3 pinning (2026-08-18). These paths were live-verified against the ABDM sandbox; the four
// non-session ones were previously legacy v0.5 shapes. See docs/connect/abdm/V3-SPEC-RECONCILIATION.md.
test("ENDPOINTS are pinned to the official V3 paths", () => {
  assert.equal(ENDPOINTS.sessions,     "/api/hiecm/gateway/v3/sessions");
  assert.equal(ENDPOINTS.consentInit,  "/api/hiecm/consent/v3/request/init");
  assert.equal(ENDPOINTS.consentFetch, "/api/hiecm/consent/v3/fetch");
  assert.equal(ENDPOINTS.hiRequest,    "/api/hiecm/data-flow/v3/health-information/request");
  assert.equal(ENDPOINTS.hiNotify,     "/api/hiecm/data-flow/v3/health-information/notify");
});

test("no ENDPOINT retains a legacy v0.5 shape", () => {
  for (const [k, v] of Object.entries(ENDPOINTS)) {
    assert.ok(v.startsWith("/api/hiecm/"), `${k} must be a V3 /api/hiecm path, got ${v}`);
  }
});

test("session() sends the three headers the gateway requires (401 without them)", async () => {
  const { makeGateway } = await import("../../../functions/_connect/abdm/gateway.js");
  let seen = null;
  const gw = makeGateway({
    baseUrl: "https://dev.abdm.gov.in",
    cmId: "sbx",
    kv: { get: async () => null, put: async () => {} },
    secrets: { get: async (n) => (n === "ABDM_CLIENT_ID" ? "SBXID_TEST" : "secret") },
    now: () => new Date(0),
    fetch: async (_url, init) => {
      seen = init;
      return { ok: true, status: 200, json: async () => ({ accessToken: "tok", expiresIn: 1200 }) };
    },
  });
  const tok = await gw.session();
  assert.equal(tok, "tok");
  assert.equal(seen.headers["X-CM-ID"], "sbx");
  assert.equal(seen.headers.TIMESTAMP, "1970-01-01T00:00:00.000Z");
  assert.match(seen.headers["REQUEST-ID"], /^[0-9a-f-]{36}$/i);
  assert.equal(seen.headers["content-type"], "application/json");
  // and no bearer on the session call itself
  assert.equal("authorization" in seen.headers, false);
});
