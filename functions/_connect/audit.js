// functions/_connect/audit.js — PHI-free-by-construction audit (spec §7, C8/C9)
import { SecretsUnavailable } from "./secrets.js";

// R14: metadata-only keys for ABDM consent/data events (consent.granted|denied|revoked, data.requested|
// received|failed). careContextHash is the HMAC of the care-context reference — the raw careContextReference,
// raw ABHA, and any decrypted content are NEVER allow-listed, so buildAuditEvent structurally drops them.
export const ALLOW = ["id", "tenantId", "actor", "connectorId", "action", "resourceCounts", "scope", "patientRefHash", "latencyMs", "outcome", "ts", "consentId", "transactionId", "careContextHash"];

export function buildAuditEvent(fields = {}) {
  const out = {};
  for (const k of ALLOW) if (fields[k] !== undefined) out[k] = fields[k];
  return out;                         // any key not in ALLOW is structurally dropped
}

export async function hmacPseudonym(env, tenantId, patientRef) {
  const salt = env && env.CONNECT_HMAC_SALT;
  if (!salt) throw new SecretsUnavailable("CONNECT_HMAC_SALT missing");
  const keyBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = new TextEncoder().encode(String(tenantId) + ":" + String(patientRef));
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function makeAuditSink(env, db) {
  return async (fields) => {
    const e = buildAuditEvent(fields);
    e.id = e.id || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    // consent_id/transaction_id/care_context_hash are the R14 accountability trail — non-PHI (a consent/txn
    // id is an artifact ref; care_context_hash is the HMAC). buildAuditEvent already dropped raw ABHA / raw
    // careContextReference / decrypted content, so only these allow-listed ids can reach the INSERT.
    await db.prepare(
      "INSERT INTO connect_audit_event (id,tenant_id,ts,actor,connector_id,action,resource_counts,scope,patient_ref_hash,latency_ms,outcome,consent_id,transaction_id,care_context_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(e.id, e.tenantId || null, e.ts || null, e.actor || null, e.connectorId || null, e.action || null,
      JSON.stringify(e.resourceCounts || null), JSON.stringify(e.scope || null), e.patientRefHash || null,
      e.latencyMs || null, e.outcome || null, e.consentId ?? null, e.transactionId ?? null, e.careContextHash ?? null).run();
  };
}
