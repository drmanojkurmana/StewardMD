// functions/_connect/identity.js — server-derived identity + membership (spec §6/§7, C3)
import { AuthError, PermissionError } from "./permission.js";
import { ownerEmails } from "../_adminauth.js";

export { AuthError };

export async function resolveActor(identifyFn, request, env) {
  const who = await identifyFn(request, env);
  if (!who || who.guest || !who.id) throw new AuthError("authenticated non-guest actor required");
  // email is carried through UNCHANGED from identify() — the VERIFIED Cf-Access header email or a
  // verified Firebase-token email (functions/_usage.js identify()); NEVER a request body/query value.
  // This is what isSuperAdmin() below gates on. Lowercased for a stable, case-insensitive comparison
  // against the (already-lowercased) OWNER_EMAILS allow-list.
  return { id: who.id, email: who.email ? String(who.email).toLowerCase() : null };
}

// isSuperAdmin — the platform-operator check (a small owner-EMAIL allow-list; distinct from the
// per-tenant "owner" ROLE). Reuses functions/_adminauth.js ownerEmails(), the SAME list the rest of
// the app's admin surfaces already use, so there is one source of truth: env.OWNER_EMAILS overrides
// the default 3-address list, and can be narrowed (or a route can additionally require a feature flag)
// later with no code change here. Uses ONLY actor.email, which resolveActor derives strictly from the
// VERIFIED identify() result — never a body/query value — so a caller cannot self-declare super-admin.
// Fail-closed: a null/absent email (guest — though resolveActor already throws for guests — or a
// signed-in caller whose token/header carried no email claim) is never a super-admin.
export function isSuperAdmin(actor, env) {
  try {
    return !!(actor && actor.email && ownerEmails(env).indexOf(actor.email) > -1);
  } catch (e) {
    return false;                                    // fail-closed: any error => deny
  }
}

// resolveTenant(db, actorOrId, tenantId, env) — actorOrId accepts EITHER the resolveActor() object
// ({id,email}) OR a bare actor-id string, so pre-existing call sites that predate the super-admin
// check (functions/_connect/engine.js, functions/_connect/abdm/hip.js|hiu.js — none of which pass
// `env` as a 4th argument) keep their EXACT prior behavior: env is undefined there, so the super-admin
// branch is never entered and the membership lookup runs unchanged. Only guard.js's requireCan (the
// Enterprise Connect surface) passes the actor object + env, opting that surface in.
export async function resolveTenant(db, actorOrId, tenantId, env) {
  const actorId = actorOrId && typeof actorOrId === "object" ? actorOrId.id : actorOrId;

  if (env && isSuperAdmin(actorOrId, env)) {
    // Platform super-admin: full Connect permissions on every tenant WITHOUT a per-tenant
    // connect_membership row (there is none to seed — the id is an opaque fb:<uid> we don't have).
    // A super-admin still cannot invent a tenant id: a non-existent tenant is a PermissionError,
    // exactly like a non-member — this is a permission floor raise, not a tenant-existence bypass.
    const tenant = await db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(tenantId).first();
    if (!tenant) throw new PermissionError("tenant not found");
    return { tenant, role: "superadmin" };
  }

  const m = await db.prepare("SELECT * FROM connect_membership WHERE user_id=?").bind(actorId).all();
  const row = (m.results || []).find((r) => String(r.tenant_id) === String(tenantId));
  // "superadmin" is a PLATFORM role granted ONLY via the email allow-list above; it is never a
  // legitimate connect_membership value. A row claiming it (forged data, or a bug elsewhere) must be
  // refused here rather than honored, or a corrupt/forged row could smuggle full permissions in
  // through the ordinary membership path (see test/connect/rbac-adversarial.test.mjs).
  if (!row || row.role === "superadmin") throw new PermissionError("actor is not a member of tenant " + tenantId);
  const tenant = await db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(tenantId).first();
  if (!tenant) throw new PermissionError("tenant not found");
  return { tenant, role: row.role };
}
