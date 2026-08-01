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

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const now = () => new Date().toISOString();
const audit = (env, deps, tenant, actor, action, outcome, extra) =>
  makeAuditSink(env, deps.db)(Object.assign({ tenantId: tenant.id, actor: actor.id, connectorId: extra && extra.connectorId, action, outcome, ts: now() }, extra || {}));

// --- validation: returns { baseUrl, config } or throws OnboardError("invalid" | "bad-url") -----------------
function buildRow(body) {
  if (!nonEmpty(body.name)) throw new OnboardError("invalid", "name required");
  if (body.type !== "fhir") throw new OnboardError("invalid", "only type 'fhir' is supported in Increment 1");
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
  config.sealed = await deps.secrets.seal(JSON.stringify(sealMaterial(body.auth || {})));   // envelope-encrypted
  const connectionId = (crypto.randomUUID ? crypto.randomUUID() : "conn-" + Math.random().toString(36).slice(2));
  await deps.db.prepare(
    "INSERT INTO connect_connector_config (tenant_id,connector_id,kind,profile,base_url,config,secret_ref,scope,status) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(tenant.id, connectionId, "fhir-r4", "pull", baseUrl, JSON.stringify(config), null, JSON.stringify(ONBOARD_SCOPE), "draft").run();
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
