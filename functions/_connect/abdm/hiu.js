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
import { putConsentReq, tryJoin, unsealTxnKey, claimAck, deleteBuffered, advanceStatus } from "./state.js";
import { importRawPrivate, sharedSecret, openEntry, FideliusError } from "./fidelius.js";
import { AbdmError } from "./gateway.js";

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

// ── Stage-4 Task-7: consumeTransfer — HIU RECEIVE + PER-ENTRY DECRYPT (R1) + EXACTLY-ONCE ACK (R8). ─────
// The read side of the async ABDM data flow. Once BOTH halves are present (the tryJoin precondition: our
// on-request has correlated the txn + sealed our ephemeral key, AND the encrypted push has buffered the
// Fidelius ciphertext), we unseal OUR ephemeral private scalar, derive the Fidelius shared secret against the
// HIP's keyMaterial, and decrypt EACH buffered entry STRICTLY PER-ENTRY (R1): every entry is opened +
// checksum-verified in ISOLATION, so one entry's GCM-auth/checksum failure fails THAT entry closed
// (contributing to PARTIAL/FAILED) and NEVER poisons its siblings — we NEVER batch/concatenate the ciphertexts.
// Exactly-once (R8): a single D1 CAS (claimAck) is the SOLE arbiter of who finalises; ONLY that winner
// notifies the gateway, deletes the R2 buffer (retiring the sealed key with the row on GC), and advances the
// txn FSM. A retry after the ack either loses the CAS or finds the buffer already gone → a pure no-op: no
// second notify, no duplicate ack, no re-buffer. The decrypted NDHM JSON is REQUEST-SCOPED ONLY — it is
// returned to the caller and NEVER persisted or logged.
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); // local; no new deps

// deps = { db, r2, secrets, gateway, now }. `hipKeyMaterial = { dhPublicKey, nonce }` (both base64) is the
// HIP's half of the Fidelius exchange for THIS transfer session; `sessionStatus` is passed through verbatim to
// the hiNotify receipt. Returns { decrypted:string[], acked:boolean }.
export async function consumeTransfer(env, deps, { transactionId, hipKeyMaterial, sessionStatus }) {
  // (1) Join precondition. A push that landed BEFORE on-request (no correlated txn yet), or a buffer already
  //     deleted by a prior winning ack, is NOT ready → a clean no-op that leaves the buffer exactly as-is.
  const { ready, entries, txn } = await tryJoin(deps.db, deps.r2, env, transactionId);
  if (!ready) return { decrypted: [], acked: false };

  // (2) Unseal OUR ephemeral private scalar and derive the Fidelius shared secret against the HIP pubkey.
  //     sharedSecret fails CLOSED on a low-order/bad HIP pubkey (FideliusError) BEFORE any entry is touched and
  //     BEFORE the ack CAS — so poisoned keyMaterial never yields a (mis)decrypt, an ack, a notify, or a delete.
  const scalarB64 = await unsealTxnKey(deps.secrets, txn);
  const { privateKey } = await importRawPrivate(unb64(scalarB64));
  const secret = await sharedSecret(privateKey, unb64(hipKeyMaterial.dhPublicKey));
  const ourNonce = unb64(txn.our_nonce);
  const hipNonce = unb64(hipKeyMaterial.nonce);

  // (3) STRICT PER-ENTRY decrypt (R1). Each entry is opened + checksum-verified on its OWN; a FideliusError
  //     (GCM auth OR post-decrypt checksum mismatch) fails THAT one entry closed and is counted as a failure —
  //     it never poisons a sibling. Any NON-Fidelius error is a genuine bug and propagates (fail-closed).
  const decrypted = [];
  let failures = 0;
  for (const entry of entries) {
    try {
      decrypted.push(await openEntry(secret, ourNonce, hipNonce, entry.contentB64, entry.checksum));
    } catch (e) {
      if (!(e instanceof FideliusError)) throw e;
      failures++;
    }
  }
  const outcome = failures === 0 ? "TRANSFERRED" : decrypted.length > 0 ? "PARTIAL" : "FAILED";

  // (4) Exactly-once finalisation (R8). The D1 CAS is the SOLE arbiter — NO read-then-write. Only the caller
  //     that flips ack_claimed 0→1 finalises. A lost CAS returns immediately as a pure no-op (no dup notify /
  //     delete / advance). CARRY-FORWARD: advanceStatus is request_id-keyed but we hold only transactionId —
  //     use txn.request_id from the join, NEVER the transactionId.
  const won = await claimAck(deps.db, transactionId, deps.now);
  if (!won) return { decrypted, acked: false };

  await deps.gateway.post("hiNotify", { transactionId, sessionStatus });
  await deleteBuffered(deps.r2, transactionId);
  await advanceStatus(deps.db, txn.request_id, "RECEIVING", outcome, deps.now);

  return { decrypted, acked: true };
}
