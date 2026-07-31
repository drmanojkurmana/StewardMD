// functions/_connect/identity.js — server-derived identity + membership (spec §6/§7, C3)
import { AuthError, PermissionError } from "./permission.js";

export { AuthError };

export async function resolveActor(identifyFn, request, env) {
  const who = await identifyFn(request, env);
  if (!who || who.guest || !who.id) throw new AuthError("authenticated non-guest actor required");
  return { id: who.id };
}

export async function resolveTenant(db, actorId, tenantId) {
  const m = await db.prepare("SELECT * FROM connect_membership WHERE user_id=?").bind(actorId).all();
  const row = (m.results || []).find((r) => String(r.tenant_id) === String(tenantId));
  if (!row) throw new PermissionError("actor is not a member of tenant " + tenantId);
  const tenant = await db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(tenantId).first();
  if (!tenant) throw new PermissionError("tenant not found");
  return { tenant, role: row.role };
}
