// test/connect-source.test.mjs — Connect client data source (window.SMD_CONNECT), P2 increment 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../connect-source.js", import.meta.url), "utf8");

// Load the browser IIFE with stubbed globals; returns window.SMD_CONNECT.
function load({ hostname = "stewardmd.in", tokenVal = "TKN", fetchImpl } = {}) {
  const win = { SMD_AUTH: { currentUser: tokenVal == null ? null : { getIdToken: () => Promise.resolve(tokenVal) } } };
  const loc = { hostname, protocol: "https:" };
  new Function("window", "location", "fetch", SRC)(win, loc, fetchImpl || (() => Promise.reject(new Error("no fetch"))));
  return win.SMD_CONNECT;
}

test("apiBase: relative on the stewardmd.in website, absolute inside the native app", () => {
  assert.equal(load({ hostname: "stewardmd.in" }).apiBase(), "");
  assert.equal(load({ hostname: "www.stewardmd.in" }).apiBase(), "");
  assert.equal(load({ hostname: "localhost" }).apiBase(), "https://stewardmd.in");   // Capacitor origin
});

test("pullContext posts tenant+patient+scope with the auth token and returns the bundle", async () => {
  let seen = null;
  const C = load({ hostname: "localhost", fetchImpl: (url, opts) => { seen = { url, opts }; return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, bundle: { resources: [{ resourceType: "Patient" }] } }) }); } });
  const r = await C.pullContext({ tenantId: "t1", patientRef: "P1" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.bundle.resources[0], { resourceType: "Patient" });
  assert.equal(seen.url, "https://stewardmd.in/api/connect/context");   // absolute in-app
  assert.equal(seen.opts.method, "POST");
  assert.equal(seen.opts.headers.Authorization, "Bearer TKN");
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.tenantId, "t1");
  assert.equal(body.patientRef, "P1");
  assert.equal(body.connectorId, "fhir-r4");
  assert.ok(Array.isArray(body.scope) && body.scope.indexOf("MedicationStatement") > -1);
});

test("pullContext requires both tenant and patient (no fetch fired)", async () => {
  const C = load({});
  assert.equal((await C.pullContext({ tenantId: "t1" })).error, "tenant-and-patient-required");
  assert.equal((await C.pullContext({ patientRef: "P1" })).error, "tenant-and-patient-required");
});

test("pullContext without a signed-in user -> not-signed-in, never calls the network", async () => {
  let called = false;
  const C = load({ tokenVal: null, fetchImpl: () => { called = true; return Promise.resolve({ status: 200, json: () => Promise.resolve({}) }); } });
  assert.equal((await C.pullContext({ tenantId: "t1", patientRef: "P1" })).error, "not-signed-in");
  assert.equal(called, false);
});

test("resourcesOfType filters the pulled bundle by resourceType", async () => {
  const C = load({ hostname: "localhost", fetchImpl: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, bundle: { resources: [{ resourceType: "MedicationStatement", id: "m1" }, { resourceType: "Observation", id: "o1" }] } }) }) });
  const r = await C.resourcesOfType({ tenantId: "t1", patientRef: "P1" }, "MedicationStatement");
  assert.equal(r.ok, true);
  assert.equal(r.resources.length, 1);
  assert.equal(r.resources[0].id, "m1");
});

test("tenants() lists the signed-in user's hospitals", async () => {
  const C = load({ hostname: "localhost", fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ tenants: [{ tenantId: "t1", role: "owner" }] }) }) });
  const ts = await C.tenants();
  assert.equal(ts.length, 1);
  assert.equal(ts[0].tenantId, "t1");
});

test("tenants() returns [] when signed out (no token)", async () => {
  const C = load({ tokenVal: null });
  assert.deepEqual(await C.tenants(), []);
});
