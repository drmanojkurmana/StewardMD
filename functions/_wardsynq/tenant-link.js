/* functions/_wardsynq/tenant-link.js - who may point an OPD org at a Connect tenant (SEC-02).
 *
 * org.connectTenantId is the key to a hospital's whole clinical record: wsqForcedMigration reads and
 * writes the tenant it names for every /ward route called under that org, and orgForTenant finds the
 * staff registry from it. It used to be a plain field on /org/update and /org/from-connect, so an
 * admin of their own org could name ANOTHER hospital's tenant id and work that hospital's charts as
 * their own admin.
 *
 * A link is accepted only when the caller is an owner or admin of that tenant in Connect (or the
 * platform owner), and no org belonging to a different owner already links it. Once set, the link does
 * not move to a different tenant except by the platform owner. Re-saving the same link is a no-op.
 */
import { fsQuery } from "../_fbfirestore.js";
import { getOrg } from "../_opd_org_store.js";
import { resolveTenant } from "../_connect/identity.js";

const LINK_ROLES = ["owner", "admin", "superadmin"];

function settingsOf(tenant) {
  try { return typeof tenant.settings === "string" ? JSON.parse(tenant.settings || "{}") : (tenant.settings || {}); } catch { return {}; }
}

/** Every live org that already points at tenant `t`, by any of the three links orgForTenant reads. */
async function orgsLinking(env, tenant) {
  const t = String(tenant.id);
  const found = new Map();
  const add = (o) => { if (o && o.id && !o.deleted) found.set(String(o.id), o); };
  const explicit = settingsOf(tenant).wardsynq && settingsOf(tenant).wardsynq.orgId;
  if (explicit) add(await getOrg(env, String(explicit)));
  // A failed read here refuses the link (the caller catches): an unknown owner is not "no owner".
  const rows = await fsQuery(env, "q_orgs", { where: { field: "connectTenantId", value: t }, limit: 20 });
  for (const d of rows || []) if (d && d.fields) add(Object.assign({ id: d.id }, d.fields));
  try { const same = await getOrg(env, t); if (same) add(same); } catch { /* no org shares the tenant id */ }
  return [...found.values()];
}

/**
 * null when `actor` may link `org` (null for an org not yet created) to `tenantId`; otherwise
 * { status, error, message }. actor: the queue router actor ({ id, email, isOwner }).
 */
export async function tenantLinkRefusal(env, actor, org, tenantId) {
  const t = String(tenantId || "").trim();
  if (!t) return null;
  if (org && org.connectTenantId && String(org.connectTenantId) === t) return null;
  const platformOwner = !!(actor && actor.isOwner === true);
  if (org && org.connectTenantId && !platformOwner) {
    return { status: 409, error: "tenant_link_immutable", message: "This hospital is already linked to its clinical record. Only StewardMD can move that link." };
  }
  if (!env || !env.CONNECT_DB) return { status: 503, error: "record_store_unavailable" };
  let m = null;
  try { m = await resolveTenant(env.CONNECT_DB, { id: actor && actor.id, email: (actor && actor.email) || null }, t, env); } catch { m = null; }
  if (!m || !LINK_ROLES.includes(m.role)) {
    return { status: 403, error: "tenant_not_yours", message: "Only an owner or admin of that hospital's clinical record can link it." };
  }
  let linked;
  try { linked = await orgsLinking(env, m.tenant); }
  catch { return { status: 503, error: "tenant_link_unverifiable", message: "Could not check who already uses that clinical record. Nothing was saved." }; }
  const ownerUid = org ? org.ownerUid : (actor && actor.id);
  const foreign = linked.filter((o) => String(o.id) !== String(org && org.id) && String(o.ownerUid || "") !== String(ownerUid || ""));
  if (foreign.length && !platformOwner) {
    return { status: 409, error: "tenant_already_linked", message: "That clinical record already belongs to another hospital." };
  }
  return null;
}
