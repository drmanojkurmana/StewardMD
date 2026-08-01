// test/connect/router.test.mjs — Connect HTTP router: flag gate, server-derived identity, reserved ingress, sanitized errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/connect/[[path]].js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const post = (path, body, env, headers) => ({ request: new Request("https://x" + path, { method: "POST", body: JSON.stringify(body), headers: Object.assign({ "content-type": "application/json" }, headers || {}) }), env, params: {} });

test("flag OFF -> 404 (router does not leak existence when disabled)", async () => {
  const res = await onRequest(post("/api/connect/context", { tenantId: "t1", patientRef: "P1", scope: ["Patient"] }, {}));
  assert.equal(res.status, 404);
});

test("context route ignores a body-supplied tenantId (server-derived only)", async () => {
  // No auth header in this request -> real _usage.identify() returns a guest object ({id:"ip:...",
  // guest:true}), not null -> resolveActor's `who.guest` check rejects it -> sanitized 401, NOT a
  // cross-tenant read of "attacker"'s tenant.
  const res = await onRequest(post("/api/connect/context", { tenantId: "attacker", patientRef: "P1", scope: ["Patient"] }, { CONNECT_FLAG: "1", CONNECT_FHIR_FLAG: "1" }));
  assert.equal(res.status, 401);                       // real identify() -> guest -> resolveActor rejects -> 401
  assert.notEqual(res.status, 200);
  assert.ok(res.status < 300 === false);               // non-2xx
  const body = await res.json();
  assert.equal("tenantId" in body, false);              // no echo of attacker input
  assert.deepEqual(Object.keys(body), ["error"]);        // sanitized: only {error: code}
  assert.equal(typeof body.error, "string");
  assert.doesNotMatch(body.error, /attacker/);           // no leak of the supplied tenantId value
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("authenticated caller (correct identify object shape) passes auth and is denied at membership, not auth", async () => {
  // Regression guard for the _fbauth (string) vs _usage (object) identify mismatch: _usage.identify()
  // returns { id, guest:false, email } for a Cf-Access-authenticated request. If the router still
  // imported the OLD string-returning identify, resolveActor's `!who.id` check would throw AuthError
  // (401/"auth") for EVERY caller, authenticated or not. With the correct object-shaped identify, this
  // caller clears resolveActor and is denied downstream at resolveTenant's membership lookup (403/
  // "permission") because CONNECT_DB has no connect_membership rows — i.e. it fails at membership,
  // not at auth. This distinguishes the two identify sources and pins the bug.
  const env = { CONNECT_FLAG: "1", CONNECT_FHIR_FLAG: "1", CONNECT_DB: makeMockDb({}) };
  const res = await onRequest(post("/api/connect/context",
    { tenantId: "t1", patientRef: "P1", scope: ["Patient"], connectorId: "fhir-r4" },
    env,
    { "Cf-Access-Authenticated-User-Email": "doctor@example.com" }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "permission");                // NOT "auth" -- proves identify's object shape was honored
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("reserved ingress route is 501 in Phase 0", async () => {
  const res = await onRequest(post("/api/connect/ingress/fhir-r4", {}, { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 501);
  assert.equal(res.headers.get("cache-control"), "no-store");
});
