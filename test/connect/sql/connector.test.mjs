// test/connect/sql/connector.test.mjs — the generic SQL/DB pull connector: contract, the STUB's honest
// not-configured path (no driver -> ZERO rows, never a fabricated row), a SYNTHETIC in-memory driver (a
// stand-in for a real Hyperdrive-backed driver, NOT a live DB) proving the fetch+normalize round trip produces
// a valid SCCM bundle with real deterministic ids, a non-array driver result never inventing rows, row-cap
// truncation, the parameterized-query (no-injection) guarantee, and the fail-closed idiom on a throwing driver
// (typed UpstreamError, never a bare/uncontrolled throw; an already-typed error is never masked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sqlConnector } from "../../../functions/_connect/connectors/sql/connector.js";
import { assertConnector } from "../../../functions/_connect/interfaces.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { UpstreamError } from "../../../functions/_connect/permission.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";

const QUERY_TEMPLATE = "SELECT patient_id AS \"patientId\", test_code AS \"testCode\" FROM labs WHERE patient_id = $1";

const ctx = (over = {}) => ({
  tenant: { id: "t1" },
  now: () => new Date(0),
  config: Object.assign({ bindingName: "LABS_DB", queryTemplate: QUERY_TEMPLATE }, over.config || {}),
  budget: over.budget || { maxRows: 50000 },
  logger: { warn() {}, error() {} },
});

// Canonical-named keys so the REUSED inferColumnMap (csv-upload.js) auto-detects them, same as rest-json/graphql.
const ROWS = [
  { patientId: "P1", testCode: "718-7", testCodeSystem: "LN", testName: "Hemoglobin", value: 9.2, unit: "g/dL", orderId: "O1", collectedAt: "2026-08-01", resultStatus: "final" },
  { patientId: "P1", testCode: "2160-0", testCodeSystem: "LN", testName: "Creatinine", value: 1.1, unit: "mg/dL", orderId: "O1", collectedAt: "2026-08-01", resultStatus: "final" },
];

test("sqlConnector satisfies the pull-profile contract", () => {
  assert.doesNotThrow(() => assertConnector(sqlConnector));
  assert.equal(sqlConnector.meta.id, "sql");
  assert.equal(sqlConnector.meta.profile, "pull");
  assert.equal(sqlConnector.meta.sccmVersion, "1.0");
});

// --- (a) the STUB: no driver wired -----------------------------------------------------------------------
test("no driver configured -> notConfigured, ZERO rows, NEVER a fabricated row; normalize still yields a valid patient-only bundle", async () => {
  const c = ctx();   // no config.driver
  const raw = await sqlConnector.fetchPatient(c, "P1");
  assert.equal(raw.notConfigured, true);
  assert.deepEqual(raw.rows, []);
  assert.ok(raw.warnings.some((w) => w.includes("not configured")));
  const bundle = await sqlConnector.normalize(c, raw);
  const v = validateBundle(bundle);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(bundle.observations.length, 0);
  assert.equal(bundle.diagnosticReports.length, 0);
  assert.equal(bundle.patient.id, "unknown");           // no row ever read -> no fabricated patient identity either
  assert.equal(bundle.meta.sourceConnector, "sql");
});

test("validate() reports not-configured with no driver, ok with a driver present", async () => {
  const noDriver = await sqlConnector.validate(ctx());
  assert.equal(noDriver.ok, false);
  assert.equal(noDriver.checks[0].detail, "not-configured");
  const withDriver = await sqlConnector.validate(ctx({ config: { driver: { query: async () => [] } } }));
  assert.equal(withDriver.ok, true);
});

// --- (b) a SYNTHETIC in-memory driver (a stand-in, NOT a live DB) ------------------------------------------
test("a synthetic in-memory driver -> fetch+normalize round trip -> valid SCCM bundle with real deterministic ids; the patient value is a BOUND parameter, never concatenated into the query text", async () => {
  let seenTemplate, seenParams;
  const driver = { query: async (template, params) => { seenTemplate = template; seenParams = params; return ROWS; } };
  const c = ctx({ config: { driver } });
  const raw = await sqlConnector.fetchPatient(c, "P1");
  assert.equal(seenTemplate, QUERY_TEMPLATE);                // the query template is sent VERBATIM, never rewritten
  assert.deepEqual(seenParams, { patientId: "P1" });         // patientRef travels ONLY as a bound parameter
  assert.equal(String(seenTemplate).includes("P1"), false);  // NEVER string-interpolated into the query
  assert.equal(raw.notConfigured, undefined);
  assert.deepEqual(raw.rows, ROWS);

  const bundle = await sqlConnector.normalize(c, raw);
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.observations.length, 2);
  assert.equal(bundle.diagnosticReports.length, 1);          // both rows share orderId O1
  assert.equal(bundle.meta.sourceConnector, "sql");
  assert.notEqual(bundle.patient.id, "unknown");              // a real row was read -> a real (hashed) patient id

  // deterministic + source-derived: re-running the SAME rows through normalize (a fresh ctx, same tenant)
  // produces the SAME ids; the ids do not depend on tenant/salt.
  const bundle2 = await sqlConnector.normalize(ctx({ config: { driver } }), raw);
  assert.equal(bundle2.patient.id, bundle.patient.id);
  assert.deepEqual(bundle2.observations.map((o) => o.id), bundle.observations.map((o) => o.id));
});

test("an explicit columnMap overrides best-effort inference", async () => {
  const driver = { query: async () => [{ pid: "P9", name: "Sodium", val: "140", u: "mmol/L" }] };
  const c = ctx({ config: { driver, config: { columnMap: { patientId: "pid", testName: "name", value: "val", unit: "u" } } } });
  const raw = await sqlConnector.fetchPatient(c, "P9");
  const bundle = await sqlConnector.normalize(c, raw);
  assert.equal(validateBundle(bundle).ok, true);
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.observations[0].value.value, 140);
});

test("a non-array driver result -> 0 rows + a warning, NEVER invented rows; still a valid (empty) bundle", async () => {
  const driver = { query: async () => ({ not: "an array" }) };
  const c = ctx({ config: { driver } });
  const raw = await sqlConnector.fetchPatient(c, "P1");
  assert.deepEqual(raw.rows, []);
  assert.ok(raw.warnings.some((w) => w.includes("non-array")));
  assert.equal(validateBundle(await sqlConnector.normalize(c, raw)).ok, true);
});

test("rows are capped at ctx.budget.maxRows with a truncation warning", async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ patientId: "P1", testName: "T" + i, value: i, unit: "u" }));
  const driver = { query: async () => many };
  const c = ctx({ config: { driver }, budget: { maxRows: 3 } });
  const raw = await sqlConnector.fetchPatient(c, "P1");
  assert.equal(raw.rows.length, 3);
  assert.ok(raw.warnings.some((w) => w.includes("truncated")));
});

// --- (c) a throwing driver: fail-closed, never a bare/uncontrolled throw -----------------------------------
test("a bare-throwing driver is wrapped in a typed UpstreamError (fail-closed, never uncontrolled)", async () => {
  const driver = { query: async () => { throw new Error("connection refused"); } };
  const c = ctx({ config: { driver } });
  await assert.rejects(() => sqlConnector.fetchPatient(c, "P1"), (e) => e instanceof UpstreamError);
});

test("an already-typed error (e.g. the onboard SSRF guard's OnboardError) from the driver is re-thrown, NOT masked", async () => {
  const driver = { query: async () => { throw new OnboardError("ssrf", "redirect target blocked"); } };
  const c = ctx({ config: { driver } });
  await assert.rejects(() => sqlConnector.fetchPatient(c, "P1"), (e) => e instanceof OnboardError && e.klass === "ssrf");
});

test("capabilities + authenticate", async () => {
  const caps = await sqlConnector.capabilities();
  assert.deepEqual(caps.resources, ["Patient", "Observation", "DiagnosticReport"]);
  assert.deepEqual(caps.authKinds, ["binding"]);
  const auth = await sqlConnector.authenticate();
  assert.equal(auth.ok, true);
});
