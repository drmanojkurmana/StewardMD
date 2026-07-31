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
