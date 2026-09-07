/* functions/_wardsynq/deps.js — the production I/O seams of the record service, in one place.
 *
 * resolveClinicalActor() and RecordService take their I/O as dependencies so a test can run the
 * whole door without Cloudflare or Firestore. This is the set a real request uses. Two routes need
 * it (the record API and the queue timeline's vitals migration), which is why it is not inlined in
 * either.
 */
import { identify } from "../_usage.js";
import { verifyFirebaseClaims } from "../_fbauth.js";
import { verifyStaffSession } from "../_opd_auth.js";
import { hmacPseudonym } from "../_connect/audit.js";
import { D1Repository } from "./repository-d1.js";
import { orgForTenant, authorizeOrg } from "./org.js";

/** Best-effort prescriber claims (name, regNo) from the bearer token. Identity itself comes from identify(). */
async function claimsOf(request, env) {
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return {};
  try { return (await verifyFirebaseClaims(tok, env)) || {}; } catch { return {}; }
}

/** The actor-resolution seams. `overrides` win, key by key, so a test replaces only what it must. */
function actorDeps(env, overrides) {
  overrides = overrides || {};
  return {
    db: "db" in overrides ? overrides.db : env.CONNECT_DB,
    identifyFn: overrides.identifyFn || identify,
    claimsFn: overrides.claimsFn || claimsOf,
    staffSession: overrides.staffSession || verifyStaffSession,
    orgForTenant: "orgForTenant" in overrides ? overrides.orgForTenant : orgForTenant,
    authorizeOrg: overrides.authorizeOrg || authorizeOrg,
  };
}

/** The persistence and audit seams. */
function recordDeps(env, tenantId, overrides) {
  overrides = overrides || {};
  const db = "db" in overrides ? overrides.db : env.CONNECT_DB;
  return {
    repository: overrides.repository || new D1Repository(db),
    pseudonym: overrides.pseudonym || (async (patientId) => {
      if (!env || !env.CONNECT_HMAC_SALT) return null;
      try { return await hmacPseudonym(env, tenantId, patientId); } catch { return null; }
    }),
  };
}

export { claimsOf, actorDeps, recordDeps };
