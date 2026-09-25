/* functions/_connect/onboard/opd-org-link.js - a hospital added through Connect is also a hospital the
 * StewardMD app can pick.
 *
 * TWO REGISTRIES, ONE HOSPITAL. A hospital brought up through the adapter (POST /api/connect/onboard/
 * tenants) was created in CONNECT_DB and nowhere else. The app's hospital picker lists Firestore q_orgs
 * - owned or member orgs, mode "connect" with a connector - so the hospital was connected to the server
 * and invisible in the app. Owner decision 2026-09-24 (option A): onboarding creates the org record too,
 * so there is one hospital with two halves, not two lists that drift.
 *
 * The org is the same shape _opd_connect_connector.js resolves - mode "connect", connectorId "connect",
 * connectTenantId naming the tenant - which is also exactly what the picker filters on. The creator is
 * made an admin MEMBER as well as the owner: /orgs lists owned orgs only for an app account, and a
 * Cloudflare Access sign-in finds its hospitals through membership.
 *
 * IDEMPOTENT. A tenant that already has its org (found the way the rest of the codebase finds it,
 * orgForTenant) is returned as it is, so linking twice, or linking a hospital created before this
 * existed, never makes a second org.
 */
import * as ORG from "../../_opd_org_store.js";
import { orgForTenant } from "../../_wardsynq/org.js";

export async function linkTenantToOpdOrg(env, tenant, actorId) {
  if (!tenant || !tenant.id) throw new Error("tenant_required");
  if (!actorId) throw new Error("actor_required");
  const existing = await orgForTenant(env, { id: tenant.id });
  if (existing && (existing.connectTenantId === tenant.id || existing.id === tenant.id)) return { org: existing, created: false };

  let org = await ORG.createOrg(env, { name: tenant.name || tenant.id, mode: "connect", connectorId: "connect" }, actorId);
  org = await ORG.updateOrg(env, org.id, { connectTenantId: tenant.id }, actorId);
  await ORG.setMembership(env, org.id, actorId, { role: "admin" }, actorId);
  return { org, created: true };
}
