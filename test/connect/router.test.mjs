// test/connect/router.test.mjs — Connect HTTP router: flag gate, server-derived identity, reserved ingress, sanitized errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/connect/[[path]].js";

const post = (path, body, env) => ({ request: new Request("https://x" + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), env, params: {} });

test("flag OFF -> 404 (router does not leak existence when disabled)", async () => {
  const res = await onRequest(post("/api/connect/context", { tenantId: "t1", patientRef: "P1", scope: ["Patient"] }, {}));
  assert.equal(res.status, 404);
});

test("context route ignores a body-supplied tenantId (server-derived only)", async () => {
  // No auth header in this request -> identify() returns null (real _fbauth.identify) -> engine's
  // resolveActor throws AuthError -> sanitized 401, NOT a cross-tenant read of "attacker"'s tenant.
  const res = await onRequest(post("/api/connect/context", { tenantId: "attacker", patientRef: "P1", scope: ["Patient"] }, { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 401);                       // real identify() unauthenticated -> AuthError -> 401
  assert.notEqual(res.status, 200);
  assert.ok(res.status < 300 === false);               // non-2xx
  const body = await res.json();
  assert.equal("tenantId" in body, false);              // no echo of attacker input
  assert.deepEqual(Object.keys(body), ["error"]);        // sanitized: only {error: code}
  assert.equal(typeof body.error, "string");
  assert.doesNotMatch(body.error, /attacker/);           // no leak of the supplied tenantId value
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("reserved ingress route is 501 in Phase 0", async () => {
  const res = await onRequest(post("/api/connect/ingress/fhir-r4", {}, { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 501);
  assert.equal(res.headers.get("cache-control"), "no-store");
});
