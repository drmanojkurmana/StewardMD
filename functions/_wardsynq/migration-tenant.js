/* functions/_wardsynq/migration-tenant.js — the ONE way an OPD write decides whether, and how, it
 * dual-writes to the WardSynQ record.
 *
 * Every migrated OPD operation (vitals first, registration now, whatever comes after) needs the same
 * three answers: is the flag on, does this org's tenant exist, what mode did the owner set for THIS
 * operation. Extracted here so migrate-vitals.js and migrate-registration.js cannot drift on what
 * "off" means. Nothing here is a clinical rule; this is deployment plumbing.
 *
 *   off            (default, every tenant today) the caller does nothing further
 *   shadow         observe: write to the record, report the outcome, never block or throw
 *   authoritative  the record's acceptance is required — see each migration file for what that
 *                  means for ITS operation, because not every OPD write can be rolled back the same
 *                  way (registration's MRN allocation cannot be undone; a vitals save can just be
 *                  retried)
 *
 * Any failure here — the flag missing, the org unlinked, a broken lookup — resolves to "off",
 * because a hospital that has not opted in must see no difference at all.
 */

const MODES = Object.freeze(["off", "shadow", "authoritative"]);

/** PURE. Reads `settings.wardsynq.migrations[key]`; anything unrecognised is "off". */
function migrationModeOf(tenant, key) {
  let settings = {};
  try { settings = typeof tenant.settings === "string" ? JSON.parse(tenant.settings || "{}") : (tenant.settings || {}); } catch { settings = {}; }
  const m = settings && settings.wardsynq && settings.wardsynq.migrations && settings.wardsynq.migrations[key];
  return MODES.includes(m) ? m : "off";
}

/**
 * The OPD organisation's Connect tenant, or a reason there is none. `deps: {getOrg, tenantRow}`,
 * the same shape every migration's caller already supplies.
 */
async function resolveTenantForOrg(env, orgId, deps) {
  if (!orgId) return { tenant: null, tenantId: null, why: "no_org" };
  const org = await deps.getOrg(env, orgId);
  const tenantId = org && org.connectTenantId;
  if (!tenantId) return { tenant: null, tenantId: null, why: "no_tenant" };
  const tenant = await deps.tenantRow(env, tenantId);
  if (!tenant) return { tenant: null, tenantId: null, why: "tenant_missing" };
  return { tenant, tenantId: String(tenantId), why: null };
}

/**
 * The full decision for one operation. Never throws.
 * @returns {{mode: string, why?: string, tenantId?: string, tenant?: object, orgId?: string}}
 */
async function resolveMigration(env, orgId, key, deps) {
  try {
    if (!env || String(env.WARDSYNQ_RECORD) !== "1") return { mode: "off", why: "flag" };
    const r = await resolveTenantForOrg(env, orgId, deps);
    if (!r.tenant) return { mode: "off", why: r.why };
    return { mode: migrationModeOf(r.tenant, key), tenantId: r.tenantId, tenant: r.tenant, orgId: String(orgId) };
  } catch (e) {
    return { mode: "off", why: "lookup_failed" };
  }
}

export { MODES, migrationModeOf, resolveTenantForOrg, resolveMigration };
