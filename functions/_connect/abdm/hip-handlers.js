// functions/_connect/abdm/hip-handlers.js — the M2 HIP callback handlers.
//
// callbacks.js is the TRANSPORT (route table, headers, JWKS bearer, replay nonce, immediate ack). This file
// is what happens AFTER the ack: each handler adapts one ABDM V3 callback payload onto the primitives that
// already exist (hip.js discovery/serve/consent, carecontext.js, linktoken.js, consented-store.js) and then
// posts the matching `on-*` back through the gateway seam.
//
// EVERY wire shape here is pinned to ABDM's OWN Milestone-2 Postman collection (16-02-2026) and the
// Scan-and-Share collection (14-08-2025), both downloaded from sandboxcms.abdm.gov.in. Where a shape is
// inferred rather than pinned it says so in a `// INFERRED` comment - those are the lines to check first
// against a real callback capture. Guessing is what produced defects D1-D6.
//
// TIMING: callbacks.js has already acknowledged by the time a handler runs (the 60-second on-notify rule,
// FAQ Q36). A handler that throws can no longer change the response, so it must record its own failure -
// deps.onError in the receiver does that. Never put a slow read in front of the acknowledgement.
//
// PHI: a raw ABHA address/number arrives in these bodies. It is HMAC-pseudonymised before it reaches D1,
// KV, an object key, or the audit trail. The only place it may appear verbatim is an outbound ABDM body
// that ABDM itself keyed on (an `acknowledgement.abhaAddress` echo).

import { hmacPseudonym } from "../audit.js";
import { handleDiscovery, serveTransfer, putHipConsent, getServableCareContexts } from "./hip.js";
import { hipFlagOn } from "./hip-flags.js";
import { assertDataBlind } from "./carecontext.js";
import { deleteForPatient } from "./consented-store.js";
import { matchDemographics } from "./demographic-index.js";
import { issueLinkOtp, verifyLinkOtp, OTP_TTL_SEC, MAX_VERIFY_ATTEMPTS } from "./otp.js";

export class HipHandlerError extends Error {}

// ── small shared shapes ─────────────────────────────────────────────────────────────────────────────
// Every on-* body carries `response.requestId` = the REQUEST-ID header of the callback being answered.
// That is the ONLY correlation the gateway uses to match our reply to its request.
const respondTo = (headers) => ({ response: { requestId: headers.requestId } });

const isoOf = (now) => {
  const d = typeof now === "function" ? now() : now;
  if (d && typeof d.toISOString === "function") return d.toISOString();
  if (typeof d === "string" && d) return d;
  return new Date(typeof d === "number" ? d : Date.now()).toISOString();
};

/** The raw ABHA identifier on any V3 payload. ABDM is inconsistent about which field carries it. */
export function abhaOf(o) {
  if (!o || typeof o !== "object") return null;
  const v = o.abhaAddress ?? o.healthId ?? o.id ?? o.abha;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Which tenant is this callback addressed to?
 *
 * ABDM stamps X-HIP-ID, and one (facility, bridge) pair yields exactly one HIP ID (FAQ Q24), so the header
 * IS the tenant selector. Fail CLOSED on an unknown id: serving a callback under a guessed tenant would
 * expose one hospital's records under another's consent.
 */
export async function resolveHipTenant(env, deps, hipId) {
  const id = String(hipId || "").trim();
  if (!id) throw new HipHandlerError("callback carries no X-HIP-ID");
  const { db } = deps || {};
  if (db) {
    const { results = [] } = await db
      .prepare("SELECT tenant_id, config FROM connect_connector_config WHERE connector_id=?")
      .bind("abdm").all();
    for (const row of results) {
      let cfg = null;
      try { cfg = typeof row.config === "string" ? JSON.parse(row.config) : row.config; } catch { cfg = null; }
      if (cfg && String(cfg.hipId || "") === id) return row.tenant_id;
    }
  }
  // Single-tenant fallback: the deployment's own configured facility. This is the sandbox shape today
  // (one bridge, one facility, one tenant) and stays correct once per-tenant rows exist, because the
  // lookup above wins.
  if (env && env.ABDM_HIP_ID && String(env.ABDM_HIP_ID) === id && env.ABDM_TENANT_ID) return env.ABDM_TENANT_ID;
  throw new HipHandlerError("no tenant is registered for this HIP id");
}

/** Post an on-* response through the gateway seam. A non-2xx is a delivery failure worth auditing. */
async function reply(deps, endpointKey, body) {
  if (!deps || !deps.gateway) throw new HipHandlerError("gateway is not bound: cannot answer " + endpointKey);
  const { status } = await deps.gateway.post(endpointKey, body);
  return status;
}

// ── 1. link-token-result ────────────────────────────────────────────────────────────────────────────
// Already wired in the receiver (it predates this file) and stays there: it needs putToken, which is the
// only thing it does.

// ── 2. discover — user-initiated discovery ──────────────────────────────────────────────────────────
// Inbound (INFERRED from the V0.5 shape + the on-discover response; the V3 YAML is unreleased):
//   { transactionId, requestId, timestamp,
//     patient: { id: "<abha address>", name, gender, yearOfBirth,
//                verifiedIdentifiers: [{type:"MOBILE"|"NDHM_HEALTH_NUMBER", value}],
//                unverifiedIdentifiers: [{type:"MR", value}] } }
// Reply: onDiscover { transactionId, patient:[{referenceNumber, display, careContexts:[…], hiType, count}],
//                     matchedBy:[…], response:{requestId} }
//
// THE MATCHING ALGORITHM (Discovery & Link, certification USER_INIT_LINK_602-607) is a flowchart:
//   ABHA address match -> return; else mobile match AND gender match AND age within +/-5 AND name
//   phonetically similar -> return; else medical-record-number match (under the SAME three conditions)
//   -> return; else no match.
// The ABHA-address arm is handled by hip.js#handleDiscovery (exact identifier only, rate-limited). The
// demographic and MRN arms are demographic-index.js, which is deterministic throughout - exact equality
// on hashed, normalised values, no distance metric anywhere - and returns NO MATCH when two patients
// both fit, because picking one would be a coin toss with somebody's medical history.
// deps.demographicMatch remains injectable for tests; production binds the real matcher.
export async function onDiscover({ env, deps, body, headers }) {
  if (!hipFlagOn(env)) return;                                  // second flag OFF: answer nothing, leak nothing
  const now = deps.now;
  const tenantId = await resolveHipTenant(env, deps, headers.entityId);
  const probe = (body && body.patient) || {};
  const abha = abhaOf(probe);

  // The exact-identifier arm reuses hip.js#handleDiscovery unchanged: per-source rate limit, EXACT ABHA
  // only, constant-shape miss, every probe audited.
  const disc = deps.handleDiscovery || handleDiscovery;
  let out = await disc(env, { db: deps.db, kv: deps.kv, audit: deps.audit },
    { probe: { abhaAddress: abha, tenantId }, sourceId: headers.entityId, now });
  let matchedBy = out.matched ? ["ABHA_ADDRESS"] : [];
  // The pseudonym the matched patient is keyed by. On the exact arm that is the probe ABHA's hash; on the
  // demographic arm the matcher must SAY which patient it matched, because the probe carried no ABHA to
  // derive it from - deriving one from an unlinked address would key the reply to nobody.
  let patientHash = out.matched && abha ? await hmacPseudonym(env, tenantId, abha) : null;

  if (!out.matched) {
    const dm = await runDemographicMatch(env, deps, { tenantId, probe, now });
    if (dm && dm.patientHash) {
      out = { matched: true, careContexts: dm.careContexts || [] };
      matchedBy = dm.matchedBy || ["MOBILE"];
      patientHash = dm.patientHash;
    }
  }

  const patient = (out.matched && patientHash)
    ? await groupForWire(env, deps, { tenantId, patientHash, careContexts: out.careContexts })
    : [];

  await reply(deps, "onDiscover", {
    transactionId: body && body.transactionId,
    patient,
    matchedBy,
    ...respondTo(headers),
  });
}

/**
 * Run the demographic/MRN arms of the discovery flowchart and translate the result into the shape
 * onDiscover expects. A patient found this way is keyed by the tenant's own patient reference, so it is
 * turned into the same pseudonym the ABHA arm publishes.
 *
 * `deps.demographicMatch` overrides the matcher (tests only). An "ambiguous" result is reported to the
 * audit trail but returned to ABDM as a plain miss - a caller must not be able to tell "two people fit"
 * from "nobody fits", or the response becomes an oracle for probing who is registered here.
 */
async function runDemographicMatch(env, deps, { tenantId, probe, now }) {
  const match = deps.demographicMatch || matchDemographics;
  const dm = await match(env, deps, { tenantId, probe, now });
  if (deps.audit) await deps.audit({
    action: "hip.discovery.demographic", outcome: dm && dm.matched ? "ok" : "denied", ts: isoOf(now),
    tenantId, scope: { reason: (dm && dm.reason) || "no-match", matchedBy: (dm && dm.matchedBy) || [] },
  }).catch(() => {});
  if (!dm || !dm.matched) return null;

  // The matcher names a LOCAL patient ref. Its care contexts are registered under the patient's ABHA
  // pseudonym, so resolve through the ABHA the probe carried; a demographic match with no ABHA on the
  // probe cannot be published (there is nothing to key the care contexts by).
  const abha = abhaOf(probe);
  if (!abha) return null;
  const patientHash = await hmacPseudonym(env, tenantId, abha);
  const rows = await getServableCareContexts(deps.db, tenantId, patientHash);
  if (!rows.length) return null;
  return {
    matchedBy: dm.matchedBy,
    patientHash,
    careContexts: rows.map((r) => ({ referenceNumber: r.ref, display: r.display })),
  };
}

/**
 * ABDM's `patient[]` is one entry per (patient reference, hiType) carrying that group's care contexts.
 * Confirmed from the M2 collection (HIP Initiated Linking / On Discovery / Link on Confirm all share it).
 * `display` must be data-blind: no clinical detail, no result (assertDataBlind enforces it).
 */
async function groupForWire(env, deps, { tenantId, patientHash, careContexts }) {
  const rows = await getServableCareContexts(deps.db, tenantId, patientHash);
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const groups = new Map();
  for (const cc of careContexts || []) {
    const ref = cc.referenceNumber ?? cc.ref;
    const row = byRef.get(ref);
    const hiType = (row && row.hi_type) || "OPConsultation";
    if (!groups.has(hiType)) groups.set(hiType, []);
    const display = (cc.display ?? (row && row.display)) || "Visit record";
    assertDataBlind(display);                                   // throws rather than leak a result to the CM
    groups.get(hiType).push({ referenceNumber: ref, display });
  }
  // The pseudonym is what crosses the wire as the patient reference - never the raw ABHA.
  return [...groups.entries()].map(([hiType, ccs]) => ({
    referenceNumber: patientHash, display: "StewardMD records", careContexts: ccs, hiType, count: ccs.length,
  }));
}

// ── 3. link-init — the HIP sends the OTP ────────────────────────────────────────────────────────────
// Inbound (INFERRED): { transactionId, requestId, timestamp,
//                       patient: { referenceNumber, careContexts:[{referenceNumber}] } }
// Reply: onLinkInit { transactionId, link:{ referenceNumber, authenticationType, meta:{communicationMedium,
//                     communicationHint, communicationExpiry} }, response:{requestId} }   [PINNED, M2]
//
// "On getting the link/init request, the HRP/HIP must send an OTP to the patient's phone number"
// (Discovery & Link). So the OTP is OURS to generate, deliver and verify - the gateway only carries the
// patient's answer back to us on link/confirm.
export async function onLinkInit({ env, deps, body, headers }) {
  if (!hipFlagOn(env)) return;
  const now = deps.now;
  const tenantId = await resolveHipTenant(env, deps, headers.entityId);
  const transactionId = body && body.transactionId;
  const patient = (body && body.patient) || {};
  const patientRef = String(patient.referenceNumber || "");
  const refs = ((patient.careContexts || []).map((c) => c.referenceNumber ?? c.ref)).filter(Boolean);

  // The mobile is OURS to find - ABDM sends a pseudonymous patient reference, not a phone number. The
  // resolver is injected at the composition root because it reaches the OPD store, which this file must
  // not import. No resolver, or no number on file, means we cannot deliver, and we say so.
  const mobile = typeof deps.resolvePatientMobile === "function"
    ? await deps.resolvePatientMobile(env, deps, { tenantId, patientRef }).catch(() => null)
    : null;

  const issued = await issueLinkOtp(env, deps, { tenantId, patientRef, refs, transactionId, mobile, now, io: deps });

  if (deps.audit) await deps.audit({
    action: "abdm.link.init", outcome: issued.delivered ? "ok" : "failed", ts: isoOf(now), tenantId,
    transactionId,
    scope: { delivered: issued.delivered, channel: issued.channel, reason: issued.reason,
             careContexts: refs.length },
  }).catch(() => {});

  // A refused mint (rate limit, no store) has no reference to offer, so there is nothing the patient
  // could confirm. Answer with an explicit failure rather than a link the gateway will wait on.
  if (!issued.linkRef) {
    await reply(deps, "onLinkInit", {
      transactionId,
      error: { code: 1000, message: "cannot send an OTP right now" },
      ...respondTo(headers),
    });
    return;
  }

  await reply(deps, "onLinkInit", {
    transactionId,
    link: {
      referenceNumber: issued.linkRef,
      authenticationType: "DIRECT",
      meta: {
        communicationMedium: "MOBILE",
        communicationHint: "OTP",
        communicationExpiry: issued.expiresAt,
      },
    },
    ...respondTo(headers),
  });
}

// ── 4. link-confirm — verify the OTP, then link ─────────────────────────────────────────────────────
// Inbound (INFERRED): { confirmation: { linkRefNumber, token } }  (token = the OTP the patient typed)
// Reply: onLinkConfirm { patient:[{referenceNumber, display, careContexts, hiType, count}],
//                        response:{requestId} }   [PINNED, M2]
export async function onLinkConfirm({ env, deps, body, headers }) {
  if (!hipFlagOn(env)) return;
  const now = deps.now;
  const conf = (body && (body.confirmation || body.link)) || {};
  const linkRef = conf.linkRefNumber ?? conf.referenceNumber ?? conf.linkReference;
  const token = conf.token ?? conf.otp;

  const v = await verifyLinkOtp(deps, { linkRef, token, now });
  if (!v.ok) {
    // One answer for every failure: unknown reference, expired reference, wrong OTP, attempts exhausted.
    // The distinction is in the audit trail, never on the wire, or the reply becomes an oracle.
    if (deps.audit) await deps.audit({
      action: "abdm.link.confirm", outcome: "denied", ts: isoOf(now),
      scope: { reason: v.reason },
    }).catch(() => {});
    await reply(deps, "onLinkConfirm", { patient: [], ...respondTo(headers) });
    return;
  }

  const state = v.state;
  // state.patientRef is what WE put on the wire in on-discover: hmacPseudonym(tenant, abha), which is
  // exactly the patient_abha_hash column. So the lookup is already tenant- and patient-scoped, and a
  // referenceNumber we never issued simply finds nothing.
  const rows = await getServableCareContexts(deps.db, state.tenantId, state.patientRef);
  const allowed = new Set(state.refs);                           // ONLY what link/init offered
  const groups = new Map();
  for (const r of rows) {
    if (allowed.size && !allowed.has(r.ref)) continue;
    const hiType = r.hi_type || "OPConsultation";
    if (!groups.has(hiType)) groups.set(hiType, []);
    groups.get(hiType).push({ referenceNumber: r.ref, display: r.display || "Visit record" });
  }
  const patient = [...groups.entries()].map(([hiType, ccs]) => ({
    referenceNumber: state.patientRef, display: "StewardMD records", careContexts: ccs, hiType, count: ccs.length,
  }));

  if (deps.audit) await deps.audit({
    action: "abdm.link.confirm", outcome: "ok", ts: isoOf(now), tenantId: state.tenantId,
    transactionId: state.transactionId, resourceCounts: { careContexts: patient.reduce((n, p) => n + p.count, 0) },
  }).catch(() => {});

  await reply(deps, "onLinkConfirm", { patient, ...respondTo(headers) });
}

// ── 5. consent-notify — GRANTED / REVOKED / EXPIRED ─────────────────────────────────────────────────
// Inbound (INFERRED): { notification: { status, consentId, consentDetail:{…}, signature }, requestId }
// Reply: consentHipOnNotify { acknowledgement:{status, consentId}, response:{requestId} }   [PINNED, M2]
//
// The HIP obligation is two-sided (M2 test cases HIP_INIT_GRANT/REVOKE/EXPIRE_CONSENT +
// HIP_INIT_ABHA_OPTOUT_DEACTIVATE): STORE the granted artefact, and DELETE it - and the records held under
// it - on revoke, expiry or ABHA opt-out. putHipConsent is monotonic, so a replayed older status can never
// regress a revoked consent back to granted.
export async function onConsentNotify({ env, deps, body, headers }) {
  if (!hipFlagOn(env)) return;
  const now = isoOf(deps.now);
  const tenantId = await resolveHipTenant(env, deps, headers.entityId);
  const n = (body && (body.notification || body.consent)) || {};
  const detail = n.consentDetail || n.consent || {};
  const status = String(n.status || detail.status || "").toUpperCase();
  const consentId = n.consentId ?? detail.consentId ?? (detail.consent && detail.consent.id) ?? null;
  const abha = abhaOf(detail.patient) || abhaOf(n.patient);
  const patientAbhaHash = abha ? await hmacPseudonym(env, tenantId, abha) : null;

  if (!consentId) throw new HipHandlerError("consent notify carries no consentId");

  const put = deps.putHipConsent || putHipConsent;
  await put(deps.db, {
    requestId: consentId,                                        // the artefact id IS the durable key here
    tenantId, patientAbhaHash,
    hiTypes: detail.hiTypes || null,
    expiresAt: (detail.permission && detail.permission.dataEraseAt) || detail.expiry || null,
    status: status || "GRANTED", now,
  });

  // REVOKED / EXPIRED / DENIED: delete what we hold for that patient. The sweep also erases derived state,
  // but the obligation is immediate - the patient revoked, so waiting for a cron is the wrong answer.
  if (TERMINAL_CONSENT.has(status) && patientAbhaHash && deps.r2) {
    await deleteForPatient(env, { r2: deps.r2, db: deps.db }, { tenantId, patientAbhaHash });
  }

  if (deps.audit) await deps.audit({
    action: "abdm.consent.notify", outcome: "ok", ts: now, tenantId, consentId, scope: { status },
  }).catch(() => {});

  await reply(deps, "consentHipOnNotify", {
    acknowledgement: { status: "SUCCESS", consentId },
    ...respondTo(headers),
  });
}
const TERMINAL_CONSENT = new Set(["REVOKED", "EXPIRED", "DENIED"]);

// ── 6. hi-request — the data request ────────────────────────────────────────────────────────────────
// Inbound (INFERRED): { transactionId, requestId,
//                       hiRequest: { consent:{id}, dateRange, dataPushUrl, keyMaterial } }
// Reply FIRST: hiHipOnRequest { hiRequest:{transactionId, sessionStatus:"ACKNOWLEDGED"},
//                               response:{requestId} }   [PINNED, M2]
// then push the sealed pages to dataPushUrl, then hiNotify the outcome.   [PINNED, M2]
//
// ORDER MATTERS. The acknowledgement goes out BEFORE the transfer: ABDM treats a late ack as a failed
// delivery and never follows up, and the transfer itself has a 20-minute budget (design to the stricter
// figure; one doc says 2h). serveTransfer does the rest - the R5 cross-patient guard, the anti-SSRF gate
// on the HIU's dataPushUrl, per-record serialize/seal, then push.
export async function onHiRequest({ env, deps, body, headers }) {
  if (!hipFlagOn(env)) return;
  const now = isoOf(deps.now);
  const tenantId = await resolveHipTenant(env, deps, headers.entityId);
  const hi = (body && body.hiRequest) || {};
  const transactionId = body && (body.transactionId ?? hi.transactionId);
  const consentId = (hi.consent && hi.consent.id) || hi.consentId;

  await reply(deps, "hiHipOnRequest", {
    hiRequest: { transactionId, sessionStatus: "ACKNOWLEDGED" },
    ...respondTo(headers),
  });

  // Which care contexts? The consent artefact's own signed scope, reloaded fresh from D1 - never the
  // request body. serveTransfer re-reloads and re-checks it anyway (assertServeAllowed), so a widened or
  // stale scope cannot survive even if this list were wrong.
  const consent = await deps.db.prepare("SELECT * FROM connect_abdm_consent_req WHERE consent_id=?")
    .bind(consentId).first();
  const careContexts = parseRefs(consent && consent.care_contexts);

  let outcome = "FAILED", pages = 0;
  try {
    const serve = deps.serveTransfer || serveTransfer;
    const res = await serve(env, {
      db: deps.db, secrets: deps.secrets, gateway: deps.gateway, fetch: deps.fetch,
      audit: deps.audit, now: deps.now, source: deps.source, jwks: deps.jwks,
    }, {
      tenantId, consentId, careContexts, hiuKeyMaterial: hi.keyMaterial,
      dataPushUrl: hi.dataPushUrl, transactionId, hipId: headers.entityId,
    });
    outcome = res.outcome; pages = res.pages;
  } catch (e) {
    if (deps.audit) await deps.audit({
      action: "abdm.hi.request", outcome: "error", ts: now, tenantId, consentId, transactionId,
      scope: { error: String(e && e.message) },
    }).catch(() => {});
  }

  // The transfer receipt. ABDM reconciles the session on this, so it is sent whatever the outcome -
  // a silent failure looks to the HIU like a transfer still in flight.
  await reply(deps, "hiNotify", {
    notification: {
      consentId, transactionId, doneAt: isoOf(deps.now),
      notifier: { type: "HIP", id: headers.entityId },
      statusNotification: {
        sessionStatus: outcome === "SERVED" ? "TRANSFERRED" : outcome,
        hipId: headers.entityId,
        statusResponses: careContexts.map((ref) => ({
          careContextReference: ref,
          hiStatus: outcome === "SERVED" ? "OK" : outcome === "PARTIAL" ? "PARTIAL" : "ERRORED",
          description: outcome,
        })),
      },
    },
  });
  if (deps.audit) await deps.audit({
    action: "abdm.hi.request", outcome: "ok", ts: now, tenantId, consentId, transactionId,
    resourceCounts: { pages }, scope: { outcome },
  }).catch(() => {});
}

function parseRefs(v) {
  if (v == null) return [];
  let arr = v;
  if (typeof v === "string") { try { arr = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => (typeof c === "string" ? c : (c && (c.careContextReference ?? c.reference ?? c.id)))).filter(Boolean);
}

// ── 7. patient-share — scan-and-share IS the OPD queue ──────────────────────────────────────────────
// Inbound [PINNED, Scan-and-Share collection]:
//   { intent: "PROFILE_SHARE"|"Payment"|"Health_record_sharing",
//     metaData: { hipId, context, hprId, latitude, longitude },
//     profile: { patient: { abhaNumber, abhaAddress, name, gender, dayOfBirth, monthOfBirth, yearOfBirth,
//                           address:{line,district,state,pinCode}, phoneNumber } } }
// Reply [PINNED]: patientShareOnShare
//   { acknowledgement:{ status:"SUCCESS", abhaAddress, profile:{ context, tokenNumber, expiry } },
//     response:{ requestId } }
//
// WE issue the tokenNumber - it is the OPD queue token the app already computes, and the shared profile is
// verified demographics that today get typed in by hand. `expiry` is in SECONDS (the collection's sample is
// "1800"); the reconciliation note's "180" was minutes-shaped and wrong.
export const SHARE_TOKEN_EXPIRY_SEC = 1800;

export async function onPatientShare({ env, deps, body, headers }) {
  if (!hipFlagOn(env)) return;
  const now = isoOf(deps.now);
  const meta = (body && body.metaData) || {};
  const hipId = meta.hipId || headers.entityId;
  const tenantId = await resolveHipTenant(env, deps, hipId);
  const patient = (body && body.profile && body.profile.patient) || {};
  const abhaAddress = abhaOf(patient);
  const context = String(meta.context ?? "");

  // No queue bridge bound => say so rather than acknowledge a token we never issued. A patient standing at
  // the counter with a token number that does not exist is worse than an honest failure.
  if (typeof deps.issueQueueToken !== "function") {
    await reply(deps, "patientShareOnShare", {
      acknowledgement: { status: "FAILURE", abhaAddress, error: { code: "TOKEN_UNAVAILABLE", message: "counter is not accepting tokens" } },
      ...respondTo(headers),
    });
    return;
  }

  const issued = await deps.issueQueueToken(env, deps, {
    tenantId, context, hipId,
    patient: {
      abhaAddress, abhaNumber: patient.abhaNumber ?? null,
      name: patient.name ?? "", gender: patient.gender ?? "",
      yearOfBirth: patient.yearOfBirth ?? null,
      mobile: patient.phoneNumber ?? "",
    },
    hprId: meta.hprId || null,
    now: deps.now,
  });

  if (deps.audit) await deps.audit({
    action: "abdm.patient.share", outcome: issued && issued.tokenNumber != null ? "ok" : "failed", ts: now, tenantId,
    patientRefHash: abhaAddress ? await hmacPseudonym(env, tenantId, abhaAddress) : null,
    scope: { intent: String((body && body.intent) || ""), counter: context, hprId: Boolean(meta.hprId) },
  }).catch(() => {});

  await reply(deps, "patientShareOnShare", {
    acknowledgement: {
      status: "SUCCESS",
      abhaAddress,
      profile: {
        context,
        tokenNumber: String(issued.tokenNumber),
        expiry: String(issued.expirySec ?? SHARE_TOKEN_EXPIRY_SEC),
      },
    },
    ...respondTo(headers),
  });
}

// ── 8-10. the acknowledgement-only callbacks ────────────────────────────────────────────────────────
// link-result (our HIP-initiated /link/carecontext landed), context-notify-ack and sms-notify-ack are
// results of calls WE made. Nothing is owed back to the gateway - answering an on-* to an on-* would be a
// loop. They are recorded so a linking failure is visible instead of silent.
function ackOnly(action) {
  return async ({ env, deps, body, headers }) => {
    if (!hipFlagOn(env)) return;
    const status = String(
      (body && body.acknowledgement && body.acknowledgement.status)
      ?? (body && body.status)
      ?? (body && body.error ? "ERROR" : "SUCCESS"));
    const err = body && body.error;
    if (deps.audit) await deps.audit({
      action, outcome: err ? "failed" : "ok", ts: isoOf(deps.now),
      transactionId: headers.requestId,
      scope: { status, code: err ? String(err.code ?? "") : undefined },
    }).catch(() => {});
  };
}

// ── the handler table ───────────────────────────────────────────────────────────────────────────────
export const HIP_HANDLERS = Object.freeze({
  discover: onDiscover,
  "link-init": onLinkInit,
  "link-confirm": onLinkConfirm,
  "consent-notify": onConsentNotify,
  "hi-request": onHiRequest,
  "patient-share": onPatientShare,
  "link-result": ackOnly("abdm.link.result"),
  "context-notify-ack": ackOnly("abdm.context.notify"),
  "sms-notify-ack": ackOnly("abdm.sms.notify"),
});

// ── local helpers ───────────────────────────────────────────────────────────────────────────────────
async function sha256hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
