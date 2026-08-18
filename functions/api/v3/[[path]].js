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
// Handlers are wired in deliberately, one at a time, as each downstream path is proven. An unwired kind
// still returns 202 - the gateway treats non-2xx as a delivery failure and retries, so acknowledging an
// unimplemented callback is strictly better than 5xx-ing at it. The gap shows up in the audit trail.

import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { handleCallback } from "../../_connect/abdm/callbacks.js";
import { putToken } from "../../_connect/abdm/linktoken.js";
import { makeAuditSink } from "../../_connect/audit.js";

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
  // Not yet wired, and acknowledged rather than failed:
  //   discover / link-init / link-confirm      need the care-context model (D5)
  //   consent-notify                           needs the HIP consent store wired to real tenants
  //   hi-request                               needs the Fidelius shared-secret question settled (D4)
  //   patient-share                            needs the OPD queue token bridge
};

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });

  const audit = makeAuditSink(env, env.CONNECT_DB);
  const deps = {
    fetch,
    kv: env.MAIK_KV,
    db: env.CONNECT_DB,
    now: () => new Date().toISOString(),
    waitUntil: (p) => context.waitUntil(p),
    handlers: HANDLERS,
    audit,
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
