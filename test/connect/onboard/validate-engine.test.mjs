// test/connect/onboard/validate-engine.test.mjs — the Auto Validation engine: combines config-shape,
// SDK connector conformance (synthetic, type-level, no live call), and reachability (the same live probe as
// the existing Test) into one PHI-free report. Deep per-check logic (probe error classes, conformance's 10
// checks, store.js's per-kind required fields) is unit-tested elsewhere; this file exercises the COMBINATION.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConnection } from "../../../functions/_connect/onboard/validate-engine.js";
import { saveConnection } from "../../../functions/_connect/onboard/store.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { PermissionError } from "../../../functions/_connect/permission.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const jr = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const env = () => ({ CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(4)).toString("base64") });
const seedDb = () => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role: "admin" }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const depsFor = (db, e, fetchFn, actorId = "u1") => ({ db, secrets: makeSecrets(e), identifyFn: async () => ({ id: actorId, guest: false }), fetch: fetchFn, now: () => Date.now() });

test("a valid rest-json connection validates ok across all three checks", async () => {
  const e = env(), db = seedDb();
  const restFetch = async (url) => { const u = new URL(url); if (u.pathname.endsWith("/results")) return jr([{ patientId: "P1", testName: "Hemoglobin", value: 9.2 }]); return new Response("nf", { status: 404 }); };
  const deps = depsFor(db, e, restFetch);
  const { connectionId } = await saveConnection(deps, {}, e, "t1", { name: "Lab API", type: "rest-json", baseUrl: "https://labs.example.org", auth: { method: "token", token: "SEKRET-REST-1" } });

  const report = await validateConnection(deps, {}, e, "t1", connectionId);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checks.find((c) => c.name === "config").ok, true);
  assert.equal(report.checks.find((c) => c.name === "conformance").ok, true);
  assert.equal(report.checks.find((c) => c.name === "reachability").ok, true);
  assert.equal(report.conformance.passed, true);
  assert.ok(Array.isArray(report.conformance.checks) && report.conformance.checks.length > 0);
  assert.ok((db._tables.connect_audit_event || []).some((r) => r.action === "connect.onboard.validated" && r.outcome === "ok"));
});

test("a config-missing connection (no sealed credentials) fails check 1 (config)", async () => {
  const e = env(), db = seedDb();
  // Bypass the save-time builder (which would reject this) to simulate a row that lost its shape, e.g. a
  // partially-migrated / hand-edited row — the same manual-insert idiom router.test.mjs uses for gate tests.
  await db.prepare(
    "INSERT INTO connect_connector_config (tenant_id,connector_id,kind,profile,base_url,config,secret_ref,scope,status) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind("t1", "rj-bad", "rest-json", "pull", "https://labs.example.org",
    JSON.stringify({ source: "onboard", type: "rest-json", authMethod: "token" }),   // no `sealed`
    null, JSON.stringify(["Patient", "Observation", "DiagnosticReport"]), "draft").run();
  const deps = depsFor(db, e, async () => new Response("nf", { status: 404 }));

  const report = await validateConnection(deps, {}, e, "t1", "rj-bad");
  const configCheck = report.checks.find((c) => c.name === "config");
  assert.equal(configCheck.ok, false);
  assert.match(configCheck.detail, /credentials/);
  assert.equal(report.ok, false);
});

test("a rejecting/unreachable fetch fails check 3 (reachability) without throwing, and the report is PHI-free", async () => {
  const e = env(), db = seedDb();
  const failFetch = async () => { const err = new TypeError("fetch failed"); err.cause = { code: "ENOTFOUND" }; throw err; };
  const deps = depsFor(db, e, failFetch);
  const { connectionId } = await saveConnection(deps, {}, e, "t1", { name: "Lab API", type: "rest-json", baseUrl: "https://labs.example.org", auth: { method: "token", token: "SEKRET-REST-2" } });

  const report = await validateConnection(deps, {}, e, "t1", connectionId);   // must resolve, never reject
  const reach = report.checks.find((c) => c.name === "reachability");
  assert.equal(reach.ok, false);
  assert.equal(reach.detail, "unreachable");
  assert.equal(report.ok, false);
  // config + conformance are unaffected by the reachability failure (independent checks).
  assert.equal(report.checks.find((c) => c.name === "config").ok, true);
  assert.equal(report.checks.find((c) => c.name === "conformance").ok, true);

  const dump = JSON.stringify(report);
  assert.doesNotMatch(dump, /labs\.example\.org/);     // no base URL / host
  assert.doesNotMatch(dump, /SEKRET-REST-2/);          // no token value
  assert.doesNotMatch(dump, /patientId/);              // no patient-shaped field name from any fixture/response
});

test("a fhir connection (no live CapabilityStatement needed) still handles conformance (type-level, synthetic)", async () => {
  const e = env(), db = seedDb();
  const CS = { resourceType: "CapabilityStatement", fhirVersion: "4.0.1", software: { name: "Test FHIR" } };
  const BUNDLE = { resourceType: "Bundle", type: "searchset", entry: [] };
  const fhirFetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/metadata")) return jr(CS);
    if (u.pathname.endsWith("/Patient")) return jr(BUNDLE);
    return new Response("nf", { status: 404 });
  };
  const deps = depsFor(db, e, fhirFetch);
  const { connectionId } = await saveConnection(deps, {}, e, "t1", { name: "Main EMR", type: "fhir", fhirBaseUrl: "https://fhir.example.org/r4", auth: { method: "token", token: "SEKRET-FHIR-1" } });

  const report = await validateConnection(deps, {}, e, "t1", connectionId);
  const conf = report.checks.find((c) => c.name === "conformance");
  assert.equal(conf.ok, true, JSON.stringify(conf));
  assert.equal(report.conformance.passed, true);
  assert.ok(report.conformance.checks.some((c) => c.name === "4-capabilities" && c.ok));
  assert.equal(report.checks.find((c) => c.name === "reachability").ok, true);
});

test("a saved sql connection (no driver wired) validates: config ok, conformance ok (empty not-configured path), reachability honestly not-configured", async () => {
  const e = env(), db = seedDb();
  const deps = depsFor(db, e, async () => new Response("nf", { status: 404 }));   // fetch is irrelevant to sql -- never called
  const { connectionId } = await saveConnection(deps, {}, e, "t1",
    { name: "Lab DB", type: "sql", bindingName: "LABS_DB", queryTemplate: "SELECT * FROM labs WHERE patient_id = $1" });

  const report = await validateConnection(deps, {}, e, "t1", connectionId);
  assert.equal(report.checks.find((c) => c.name === "config").ok, true, JSON.stringify(report));
  assert.equal(report.checks.find((c) => c.name === "conformance").ok, true, JSON.stringify(report.conformance));
  assert.equal(report.conformance.passed, true);
  // no wired driver (deps.sqlDriverFactory unset) -> reachability HONESTLY reports not-configured, never a fake ok
  const reach = report.checks.find((c) => c.name === "reachability");
  assert.equal(reach.ok, false);
  assert.equal(reach.detail, "not-configured");
  assert.equal(report.ok, false);
});

test("RBAC denies a non-member (fails closed, never throws PHI, never runs the checks)", async () => {
  const e = env(), db = seedDb();
  const deps = depsFor(db, e, async () => new Response("nf", { status: 404 }), "u-stranger");   // not in connect_membership
  await assert.rejects(() => validateConnection(deps, {}, e, "t1", "any-id"), PermissionError);
});
