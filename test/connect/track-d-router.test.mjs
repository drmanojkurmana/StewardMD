// test/connect/track-d-router.test.mjs — Enterprise + MaiK route surfaces: flag gate, server-derived
// identity, sanitized errors, no-store (mirrors router.test.mjs). Deep logic is unit-tested per-module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest as enterprise } from "../../functions/api/connect/enterprise/[[path]].js";
import { onRequest as maik } from "../../functions/api/connect/maik/[[path]].js";

const get = (path, env) => ({ request: new Request("https://x" + path), env, params: {} });
const post = (path, body, env) => ({ request: new Request("https://x" + path, { method: "POST", body: JSON.stringify(body || {}), headers: { "content-type": "application/json" } }), env, params: {} });

test("enterprise route 404s when smd_connect is OFF (no existence leak)", async () => {
  const res = await enterprise(get("/api/connect/enterprise/members?tenant=t1", {}));
  assert.equal(res.status, 404);
});

test("maik route 404s when smd_connect is OFF", async () => {
  const res = await maik(post("/api/connect/maik/attach", { tenantId: "t1" }, {}));
  assert.equal(res.status, 404);
});

test("enterprise members read by an unauthenticated caller => sanitized 401", async () => {
  const res = await enterprise(get("/api/connect/enterprise/members?tenant=t1", { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 401);                              // real identify() -> guest -> resolveActor rejects
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);            // sanitized: only {error: code}
  assert.doesNotMatch(body.error, /t1/);                     // no echo of supplied tenant
});

test("maik attach by an unauthenticated caller => sanitized 401 (no PHI echo)", async () => {
  const res = await maik(post("/api/connect/maik/attach", { tenantId: "t1", connectorId: "fhir-r4", patientRef: "MRN-SECRET" }, { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.doesNotMatch(JSON.stringify(body), /MRN-SECRET/);   // patientRef never echoed
});

test("unknown enterprise sub-path => 404", async () => {
  const res = await enterprise(get("/api/connect/enterprise/nope", { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 404);
});
