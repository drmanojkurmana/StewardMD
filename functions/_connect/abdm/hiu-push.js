// functions/_connect/abdm/hiu-push.js — the V3 HIU data-push receiver (merge follow-up, 2026-09-14).
//
// Under V3 the HIP POSTs the encrypted records straight to the dataPushUrl we named in our hiRequest. The
// branch wired every V3 callback except this one, and the product's only landing path hung off the V0.5
// JWS-body ingress. This is the V3 door, and it ends in the SAME place: buffer, advance the FSM, then the
// injected consumeAndLand (functions/_wardsynq/abdm-land.js#makeConsumeAndLand) decrypts and files.
//
// UNCONFIRMED, on both sides and never observed from the real sandbox:
//   - the body shape. // INFERRED from this repository's own HIP push (hip.js#pushPage) and the V0.5 transfer:
//     { transactionId, pageNumber, pageCount, entries: [{ content, media, checksum, careContextReference }],
//       keyMaterial: { cryptoAlg, curve, dhPublicKey: { expiry, parameters, keyValue }, nonce } }
//   - whether the push carries any gateway credential. It is authenticated here by CORRELATION and crypto only:
//     an unknown transactionId buffers nothing, and the ciphertext opens only under the ephemeral key we
//     minted and sealed for that transaction. A forged push for a real transaction fails the Fidelius GCM tag.
//
// deps = { db, r2, now, audit?, consumeAndLand? }. Returns { status, body }; never throws for a bad push.

import { getTxnByTransactionId, bufferEntry, bufferIndexPut, advanceStatus } from "./state.js";
import { getConsentReqByConsentId } from "./consent.js";

const TERMINAL_CONSENT = new Set(["REVOKED", "EXPIRED", "DENIED"]);   // mirrors ingress.js

export async function receiveDataPush(env, deps, body) {
  const b = (body && typeof body === "object") ? body : {};
  const transactionId = b.transactionId != null ? String(b.transactionId) : "";
  const entries = Array.isArray(b.entries) ? b.entries : [];
  if (!transactionId) return { status: 400, body: { error: "transaction_id_required" } };
  if (!entries.length) return { status: 400, body: { error: "entries_required" } };
  if (!b.keyMaterial || !b.keyMaterial.dhPublicKey || !b.keyMaterial.nonce) return { status: 400, body: { error: "key_material_required" } };

  // CORRELATE BEFORE BUFFER: a push for a transaction we never started touches no storage.
  const txn = await getTxnByTransactionId(deps.db, transactionId);
  if (!txn) return { status: 403, body: { error: "unknown_correlation" } };
  // Already finalised: a re-delivery is acknowledged and buffers nothing, so no orphan outlives the sweep.
  if (Number(txn.ack_claimed) === 1) return { status: 202, body: { ok: true, deduped: true } };
  if (txn.consent_id != null) {
    const cr = await getConsentReqByConsentId(deps.db, txn.consent_id);
    if (cr && TERMINAL_CONSENT.has(cr.status)) return { status: 403, body: { error: "consent_terminal" } };
  }

  const now = typeof deps.now === "function" ? deps.now() : deps.now;
  if (txn.consent_id != null) await bufferIndexPut(deps.r2, txn.consent_id, transactionId);   // erasure pointer first
  for (const e of entries) {
    await bufferEntry(deps.r2, env, transactionId, e && e.careContextReference, e && e.content, e && e.checksum, now);
  }
  await advanceStatus(deps.db, txn.request_id, "REQUESTED", "RECEIVING", now);

  // The ending. Guarded and non-fatal, as on the V0.5 ingress: the entries are buffered durably, so a landing
  // failure leaves a recoverable strand for the reconcile pass instead of a 5xx the HIP would re-send.
  if (deps.consumeAndLand) {
    try {
      await deps.consumeAndLand({
        transactionId, hipKeyMaterial: b.keyMaterial, tenantId: txn.tenant_id, consentId: txn.consent_id,
        onBehalfOf: null, sessionStatus: "TRANSFERRED",
      });
    } catch (e) {
      if (deps.audit) { try { await deps.audit({ action: "abdm.land.failed", tenantId: txn.tenant_id, outcome: "error", scope: { reason: String((e && e.name) || "error") } }); } catch { /* never fails the push */ } }
    }
  }
  return { status: 202, body: { ok: true } };
}
