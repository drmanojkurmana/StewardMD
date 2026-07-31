// functions/_connect/enterprise/org.js — org/tenant lifecycle (spec §3.4).
// createTenant is a BOOTSTRAP: the actor is not yet a member, so it is gated by the PLATFORM owner
// (deps.ownerOk = _adminauth.ownerOK), then seeds the creator as the tenant `owner`. update/suspend are
// tenant-scoped and RBAC-gated (tenant:write). A sandbox->live transition is REFUSED here (Phase-1's
// per-request consent artifact owns `live`; Track D never opens blanket live).
import { requireCan } from "./guard.js";
import { resolveActor } from "../identity.js";
import { PermissionError } from "../permission.js";
import { makeAuditSink } from "../audit.js";

const ID_RE = /^[a-z0-9-]{1,64}$/;   // KV-delimiter-safe (foundation §7)

export async function createTenant(deps, request, env, { id, name }) {
  if (typeof deps.ownerOk !== "function" || !(await deps.ownerOk(request, env)))
    throw new PermissionError("platform owner required to create a tenant");
  if (!ID_RE.test(String(id || ""))) throw new PermissionError("tenant id must match [a-z0-9-]{1,64}");
  const actor = await resolveActor(deps.identifyFn, request, env);
  const now = new Date().toISOString();
  await deps.db.prepare("INSERT INTO connect_tenant (id,name,status,mode,granted_scopes,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, name || id, "active", "sandbox", "[]", "{}", now, now).run();
  await deps.db.prepare("INSERT INTO connect_membership (user_id,tenant_id,role) VALUES (?,?,?)").bind(actor.id, id, "owner").run();
  await makeAuditSink(env, deps.db)({ tenantId: id, actor: actor.id, action: "tenant.create", outcome: "ok", ts: now });
  return { ok: true, id, mode: "sandbox" };
}

export async function updateTenant(deps, request, env, tenantId, patch = {}) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "tenant:write");
  if (patch.mode && patch.mode !== "sandbox")
    throw new PermissionError("live mode transition refused in Track D; the Phase-1 consent artifact owns 'live'");
  await deps.db.prepare("UPDATE connect_tenant SET name=?, updated_at=? WHERE id=?")
    .bind(patch.name != null ? patch.name : tenant.name, new Date().toISOString(), tenant.id).run();
  await makeAuditSink(env, deps.db)({ tenantId: tenant.id, actor: actor.id, action: "tenant.update", outcome: "ok", ts: new Date().toISOString() });
  return { ok: true };
}

export async function suspendTenant(deps, request, env, tenantId) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "tenant:write");
  await deps.db.prepare("UPDATE connect_tenant SET status=?, updated_at=? WHERE id=?").bind("suspended", new Date().toISOString(), tenant.id).run();
  await makeAuditSink(env, deps.db)({ tenantId: tenant.id, actor: actor.id, action: "tenant.suspend", outcome: "ok", ts: new Date().toISOString() });
  return { ok: true };
}
