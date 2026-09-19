/* functions/_wardsynq/transmit-send.js - actually sending the prescription.
 *
 * #908 built the outbox and stopped exactly where it should have: `queued`, `sent`, `acknowledged`
 * and `failed` are distinct states, a failure stays outstanding until a human deals with it, and the
 * payload is versioned to the order. What it did NOT do was send anything - "no transport is
 * implemented (a site plugs in its own)" has been domain 5's remaining gap since.
 *
 * THIS IS THE TRANSPORT AND IT CHANGES NO STATE ITSELF. It performs one HTTP POST and then reports
 * the outcome through the SAME `transmit-outcome` path a human or a site's own transport would use.
 * Nothing here writes `sent` directly: the state machine that decides what an outcome means already
 * exists and has tests, and a second writer would be a second opinion about what "delivered" means.
 *
 * A PRESCRIPTION IS PHI LEAVING THE BUILDING. That makes the destination the dangerous part, not the
 * payload, so:
 *
 *   THE ENDPOINT IS ORG CONFIGURATION, NEVER A REQUEST FIELD. `wardsynq.transmitEndpoints` maps a
 *   channel to a URL. A caller cannot name a destination - if it could, anyone who could queue a
 *   prescription could post a patient's medicines to a host of their choosing, and the audit would
 *   show a successful transmission.
 *
 *   IT GOES THROUGH THE HARDENED FETCH. `makeSafeFetch` re-validates every redirect hop against
 *   assertPublicHttpsUrl and drops headers and body on a cross-origin hop, which is what stops a
 *   compliant-looking endpoint 302-ing a prescription (and its bearer token) somewhere else. There is
 *   no plain `fetch` in this file.
 *
 * "WE COULD NOT TELL" IS NOT "IT FAILED", AND IT IS CERTAINLY NOT "IT ARRIVED". A timeout, a dropped
 * connection or an unreadable response means the message may or may not have been delivered, and
 * both confident answers are wrong: reporting failure invites a re-send that duplicates a
 * prescription, and reporting success loses it silently. That case is reported as `indeterminate`,
 * the transmission stays OUTSTANDING, and a human resolves it - which is exactly what the outbox was
 * built to make possible.
 *
 * A NON-2xx IS A FAILURE WITH THE STATUS ON IT. The endpoint's own words are recorded, truncated,
 * because "failed" with no reason produces a work list nobody can act on.
 *
 * IT NEVER RETRIES ON ITS OWN. A retry that duplicates a prescription is worse than one that did not
 * happen, and only the receiving system knows whether it processed the first attempt. Re-sending is
 * a human act through the outbox, against the same order version, and the transmission id already
 * makes a repeat of the same version to the same channel one record rather than two.
 */

import { makeSafeFetch } from "../_connect/onboard/net.js";
import { OnboardError } from "../_connect/onboard/errors.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** How long a prescription send may take before the answer becomes "we could not tell". */
const TIMEOUT_MS = 10000;

/** Endpoint replies are recorded, not trusted. Enough to act on, never enough to fill the record. */
const MAX_DETAIL = 500;

/** PURE. The configured endpoint for a channel, or null. Never taken from the request. */
function endpointFor(channel, endpoints) {
  const c = str(channel);
  const table = endpoints && typeof endpoints === "object" ? endpoints : {};
  const entry = table[c];
  if (!entry) return null;
  const url = typeof entry === "string" ? entry : str(entry.url);
  if (!url) return null;
  return { url, headerName: (typeof entry === "object" && str(entry.headerName)) || null, token: (typeof entry === "object" && str(entry.token)) || null };
}

/**
 * PURE. What one HTTP result means for the outbox.
 *
 * Three answers and not two. The third is the one that matters: `indeterminate` keeps the
 * transmission outstanding instead of guessing in either direction.
 */
function outcomeOf({ status, body, networkError }) {
  if (networkError) {
    return {
      outcome: "indeterminate",
      detail: `The endpoint could not be reached or did not answer in time (${str(networkError).slice(0, 200)}). It is NOT known whether the prescription arrived.`,
    };
  }
  const s = Number(status);
  if (Number.isFinite(s) && s >= 200 && s < 300) {
    return { outcome: "sent", detail: `The endpoint accepted the message (HTTP ${s}).` };
  }
  /* A 5xx is the server saying it broke, which is not the same as the message being rejected: it may
   * have been received and then failed to process. Still outstanding, still a human's call. */
  if (Number.isFinite(s) && s >= 500) {
    return { outcome: "indeterminate", detail: `The endpoint returned HTTP ${s}. It may have received the message before failing. ${str(body).slice(0, MAX_DETAIL)}`.trim() };
  }
  return {
    outcome: "failed",
    detail: `The endpoint refused the message (HTTP ${Number.isFinite(s) ? s : "unknown"}). ${str(body).slice(0, MAX_DETAIL)}`.trim(),
  };
}

/**
 * Sends one queued transmission.
 *
 * Returns what the transport observed. It writes NOTHING: the caller reports this through the
 * existing outcome route, so the state machine has exactly one author.
 *
 * ctx: { channel, payload, endpoints, fetchImpl?, now? }
 */
async function sendTransmission(ctx) {
  const channel = str(ctx.channel);
  const endpoint = endpointFor(channel, ctx.endpoints);

  /* `print` is a real channel and has no endpoint by design - a printed prescription is handed over
   * by a person. Saying so is not a failure, and recording one would put a permanent error against a
   * transmission that worked exactly as intended. */
  if (channel === "print") {
    return { ok: true, attempted: false, outcome: null, reason: "print_is_local",
      detail: "A printed prescription is handed over by a person. There is nothing to send and nothing failed." };
  }
  if (!endpoint) {
    return { ok: false, attempted: false, outcome: null, reason: "no_endpoint",
      detail: `This hospital has not configured wardsynq.transmitEndpoints["${channel}"]. Nothing was sent, and the prescription is still queued - it has NOT failed and must not be recorded as failed.` };
  }

  const doFetch = makeSafeFetch(ctx.fetchImpl || fetch);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

  const headers = { "content-type": "application/json" };
  if (endpoint.headerName && endpoint.token) headers[endpoint.headerName] = endpoint.token;

  let status = null, body = "", networkError = null;
  try {
    const res = await doFetch(endpoint.url, {
      method: "POST", headers,
      body: JSON.stringify(ctx.payload || {}),
      ...(controller ? { signal: controller.signal } : {}),
    });
    status = res.status;
    try { body = str(await res.text()).slice(0, MAX_DETAIL); } catch (_) { body = ""; }
  } catch (e) {
    /* An SSRF refusal is NOT a delivery problem and must not read as one: it means the configured
     * endpoint redirected somewhere it is not allowed to go, and the prescription was deliberately
     * not sent onward. It is a configuration fault, and a definite failure rather than an unknown. */
    if (e instanceof OnboardError) {
      return { ok: false, attempted: true, outcome: "failed", reason: "ssrf_refused",
        detail: `The configured endpoint redirected to a host that is not permitted, so nothing was sent onward. This is a configuration fault, not a delivery failure: ${str(e.message).slice(0, 200)}` };
    }
    networkError = str(e && e.message) || "no response";
  } finally {
    if (timer) clearTimeout(timer);
  }

  const verdict = outcomeOf({ status, body, networkError });
  return {
    ok: verdict.outcome === "sent",
    attempted: true,
    ...verdict,
    status,
    /* The URL is NOT returned. It is a configured secret-adjacent value and a response that echoed
     * it would put the destination of every prescription into any log that captured a body. */
    channel,
    note: verdict.outcome === "indeterminate"
      ? "This transmission stays OUTSTANDING. It is not known whether the prescription arrived, and re-sending is a human decision: a retry that duplicates a prescription is worse than one that did not happen."
      : undefined,
  };
}

export { TIMEOUT_MS, MAX_DETAIL, endpointFor, outcomeOf, sendTransmission };
