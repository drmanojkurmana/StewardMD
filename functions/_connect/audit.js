// functions/_connect/audit.js — PHI-free-by-construction audit (spec §7, C8/C9)
import { SecretsUnavailable } from "./secrets.js";

const ALLOW = ["id", "tenantId", "actor", "connectorId", "action", "resourceCounts", "scope", "patientRefHash", "latencyMs", "outcome", "ts"];

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
    await db.prepare(
      "INSERT INTO connect_audit_event (id,tenant_id,ts,actor,connector_id,action,resource_counts,scope,patient_ref_hash,latency_ms,outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(e.id, e.tenantId || null, e.ts || null, e.actor || null, e.connectorId || null, e.action || null,
      JSON.stringify(e.resourceCounts || null), JSON.stringify(e.scope || null), e.patientRefHash || null,
      e.latencyMs || null, e.outcome || null).run();
  };
}
