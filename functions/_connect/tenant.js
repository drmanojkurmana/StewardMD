// functions/_connect/tenant.js — tenant/config load + sandbox-only gate (spec §6/§7, C6)
import { SandboxViolation } from "./permission.js";
export const SANDBOX_ALLOWLIST = ["launch.smarthealthit.org", "r4.smarthealthit.org", "synthea.local", "smart-mock.local"]; // // VERIFY real hospital FHIR host(s) before non-sandbox use

export async function loadConnectorConfig(db, tenantId, connectorId) {
  const r = await db.prepare("SELECT * FROM connect_connector_config WHERE tenant_id=?").bind(tenantId).all();
  return (r.results || []).find((c) => String(c.connector_id) === String(connectorId)) || null;
}
export function assertSandboxAllowed(tenant, config, allowlist = SANDBOX_ALLOWLIST) {
  if (!tenant) throw new SandboxViolation("tenant required");
  if (tenant.mode === "live") throw new SandboxViolation("live mode refused in Phase 0 (no consent framework yet)");
  let u; try { u = new URL(config.base_url); } catch { throw new SandboxViolation("invalid base_url"); }
  if (u.protocol !== "https:") throw new SandboxViolation("base_url must be https");
  if (u.username || u.password) throw new SandboxViolation("base_url must not contain userinfo");
  if (!allowlist.includes(u.host)) throw new SandboxViolation("base_url host not on the sandbox allow-list: " + u.host);
}
