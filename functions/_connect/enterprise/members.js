// functions/_connect/enterprise/members.js — membership management (spec §3.3). RBAC-gated; server-derived.
// Guards: role-enum validation; only an owner grants/acts-on owner (†); last-owner protection.
// Audit is PHI-free (action + actor + tenant + outcome only; target user-id/role are non-PHI account ids
// but are not on the audit ALLOW-list, so they are intentionally not persisted — see spec §2 note).
import { requireCan } from "./guard.js";
import { resolveActor, isSuperAdmin } from "../identity.js";
import { TENANT_ROLES } from "./rbac.js";
import { PermissionError } from "../permission.js";
import { makeAuditSink } from "../audit.js";

// TENANT_ROLES (not the full ROLES list) — "superadmin" is a platform-operator role granted only via
// the OWNER_EMAILS allow-list (identity.js isSuperAdmin), never via an invite/setRole grant. Validating
// against TENANT_ROLES here closes off a second, weaker path to the same privilege.
const validRole = (r) => TENANT_ROLES.includes(r);

async function membersOf(db, tenantId) {
  const r = await db.prepare("SELECT * FROM connect_membership WHERE tenant_id=?").bind(tenantId).all();
  return r.results || [];
}
async function ownersOf(db, tenantId) {
  return (await membersOf(db, tenantId)).filter((m) => String(m.role) === "owner");
}
async function findMember(db, tenantId, userId) {
  return (await membersOf(db, tenantId)).find((m) => String(m.user_id) === String(userId)) || null;
}
function audit(env, deps, tenant, actor, action, outcome) {
  return makeAuditSink(env, deps.db)({ tenantId: tenant.id, actor: actor.id, action, outcome, ts: new Date().toISOString() });
}

export async function listMembers(deps, request, env, tenantId) {
  const { tenant } = await requireCan(deps, request, env, tenantId, "member:read");
  return membersOf(deps.db, tenant.id);
}

// listMyTenants — the CALLING user's OWN tenant memberships, for the self-service onboarding tenant picker
// (an admin selects their hospital from a dropdown instead of typing a tenant id). The actor id is derived
// SERVER-SIDE via resolveActor (identify()), NEVER read from the request body, so the query is keyed strictly
// by the server actor id: there is NO cross-user enumeration (a caller can only ever list rows WHERE
// user_id = <their own id>). This is a self-scoped read (any authenticated member lists their own tenants),
// so it does NOT go through requireCan (there is no single target tenant to authorize against) — but it DOES
// require an authenticated non-guest actor (resolveActor throws AuthError otherwise). Reuses connect_membership
// + connect_tenant with NO new table and NO RBAC fork. Returns [{ tenantId, name?, role }]; `name` is included
// ONLY when a real display name is stored (a name equal to the id is a default, not a display name, so it is
// omitted rather than echoed back as if it were one — we never invent names).
export async function listMyTenants(deps, request, env) {
  const actor = await resolveActor(deps.identifyFn, request, env);   // AuthError if guest / unauthenticated
  // Platform super-admin: no connect_membership rows exist for them (there is nothing to seed — the id
  // is an opaque fb:<uid> we don't have), so the ordinary "my memberships" query would come back empty.
  // Special-case it to every tenant, so the wizard tenant picker still shows something for them. Gated
  // on the SAME verified-email check as resolveTenant's super-admin branch (identity.js isSuperAdmin) —
  // never on a request-body value.
  if (isSuperAdmin(actor, env)) {
    const r = await deps.db.prepare("SELECT * FROM connect_tenant").all();
    const out = [];
    for (const t of (r.results || [])) {
      const item = { tenantId: t.id, role: "superadmin" };
      if (t.name != null && String(t.name).trim() && String(t.name) !== String(t.id)) item.name = String(t.name);
      out.push(item);
    }
    return out;
  }
  const r = await deps.db.prepare("SELECT * FROM connect_membership WHERE user_id=?").bind(actor.id).all();
  const out = [];
  for (const m of (r.results || [])) {
    const item = { tenantId: m.tenant_id, role: m.role };
    const t = await deps.db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(m.tenant_id).first();
    if (t && t.name != null && String(t.name).trim() && String(t.name) !== String(m.tenant_id)) item.name = String(t.name);
    out.push(item);
  }
  return out;
}

export async function invite(deps, request, env, tenantId, { userId, role }) {
  const { actor, tenant, role: actorRole } = await requireCan(deps, request, env, tenantId, "member:invite");
  if (!userId) throw new PermissionError("userId required");
  if (!validRole(role)) throw new PermissionError("invalid role");
  if (role === "owner" && actorRole !== "owner") throw new PermissionError("only an owner may grant owner"); // †
  await deps.db.prepare("INSERT INTO connect_membership_invite (tenant_id,user_id,role,status,invited_by,created_at) VALUES (?,?,?,?,?,?)")
    .bind(tenant.id, userId, role, "invited", actor.id, new Date().toISOString()).run();
  await audit(env, deps, tenant, actor, "member.invite", "ok");
  return { ok: true, status: "invited" };
}

export async function setRole(deps, request, env, tenantId, { userId, role }) {
  const { actor, tenant, role: actorRole } = await requireCan(deps, request, env, tenantId, "member:role");
  if (!validRole(role)) throw new PermissionError("invalid role");
  const target = await findMember(deps.db, tenant.id, userId);
  if (!target) throw new PermissionError("member not found");
  if (String(target.role) === "owner" && actorRole !== "owner") throw new PermissionError("only an owner may modify an owner"); // †
  if (role === "owner" && actorRole !== "owner") throw new PermissionError("only an owner may grant owner");
  if (String(target.role) === "owner" && role !== "owner" && (await ownersOf(deps.db, tenant.id)).length <= 1)
    throw new PermissionError("cannot demote the last owner");                                            // last-owner
  // Defense-in-depth vs a read-then-write TOCTOU (two concurrent demotes): when demoting an owner, the
  // write itself is conditioned on >1 owner still existing, so D1 can never leave a tenant owner-less.
  const demotingOwner = String(target.role) === "owner" && role !== "owner";
  const sql = demotingOwner
    ? "UPDATE connect_membership SET role=? WHERE user_id=? AND tenant_id=? AND (SELECT COUNT(*) FROM connect_membership WHERE tenant_id=? AND role='owner')>1"
    : "UPDATE connect_membership SET role=? WHERE user_id=? AND tenant_id=?";
  const stmt = deps.db.prepare(sql);
  await (demotingOwner ? stmt.bind(role, userId, tenant.id, tenant.id) : stmt.bind(role, userId, tenant.id)).run();
  await audit(env, deps, tenant, actor, "role.change", "ok");
  return { ok: true };
}

export async function removeMember(deps, request, env, tenantId, { userId }) {
  const { actor, tenant, role: actorRole } = await requireCan(deps, request, env, tenantId, "member:remove");
  const target = await findMember(deps.db, tenant.id, userId);
  if (!target) throw new PermissionError("member not found");
  if (String(target.role) === "owner" && actorRole !== "owner") throw new PermissionError("only an owner may remove an owner"); // †
  if (String(target.role) === "owner" && (await ownersOf(deps.db, tenant.id)).length <= 1)
    throw new PermissionError("cannot remove the last owner");                                            // last-owner
  // Defense-in-depth vs TOCTOU: removing an owner is conditioned on >1 owner still existing (see setRole).
  const removingOwner = String(target.role) === "owner";
  const sql = removingOwner
    ? "DELETE FROM connect_membership WHERE user_id=? AND tenant_id=? AND (SELECT COUNT(*) FROM connect_membership WHERE tenant_id=? AND role='owner')>1"
    : "DELETE FROM connect_membership WHERE user_id=? AND tenant_id=?";
  const stmt = deps.db.prepare(sql);
  await (removingOwner ? stmt.bind(userId, tenant.id, tenant.id) : stmt.bind(userId, tenant.id)).run();
  await audit(env, deps, tenant, actor, "member.remove", "ok");
  return { ok: true };
}
