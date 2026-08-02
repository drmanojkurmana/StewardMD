// functions/_connect/onboard/validate-engine.js — Auto Validation engine: ONE action that comprehensively
// validates a saved connection and returns a structured, PHI-free report, so a hospital admin can
// self-diagnose a connection beyond the basic Test. Combines three REUSED checks (nothing reinvented):
//   1. config      — the stored config has the required shape for its kind (mirrors store.js's per-kind
//                     required-field rules; a minimal re-check, not a re-run of the SSRF/save-time builder).
//   2. conformance — the connection's connector TYPE passes the SDK conformance kit (sdk/conformance.js's
//                     runConformance) against a SYNTHETIC fetch fixture. TYPE-LEVEL only: no live call, no
//                     tenant credentials, no real base_url/patient data ever touch this check.
//   3. reachability — the SAME live capability probe as the existing Test (onboard/probe.js's runProbe),
//                     opening the sealed creds exactly as testConnection does.
// Every check returns only { name, ok, detail } where detail is a short CLASS string (a field-name list or
// an error class) — never a URL, token, patient value, or stack.
import { requireCan } from "../enterprise/guard.js";
import { makeAuditSink } from "../audit.js";
import { enforce } from "../enterprise/ratelimit.js";
import { getRow } from "./store.js";
import { runProbe } from "./probe.js";
import { runConformance } from "../sdk/conformance.js";
import { fhirR4Connector } from "../connectors/fhir-r4/connector.js";
import { restJsonConnector } from "../connectors/rest-json/connector.js";
import { dicomWebConnector } from "../connectors/dicomweb/connector.js";
import { graphqlConnector } from "../connectors/graphql/connector.js";
import { sqlConnector } from "../connectors/sql/connector.js";

// The SAME kind -> connector map + kind resolution pull.js uses, so validation ALWAYS conformance-checks the
// exact connector object the real pull would run (mirrored here, not imported — pull.js keeps this map local
// too; see its comment on why an unknown/legacy kind defaults to fhir-r4, the original Increment-1 shape).
const CONNECTORS_BY_KIND = { "fhir-r4": fhirR4Connector, "rest-json": restJsonConnector, "dicomweb": dicomWebConnector, "graphql": graphqlConnector, "sql": sqlConnector };
const kindOf = (row) => (row.kind === "rest-json" ? "rest-json" : row.kind === "dicomweb" ? "dicomweb" : row.kind === "graphql" ? "graphql" : row.kind === "sql" ? "sql" : "fhir-r4");

// --- CHECK 1: config validity -------------------------------------------------------------------------------
// A minimal per-kind required-field check, mirroring store.js's buildRestJsonRow / buildDicomWebRow / the fhir
// branch (NOT a re-run of the SSRF-guarded save-time builder — this connection is already saved and its
// base_url was already SSRF-checked at save time). detail is a class string (field NAMES only, never values).
function checkConfig(row, config) {
  const missing = [];
  const kind = config && config.type;
  // sql has NO base_url (SQL has no HTTP endpoint) and NO sealed credential (DB creds live in the owner's
  // Hyperdrive binding, referenced by name) -- by design, not a missing-config defect. Check its OWN required
  // shape instead (mirrors store.js's buildSqlRow required fields).
  if (kind === "sql") {
    if (!config || !config.bindingName) missing.push("bindingName");
    if (!config || !config.queryTemplate) missing.push("queryTemplate");
    return { name: "config", ok: missing.length === 0, detail: missing.length ? "missing: " + missing.join(",") : "" };
  }
  if (!row || !row.base_url) missing.push("base_url");
  if (!config || !config.sealed) missing.push("credentials");
  if (kind === "rest-json" || kind === "dicomweb" || kind === "graphql") {
    if (!config || config.authMethod !== "token") missing.push("auth.method");
  } else {
    if (!config || (config.authMethod !== "token" && config.authMethod !== "smart")) missing.push("auth.method");
    if (config && config.authMethod === "smart" && !config.clientId) missing.push("auth.clientId");
  }
  return { name: "config", ok: missing.length === 0, detail: missing.length ? "missing: " + missing.join(",") : "" };
}

// --- CHECK 2: connector conformance --------------------------------------------------------------------------
// HAND-AUTHORED synthetic fixtures (never real/captured data) — the SAME synthetic shapes already proven
// against these three built-ins in test/connect/sdk/existing-connectors-conform.test.mjs, test/connect/
// rest-json/conformance.test.mjs and test/connect/dicomweb/conformance.test.mjs. This is TYPE-LEVEL
// conformance only: it never touches the connection's real base_url, sealed creds, or a patient value.
const SYNTHETIC_FHIR_PATIENT = { resourceType: "Patient", id: "P1", gender: "female" };
const SYNTHETIC_FHIR_RESOURCES = [{ resourceType: "Condition", id: "C1", code: { text: "synthetic" } }];
const SYNTHETIC_REST_ROWS = [{ patientId: "P1", testCode: "718-7", testCodeSystem: "LN", testName: "Hemoglobin", value: 9.2, unit: "g/dL", orderId: "O1", collectedAt: "2026-08-01", resultStatus: "final" }];
const SYNTHETIC_DICOM_STUDY = { "0020000D": { vr: "UI", Value: ["1.2.840.113619.2.55.1.1"] }, "00080061": { vr: "CS", Value: ["CT"] }, "00201206": { vr: "IS", Value: [2] }, "00201208": { vr: "IS", Value: [128] } };
// A GraphQL response always wraps rows under `data` (the SAME synthetic row shape as rest-json's); no
// resultsPath is configured for this synthetic fixture, so the connector accepts `data` as a bare array
// (mirrors the connector's own "no path -> accept a bare array" contract, see connectors/graphql/connector.js).
const SYNTHETIC_GRAPHQL_ROWS = SYNTHETIC_REST_ROWS;

function syntheticFetch(kind) {
  if (kind === "rest-json") return async () => new Response(JSON.stringify(SYNTHETIC_REST_ROWS), { status: 200 });
  if (kind === "dicomweb") return async () => new Response(JSON.stringify([SYNTHETIC_DICOM_STUDY]), { status: 200 });
  if (kind === "graphql") return async () => new Response(JSON.stringify({ data: SYNTHETIC_GRAPHQL_ROWS }), { status: 200 });
  // sql ignores ctx.fetch entirely (it reads via ctx.config.driver, never HTTP) -- this fetch is never called;
  // the config-check + conformance kit both run through the connector's own honest not-configured empty path.
  if (kind === "sql") return async () => new Response("{}", { status: 200 });
  return async (url) => {
    const u = String(url);
    if (/\/Patient\/[^/?]+$/.test(u)) return new Response(JSON.stringify(SYNTHETIC_FHIR_PATIENT));
    const m = u.match(/\/([A-Za-z]+)\?/);
    const type = m ? m[1] : null;
    const entry = SYNTHETIC_FHIR_RESOURCES.filter((r) => !type || r.resourceType === type).map((r) => ({ resource: r }));
    return new Response(JSON.stringify({ entry }));
  };
}

// Feed/event kinds that aren't pull connectors (none of the three built-ins onboarded here are, today, but
// this stays defensive for a future kind added to the row's `kind` column) are skipped (n/a), not failed.
async function checkConformance(kind) {
  const connector = CONNECTORS_BY_KIND[kind];
  if (!connector || connector.meta.profile !== "pull") {
    return { name: "conformance", ok: true, detail: "n/a (not a pull connector)", skipped: true, checks: [] };
  }
  const r = await runConformance(connector, { fetch: syntheticFetch(kind), fixtures: { patientRef: "P1" } });
  const failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
  return {
    name: "conformance", ok: !!r.passed,
    detail: r.passed ? "" : "failed: " + failed.join(","),
    checks: r.checks.map((c) => ({ name: c.name, ok: c.ok })),   // names + ok only — never the kit's raw detail text
  };
}

// --- CHECK 3: reachability ------------------------------------------------------------------------------------
// The SAME live probe as the existing Test (testConnection in probe.js): open the sealed creds, run runProbe.
async function checkReachability(deps, row, config) {
  let creds = {};
  try { creds = JSON.parse(await deps.secrets.open(config.sealed)); } catch { creds = {}; }
  const result = await runProbe(deps, row.base_url, config, creds);
  return { name: "reachability", ok: !!result.ok, detail: result.ok ? "" : (result.error || "unreachable") };
}

// Endpoint: RBAC-gated (connector:validate, same tier + throttle as Test), PHI-free report + audit.
export async function validateConnection(deps, request, env, tenantId, connectionId) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:validate");
  await enforce(deps, env, tenant.id, "connector:validate", actor.id);   // same throttle bucket as Test (fail-open on a KV blip)
  const { row, config } = await getRow(deps.db, tenant.id, connectionId);
  const kind = kindOf(row);

  const configCheck = checkConfig(row, config);
  const conformanceCheck = await checkConformance(kind);
  const reachabilityCheck = await checkReachability(deps, row, config);
  const checks = [configCheck, conformanceCheck, reachabilityCheck];
  const ok = checks.every((c) => c.skipped || c.ok);

  await makeAuditSink(env, deps.db)({
    tenantId: tenant.id, actor: actor.id, connectorId: connectionId, action: "connect.onboard.validated",
    outcome: ok ? "ok" : "error", ts: new Date().toISOString(),
  });

  return {
    ok,
    checks: [configCheck, conformanceCheck, reachabilityCheck].map(({ name, ok, detail }) => ({ name, ok, detail })),
    conformance: { passed: conformanceCheck.ok, checks: conformanceCheck.checks },
  };
}
