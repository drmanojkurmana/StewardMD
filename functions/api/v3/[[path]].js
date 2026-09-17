// functions/api/v3/[[path]].js — the ABDM V3 callback receiver.
//
// ABDM appends its own paths to whatever base URL we register, so this MUST live at /api/v3/... - that
// is the shape the gateway posts to (see docs/connect/abdm/V3-SPEC-RECONCILIATION.md D3). /api/* already
// bypasses the coming-soon gate in _middleware.js, and every request here self-authorises: the bearer is
// verified against ABDM's pinned JWKS before any handler runs.
//
// INDIA HOSTING: the registered base is ABDM_CALLBACK_BASE (e.g. https://abdm.stewardmd.in). Whether that
// resolves to a Cloudflare India-region custom domain or an India-hosted forwarder proxying to us, this
// file is unchanged. Set ABDM_CALLBACK_PATH_PREFIX if the forwarder mounts us under a path.
//
// This is the composition root: it binds storage, the gateway, the HIP read-source and the two outbound
// seams (OTP delivery, OPD token issue) to the handlers in hip-handlers.js. Everything stays inert behind
// CONNECT_FLAG, and the M2 handlers behind CONNECT_HIP_FLAG on top of it.
//
// An unhandled kind still returns 202 - the gateway treats non-2xx as a delivery failure and retries, so
// acknowledging an unimplemented callback is strictly better than 5xx-ing at it. The gap shows up in the
// audit trail as abdm.callback.unhandled.

import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { handleCallback } from "../../_connect/abdm/callbacks.js";
import { putToken } from "../../_connect/abdm/linktoken.js";
import { makeAuditSink } from "../../_connect/audit.js";
import { makeSecrets } from "../../_connect/secrets.js";
import { makeGateway } from "../../_connect/abdm/gateway.js";
import { abdmConfig } from "../../_connect/abdm/config.js";
import { HIP_HANDLERS } from "../../_connect/abdm/hip-handlers.js";
import { HIU_HANDLERS } from "../../_connect/abdm/hiu-handlers.js";
import { consentedStoreSource } from "../../_connect/abdm/consented-store.js";
import { resolvePatientMobile, findTicketMobile } from "../../_connect/abdm/opd-bridge.js";
// A WardSynQ hospital queues a scan-and-share in the counter's department; any other keeps opd-bridge's token.
import { issueShareToken } from "../../_wardsynq/abdm-share.js";
// A WardSynQ hospital's inpatient record is a HIP source beside the consented store (design S6 phase A3).
import { wardsynqHipSource, hipSourceFor, linkPendingAfterToken } from "../../_wardsynq/abdm-hip.js";
import { recordDeps as wsqRecordDeps } from "../../_wardsynq/deps.js";
import { orgForTenant } from "../../_wardsynq/org.js";
import { resolveHipTenant } from "../../_connect/abdm/hip-handlers.js";
import { hmacPseudonym } from "../../_connect/audit.js";

/* The WardSynQ HIP source, bound to the record store and the hospital's own HFR facility. */
const WARDSYNQ_HIP = wardsynqHipSource({
  recordDepsFor: (env, tenantId) => wsqRecordDeps(env, tenantId),
  facilityFor: async (env, tenantId) => {
    const tenant = env.CONNECT_DB ? await env.CONNECT_DB.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(String(tenantId)).first() : null;
    const org = tenant ? await orgForTenant(env, tenant) : null;
    const hfrId = org && org.regionProfile && org.regionProfile.hfrId;
    return hfrId ? { hfrId, name: org.name || null } : null;
  },
});

/**
 * The link token arrives asynchronously here after ensureLinkToken() fires generate-token.
 * Caching it is the whole point: the token lasts six months and only three requests per patient per
 * facility per day are permitted before ABDM blocks the patient for 24 hours (FAQ Q31).
 */
export async function onGenerateToken({ env, deps, body, headers }) {
  // PINNED (captured 2026-08-19): this callback commonly arrives as a pure FAILURE, carrying only
  //   { error: { code: "ABDM-1207: ", message: "...does not match the details on record with Aadhaar" },
  //     response: { requestId } }
  // and no token at all. The old code fell into the `!token` branch and filed it as "uncorrelated", which
  // reads as "we could not match this to a patient" when the truth is "ABDM refused the demographics".
  // Those need different fixes, so they cannot share an audit line.
  if (body && body.error) {
    await deps.audit({
      action: "abdm.linktoken.failed", outcome: "error", ts: deps.now(),
      detail: String(body.error.code ?? "").trim() + " " + String(body.error.message ?? "").slice(0, 200),
      transactionId: (body.response && body.response.requestId) || null,
    }).catch(() => {});
    return;
  }
  const token = body && (body.linkToken || body.accessToken || (body.link && body.link.accessToken));
  /* PINNED (ABDM M2 document v2.7, 12-08-2025, section 4.3): the success body is { abhaAddress, linkToken, response },
   * delivered with X-HIP-ID. The facility and the address ARE the correlation, exactly the pair the token belongs to
   * (FAQ Q31), so the pseudonym is derived from them under the tenant that HIP ID resolves to. Unknown HIP ID: none. */
  const hipId = headers && headers.entityId ? String(headers.entityId) : "";
  let tenantId = null, abhaHash = null;
  if (token && hipId && body && typeof body.abhaAddress === "string" && body.abhaAddress.trim()) {
    try { tenantId = await resolveHipTenant(env, deps, hipId); abhaHash = await hmacPseudonym(env, tenantId, body.abhaAddress.trim()); }
    catch { tenantId = null; abhaHash = null; }
  }
  if (!abhaHash && deps.correlate) abhaHash = await deps.correlate(body);
  if (!token || !abhaHash) {
    // Without a correlation we cannot key the cache. Record it rather than caching under a guess -
    // a token filed against the wrong patient would link somebody else's records.
    await deps.audit({ action: "abdm.linktoken.uncorrelated", outcome: "skipped", ts: deps.now() }).catch(() => {});
    return;
  }
  await putToken(deps, { hipId: hipId || abdmConfig(env).hipId, abhaHash, token });
  // Care contexts that waited for this token (a WardSynQ discharge, functions/_wardsynq/abdm-hip.js) are linked now.
  if (tenantId && typeof deps.onLinkToken === "function") await deps.onLinkToken(env, deps, { tenantId, hipId, abhaAddress: body.abhaAddress.trim(), token });
}

const HANDLERS = {
  "link-token-result": onGenerateToken,
  ...HIP_HANDLERS,
  ...HIU_HANDLERS,
};

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });

  const audit = makeAuditSink(env, env.CONNECT_DB);
  const cfg = abdmConfig(env);
  const now = () => new Date().toISOString();
  const deps = {
    fetch,
    kv: env.MAIK_KV,
    db: env.CONNECT_DB,
    r2: env.CONNECT_R2,
    secrets: makeSecrets(env),
    now,
    waitUntil: (p) => context.waitUntil(p),
    handlers: HANDLERS,
    audit,
    // Answering an ABDM callback means calling BACK into the gateway (on-discover, on-init, on-confirm,
    // hip/on-notify, hip/on-request, hiNotify, on-share). Same session-token seam as the outbound side.
    /* The reply speaks as the facility ABDM addressed (owner S6: each hospital has its own HIP ID). The header is only
     * used after callbacks.js has verified the gateway's bearer, and every HIP handler resolves it to a tenant first,
     * failing closed on an unknown one. Without the header, the deployment's own identity as before. */
    gateway: makeGateway({
      baseUrl: cfg.gatewayBase, cmId: cfg.cmId,
      hipId: (request.headers && request.headers.get("X-HIP-ID")) || cfg.hipId,
      hiuId: (request.headers && request.headers.get("X-HIU-ID")) || cfg.hiuId,
      clientId: cfg.clientId, trafficHeld: cfg.trafficHeld, fetch, kv: env.MAIK_KV, now: () => new Date(), secrets: makeSecrets(env),
    }),
    // The only HIP source that can answer without the doctor's device being awake, which is the whole
    // point of the 20-minute data-push budget. See consented-store.js.
    source: hipSourceFor(WARDSYNQ_HIP, consentedStoreSource),
    // A link token for a WardSynQ patient links the care contexts that were waiting for it.
    onLinkToken: linkPendingAfterToken,
    // Scan-and-share issues an OPD queue token. Bound here so hip-handlers stays free of Firestore.
    issueQueueToken: issueShareToken,
    // OTP delivery for user-initiated linking goes through the app's existing SMS/WhatsApp senders
    // (functions/_connect/abdm/otp.js). It reports delivered:false, honestly, until BOTH a provider and a
    // DLT-approved OTP template (ABDM_OTP_TEMPLATE) are configured - an Indian transactional SMS without
    // an approved template is dropped by the provider, which would otherwise look to us like success.
    // // VERIFY (owner): register the OTP template with the SMS provider and set ABDM_OTP_TEMPLATE.
    resolvePatientMobile,
    // The mobile for a link OTP: this patient's most recent OPD ticket, decrypted for one send. Bound
    // rather than null, so resolvePatientMobile can actually find a number - it was the reason
    // link/init always reported delivered:false even where a number was on file.
    findTicketMobile,
    // Correlating a callback back to a patient is per-flow and none of it is proven yet, so it stays
    // null: onGenerateToken records and skips rather than caching against a guessed subject.
    correlate: null,
    onUnhandled: ({ route, headers }) => {
      context.waitUntil(audit({
        action: "abdm.callback.unhandled", outcome: "acknowledged",
        detail: route.kind, transactionId: headers.requestId, ts: new Date().toISOString(),
      }).catch(() => {}));
    },
    onError: (err, { route, headers }) => {
      context.waitUntil(audit({
        action: "abdm.callback.failed", outcome: "error",
        detail: route.kind + ": " + (err && err.message), transactionId: headers.requestId,
        ts: new Date().toISOString(),
      }).catch(() => {}));
    },
  };

  return handleCallback(env, deps, request);
}
