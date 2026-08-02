// test/connect/onboard/router.test.mjs — onboard HTTP surface: flag gate (both flags), server-derived
// identity, sanitized errors, no-store. Deep logic is unit-tested per-module (store/probe/pull).
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/onboard/[[path]].js";
import { makeOnboardDb } from "./onboard-db.mjs";

const post = (path, body, env) => ({ request: new Request("https://x" + path, { method: "POST", body: JSON.stringify(body || {}), headers: { "content-type": "application/json" } }), env, params: {} });
const get = (path, env) => ({ request: new Request("https://x" + path), env, params: {} });
const del = (path, env) => ({ request: new Request("https://x" + path, { method: "DELETE" }), env, params: {} });
const BOTH = { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" };

test("flag OFF -> 404 (no existence leak)", async () => {
  assert.equal((await onRequest(post("/api/connect/onboard/emr", {}, {}))).status, 404);
});

test("onboard flag requires BOTH smd_connect AND smd_connect_onboard", async () => {
  assert.equal((await onRequest(post("/api/connect/onboard/emr", {}, { CONNECT_FLAG: "1" }))).status, 404);            // onboard sub-flag off
  assert.equal((await onRequest(post("/api/connect/onboard/emr", {}, { CONNECT_ONBOARD_FLAG: "1" }))).status, 404);   // master off
});

test("unauthenticated save -> sanitized 401, no secret echo, no-store", async () => {
  const res = await onRequest(post("/api/connect/onboard/emr",
    { tenantId: "t1", name: "x", type: "fhir", fhirBaseUrl: "https://fhir.example.org", auth: { method: "token", token: "SEKRET-TOKEN" } }, BOTH));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);                 // only { error: code }
  assert.doesNotMatch(JSON.stringify(body), /SEKRET-TOKEN/);      // token never echoed
});

test("unauthenticated list -> sanitized 401 (no tenant echo)", async () => {
  const res = await onRequest(get("/api/connect/onboard/list?tenant=t1", BOTH));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.doesNotMatch(body.error, /t1/);
});

test("unauthenticated test/pull/delete -> 401 before any upstream fetch", async () => {
  assert.equal((await onRequest(post("/api/connect/onboard/test/abc", { tenantId: "t1" }, BOTH))).status, 401);
  assert.equal((await onRequest(post("/api/connect/onboard/pull/abc", { tenantId: "t1", patientId: "MRN-SECRET" }, BOTH))).status, 401);
  const res = await onRequest(post("/api/connect/onboard/pull/abc", { tenantId: "t1", patientId: "MRN-SECRET" }, BOTH));
  assert.doesNotMatch(JSON.stringify(await res.json()), /MRN-SECRET/);
  assert.equal((await onRequest(del("/api/connect/onboard/abc?tenant=t1", BOTH))).status, 401);
});

test("unknown sub-path -> 404", async () => {
  assert.equal((await onRequest(get("/api/connect/onboard/nope", BOTH))).status, 404);
});

// Self-service Activity log (security-center-lite): GET /activity, same flag gate as every other onboard
// route (no existence leak). Deep RBAC/tenant-scoping/projection logic is unit-tested in activity.test.mjs.
// A D1 binding is provided here (as production always has one when the flag is on) so the request reaches
// RBAC instead of short-circuiting on readTenantActivity's "no D1 binding => empty list" ops-degrade path.
test("activity: flag OFF -> 404; unauthenticated -> sanitized 401", async () => {
  assert.equal((await onRequest(get("/api/connect/onboard/activity?tenant=t1", {}))).status, 404);
  const res = await onRequest(get("/api/connect/onboard/activity?tenant=t1", Object.assign({}, BOTH, { CONNECT_DB: makeOnboardDb() })));
  assert.equal(res.status, 401);
  assert.deepEqual(Object.keys(await res.json()), ["error"]);
});

// Connector Registry + Marketplace catalog: GET /connectors, same flag gate as every other onboard route (no
// existence leak). Deep RBAC/catalog-shape logic is unit-tested in registry-catalog.test.mjs.
test("connectors: flag OFF -> 404; unauthenticated -> sanitized 401", async () => {
  assert.equal((await onRequest(get("/api/connect/onboard/connectors?tenant=t1", {}))).status, 404);
  const res = await onRequest(get("/api/connect/onboard/connectors?tenant=t1", Object.assign({}, BOTH, { CONNECT_DB: makeOnboardDb() })));
  assert.equal(res.status, 401);
  assert.deepEqual(Object.keys(await res.json()), ["error"]);
});

test("csv upload: flag OFF -> 404; unauthenticated -> sanitized 401 (no raw row echo)", async () => {
  assert.equal((await onRequest(post("/api/connect/onboard/csv", { tenantId: "t1", csv: "MRN,Test\nSECRET-MRN,Hb" }, {}))).status, 404);
  const res = await onRequest(post("/api/connect/onboard/csv", { tenantId: "t1", csv: "MRN,Test\nSECRET-MRN,Hb" }, BOTH));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.doesNotMatch(JSON.stringify(body), /SECRET-MRN/);
});

test("csv upload: an oversized Content-Length is rejected 413 before parsing", async () => {
  const req = new Request("https://x/api/connect/onboard/csv", { method: "POST", body: "{}", headers: { "content-type": "application/json", "content-length": "9000000" } });
  const res = await onRequest({ request: req, env: BOTH, params: {} });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, "too-large");
});

// Automatic sync scheduler routes: sync-config is the RBAC path (behaves like any other onboard route —
// unauthenticated -> sanitized 401); sync-run is the CRON-ONLY admin-token-gated sweep (no RBAC/identify).
test("sync-config: flag OFF -> 404; unauthenticated -> sanitized 401", async () => {
  assert.equal((await onRequest(post("/api/connect/onboard/sync-config/abc", { tenantId: "t1", intervalMin: 60 }, {}))).status, 404);
  const res = await onRequest(post("/api/connect/onboard/sync-config/abc", { tenantId: "t1", intervalMin: 60 }, BOTH));
  assert.equal(res.status, 401);
  assert.deepEqual(Object.keys(await res.json()), ["error"]);
});

test("sync-run: flag OFF -> 404 (even with a valid admin token)", async () => {
  const env = Object.assign({ UPDATES_ADMIN_TOKEN: "s3cret" }, {});   // no CONNECT_FLAG/CONNECT_ONBOARD_FLAG
  const res = await onRequest({ request: new Request("https://x/api/connect/onboard/sync-run", { method: "POST", headers: { "X-Admin-Token": "s3cret" } }), env, params: {} });
  assert.equal(res.status, 404);
});

test("sync-run: missing or wrong X-Admin-Token -> 401, no DB access", async () => {
  const poisonDb = { prepare() { throw new Error("db must not be touched by an unauthorized sync-run"); } };
  const env = Object.assign({}, BOTH, { UPDATES_ADMIN_TOKEN: "s3cret", CONNECT_DB: poisonDb });
  const missing = await onRequest({ request: new Request("https://x/api/connect/onboard/sync-run", { method: "POST" }), env, params: {} });
  assert.equal(missing.status, 401);
  const wrong = await onRequest({ request: new Request("https://x/api/connect/onboard/sync-run", { method: "POST", headers: { "X-Admin-Token": "WRONG" } }), env, params: {} });
  assert.equal(wrong.status, 401);
});

test("sync-run: a valid admin token runs the sweep and returns PHI-free counts", async () => {
  const env = Object.assign({}, BOTH, { UPDATES_ADMIN_TOKEN: "s3cret", CONNECT_DB: makeOnboardDb() });
  const res = await onRequest({ request: new Request("https://x/api/connect/onboard/sync-run", { method: "POST", headers: { "X-Admin-Token": "s3cret" } }), env, params: {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, due: 0, ran: 0, errors: 0 });
});

// --- rest-json per-track flag gate (mirrors Track A's fhirFlagOn idiom): smd_connect_rest, default OFF -----
test("rest-json save: 404 when CONNECT_REST_FLAG is off (base+onboard on); reachable (401) when on", async () => {
  const restBody = { tenantId: "t1", name: "Lab API", type: "rest-json", baseUrl: "https://labs.example.org", auth: { method: "token", token: "SEKRET-REST" } };
  const off = await onRequest(post("/api/connect/onboard/emr", restBody, BOTH));
  assert.equal(off.status, 404);
  const on = await onRequest(post("/api/connect/onboard/emr", restBody, Object.assign({}, BOTH, { CONNECT_REST_FLAG: "1" })));
  assert.equal(on.status, 401);        // past the gate -> the normal unauthenticated RBAC 401
  // fhir save is unaffected by the rest-json gate either way.
  const fhirRes = await onRequest(post("/api/connect/onboard/emr",
    { tenantId: "t1", name: "x", type: "fhir", fhirBaseUrl: "https://fhir.example.org", auth: { method: "token", token: "x" } }, BOTH));
  assert.equal(fhirRes.status, 401);
});

test("rest-json test/pull: per-track flag gate on an existing rest-json row -> 404 off, reachable (401) on", async () => {
  const db = makeOnboardDb();
  await db.prepare("INSERT INTO connect_connector_config (tenant_id,connector_id,kind,profile,base_url,config,secret_ref,scope,status) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind("t1", "rj1", "rest-json", "pull", "https://labs.example.org", JSON.stringify({ source: "onboard", type: "rest-json" }), null,
      JSON.stringify(["Patient", "Observation", "DiagnosticReport"]), "draft").run();
  const envOff = Object.assign({}, BOTH, { CONNECT_DB: db });
  const envOn = Object.assign({}, BOTH, { CONNECT_DB: db, CONNECT_REST_FLAG: "1" });

  assert.equal((await onRequest(post("/api/connect/onboard/test/rj1", { tenantId: "t1" }, envOff))).status, 404);
  assert.equal((await onRequest(post("/api/connect/onboard/pull/rj1", { tenantId: "t1", patientId: "P1" }, envOff))).status, 404);

  assert.equal((await onRequest(post("/api/connect/onboard/test/rj1", { tenantId: "t1" }, envOn))).status, 401);
  assert.equal((await onRequest(post("/api/connect/onboard/pull/rj1", { tenantId: "t1", patientId: "P1" }, envOn))).status, 401);
});

// --- dicomweb per-track flag gate (mirrors the rest-json idiom): smd_connect_dicom, default OFF -------------
test("dicomweb save: 404 when CONNECT_DICOM_FLAG is off (base+onboard on); reachable (401) when on", async () => {
  const dicomBody = { tenantId: "t1", name: "Hospital PACS", type: "dicomweb", baseUrl: "https://pacs.example.org/dicom-web", auth: { method: "token", token: "SEKRET-DICOM" } };
  const off = await onRequest(post("/api/connect/onboard/emr", dicomBody, BOTH));
  assert.equal(off.status, 404);
  const on = await onRequest(post("/api/connect/onboard/emr", dicomBody, Object.assign({}, BOTH, { CONNECT_DICOM_FLAG: "1" })));
  assert.equal(on.status, 401);        // past the gate -> the normal unauthenticated RBAC 401
  // fhir save is unaffected by the dicomweb gate either way.
  const fhirRes = await onRequest(post("/api/connect/onboard/emr",
    { tenantId: "t1", name: "x", type: "fhir", fhirBaseUrl: "https://fhir.example.org", auth: { method: "token", token: "x" } }, BOTH));
  assert.equal(fhirRes.status, 401);
});

// --- AI-assisted field mapping: per-track flag gate (mirrors the rest-json/dicomweb idiom): smd_connect_ai_map,
// default OFF. Deep logic (RBAC, validation, PHI-safety, fallback) is unit-tested in ai-map.test.mjs. -----------
test("suggest-mapping: 404 when CONNECT_AI_MAP_FLAG is off (base+onboard on); reachable (401) when on", async () => {
  const suggestBody = { tenantId: "t1", headers: ["MRN", "Test", "Value"] };
  const off = await onRequest(post("/api/connect/onboard/suggest-mapping", suggestBody, BOTH));
  assert.equal(off.status, 404);
  const on = await onRequest(post("/api/connect/onboard/suggest-mapping", suggestBody, Object.assign({}, BOTH, { CONNECT_AI_MAP_FLAG: "1" })));
  assert.equal(on.status, 401);        // past the gate -> the normal unauthenticated RBAC 401
  assert.equal(on.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(await on.json()), ["error"]);
});

test("suggest-mapping: 404 when the base onboard flag is off, even with CONNECT_AI_MAP_FLAG on", async () => {
  const res = await onRequest(post("/api/connect/onboard/suggest-mapping", { tenantId: "t1", headers: ["MRN"] }, { CONNECT_AI_MAP_FLAG: "1" }));
  assert.equal(res.status, 404);
});

test("dicomweb test/pull: per-track flag gate on an existing dicomweb row -> 404 off, reachable (401) on", async () => {
  const db = makeOnboardDb();
  await db.prepare("INSERT INTO connect_connector_config (tenant_id,connector_id,kind,profile,base_url,config,secret_ref,scope,status) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind("t1", "dw1", "dicomweb", "pull", "https://pacs.example.org/dicom-web", JSON.stringify({ source: "onboard", type: "dicomweb" }), null,
      JSON.stringify(["ImagingStudy"]), "draft").run();
  const envOff = Object.assign({}, BOTH, { CONNECT_DB: db });
  const envOn = Object.assign({}, BOTH, { CONNECT_DB: db, CONNECT_DICOM_FLAG: "1" });

  assert.equal((await onRequest(post("/api/connect/onboard/test/dw1", { tenantId: "t1" }, envOff))).status, 404);
  assert.equal((await onRequest(post("/api/connect/onboard/pull/dw1", { tenantId: "t1", patientId: "P1" }, envOff))).status, 404);

  assert.equal((await onRequest(post("/api/connect/onboard/test/dw1", { tenantId: "t1" }, envOn))).status, 401);
  assert.equal((await onRequest(post("/api/connect/onboard/pull/dw1", { tenantId: "t1", patientId: "P1" }, envOn))).status, 401);
});
