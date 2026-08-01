// test/connect/router.test.mjs — Connect HTTP router: flag gate, server-derived identity, reserved ingress, sanitized errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/connect/[[path]].js";
import { makeMockDb } from "../../functions/_connect/testkit.js";
import { sha256hex } from "../../functions/_usage.js";

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

// --- Track C (Connector SDK, smd_connect_sdk) --- with the flag ON the /context dispatch resolves connectors
// through the pull-profile-filtered SDK registry; these pin that the filter + auth ordering are preserved.
test("SDK ON: pull /context refuses an EVENT-profile connectorId via the engine's own guard (typed upstream, never a TypeError)", async () => {
  // With the SDK registry ON, the pull engine is handed only PULL-profile connectors, so an event-profile id
  // ("abdm") resolves to undefined and the engine's OWN guard fires (UpstreamError -> {error:"upstream"}) AFTER
  // auth/membership -- never reaching a missing fetchPatient (which would be an uncontrolled {error:"type"}).
  const actor = "cfa:" + (await sha256hex("doctor@example.com"));
  const db = makeMockDb({
    connect_membership: [{ user_id: actor, tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: JSON.stringify(["Patient"]) }],
    connect_connector_config: [{ tenant_id: "t1", connector_id: "abdm", kind: "abdm", profile: "event", base_url: "https://r4.smarthealthit.org/fhir", scope: JSON.stringify(["Patient"]) }],
  });
  const env = { CONNECT_FLAG: "1", CONNECT_SDK_FLAG: "1", CONNECT_DB: db };
  const res = await onRequest(post("/api/connect/context",
    { tenantId: "t1", patientRef: "P1", scope: ["Patient"], connectorId: "abdm" },
    env, { "Cf-Access-Authenticated-User-Email": "doctor@example.com" }));
  const body = await res.json();
  assert.equal(body.error, "upstream");                  // typed UpstreamError from the profile gate
  assert.notEqual(body.error, "type");                   // NOT an uncontrolled TypeError
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(body), ["error"]);        // sanitized: only {error: code}
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("SDK ON: auth is checked FIRST for every connectorId — an unauthenticated caller cannot distinguish a pull id from an event id", async () => {
  // Identity stays strictly ahead of the connector map: with no actor, BOTH a valid pull id (fhir-r4) and an
  // event id (abdm) return the SAME 401/"auth" — the map is never consulted before auth.
  const env = { CONNECT_FLAG: "1", CONNECT_SDK_FLAG: "1", CONNECT_FHIR_FLAG: "1", CONNECT_DB: makeMockDb({}) };
  for (const connectorId of ["fhir-r4", "abdm"]) {
    const res = await onRequest(post("/api/connect/context", { tenantId: "t1", patientRef: "P1", scope: ["Patient"], connectorId }, env));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "auth");
  }
});

test("SDK ON: valid fhir-r4 (pull) /context path is unchanged — denied at membership, not upstream/type", async () => {
  // Behavior-preserving for the valid pull id: fhir-r4 resolves cleanly through the registry, and an
  // authenticated non-member is still denied at membership (403/"permission").
  const env = { CONNECT_FLAG: "1", CONNECT_SDK_FLAG: "1", CONNECT_FHIR_FLAG: "1", CONNECT_DB: makeMockDb({}) };
  const res = await onRequest(post("/api/connect/context",
    { tenantId: "t1", patientRef: "P1", scope: ["Patient"], connectorId: "fhir-r4" },
    env, { "Cf-Access-Authenticated-User-Email": "doctor@example.com" }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "permission");                // not "upstream", not "type" — gate lets fhir-r4 through
});

test("SDK ON, rest flag OFF: /context rest-json is 404 (per-track smd_connect_rest gate)", async () => {
  // rest-json is in the SDK registry, so with smd_connect_sdk ON it would otherwise be reachable via /context.
  // The per-track smd_connect_rest gate must 404 it (before auth) exactly as the fhir-r4 gate does — a connector
  // is never reachable without its own flag. With the flag ON it clears the gate and falls through to the normal
  // auth check (401 for an unauthenticated caller).
  const off = { CONNECT_FLAG: "1", CONNECT_SDK_FLAG: "1" };            // no CONNECT_REST_FLAG
  const r1 = await onRequest(post("/api/connect/context", { tenantId: "t1", patientRef: "P1", scope: ["Observation"], connectorId: "rest-json" }, off));
  assert.equal(r1.status, 404);
  const on = { CONNECT_FLAG: "1", CONNECT_SDK_FLAG: "1", CONNECT_REST_FLAG: "1", CONNECT_DB: makeMockDb({}) };
  const r2 = await onRequest(post("/api/connect/context", { tenantId: "t1", patientRef: "P1", scope: ["Observation"], connectorId: "rest-json" }, on));
  assert.equal(r2.status, 401);                                        // past the gate -> unauthenticated
});

test("SDK ON, dicom flag OFF: /context dicomweb is 404 (per-track smd_connect_dicom gate)", async () => {
  // dicomweb is in the SDK registry, so with smd_connect_sdk ON it would otherwise be reachable via /context.
  // The per-track smd_connect_dicom gate must 404 it (before auth) exactly as the fhir-r4/rest-json gates do.
  const off = { CONNECT_FLAG: "1", CONNECT_SDK_FLAG: "1" };            // no CONNECT_DICOM_FLAG
  const r1 = await onRequest(post("/api/connect/context", { tenantId: "t1", patientRef: "P1", scope: ["Observation"], connectorId: "dicomweb" }, off));
  assert.equal(r1.status, 404);
  const on = { CONNECT_FLAG: "1", CONNECT_SDK_FLAG: "1", CONNECT_DICOM_FLAG: "1", CONNECT_DB: makeMockDb({}) };
  const r2 = await onRequest(post("/api/connect/context", { tenantId: "t1", patientRef: "P1", scope: ["Observation"], connectorId: "dicomweb" }, on));
  assert.equal(r2.status, 401);                                        // past the gate -> unauthenticated
});
