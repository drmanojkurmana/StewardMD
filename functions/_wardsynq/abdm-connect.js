/* functions/_wardsynq/abdm-connect.js - is THIS hospital connected to ABDM, and the gateway it talks through.
 *
 * Owner S6 (2026-09-14): registrations are hospital-specific. The hospital's ABDM profile is the singleton
 * "abdm" connector (abdm-hospital.js, connectors.js); this file reads it and answers one question for every
 * ABDM screen and callback: may this hospital talk to ABDM right now, and as which facility.
 *
 *   connected    the profile is active and "sandbox-linked" with a HIP ID, and the shared StewardMD bridge
 *                credential exists on this server. Only the sandbox is ever connected.
 *   not          every other case, with a code the screen turns into words: not set up, switched off, not
 *                linked yet, suspended, production held (owner A2) or no bridge credential.
 *
 * THE BRIDGE IS SHARED (owner A1): each hospital links its own HFR facility to the one StewardMD bridge, so
 * the client id is config.js's and the secret is the one existing Pages secret ABDM_CLIENT_SECRET. No
 * hospital holds bridge credentials and none are entered here. What IS the hospital's own - the environment
 * and the HIP/HIU IDs - comes from its profile through abdmConfigFor (design 3.3), never from a deployment
 * variable.
 */

import { CONNECTOR_TYPE } from "./connectors.js";
import { abdmConfigFor } from "../_connect/abdm/config.js";
import { makeGateway } from "../_connect/abdm/gateway.js";
import { makeSecrets } from "../_connect/secrets.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* What a screen says for each code. The site and ward.js translate by the code; this English is the server's. */
const REASONS = Object.freeze({
  not_set_up: "ABDM is not set up for this hospital. An administrator sets it up on Admin Center, Integrations, ABDM.",
  inactive: "This hospital's ABDM profile is switched off.",
  not_linked: "This hospital is not linked to ABDM yet. ABDM has to link the facility to the StewardMD bridge and issue a HIP ID first.",
  suspended: "This hospital's ABDM connection is suspended.",
  production_held: "Production ABDM traffic is held until India-region hosting exists.",
  bridge_not_configured: "The StewardMD ABDM bridge credential is not configured on this server.",
});

/* The facility QR opens this page in the patient's ABHA app. Sandbox host and the HYPHENATED parameter names
 * are from ABDM's Scan-and-Share document v1.0 (22 Aug 2024) section 4.1, checked on a real device (D13 in
 * docs/connect/abdm/V3-SPEC-RECONCILIATION.md). Production is never connected (owner A2), so it has no host. */
const SHARE_PROFILE_HOST = Object.freeze({ sandbox: "https://phrsbx.abdm.gov.in" });

/** PURE. The connection a saved profile allows. rec = the latest "abdm" connector record, or null. */
function connectionOf(rec, env) {
  const off = (code) => ({ connected: false, code, reason: REASONS[code] });
  if (!rec) return off("not_set_up");
  if (rec.active !== true) return off("inactive");
  const s = rec.settings || {};
  if (s.status === "suspended") return off("suspended");
  if (s.status === "production-linked") return off("production_held");
  if (s.status !== "sandbox-linked" || !str(s.hipId)) return off("not_linked");
  if (!(env && str(env.ABDM_CLIENT_SECRET))) return off("bridge_not_configured");
  return { connected: true, code: "connected", reason: null, envName: "sandbox",
    hfrFacilityId: str(s.hfrFacilityId), hipId: str(s.hipId), hiuId: str(s.hiuId) || str(s.hipId) };
}

/** What a screen may see of it. The IDs are the hospital's own public registry identifiers, not secrets. */
function connectionView(conn) {
  return conn.connected
    ? { connected: true, code: "connected", env: conn.envName, hfrFacilityId: conn.hfrFacilityId, hipId: conn.hipId, hiuId: conn.hiuId }
    : { connected: false, code: conn.code, reason: conn.reason };
}

/** The hospital's connection. Throws when the profile cannot be read: an unread profile is not "not set up". */
async function loadConnection(env, repo, tenantId) {
  const rec = await repo.latest(tenantId, CONNECTOR_TYPE, "abdm");
  return connectionOf(rec, env);
}

/** The gateway for a connected hospital: its own HIP/HIU IDs on every call, the shared bridge's session. */
function gatewayFor(env, conn, opts) {
  const o = opts || {};
  const cfg = abdmConfigFor(env, conn);
  return makeGateway({
    baseUrl: cfg.gatewayBase, cmId: cfg.cmId, hipId: cfg.hipId, hiuId: cfg.hiuId, clientId: cfg.clientId,
    trafficHeld: cfg.trafficHeld, fetch: o.fetchImpl || ((...a) => fetch(...a)), kv: o.kv || (env && env.MAIK_KV),
    now: () => new Date(), secrets: makeSecrets(env),
  });
}

/** PURE. The URL a counter's QR encodes, or null when this hospital cannot receive a share. */
function shareProfileUrl(conn, counterId) {
  const host = conn && conn.connected ? SHARE_PROFILE_HOST[conn.envName] : null;
  const counter = str(counterId);
  if (!host || !/^[A-Za-z0-9_-]{1,40}$/.test(counter)) return null;
  return `${host}/share-profile?hip-id=${encodeURIComponent(conn.hipId)}&counter-id=${encodeURIComponent(counter)}`;
}

/**
 * Keep ABDM's callback routing in step with the saved profile. hip-handlers.js resolveHipTenant finds the hospital a
 * callback is for by reading connect_connector_config rows (connector "abdm", config.hipId): a linked, active profile is
 * written there, anything else is removed, so a suspended or unlinked hospital's callbacks fail closed.
 * -> { ok, routed } or { ok:false, message }. The profile itself is already saved when this runs.
 */
async function projectHipRouting(env, tenantId, rec) {
  const db = env && env.CONNECT_DB;
  if (!db) return { ok: false, message: "ABDM callbacks cannot be routed to this hospital on this server." };
  const conn = connectionOf(rec, { ABDM_CLIENT_SECRET: "routing" });   // the credential decides calling out, not routing
  try {
    await db.prepare("DELETE FROM connect_connector_config WHERE tenant_id=? AND connector_id=?").bind(String(tenantId), "abdm").run();
    if (!conn.connected) return { ok: true, routed: false };
    const res = await db.prepare("INSERT INTO connect_connector_config (tenant_id, connector_id, kind, config, status) VALUES (?, ?, ?, ?, ?)")
      .bind(String(tenantId), "abdm", "abdm", JSON.stringify({ source: "wardsynq-abdm-profile", hipId: conn.hipId, hiuId: conn.hiuId, env: conn.envName }), "active").run();
    if (!res || res.success === false) throw new Error("insert");
    return { ok: true, routed: true };
  } catch {
    return { ok: false, message: "The profile was saved, but ABDM callbacks could not be routed to this hospital. Save it again." };
  }
}

export { projectHipRouting, REASONS, SHARE_PROFILE_HOST, connectionOf, connectionView, loadConnection, gatewayFor, shareProfileUrl };
