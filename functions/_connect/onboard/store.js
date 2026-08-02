// functions/_connect/onboard/store.js — self-service EMR connection CRUD over connect_connector_config.
// Server-derived identity + fail-closed RBAC (reuses the Track-D guard); credentials are ENVELOPE-SEALED
// (secrets.js) and NEVER returned to the client; every user-entered URL is SSRF-guarded at save time.
// Each connection is a row keyed (tenant_id, connector_id) where connector_id is a fresh connectionId, so
// onboarded connections coexist with the built-in "fhir-r4" connector without collision.
import { requireCan } from "../enterprise/guard.js";
import { PermissionError } from "../permission.js";
import { makeAuditSink } from "../audit.js";
import { assertPublicHttpsUrl } from "./ssrf.js";
import { OnboardError } from "./errors.js";

// SCCM scope the onboarded FHIR connection pulls by default (Patient is always read; the rest are searched).
export const ONBOARD_SCOPE = Object.freeze(["Patient", "Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DiagnosticReport", "DocumentReference"]);
// SCCM scope a rest-json connection can ever produce (normalizeCsvLab only ever emits these three resources).
export const REST_ONBOARD_SCOPE = Object.freeze(["Patient", "Observation", "DiagnosticReport"]);
// SCCM scope a dicomweb connection can ever produce (the QIDO-RS connector only ever emits ImagingStudy — no
// Patient demographics, no other resource; the bundle's `patient` is a hashed-ref placeholder, not scoped data).
export const DICOM_ONBOARD_SCOPE = Object.freeze(["ImagingStudy"]);
// SCCM scope a graphql connection can ever produce — IDENTICAL to rest-json (the graphql connector reuses the
// SAME normalizeCsvLab mapper, so it can never emit anything rest-json can't).
export const GRAPHQL_ONBOARD_SCOPE = REST_ONBOARD_SCOPE;
// SCCM scope a sql connection can ever produce — IDENTICAL to rest-json (the sql connector reuses the SAME
// normalizeCsvLab mapper, so it can never emit anything rest-json can't).
export const SQL_ONBOARD_SCOPE = REST_ONBOARD_SCOPE;

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const now = () => new Date().toISOString();
const audit = (env, deps, tenant, actor, action, outcome, extra) =>
  makeAuditSink(env, deps.db)(Object.assign({ tenantId: tenant.id, actor: actor.id, connectorId: extra && extra.connectorId, action, outcome, ts: now() }, extra || {}));

// --- validation: returns { baseUrl, config } or throws OnboardError("invalid" | "bad-url") -----------------
function buildRow(body) {
  if (!nonEmpty(body.name)) throw new OnboardError("invalid", "name required");
  if (body.type === "rest-json") return buildRestJsonRow(body);
  if (body.type === "dicomweb") return buildDicomWebRow(body);
  if (body.type === "graphql") return buildGraphQlRow(body);
  if (body.type === "sql") return buildSqlRow(body);
  if (body.type !== "fhir") throw new OnboardError("invalid", "only type 'fhir', 'rest-json', 'dicomweb', 'graphql' or 'sql' is supported");
  const base = assertPublicHttpsUrl(body.fhirBaseUrl, "fhirBaseUrl");    // SSRF guard at save time
  const auth = body.auth || {};
  const config = { source: "onboard", name: String(body.name).trim(), type: "fhir", authMethod: auth.method, createdAt: now(), updatedAt: now(), lastTest: null };
  if (auth.method === "token") {
    if (!nonEmpty(auth.token)) throw new OnboardError("invalid", "auth.token required for method 'token'");
    if (auth.headerName != null && !nonEmpty(auth.headerName)) throw new OnboardError("invalid", "auth.headerName must be a non-empty string");
    if (auth.headerName) config.headerName = String(auth.headerName);
  } else if (auth.method === "smart") {
    if (!nonEmpty(auth.clientId)) throw new OnboardError("invalid", "auth.clientId required for method 'smart'");
    config.clientId = String(auth.clientId);
    if (auth.tokenEndpoint != null) { assertPublicHttpsUrl(auth.tokenEndpoint, "tokenEndpoint"); config.tokenEndpoint = String(auth.tokenEndpoint); }
  } else {
    throw new OnboardError("invalid", "auth.method must be 'token' or 'smart'");
  }
  return { baseUrl: base.href.replace(/\/$/, ""), config };
}

// Generic REST/JSON lab-results pull connection. Token/API-key auth ONLY (no SMART — reject it explicitly so
// the wizard can't silently ask this connector to do work it doesn't support). columnMap is OPTIONAL: if the
// hospital doesn't supply one, the connector (rest-json/connector.js) falls back to the SAME best-effort
// inferColumnMap the CSV upload path already uses — no separate mapping engine.
function buildRestJsonRow(body) {
  const base = assertPublicHttpsUrl(body.baseUrl, "baseUrl");           // SSRF guard at save time
  const auth = body.auth || {};
  if (auth.method !== "token") throw new OnboardError("invalid", "auth.method must be 'token' for type 'rest-json'");
  if (!nonEmpty(auth.token)) throw new OnboardError("invalid", "auth.token required for method 'token'");
  const config = { source: "onboard", name: String(body.name).trim(), type: "rest-json", authMethod: "token", createdAt: now(), updatedAt: now(), lastTest: null };
  // Shape-validate the admin-supplied request-shaping fields (not just non-empty): resultsPath must be a real
  // absolute PATH (no query/fragment/whitespace/@/control), so it cannot silently drop the patient-scoping
  // query via a '#' fragment (which would fetch unfiltered/all-patient data) or pivot to another host:port.
  // patientParam is a query-parameter NAME (no &/=/# injection); headerName is an HTTP header token (no CRLF).
  if (body.headerName != null) { if (!nonEmpty(body.headerName) || !/^[A-Za-z0-9-]+$/.test(body.headerName)) throw new OnboardError("invalid", "headerName must be a simple header token (letters, digits, dashes)"); config.headerName = String(body.headerName); }
  if (body.resultsPath != null) { if (!nonEmpty(body.resultsPath) || !/^\/[^\s#?@\x00-\x1f]*$/.test(body.resultsPath)) throw new OnboardError("invalid", "resultsPath must be an absolute path (start with /) with no query, fragment, whitespace, @ or control characters"); config.resultsPath = String(body.resultsPath); }
  if (body.patientParam != null) { if (!nonEmpty(body.patientParam) || !/^[A-Za-z0-9_.-]+$/.test(body.patientParam)) throw new OnboardError("invalid", "patientParam must be a simple query-parameter name (letters, digits, _ . -)"); config.patientParam = String(body.patientParam); }
  if (body.columnMap != null) { if (typeof body.columnMap !== "object" || Array.isArray(body.columnMap)) throw new OnboardError("invalid", "columnMap must be an object"); config.columnMap = body.columnMap; }
  return { baseUrl: base.href.replace(/\/$/, ""), config };
}

// Generic DICOMweb QIDO-RS imaging-metadata pull connection. Token/API-key auth ONLY (no SMART — same explicit
// rejection as rest-json). studiesPath and patientTag are OPTIONAL request-shaping fields, shape-validated the
// same way as rest-json's resultsPath/patientParam: studiesPath must be a real absolute PATH (no query/
// fragment/whitespace/@/control) so it can never silently drop the patient-scoping query via a '#' fragment
// (which would fetch unfiltered/all-patient studies) or pivot to another host:port; patientTag must be a real
// 8-hex-digit DICOM tag (group+element), not an arbitrary query-parameter name.
function buildDicomWebRow(body) {
  const base = assertPublicHttpsUrl(body.baseUrl, "baseUrl");           // SSRF guard at save time
  const auth = body.auth || {};
  if (auth.method !== "token") throw new OnboardError("invalid", "auth.method must be 'token' for type 'dicomweb'");
  if (!nonEmpty(auth.token)) throw new OnboardError("invalid", "auth.token required for method 'token'");
  const config = { source: "onboard", name: String(body.name).trim(), type: "dicomweb", authMethod: "token", createdAt: now(), updatedAt: now(), lastTest: null };
  if (body.headerName != null) { if (!nonEmpty(body.headerName) || !/^[A-Za-z0-9-]+$/.test(body.headerName)) throw new OnboardError("invalid", "headerName must be a simple header token (letters, digits, dashes)"); config.headerName = String(body.headerName); }
  if (body.studiesPath != null) { if (!nonEmpty(body.studiesPath) || !/^\/[^\s#?@\x00-\x1f]*$/.test(body.studiesPath)) throw new OnboardError("invalid", "studiesPath must be an absolute path (start with /) with no query, fragment, whitespace, @ or control characters"); config.studiesPath = String(body.studiesPath); }
  if (body.patientTag != null) { if (!nonEmpty(body.patientTag) || !/^[0-9A-Fa-f]{8}$/.test(body.patientTag)) throw new OnboardError("invalid", "patientTag must be an 8-hex-digit DICOM tag (e.g. 00100020)"); config.patientTag = String(body.patientTag); }
  return { baseUrl: base.href.replace(/\/$/, ""), config };
}

// Generic GraphQL lab-results pull connection. Token/API-key auth ONLY (no SMART — same explicit rejection as
// rest-json/dicomweb). `query` is the hospital's OWN GraphQL query text (their input; we never fabricate a
// schema), SHAPE-VALIDATED (not just non-empty): bounded length, must look like a query operation (not a bare
// fragment/garbage), and must NEVER contain a mutation/subscription (this connector only ever reads). Crucially
// the query MUST reference the bound `$<patientVar>` variable — a query without it would still execute and
// return SOME rows, but unscoped to the requested patient (a silent all-patient fetch), so that shape is
// rejected here rather than merely "accepted but insecure". `graphqlPath`/`resultsPath` are shape-validated the
// same way as rest-json's resultsPath/dicomweb's studiesPath (an absolute path with no query/fragment/
// whitespace/@/control for graphqlPath; simple dotted identifier segments for resultsPath, with __proto__/
// prototype/constructor segments rejected so a malicious path can never touch the Object prototype chain).
function buildGraphQlRow(body) {
  const base = assertPublicHttpsUrl(body.baseUrl, "baseUrl");           // SSRF guard at save time
  const auth = body.auth || {};
  if (auth.method !== "token") throw new OnboardError("invalid", "auth.method must be 'token' for type 'graphql'");
  if (!nonEmpty(auth.token)) throw new OnboardError("invalid", "auth.token required for method 'token'");
  const config = { source: "onboard", name: String(body.name).trim(), type: "graphql", authMethod: "token", createdAt: now(), updatedAt: now(), lastTest: null };

  if (!nonEmpty(body.query)) throw new OnboardError("invalid", "query required");
  const query = String(body.query).trim();
  if (query.length > 8000) throw new OnboardError("invalid", "query must be at most 8000 characters");
  if (!/^(query\b|\{)/.test(query)) throw new OnboardError("invalid", "query must start with 'query' or '{'");
  if (/\bmutation\b|\bsubscription\b/.test(query)) throw new OnboardError("invalid", "query must not contain a mutation or subscription");

  let patientVar = "patientId";
  if (body.patientVar != null) {
    if (!nonEmpty(body.patientVar) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(body.patientVar)) throw new OnboardError("invalid", "patientVar must be a simple identifier");
    patientVar = String(body.patientVar);
  }
  // A query without this bound variable would fetch unscoped/all-patient data — reject, don't just warn.
  if (!new RegExp("\\$" + patientVar + "\\b").test(query)) throw new OnboardError("invalid", "query must reference the bound variable $" + patientVar);
  config.query = query;
  config.patientVar = patientVar;

  if (body.headerName != null) { if (!nonEmpty(body.headerName) || !/^[A-Za-z0-9-]+$/.test(body.headerName)) throw new OnboardError("invalid", "headerName must be a simple header token (letters, digits, dashes)"); config.headerName = String(body.headerName); }
  if (body.graphqlPath != null) { if (!nonEmpty(body.graphqlPath) || !/^\/[^\s#?@\x00-\x1f]*$/.test(body.graphqlPath)) throw new OnboardError("invalid", "graphqlPath must be an absolute path (start with /) with no query, fragment, whitespace, @ or control characters"); config.graphqlPath = String(body.graphqlPath); }
  if (body.resultsPath != null) {
    if (!nonEmpty(body.resultsPath) || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(body.resultsPath)) throw new OnboardError("invalid", "resultsPath must be dot-separated simple identifiers");
    if (/(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(body.resultsPath)) throw new OnboardError("invalid", "resultsPath must not reference __proto__, prototype or constructor");
    config.resultsPath = String(body.resultsPath);
  }
  if (body.columnMap != null) { if (typeof body.columnMap !== "object" || Array.isArray(body.columnMap)) throw new OnboardError("invalid", "columnMap must be an object"); config.columnMap = body.columnMap; }
  return { baseUrl: base.href.replace(/\/$/, ""), config };
}

// Generic SQL/DB lab-results pull connection (INTERFACE + STUB — see connectors/sql/connector.js). There is NO
// URL (SQL has no HTTP endpoint, so no assertPublicHttpsUrl and baseUrl:"") and NO admin secret in our store:
// the DB credentials live in the owner's Cloudflare Hyperdrive binding, referenced here by NAME only (we NEVER
// store a connection string). `bindingName` is a simple binding identifier. `queryTemplate` is the owner's OWN
// read-only, PARAMETERIZED query: SHAPE-VALIDATED (not just non-empty) so the patient value is ALWAYS a bound
// parameter — the query must contain a placeholder ($1 / :patientId / ?) and reference the patient (never a
// concatenated patient value: the SQL-injection invariant), must be a single statement (no ';'), and must not
// contain any write/DDL keyword (read-only allow-list). columnMap is OPTIONAL (same inferColumnMap fallback as
// rest-json). auth is "binding" (no admin secret), so save does the minimal conditional-seal (config.sealed=null).
function buildSqlRow(body) {
  if (!nonEmpty(body.bindingName) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(body.bindingName)) throw new OnboardError("invalid", "bindingName must be a simple Hyperdrive binding identifier (letters, digits, underscore; we store the NAME, never a connection string)");
  if (!nonEmpty(body.queryTemplate)) throw new OnboardError("invalid", "queryTemplate required");
  const q = String(body.queryTemplate).trim();
  if (q.length > 8000) throw new OnboardError("invalid", "queryTemplate must be at most 8000 characters");
  // READ-ONLY allow-list: a single statement (no ';' -> no stacked/second statement), and NO write/DDL keyword.
  if (q.includes(";")) throw new OnboardError("invalid", "queryTemplate must be a single read-only statement (no ';')");
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|TRUNCATE|MERGE|REPLACE|CALL|EXEC(?:UTE)?)\b/i.test(q)) throw new OnboardError("invalid", "queryTemplate must be read-only (no INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/GRANT/TRUNCATE)");
  // PARAMETERIZED: the patient value MUST be a bound placeholder, never concatenated into the SQL.
  if (!(/\$\d+/.test(q) || /:[A-Za-z_]\w*/.test(q) || q.includes("?"))) throw new OnboardError("invalid", "queryTemplate must be parameterized (use a $1, :patientId or ? placeholder for the patient id, never a concatenated value)");
  // ...and it must reference the patient parameter the driver binds ({ patientId }): a named :patientId, or a
  // patient-scoping column (e.g. WHERE patient_id = $1). Rejects an unscoped query that would fetch all patients.
  if (!/patient/i.test(q)) throw new OnboardError("invalid", "queryTemplate must reference the patient parameter (e.g. WHERE patient_id = $1 or :patientId)");
  const config = { source: "onboard", name: String(body.name).trim(), type: "sql", authMethod: "binding", bindingName: String(body.bindingName), queryTemplate: q, createdAt: now(), updatedAt: now(), lastTest: null };
  if (body.columnMap != null) { if (typeof body.columnMap !== "object" || Array.isArray(body.columnMap)) throw new OnboardError("invalid", "columnMap must be an object"); config.columnMap = body.columnMap; }
  return { baseUrl: "", config };   // SQL has no URL — an empty base_url is stored by design (pull.js/probe.js skip the URL guard for kind 'sql')
}

// The client-facing credential material that gets envelope-sealed (never stored/returned in the clear).
function sealMaterial(auth) {
  if (auth.method === "token") return { token: String(auth.token) };
  // smart: clientId is non-secret (kept in config for display); the private key material is the secret.
  const m = { clientId: String(auth.clientId) };
  if (auth.privateKeyJwk) m.privateKeyJwk = auth.privateKeyJwk;
  if (auth.kid) m.kid = String(auth.kid);
  if (auth.alg) m.alg = String(auth.alg);
  return m;
}

export async function saveConnection(deps, request, env, tenantId, body = {}) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
  const { baseUrl, config } = buildRow(body);
  // Conditional seal: a sql connection carries NO admin secret (DB creds live in the owner's Hyperdrive binding),
  // so it stores config.sealed=null instead of requiring/sealing a credential. pull.js/probe.js already try/catch
  // secrets.open(null) -> {}. Every other type envelope-seals its credential exactly as before.
  config.sealed = config.type === "sql" ? null : await deps.secrets.seal(JSON.stringify(sealMaterial(body.auth || {})));   // envelope-encrypted
  const connectionId = (crypto.randomUUID ? crypto.randomUUID() : "conn-" + Math.random().toString(36).slice(2));
  const kind = config.type === "rest-json" ? "rest-json" : config.type === "dicomweb" ? "dicomweb" : config.type === "graphql" ? "graphql" : config.type === "sql" ? "sql" : "fhir-r4";
  const scope = config.type === "rest-json" ? REST_ONBOARD_SCOPE : config.type === "dicomweb" ? DICOM_ONBOARD_SCOPE : config.type === "graphql" ? GRAPHQL_ONBOARD_SCOPE : config.type === "sql" ? SQL_ONBOARD_SCOPE : ONBOARD_SCOPE;
  await deps.db.prepare(
    "INSERT INTO connect_connector_config (tenant_id,connector_id,kind,profile,base_url,config,secret_ref,scope,status) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(tenant.id, connectionId, kind, "pull", baseUrl, JSON.stringify(config), null, JSON.stringify(scope), "draft").run();
  await audit(env, deps, tenant, actor, "connect.onboard.saved", "ok", { connectorId: connectionId });
  return { ok: true, connectionId };
}

// Fetch one onboarded row for a tenant (fail-closed if missing / not onboard-sourced).
export async function getRow(db, tenantId, connectionId) {
  const r = await db.prepare("SELECT * FROM connect_connector_config WHERE tenant_id=?").bind(tenantId).all();
  const row = (r.results || []).find((c) => String(c.connector_id) === String(connectionId));
  if (!row) throw new OnboardError("not-found", "connection not found");
  let config = {}; try { config = JSON.parse(row.config || "{}"); } catch {}
  if (config.source !== "onboard") throw new OnboardError("not-found", "connection not found");
  return { row, config };
}

// Client-safe projection — NEVER includes sealed/token/private-key material.
export function safeView(row) {
  let c = {}; try { c = JSON.parse(row.config || "{}"); } catch {}
  return {
    connectionId: row.connector_id, name: c.name || null, type: c.type || "fhir",
    fhirBaseUrl: row.base_url, authMethod: c.authMethod || null,
    headerName: c.headerName || null, tokenEndpoint: c.tokenEndpoint || null, clientId: c.clientId || null,
    status: row.status || null, createdAt: c.createdAt || null, updatedAt: c.updatedAt || null,
    lastTest: c.lastTest || null,
    // rest-json-only (non-secret): the results endpoint shape the connector reads with.
    resultsPath: c.resultsPath || null, patientParam: c.patientParam || null, columnMap: c.columnMap || null,
    // dicomweb-only (non-secret): the QIDO-RS studies endpoint shape the connector reads with.
    studiesPath: c.studiesPath || null, patientTag: c.patientTag || null,
    // graphql-only (non-secret): the hospital's OWN query text + the variable/graphqlPath shape the connector
    // reads with (resultsPath/columnMap are shared field names, already surfaced above). `query` carries no
    // patient value (the variable is bound at pull time, never embedded in the query string).
    query: c.query || null, graphqlPath: c.graphqlPath || null, patientVar: c.patientVar || null,
    // sql-only (non-secret): the Hyperdrive binding NAME (never a connection string) + the read-only parameterized
    // query template the connector runs. A connection string / DB credential is NEVER stored or surfaced.
    bindingName: c.bindingName || null, queryTemplate: c.queryTemplate || null,
    // Automatic sync scheduler (additive, no schema change — lives in this same config JSON blob).
    syncIntervalMin: c.syncIntervalMin || 0, lastSyncAt: c.lastSyncAt || null,
  };
}

export async function listConnections(deps, request, env, tenantId) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "connector:read");
  const r = await deps.db.prepare("SELECT * FROM connect_connector_config WHERE tenant_id=?").bind(tenant.id).all();
  return (r.results || []).filter((row) => { try { return JSON.parse(row.config || "{}").source === "onboard"; } catch { return false; } }).map(safeView);
}

export async function deleteConnection(deps, request, env, tenantId, connectionId) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");
  await getRow(deps.db, tenant.id, connectionId);        // 404 if missing / not onboard-sourced
  // Deleting the row erases the inline envelope-sealed credential material with it.
  await deps.db.prepare("DELETE FROM connect_connector_config WHERE tenant_id=? AND connector_id=?").bind(tenant.id, connectionId).run();
  await audit(env, deps, tenant, actor, "connect.onboard.deleted", "ok", { connectorId: connectionId });
  return { ok: true };
}

// Persist the capability-probe outcome (metadata only; no secret material).
export async function recordTest(deps, tenantId, connectionId, result) {
  const { row, config } = await getRow(deps.db, tenantId, connectionId);
  config.lastTest = { ok: !!result.ok, at: now(), fhirVersion: result.fhirVersion || null, softwareName: result.softwareName || null, error: result.error || null };
  config.updatedAt = now();
  const status = result.ok ? "active" : (row.status || "draft");
  await deps.db.prepare("UPDATE connect_connector_config SET config=?, status=? WHERE tenant_id=? AND connector_id=?")
    .bind(JSON.stringify(config), status, tenantId, connectionId).run();
}

export { PermissionError };
