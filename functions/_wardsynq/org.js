/* functions/_wardsynq/org.js — which OPD organisation a record tenant belongs to.
 *
 * The record is keyed on the Connect tenant (D1). The hospital's staff registry is the OPD
 * organisation (Firestore q_orgs / q_members), which already knows how to point at a Connect tenant:
 * `org.connectTenantId` is how a Connect-onboarded hospital feeds the OPD queue. The same pointer,
 * read the other way, is how the record finds the staff registry. Three ways to link, in order:
 *
 *   1. connect_tenant.settings.wardsynq.orgId     explicit, set by the owner
 *   2. q_orgs where connectTenantId == tenant.id  the existing Connect -> OPD bridge, reversed
 *   3. q_orgs/<tenant.id>                          the org and the tenant share an id
 *
 * None found: the tenant has no OPD organisation and only Connect membership applies. This is the
 * ONLY Firestore I/O the record service does, and it is read-only.
 */

import { fsQuery } from "../_fbfirestore.js";
import { getOrg, authorizeOrg } from "../_opd_org_store.js";

function settingsOf(tenant) {
  try { return typeof tenant.settings === "string" ? JSON.parse(tenant.settings || "{}") : (tenant.settings || {}); } catch { return {}; }
}

async function orgForTenant(env, tenant) {
  if (!tenant || !tenant.id) return null;
  const explicit = settingsOf(tenant).wardsynq && settingsOf(tenant).wardsynq.orgId;
  if (explicit) {
    const o = await getOrg(env, String(explicit));
    if (o) return o;
  }
  try {
    const r = await fsQuery(env, "q_orgs", { where: { field: "connectTenantId", value: String(tenant.id) }, limit: 1 });
    const d = r && r[0];
    if (d && d.fields) return Object.assign({ id: d.id }, d.fields);
  } catch { /* no Firestore in this deployment: fall through */ }
  try { return await getOrg(env, String(tenant.id)); } catch { return null; }
}

export { orgForTenant, authorizeOrg };
