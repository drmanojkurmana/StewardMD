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
import { issueQueueToken, resolvePatientMobile, findTicketMobile } from "../../_connect/abdm/opd-bridge.js";

/**
 * The link token arrives asynchronously here after ensureLinkToken() fires generate-token.
 * Caching it is the whole point: the token lasts six months and only three requests per patient per
 * facility per day are permitted before ABDM blocks the patient for 24 hours (FAQ Q31).
 */
async function onGenerateToken({ env, deps, body }) {
  const token = body && (body.linkToken || body.accessToken || (body.link && body.link.accessToken));
  const abhaHash = deps.correlate ? await deps.correlate(body) : null;
  if (!token || !abhaHash) {
    // Without a correlation we cannot key the cache. Record it rather than caching under a guess -
    // a token filed against the wrong patient would link somebody else's records.
    await deps.audit({ action: "abdm.linktoken.uncorrelated", outcome: "skipped", ts: deps.now() }).catch(() => {});
    return;
  }
  await putToken(deps, { hipId: env.ABDM_HIP_ID, abhaHash, token });
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
    gateway: makeGateway({
      baseUrl: cfg.gatewayBase, cmId: cfg.cmId, hipId: cfg.hipId, hiuId: cfg.hiuId,
      fetch, kv: env.MAIK_KV, now: () => new Date(), secrets: makeSecrets(env),
    }),
    // The only HIP source that can answer without the doctor's device being awake, which is the whole
    // point of the 20-minute data-push budget. See consented-store.js.
    source: consentedStoreSource,
    // Scan-and-share issues an OPD queue token. Bound here so hip-handlers stays free of Firestore.
    issueQueueToken,
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
