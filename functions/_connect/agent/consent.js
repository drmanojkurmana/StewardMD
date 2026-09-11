// functions/_connect/agent/consent.js — SERVER-OWNED consent for the Connect Hospital agent.
//
// This is the server-side port of connect-agent/consent.mjs's semantics, NOT a verifier for the receipts
// that module mints. The difference is the whole point: a client-held receipt is a bearer artifact, and
// anything the client can hold it can replay, edit or hand to another actor. Here the record lives in D1,
// keyed by (tenant, actor, deployment), and the client presents NOTHING. The keyed HMAC
// (CONNECT_CONSENT_SIGNING_KEY, the SAME env name connect-agent/consent.mjs uses) is a tamper check on our
// own row, so a consent row edited around the application still fails verification.
//
// Ported semantics, unchanged: keyed HMAC (never an unkeyed digest), no unkeyed fallback, an unparseable
// expiry is a failure and not "no expiry", expiry is checked, and every required scope must be present.
// Added on top: tenant/deployment binding, explicit revocation, and a recorded policy version.
import { OnboardError } from "../onboard/errors.js";
import { hmacHex, equalHex } from "./hmac.js";
import { insertConsent, listConsents, getConsent, revokeConsentRow, newId, nowIso } from "./store.js";

// The scope vocabulary a Connect Hospital consent can grant. Read-only by construction: there is no
// write/order/prescribe scope to grant, so no policy mistake can produce one.
export const AGENT_SCOPES = Object.freeze(["emr:session", "emr:discover", "emr:read"]);
export const CONSENT_POLICY_VERSION = "connect-agent-consent/1";
export const CONSENT_DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;   // 12h; a consent is not a standing grant

function signingKey(env) {
  const key = env && env.CONNECT_CONSENT_SIGNING_KEY;
  // No unkeyed fallback, for the same reason connect-agent/consent.mjs has none: an unkeyed "signature"
  // looks verified and is not. Missing key => the surface fails closed rather than degrading.
  if (!key) throw new OnboardError("not-configured", "CONNECT_CONSENT_SIGNING_KEY missing");
  return String(key);
}

// The canonical bytes the HMAC covers. Field order is fixed here, not derived from object key order.
function canonical(row) {
  return JSON.stringify([
    CONSENT_POLICY_VERSION, String(row.id), String(row.tenant_id), String(row.deployment_id),
    String(row.actor_id), JSON.parse(row.scope || "[]"), Number(row.expires_at),
  ]);
}

export function normalizeScope(scope) {
  if (!Array.isArray(scope) || scope.length === 0) throw new OnboardError("invalid", "at least one scope is required");
  const out = [...new Set(scope.map(String))];
  for (const s of out) if (AGENT_SCOPES.indexOf(s) === -1) throw new OnboardError("invalid", "unknown consent scope");
  return out.sort();
}

// recordConsent — writes the server-owned record. `actorId` and `tenantId` come from the authenticated
// caller resolution, never from a request body.
export async function recordConsent(deps, env, { tenantId, actorId, deploymentId, scope, ttlMs, now }) {
  const key = signingKey(env);
  const nowMs = Number(now != null ? now : deps.now());
  const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : CONSENT_DEFAULT_TTL_MS;
  const row = {
    id: newId("con_"), tenant_id: String(tenantId), deployment_id: String(deploymentId),
    actor_id: String(actorId), scope: JSON.stringify(normalizeScope(scope)),
    policy_version: CONSENT_POLICY_VERSION, expires_at: nowMs + ttl, created_at: nowIso(),
  };
  row.receipt_hmac = await hmacHex(key, canonical(row));
  await insertConsent(deps.db, row);
  return row;
}

// verifyConsentRow — the tamper + validity check. Exported so a test (and any future admin surface) can
// assert the exact failure mode rather than only "it threw".
export async function verifyConsentRow(env, row, { requiredScope = [], now = Date.now() } = {}) {
  const key = signingKey(env);
  if (!row) throw new OnboardError("forbidden", "consent required");
  const expected = await hmacHex(key, canonical(row));
  if (!equalHex(expected, row.receipt_hmac)) throw new OnboardError("forbidden", "consent record signature invalid");
  if (row.revoked_at != null) throw new OnboardError("revoked", "consent revoked");
  const expiry = Number(row.expires_at);
  if (!Number.isFinite(expiry)) throw new OnboardError("forbidden", "consent has an invalid expiry");
  if (Number(now) >= expiry) throw new OnboardError("expired", "consent expired");
  const granted = new Set(JSON.parse(row.scope || "[]"));
  for (const s of requiredScope) if (!granted.has(s)) throw new OnboardError("forbidden", "consent scope missing");
  return true;
}

// assertConsent — find this actor's active consent for this deployment and verify it. Returns the row.
export async function assertConsent(deps, env, { tenantId, actorId, deploymentId, requiredScope = [], now }) {
  const nowMs = Number(now != null ? now : deps.now());
  const rows = await listConsents(deps.db, tenantId, actorId, deploymentId);
  let lastError = null;
  const candidates = rows.slice().sort((a, b) => Number(b.expires_at) - Number(a.expires_at));
  for (const row of candidates) {
    try { await verifyConsentRow(env, row, { requiredScope, now: nowMs }); return row; }
    catch (e) { lastError = e; }
  }
  throw lastError || new OnboardError("forbidden", "consent required");
}

export async function revokeConsent(deps, env, { tenantId, consentId, now }) {
  const row = await getConsent(deps.db, tenantId, consentId);
  if (!row) throw new OnboardError("not-found", "consent not found");
  await revokeConsentRow(deps.db, tenantId, consentId, Number(now != null ? now : deps.now()));
  return { ok: true };
}

// Client-safe projection: scope, expiry and policy version. Never the HMAC.
export function consentView(row) {
  return {
    consentId: row.id, scope: JSON.parse(row.scope || "[]"), policyVersion: row.policy_version,
    expiresAt: Number(row.expires_at), revokedAt: row.revoked_at != null ? Number(row.revoked_at) : null,
  };
}
