// functions/_connect/abdm/hiu.js — HIU consent-request builder (Stage-4 Task-1; spec §4, R3/R17, ADR-2D/2H).
// requestConsent kicks off an ABDM HIU consent request: server-derives the actor+tenant, builds the
// consentInit body (the RAW ABHA lives ONLY in that POST body), submits it via the gateway, and on the
// gateway's 202-accept persists an INITIATED consent_req row keyed by the ABHA *HMAC* (never the raw ABHA)
// plus a PHI-free audit event. Fail-closed: a non-202 throws and writes no row.
//
// Deliberately NOT done here (later tasks own them): NO ephemeral keypair is minted/sealed at consent-request
// time — that is the data-request (Task 6, R17 + ADR-2D). And mode:live is NOT gated here — the live gate
// bites at the data request (R3), so a sandbox and a live tenant both reach the gateway the same way.
import { resolveActor, resolveTenant } from "../identity.js";
import { hmacPseudonym } from "../audit.js";
import { putConsentReq, putTxn, tryJoin, unsealTxnKey, claimAck, deleteBuffered, advanceStatus } from "./state.js";
import { randomBytes, importRawPrivate, nonce, sharedSecret, openEntry, abdmKeyMaterial, readDhPublicKey, FideliusError } from "./fidelius.js";
import { revalidateForRequest, getConsentReqByConsentId } from "./consent.js";
import { AbdmError } from "./gateway.js";
import { PermissionError } from "../permission.js";

// ── ADR-2H consent-body field-name seam. Corroborated-not-official (ABDM research was WAF-blocked and V1↔V3
//    key casing differs) — pin every name to the live Postman/Swagger before real calls. Kept LOCAL to the
//    consent code (the sole place these names are used) so the real names change in exactly one spot, mirroring
//    gateway.js's FIELDS/ENDPOINTS seam.
export const CONSENT_FIELDS = {
  requestId:   "requestId",     // VERIFY
  timestamp:   "timestamp",     // VERIFY
  consent:     "consent",       // VERIFY
  purpose:     "purpose",       // VERIFY
  patient:     "patient",       // VERIFY
  patientId:   "id",            // VERIFY — the RAW ABHA address lands here (POST body ONLY, never persisted)
  hiTypes:     "hiTypes",       // VERIFY
  permission:  "permission",    // VERIFY
  dateRange:   "dateRange",     // VERIFY
  dataEraseAt: "dataEraseAt",   // VERIFY
};

// Build the consentInit POST body through the field seam. The RAW ABHA is placed ONLY here (patient.id) —
// it is HMAC'd before it touches D1/KV/audit and must never appear in a URL/log.
export function buildConsentInitBody(F, { requestId, now, abhaAddress, purpose, hiTypes, dateRange, dataEraseAt }) {
  return {
    [F.requestId]: requestId,
    [F.timestamp]: now,
    [F.consent]: {
      [F.purpose]: purpose ?? null,
      [F.patient]: { [F.patientId]: abhaAddress },   // RAW ABHA — POST body ONLY
      [F.hiTypes]: hiTypes ?? [],
      [F.permission]: {
        [F.dateRange]: dateRange ?? null,
        [F.dataEraseAt]: dataEraseAt ?? null,
      },
    },
  };
}

// deps = { db, kv, secrets, gateway, identifyFn, audit, now }; req = { request, tenantId, abhaAddress,
// purpose, hiTypes, dateRange, dataEraseAt }. Dependency-injected — no Date.now/globals for the clock.
export async function requestConsent(env, deps, req) {
  const { db, gateway, identifyFn, audit } = deps;
  const now = typeof deps.now === "function" ? deps.now() : deps.now;   // injected clock only (no Date.now)

  // Server-derived identity + membership — NEVER trust a tenantId from the request body. A non-member
  // tenantId throws PermissionError HERE, before any gateway call or persistence.
  const actor = await resolveActor(identifyFn, req.request, env);
  const { tenant } = await resolveTenant(db, actor.id, req.tenantId);
  const tenantId = tenant.id;

  // Our own correlation id — distinct from the gateway's per-HTTP REQUEST-ID header, which the gateway mints.
  const requestId = globalThis.crypto.randomUUID();

  const body = buildConsentInitBody(CONSENT_FIELDS, {
    requestId, now,
    abhaAddress: req.abhaAddress,
    purpose: req.purpose,
    hiTypes: req.hiTypes,
    dateRange: req.dateRange,
    dataEraseAt: req.dataEraseAt,
  });

  // Submit. Fresh REQUEST-ID header is minted inside the gateway. Fail-closed: only a 202-accept persists.
  const { status } = await gateway.post("consentInit", body);
  if (status !== 202) throw new AbdmError("consentInit not accepted: HTTP " + status);   // no row written

  // 202 accepted → HMAC the ABHA (per-tenant) BEFORE it touches D1; the raw ABHA never reaches storage.
  const patientAbhaHash = await hmacPseudonym(env, tenantId, req.abhaAddress);
  await putConsentReq(db, {
    requestId, tenantId, actor: actor.id, patientAbhaHash,
    hiTypes: req.hiTypes,
    expiresAt: req.dataEraseAt ?? null,   // VERIFY: consent-artifact erase/expiry bound (pin to real semantics)
    now,
  });

  // PHI-free audit (metadata only): ONLY ALLOW-listed keys + the patient HMAC. requestId and the hiTypes
  // COUNT ride inside the ALLOW-listed scope/resourceCounts blobs — never a raw key, never the raw ABHA.
  if (audit) {
    await audit({
      action: "consent.requested",
      tenantId,
      actor: actor.id,
      patientRefHash: patientAbhaHash,
      resourceCounts: { hiTypes: Array.isArray(req.hiTypes) ? req.hiTypes.length : 0 },
      scope: { requestId },
      outcome: "ok",
      ts: now,
    });
  }

  return { requestId, status: "INITIATED" };
}

// ── Stage-4 Task-6: requestHealthInformation — the DATA REQUEST = per-request consent-binding + ephemeral key
//    mint (spec §4, R3/R17, ADR-2D). The write side of the async data flow: re-validate the consent FRESH
//    (R3 mode:live gate — a since-REVOKED/EXPIRED/narrowed consent is refused HERE), mint ONE fresh ephemeral
//    X25519 keypair FOR THIS transaction, send our PUBLIC keyMaterial to the HIP via the gateway, and on the
//    202-accept persist a txn row with the private key SEALED (never plaintext, never logged), keyed by the
//    DATA-REQUEST requestId (R17). The gateway's on-request webhook later attaches the transaction_id (Task 4).
const b64 = (u8) => btoa(String.fromCharCode(...u8));   // 32-byte inputs (keys/nonces) — safe for spread

// hiRequest body field-name seam (ADR-2H) — LOCAL to hiu.js (its sole caller), mirroring CONSENT_FIELDS: the
// 2-file task constraint forbids editing gateway.js's FIELDS, so the real names change in exactly one spot.
// Every name is corroborated-not-official — pin to the live Postman/Swagger before real calls.
export const HIREQUEST_FIELDS = {
  requestId:   "requestId",     // VERIFY — our correlation id (distinct from the per-HTTP REQUEST-ID header)
  timestamp:   "timestamp",     // VERIFY
  hiRequest:   "hiRequest",     // VERIFY — wraps consent + dateRange + dataPushUrl + keyMaterial
  consent:     "consent",       // VERIFY
  consentId:   "id",            // VERIFY — { id: <consentId> }
  dateRange:   "dateRange",     // VERIFY — the requested pull window
  dataPushUrl: "dataPushUrl",   // VERIFY — OUR callback URL; the HIP pushes Fidelius ciphertext here
  keyMaterial: "keyMaterial",   // VERIFY
  cryptoAlg:   "cryptoAlg",     // VERIFY
  curve:       "curve",         // VERIFY
  dhPublicKey: "dhPublicKey",   // VERIFY — b64(our ephemeral X25519 public key)
  nonce:       "nonce",         // VERIFY — b64(our 32-byte nonce)
};

// Build the hiRequest POST body through the field seam. keyMaterial carries ONLY our PUBLIC half (public key +
// nonce); the private scalar never leaves this process except SEALED into D1.
export function buildHiRequestBody(F, { requestId, now, consentId, dateRange, dataPushUrl, keyMaterial }) {
  return {
    [F.requestId]: requestId,
    [F.timestamp]: now,
    [F.hiRequest]: {
      [F.consent]: { [F.consentId]: consentId },
      [F.dateRange]: dateRange ?? null,
      [F.dataPushUrl]: dataPushUrl ?? null,
      // keyMaterial comes from fidelius.abdmKeyMaterial(): dhPublicKey is the { expiry, parameters,
      // keyValue } object the M3 collection specifies, not a bare base64 string.
      [F.keyMaterial]: keyMaterial,
    },
  };
}

const parseHiTypes = (v) => { if (v == null) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return [v]; } };
// Decode a persisted JSON scope column (care_contexts/purpose/date_range). Non-string ⇒ passthrough; a
// non-JSON string ⇒ returned verbatim (fail-soft — revalidate's own array/purpose guards then fail closed).
const parseJson = (v) => { if (v == null) return null; if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };

// deps = { db, kv, secrets, gateway, identifyFn, audit, now }; req = { request, tenantId, consentId, consent,
// careContexts, hiTypes, purpose, dateRange }. `req.consent` is the fetch-time JWS-verified grant, carrying its
// IMMUTABLE signed scope (careContexts / permission.dateRange / purpose). Dependency-injected clock — no Date.now.
export async function requestHealthInformation(env, deps, req) {
  const { db, secrets, gateway, identifyFn, audit } = deps;
  const now = typeof deps.now === "function" ? deps.now() : deps.now;   // injected clock only (no Date.now)

  // (1a) Server-derived identity + membership — NEVER trust a body tenantId. A non-member throws PermissionError
  //      HERE, before any gateway call, key mint, or persistence.
  const actor = await resolveActor(identifyFn, req.request, env);
  const { tenant } = await resolveTenant(db, actor.id, req.tenantId);
  const tenantId = tenant.id;

  // (1b) R3 mode:live GATE — reload the ONE reconciled consent row FRESH from D1 by its durable join key
  //      (consent_id), then re-run the request-time checklist. The row is now AUTHORITATIVE for BOTH the
  //      revocation-sensitive status AND the full SIGNED scope (careContexts/hiTypes/purpose/dateRange/expiry)
  //      that verifyConsentArtifact persisted onto it — so a since-REVOKED/EXPIRED/narrowed consent is caught
  //      HERE off the DB, never trusted from a cached fetch-time artifact. req.consent is only a defensive
  //      fallback for a scope column not yet persisted (pre-reconciliation rows). A missing row => status null
  //      => fail-closed. // VERIFY: resolves by consent_id (the join the GRANT notify linked), not request_id.
  const fresh = await getConsentReqByConsentId(db, req.consentId);
  const bound = (req.consent && typeof req.consent === "object") ? req.consent : {};
  const consent = {
    id: (fresh && fresh.consent_id) || req.consentId,
    status: fresh ? fresh.status : null,                                          // FRESH — the revocation catch
    careContexts: (fresh && fresh.care_contexts != null) ? parseJson(fresh.care_contexts) : (bound.careContexts || []),
    hiTypes: (fresh && fresh.hi_types != null) ? parseHiTypes(fresh.hi_types) : (bound.hiTypes || []),
    purpose: (fresh && fresh.purpose != null) ? parseJson(fresh.purpose) : (bound.purpose ?? null),
    permission: { dateRange: (fresh && fresh.date_range != null) ? parseJson(fresh.date_range) : ((bound.permission && bound.permission.dateRange) || {}) },
    expiry: (fresh && fresh.expires_at != null) ? fresh.expires_at : (bound.expiry ?? null),
  };
  const gate = revalidateForRequest(consent, req, now);
  if (!gate.ok) throw new PermissionError("consent revalidation failed: " + gate.reason);   // fail-closed: no gateway, no txn

  // Our own correlation id for THIS data request; the txn row is keyed by it (R17).
  const requestId = globalThis.crypto.randomUUID();

  // (2) Mint ONE fresh ephemeral X25519 keypair FOR THIS transaction (ADR-2D) using ONLY existing fidelius
  //     exports (fidelius.js stays untouched). scalar = the storable private key (sealed below); publicKeyRaw +
  //     ourNonce = the outbound keyMaterial. A fresh mint per request => keys are NEVER reused.
  const scalar = randomBytes(32);
  const { publicKeyRaw } = await importRawPrivate(scalar);
  const ourNonce = nonce();

  // (3) Build + submit the hiRequest. keyMaterial carries only the PUBLIC half. Fail-closed: only a 202 persists.
  const body = buildHiRequestBody(HIREQUEST_FIELDS, {
    requestId, now, consentId: consent.id, dateRange: req.dateRange,
    dataPushUrl: env && env.CONNECT_ABDM_DATA_PUSH_URL,   // VERIFY: our on-push callback URL
    // keyValue is the 65-byte uncompressed point, NOT the bare 32-byte X25519 key: the HIP runs Fidelius,
    // which selects its decoder by base64 length (88 chars -> decodePoint, otherwise X509/SPKI). A 44-char
    // key is unparseable at the far end, so the HIP could never encrypt for us.
    keyMaterial: abdmKeyMaterial(publicKeyRaw, ourNonce, { now }),
  });
  const { status } = await gateway.post("hiRequest", body);
  if (status !== 202) throw new AbdmError("hiRequest not accepted: HTTP " + status);   // no txn row; minted key discarded

  // (4) 202 accepted → persist the txn with the private scalar SEALED (putTxn seals; plaintext never stored),
  //     keyed by the DATA-REQUEST requestId (R17); then advance CONSENT_GRANTED → REQUESTED. The txn (and its
  //     sealed key) expires no later than the consent, so the GC sweep retires the key at consent expiry.
  await putTxn(db, secrets, {
    requestId, tenantId, consentId: req.consentId,
    ephPrivKeyB64: b64(scalar), ephPubRaw: b64(publicKeyRaw), ourNonce: b64(ourNonce),
    status: "CONSENT_GRANTED", expiresAt: consent.expiry ?? null, now,
  });
  await advanceStatus(db, requestId, "CONSENT_GRANTED", "REQUESTED", now);

  // PHI-free audit (metadata only): consentId is a non-PHI artifact id (R16); COUNTS, not lists; no ABHA/careContextRef.
  if (audit) await audit({
    action: "data.requested", tenantId, actor: actor.id, consentId: req.consentId,
    resourceCounts: {
      hiTypes: Array.isArray(req.hiTypes) ? req.hiTypes.length : 0,
      careContexts: Array.isArray(req.careContexts) ? req.careContexts.length : 0,
    },
    scope: { requestId }, outcome: "ok", ts: now,
  });

  return { requestId, status: "REQUESTED" };
}

// ── Stage-4 Task-7: consumeTransfer — HIU RECEIVE + PER-ENTRY DECRYPT (R1) + EXACTLY-ONCE ACK (R8). ─────
// The read side of the async ABDM data flow. Once BOTH halves are present (the tryJoin precondition: our
// on-request has correlated the txn + sealed our ephemeral key, AND the encrypted push has buffered the
// Fidelius ciphertext), we unseal OUR ephemeral private scalar, derive the Fidelius shared secret against the
// HIP's keyMaterial, and decrypt EACH buffered entry STRICTLY PER-ENTRY (R1): every entry is opened +
// checksum-verified in ISOLATION, so one entry's GCM-auth/checksum failure fails THAT entry closed
// (contributing to PARTIAL/FAILED) and NEVER poisons its siblings — we NEVER batch/concatenate the ciphertexts.
// Exactly-once (R8): a single D1 CAS (claimAck) is the SOLE arbiter of who finalises; ONLY that winner
// advances the txn FSM to its terminal outcome + deletes the R2 buffer, THEN notifies the gateway (FAIL-SAFE
// ordering — a notify throw leaves buffer-gone + status-terminal + receipt-lost, recovered by a Stage-6 sweep
// re-notify, never a stranded buffer-full RECEIVING txn). A retry after the ack either loses the CAS or finds
// the buffer already gone → a pure no-op that returns NO plaintext: no second notify, no duplicate ack, no
// re-buffer, and a lost-CAS caller receives an EMPTY decrypted set (never re-decrypted PHI). The winner also
// SURFACES (never swallows) a stale advance via an `advanced` flag. The decrypted NDHM JSON is REQUEST-SCOPED
// ONLY — returned to the winner and NEVER persisted or logged.
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); // local; no new deps

// deps = { db, r2, secrets, gateway, now }. `hipKeyMaterial = { dhPublicKey, nonce }` (both base64) is the
// HIP's half of the Fidelius exchange for THIS transfer session; `sessionStatus` is passed through verbatim to
// the hiNotify receipt. Returns { decrypted:string[], acked:boolean }.
export async function consumeTransfer(env, deps, { transactionId, hipKeyMaterial, sessionStatus }) {
  // (1) Join precondition. A push that landed BEFORE on-request (no correlated txn yet), or a buffer already
  //     deleted by a prior winning ack, is NOT ready → a clean no-op that leaves the buffer exactly as-is.
  const { ready, entries, txn } = await tryJoin(deps.db, deps.r2, env, transactionId);
  if (!ready) return { decrypted: [], acked: false, advanced: false };

  // (2) Unseal OUR ephemeral private scalar and derive the Fidelius shared secret against the HIP pubkey.
  //     sharedSecret fails CLOSED on a low-order/bad HIP pubkey (FideliusError) BEFORE any entry is touched and
  //     BEFORE the ack CAS — so poisoned keyMaterial never yields a (mis)decrypt, an ack, a notify, or a delete.
  // LIVE PROTOCOL (reconciled with fidelius.js#sealBundle docstring): the exchange is ONE keyMaterial per transfer
  // PAGE — we derive ONE (secret, ourNonce, hipNonce) for this page and open EVERY buffered entry under it. A
  // well-behaved page carries EXACTLY ONE entry (per-page == per-entry); a HOSTILE multi-entry-under-one-keyMaterial
  // page is tolerated ONLY because step (3) checksum-verifies EACH entry post-decrypt (a reused-(key,iv) sibling
  // can never slip past that per-entry check).
  // VERIFY: confirm against the ABDM /health-information/transfer wire-shape (one keyMaterial per page, one entry per page)
  const scalarB64 = await unsealTxnKey(deps.secrets, txn);
  const { privateKey } = await importRawPrivate(unb64(scalarB64));
  // The HIP sends dhPublicKey as { expiry, parameters, keyValue }; readDhPublicKey unwraps it and still
  // accepts a bare base64 string from a peer that got the shape wrong.
  const secret = await sharedSecret(privateKey, unb64(readDhPublicKey(hipKeyMaterial.dhPublicKey)));
  const ourNonce = unb64(txn.our_nonce);
  const hipNonce = unb64(hipKeyMaterial.nonce);

  // (3) STRICT PER-ENTRY decrypt (R1). Each entry is opened + checksum-verified on its OWN; a FideliusError
  //     (GCM auth OR post-decrypt checksum mismatch) fails THAT one entry closed and is counted as a failure —
  //     it never poisons a sibling. Any NON-Fidelius error is a genuine bug and propagates (fail-closed).
  // `deps.openEntry` is a TEST-ONLY injection seam (defaults to the real import) so the non-Fidelius error
  // path is exercisable; production behaviour is identical (deps.openEntry is undefined in prod).
  const open = deps.openEntry || openEntry;
  const decrypted = [];
  let failures = 0;
  for (const entry of entries) {
    try {
      decrypted.push(await open(secret, ourNonce, hipNonce, entry.contentB64, entry.checksum));
    } catch (e) {
      if (!(e instanceof FideliusError)) throw e;   // a NON-Fidelius error is a genuine bug → propagate (fail-closed)
      failures++;
    }
  }
  const outcome = failures === 0 ? "TRANSFERRED" : decrypted.length > 0 ? "PARTIAL" : "FAILED";

  // (4) Exactly-once finalisation (R8). The D1 CAS is the SOLE arbiter — NO read-then-write. Only the caller
  //     that flips ack_claimed 0→1 finalises. A LOST CAS (already-claimed retry) returns a pure no-op with an
  //     EMPTY decrypted set — a non-winner must NEVER receive re-decrypted PHI (the plaintext it decrypted above
  //     is discarded here).
  const won = await claimAck(deps.db, transactionId, deps.now);
  if (!won) return { decrypted: [], acked: false, advanced: false };

  // STAGE-6 T3 (recoverable finalize): the INSTANT the ack is claimed — and BEFORE the hiNotify — persist the
  // computed `outcome` to session_status, so a crash/throw ANYWHERE in the tail below leaves a RECOVERABLE strand
  // (ack_claimed=1 + session_status set) that state.js#reconcileNotify re-drives idempotently. session_status is
  // the FSM outcome (TRANSFERRED|PARTIAL|FAILED), which is also what a re-issued receipt reports.
  await deps.db.prepare("UPDATE connect_abdm_txn SET session_status=?,updated_at=? WHERE transaction_id=?")
    .bind(outcome, deps.now, transactionId).run();

  // FAIL-SAFE ORDERING: advance the FSM to its terminal outcome and delete the R2 buffer BEFORE notifying, so a
  // gateway notify throw leaves a CONSISTENT end state (status terminal + buffer deleted + receipt-lost) instead
  // of a stranded buffer-full RECEIVING txn. Because session_status was persisted above, ANY throw in this tail is
  // recoverable by the Stage-6 reconcile pass (state.js#reconcileNotify) — it re-issues the receipt, deletes the
  // buffer, and terminalises the FSM idempotently. Still exactly-once: only the CAS winner ever reaches this block.
  // CARRY-FORWARD: advanceStatus is request_id-keyed but we hold only transactionId — use txn.request_id.
  const advance = await advanceStatus(deps.db, txn.request_id, "RECEIVING", outcome, deps.now);
  await deleteBuffered(deps.r2, transactionId);
  await deps.gateway.post("hiNotify", { transactionId, sessionStatus });

  // STAGE-6 T3 (receipt-delivery marker): the hiNotify RETURNED SUCCESSFULLY → stamp notify_confirmed so this txn
  // is never re-notified by a reconcile pass. A throw ABOVE (advance/delete/notify) skips this stamp, leaving
  // notify_confirmed NULL → the strand (ack_claimed=1 + session_status set + notify_confirmed NULL) is recovered by
  // state.js#reconcileNotify regardless of how far the tail got (incl. the common notify-throw: terminal+buffer-gone).
  await deps.db.prepare("UPDATE connect_abdm_txn SET notify_confirmed=?,updated_at=? WHERE transaction_id=?")
    .bind(deps.now, deps.now, transactionId).run();

  // SURFACE (never swallow) a stale advance: a winner whose advanceStatus is a {ok:false} no-op (the txn was
  // not in RECEIVING) is an anomaly — an acked-but-non-terminal txn — flagged to the caller via `advanced:false`.
  return { decrypted, acked: true, advanced: advance.ok === true };
}
