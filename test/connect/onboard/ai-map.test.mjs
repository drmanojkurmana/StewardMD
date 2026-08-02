// test/connect/onboard/ai-map.test.mjs — AI-assisted field mapping suggestion.
// PHI-safety (the hard invariant): the injected aiSuggest seam is called with ONLY the input headers + the
// fixed SCCM target-field list — never a row/cell/patient value, never a tenant id, never anything else.
// A hallucinated/unknown SCCM field in the model's response is dropped; a header it didn't echo back is
// dropped; aiSuggest absent or throwing falls back to the SAME deterministic inferColumnMap the CSV upload
// path already uses. The endpoint fn is RBAC-gated, rejects a headers array smuggling non-string entries, and
// audits outcome + source + header COUNT only — never a header name or mapped value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestFieldMap, suggestMapping } from "../../../functions/_connect/onboard/ai-map.js";
import { inferColumnMap, SCCM_TARGET_FIELDS } from "../../../functions/_connect/onboard/csv-upload.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const env = {};
const seedDb = (role = "admin") => makeOnboardDb({
  connect_membership: [{ user_id: "u1", tenant_id: "t1", role }],
  connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
});
const deps = (db, extra = {}) => Object.assign({ db, identifyFn: async () => ({ id: "u1", guest: false }) }, extra);
const req = {};

const HEADERS = ["MRN", "Test", "Value", "Unit"];

test("suggestFieldMap: with a mock aiSuggest, returns the validated map (source 'ai')", async () => {
  const aiSuggest = async () => ({ MRN: "patientId", Test: "testName", Value: "value", Unit: "unit" });
  const res = await suggestFieldMap({ aiSuggest }, HEADERS);
  assert.equal(res.source, "ai");
  assert.deepEqual(res.map, { MRN: "patientId", Test: "testName", Value: "value", Unit: "unit" });
});

test("suggestFieldMap: a hallucinated/unknown SCCM field in the response is dropped", async () => {
  const aiSuggest = async () => ({ MRN: "patientId", Test: "not_a_real_sccm_field", Value: "value" });
  const res = await suggestFieldMap({ aiSuggest }, HEADERS);
  assert.equal(res.source, "ai");
  assert.deepEqual(res.map, { MRN: "patientId", Value: "value" });
  assert.equal("Test" in res.map, false);
});

test("suggestFieldMap: a header the model didn't echo back verbatim from the input is dropped", async () => {
  const aiSuggest = async () => ({ MRN: "patientId", "Smuggled-Column-Not-In-Input": "value" });
  const res = await suggestFieldMap({ aiSuggest }, HEADERS);
  assert.deepEqual(res.map, { MRN: "patientId" });
});

test("suggestFieldMap: aiSuggest throws -> falls back to inferColumnMap (source 'heuristic')", async () => {
  const aiSuggest = async () => { throw new Error("model unavailable"); };
  const res = await suggestFieldMap({ aiSuggest }, HEADERS);
  assert.equal(res.source, "heuristic");
  assert.deepEqual(res.map, inferColumnMap(HEADERS));
});

test("suggestFieldMap: no aiSuggest -> heuristic", async () => {
  const res = await suggestFieldMap({}, HEADERS);
  assert.equal(res.source, "heuristic");
  assert.deepEqual(res.map, inferColumnMap(HEADERS));
});

test("PHI-safety: the mock aiSuggest is called with ONLY the headers + the SCCM field list, nothing else", async () => {
  let seen = null;
  const aiSuggest = async (payload) => { seen = payload; return {}; };
  await suggestFieldMap({ aiSuggest }, HEADERS);
  assert.ok(seen, "aiSuggest was invoked");
  // Exactly two top-level keys: headers + fields — no tenantId, no sample row, no free text, nothing extra.
  assert.deepEqual(Object.keys(seen).sort(), ["fields", "headers"]);
  assert.deepEqual(seen.headers, HEADERS);
  assert.deepEqual(seen.fields, SCCM_TARGET_FIELDS.slice());
  // The field list is exactly the SCCM allow-list derived from csv-upload.js's own mapper (no divergent list).
  for (const f of seen.fields) assert.ok(SCCM_TARGET_FIELDS.includes(f));
  // No PHI-shaped values anywhere in the payload (defense in depth beyond the key check above).
  const blob = JSON.stringify(seen);
  for (const phi of ["9.2", "Jane", "Doe", "t1", "tenantId"]) assert.equal(blob.includes(phi), false);
});

test("PHI-safety: a data row passed alongside headers is never forwarded to aiSuggest", async () => {
  let seen = null;
  const aiSuggest = async (payload) => { seen = payload; return {}; };
  // Even if a caller tried to smuggle row data into suggestFieldMap's opts, the payload built for aiSuggest
  // must still be headers-only (suggestFieldMap only ever reads the headers argument, never opts.rows).
  await suggestFieldMap({ aiSuggest }, HEADERS, { rows: [["P1", "Jane Doe", "9.2", "g/dL"]] });
  assert.deepEqual(Object.keys(seen).sort(), ["fields", "headers"]);
});

// --- suggestMapping: the RBAC-gated endpoint fn -------------------------------------------------------------

test("suggestMapping: RBAC denies a non-member actor (fail-closed)", async () => {
  const db = seedDb();
  await assert.rejects(() => suggestMapping(deps(db, { identifyFn: async () => ({ id: "intruder", guest: false }) }), req, env, "t1", { headers: HEADERS }));
});

test("suggestMapping: rejects a headers array containing a non-string (anti data-smuggle)", async () => {
  const db = seedDb();
  await assert.rejects(() => suggestMapping(deps(db), req, env, "t1", { headers: ["MRN", 42] }), (e) => e.klass === "invalid");
  await assert.rejects(() => suggestMapping(deps(db), req, env, "t1", { headers: ["MRN", { evil: true }] }), (e) => e.klass === "invalid");
  await assert.rejects(() => suggestMapping(deps(db), req, env, "t1", { headers: [] }), (e) => e.klass === "invalid");
  await assert.rejects(() => suggestMapping(deps(db), req, env, "t1", {}), (e) => e.klass === "invalid");
});

test("suggestMapping: returns the heuristic map when no aiSuggest is wired", async () => {
  const db = seedDb();
  const res = await suggestMapping(deps(db), req, env, "t1", { headers: HEADERS });
  assert.equal(res.ok, true);
  assert.equal(res.source, "heuristic");
  assert.deepEqual(res.map, inferColumnMap(HEADERS));
});

test("suggestMapping: audit records outcome + source + header COUNT only, never header names", async () => {
  const db = seedDb();
  await suggestMapping(deps(db, { aiSuggest: async () => ({ MRN: "patientId" }) }), req, env, "t1", { headers: HEADERS });
  const auditRows = db._tables.connect_audit_event || [];
  const row = auditRows.find((r) => r.action === "connect.onboard.map_suggested");
  assert.ok(row, "a map_suggested audit row is written");
  assert.equal(row.outcome, "ok");
  const counts = JSON.parse(row.resource_counts);
  assert.equal(counts.headerCount, HEADERS.length);
  assert.equal(counts.mappedCount, 1);
  const scope = JSON.parse(row.scope);
  assert.equal(scope.source, "ai");
  // No header name (or mapped SCCM field value) reaches the audit sink.
  const blob = JSON.stringify(auditRows);
  for (const h of HEADERS) assert.equal(blob.includes(h), false);
  assert.equal(blob.includes("patientId"), false);
});

test("RBAC: a clinician (no connector:write) is denied", async () => {
  const db = seedDb("clinician");
  await assert.rejects(() => suggestMapping(deps(db), req, env, "t1", { headers: HEADERS }));
});
