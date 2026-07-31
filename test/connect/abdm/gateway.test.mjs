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

test("mock gateway stores adversarial delivery knobs for Stage 4", () => {
  const g = makeMockGateway();
  g.setBehavior({ pushOrder: "out-of-order", callbackDelayMs: 10 });
  assert.equal(g.behavior.pushOrder, "out-of-order");
  assert.equal(g.behavior.callbackDelayMs, 10);
});
