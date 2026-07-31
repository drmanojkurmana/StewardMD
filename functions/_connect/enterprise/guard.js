// functions/_connect/enterprise/guard.js — server-derived, fail-closed RBAC entry guard (spec §3.2)
// Every Enterprise + MaiK-bridge action funnels through requireCan: identity + membership are derived
// server-side (never the request body); a deny is any of {non-authenticated, non-member, role lacks the
// action, ANY thrown error}. Reuses the Phase-0 identity/tenant/permission seams unchanged.
import { resolveActor, resolveTenant } from "../identity.js";
import { PermissionError } from "../permission.js";
import { can } from "./rbac.js";

// deps: { db, identifyFn }. Returns { actor, tenant, role } on allow; throws (fail-closed) on deny.
export async function requireCan(deps, request, env, tenantId, action) {
  const actor = await resolveActor(deps.identifyFn, request, env);        // AuthError if guest/none
  const { tenant, role } = await resolveTenant(deps.db, actor.id, tenantId); // PermissionError if non-member
  if (!can(role, action)) throw new PermissionError("role '" + role + "' may not perform '" + action + "'");
  return { actor, tenant, role };
}
