// test/connect/onboard/router.test.mjs — onboard HTTP surface: flag gate (both flags), server-derived
// identity, sanitized errors, no-store. Deep logic is unit-tested per-module (store/probe/pull).
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/connect/onboard/[[path]].js";

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
