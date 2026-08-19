// functions/_connect/abdm/hiu-handlers.js — the M3 HIU callback handlers.
//
// The mirror of hip-handlers.js, for StewardMD as a Health Information USER: a doctor asks for a patient's
// records from other facilities, the patient grants in their ABHA app, and the records arrive encrypted.
//
// The state machine already exists (engine.js#ingestEvent + state.js + consent.js). This file is only the
// V3 adapter: it turns each callback body into the event that machine already understands, and posts the
// one acknowledgement M3 actually requires.
//
// WHAT IS PINNED AND WHAT IS NOT. Our OUTBOUND bodies are pinned to ABDM's Milestone-3 Postman collection
// (16-02-2026). The INBOUND callback bodies are not published in a V3 YAML (the docs site says "YAML not
// yet released"), so they follow the V0.5 shapes that the V3 outbound bodies visibly mirror, and every one
// is marked // INFERRED. Those are the first lines to check against a real callback capture.
//
// THE 14-DAY RULE lives here rather than on the HIP side: it binds the HIU. A consent artefact is valid for
// its own window, but data fetched under it may only be re-fetched within 14 days without asking again -
// so a fetch attempt past that boundary is refused at the request, not filtered afterwards.

import { flagOn } from "../testkit.js";
import {
  fetchConsentArtifact, verifyConsentArtifact, linkConsentId,
  attachConsentRequestId, getConsentReqByConsentRequestId,
} from "./consent.js";
export { withinRefetchWindow, REFETCH_WINDOW_DAYS } from "./consent.js";   // re-exported: the rule binds the HIU
import { updateConsentStatus, attachTransactionId, advanceStatus, getConsentReq } from "./state.js";

export class HiuHandlerError extends Error {}

const respondTo = (headers) => ({ response: { requestId: headers.requestId } });
const isoOf = (now) => {
  const d = typeof now === "function" ? now() : now;
  if (d && typeof d.toISOString === "function") return d.toISOString();
  if (typeof d === "string" && d) return d;
  return new Date(typeof d === "number" ? d : Date.now()).toISOString();
};

/** Our own correlation id, echoed by the gateway on every reply to a request we made. */
const ourRequestId = (body) => (body && (body.resp || body.response) || {}).requestId ?? null;

// ── 1. consent-on-init — the CM accepted our consent request ────────────────────────────────────────
// Inbound // INFERRED: { consentRequest: { id }, response: { requestId }, error? }
// Nothing is owed back. Record the CM's consent-REQUEST id so the later grant can be matched to the
// request that asked for it.
export async function onConsentInit({ env, deps, body, headers }) {
  if (!flagOn(env)) return;
  const now = isoOf(deps.now);
  const rid = ourRequestId(body);
  const cr = (body && (body.consentRequest || body.consent)) || {};
  const consentRequestId = cr.id ?? cr.consentRequestId ?? null;

  if (body && body.error) {
    // The CM refused the request outright (bad purpose code, unknown ABHA address, malformed scope). The
    // doctor is waiting on a screen, so this must land as a status, not as silence.
    if (rid) await updateConsentStatus(deps.db, rid, "DENIED", now);
    if (deps.audit) await deps.audit({
      action: "abdm.hiu.consent.init", outcome: "denied", ts: now, scope: { code: String(body.error.code ?? "") },
    }).catch(() => {});
    return;
  }
  if (!rid || !consentRequestId) throw new HiuHandlerError("on-init carries no correlation");
  await attachConsentRequestId(deps.db, rid, consentRequestId, now);
  if (deps.audit) await deps.audit({
    action: "abdm.hiu.consent.init", outcome: "ok", ts: now, scope: { requestId: rid },
  }).catch(() => {});
}

// ── 2. consent-hiu-notify — the patient granted, denied, revoked or it expired ──────────────────────
// Inbound // INFERRED: { notification: { status, consentRequestId,
//                                        consentArtefacts: [{ id }] } , requestId, timestamp }
// Reply [PINNED, M3]: consentHiuOnNotify
//   { acknowledgement: [{ status, consentId }], response: { requestId } }
//   NOTE the ARRAY - the HIP-side equivalent is a bare object. One grant can carry several artefacts (one
//   per HIP), and each is acknowledged separately.
export async function onConsentNotify({ env, deps, body, headers }) {
  if (!flagOn(env)) return;
  const now = isoOf(deps.now);
  const n = (body && body.notification) || {};
  const status = String(n.status || "").toUpperCase();
  const artefacts = Array.isArray(n.consentArtefacts) ? n.consentArtefacts : [];

  const row = await getConsentReqByConsentRequestId(deps.db, n.consentRequestId);
  if (!row) throw new HiuHandlerError("consent notify for a request we never made");

  // GRANTED: link each artefact to our row, then FETCH it. Nothing is persisted as granted here - the
  // signed artefact arrives on on-fetch and only a verified signature may write scope (R3).
  if (status === "GRANTED") {
    for (const a of artefacts) {
      const consentId = a && (a.id ?? a.consentId);
      if (!consentId) continue;
      await linkConsentId(deps.db, row.request_id, consentId, now);
      await fetchConsentArtifact(env, deps, { requestId: row.request_id, consentId });
    }
  }
  // Everything else is a lifecycle transition on our row. updateConsentStatus is monotonic, so a replayed
  // GRANTED after a REVOKE cannot resurrect it.
  await updateConsentStatus(deps.db, row.request_id, status || "DENIED", now);

  if (deps.audit) await deps.audit({
    action: "abdm.hiu.consent.notify", outcome: "ok", ts: now, tenantId: row.tenant_id,
    scope: { status }, resourceCounts: { artefacts: artefacts.length },
  }).catch(() => {});

  await reply(deps, "consentHiuOnNotify", {
    acknowledgement: artefacts.length
      ? artefacts.map((a) => ({ status: "OK", consentId: a && (a.id ?? a.consentId) }))
      : [{ status: "OK", consentId: null }],
    ...respondTo(headers),
  });
}

// ── 3. consent-on-fetch — the signed artefact itself ────────────────────────────────────────────────
// Inbound // INFERRED: { consent: { status, consentDetail: {…}, signature }, response: { requestId } }
// Nothing is owed back. verifyConsentArtifact checks the JWS against the pinned JWKS and only then
// persists the SIGNED scope onto the ONE reconciled row - an unverified artefact writes nothing.
export async function onConsentFetch({ env, deps, body, headers }) {
  if (!flagOn(env)) return;
  const artefact = (body && (body.consent || body.artifact)) || body;
  const res = await verifyConsentArtifact(env, deps, artefact);
  if (deps.audit) await deps.audit({
    action: "abdm.hiu.consent.fetch", outcome: res && res.ok ? "ok" : "denied", ts: isoOf(deps.now),
    scope: { reason: res && res.reason ? String(res.reason) : undefined },
  }).catch(() => {});
}

// ── 4. consent-on-status — the answer to a status poll ──────────────────────────────────────────────
// Inbound // INFERRED: { consentRequest: { status, id, consentArtefacts: [{id}] }, response:{requestId} }
// A poll answer carries no new authority: it may move the row's status, but it may NOT be treated as a
// grant. Only a verified artefact does that.
export async function onConsentStatus({ env, deps, body, headers }) {
  if (!flagOn(env)) return;
  const now = isoOf(deps.now);
  const cr = (body && (body.consentRequest || body.consent)) || {};
  const status = String(cr.status || "").toUpperCase();
  const row = await getConsentReqByConsentRequestId(deps.db, cr.id)
    || (ourRequestId(body) ? await getConsentReq(deps.db, ourRequestId(body)) : null);
  if (!row) throw new HiuHandlerError("status for a consent request we never made");
  if (status) await updateConsentStatus(deps.db, row.request_id, status, now);
  if (deps.audit) await deps.audit({
    action: "abdm.hiu.consent.status", outcome: "ok", ts: now, tenantId: row.tenant_id, scope: { status },
  }).catch(() => {});
}

// ── 5. hi-on-request — the HIP acknowledged our data request ────────────────────────────────────────
// Inbound // INFERRED: { hiRequest: { transactionId, sessionStatus }, response: { requestId } }
// This is the correlation half we were missing: our txn row is keyed by OUR requestId and the encrypted
// push will arrive keyed by the HIP's transactionId, so without attaching it here a push can never be
// joined to the ephemeral key that decrypts it.
export async function onHiRequest({ env, deps, body, headers }) {
  if (!flagOn(env)) return;
  const now = isoOf(deps.now);
  const hi = (body && body.hiRequest) || {};
  const rid = ourRequestId(body);
  const transactionId = hi.transactionId;
  if (!rid || !transactionId) throw new HiuHandlerError("on-request carries no correlation");

  await attachTransactionId(deps.db, rid, transactionId, now);
  await advanceStatus(deps.db, rid, "CONSENT_GRANTED", "REQUESTED", now);
  if (deps.audit) await deps.audit({
    action: "abdm.hiu.hi.request", outcome: "ok", ts: now, transactionId,
    scope: { sessionStatus: String(hi.sessionStatus || "") },
  }).catch(() => {});
}

// ── 6. patient-on-share — a scan-and-share answered to us as HIU ────────────────────────────────────
// We are the HIP for scan-and-share (we issue the token), so this arrives only if a StewardMD deployment
// also acts as the scanning party. Recorded rather than dropped, so the case is visible if it ever fires.
export async function onPatientShare({ env, deps, body, headers }) {
  if (!flagOn(env)) return;
  if (deps.audit) await deps.audit({
    action: "abdm.hiu.patient.share", outcome: "ok", ts: isoOf(deps.now),
    scope: { status: String((body && body.acknowledgement && body.acknowledgement.status) || "") },
  }).catch(() => {});
}

async function reply(deps, endpointKey, body) {
  if (!deps || !deps.gateway) throw new HiuHandlerError("gateway is not bound: cannot answer " + endpointKey);
  const { status } = await deps.gateway.post(endpointKey, body);
  return status;
}

export const HIU_HANDLERS = Object.freeze({
  "consent-on-init": onConsentInit,
  "consent-hiu-notify": onConsentNotify,
  "consent-on-fetch": onConsentFetch,
  "consent-on-status": onConsentStatus,
  "hi-on-request": onHiRequest,
  "patient-on-share": onPatientShare,
});
