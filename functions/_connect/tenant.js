// functions/_connect/tenant.js — tenant/config load + sandbox-only gate (spec §6/§7, C6)
import { SandboxViolation } from "./permission.js";
export const SANDBOX_ALLOWLIST = ["launch.smarthealthit.org", "r4.smarthealthit.org", "synthea.local"];

export async function loadTenant(db, tenantId) {
  return db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(tenantId).first();
}
export async function loadConnectorConfig(db, tenantId, connectorId) {
  return db.prepare("SELECT * FROM connect_connector_config WHERE tenant_id=?").bind(tenantId).first();
}
export function assertSandboxAllowed(tenant, config, allowlist = SANDBOX_ALLOWLIST) {
  if (tenant && tenant.mode === "live") throw new SandboxViolation("live mode refused in Phase 0 (no consent framework yet)");
  let host; try { host = new URL(config.base_url).host; } catch { throw new SandboxViolation("invalid base_url"); }
  if (!new URL(config.base_url).protocol.startsWith("https")) throw new SandboxViolation("base_url must be https");
  if (!allowlist.includes(host)) throw new SandboxViolation("base_url host not on the sandbox allow-list: " + host);
}
