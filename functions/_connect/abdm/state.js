// functions/_connect/abdm/state.js — ABDM async correlation store (D1).
// Stage-3 Task-2: monotonic consent status (R6 anti-replay) + sealed ephemeral key (ADR-2D).
// Dependency-injected: caller passes `db` (D1), `secrets` ({seal,open}) and `now` (ISO string).
// No env/global/Date.now reads here. Mock-friendly SQL only: WHERE `col=?`, SET `col=?,...`.
// TIME CONTRACT (pinned): every timestamp column here (`created_at`/`updated_at`/`expires_at`) and every
// injected `now` is an ISO-8601 string — NEVER epoch-ms. `sweep` compares them ISO-aware (Date.parse),
// never `Number()` (which turns an ISO string into NaN and silently no-ops the expiry branch).
import { hmacPseudonym, makeAuditSink } from "../audit.js"; // reuse the CONNECT_HMAC_SALT keyed-HMAC + PHI-free audit sink
export class ConnectStateError extends Error {}

// Consent lifecycle ranks; terminal statuses refuse any further change.
const RANK = { INITIATED: 0, GRANTED: 1, DENIED: 1, REVOKED: 2, EXPIRED: 2 };
const TERMINAL = new Set(["DENIED", "REVOKED", "EXPIRED"]);

async function insertRow(db, table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
  const res = await db.prepare(sql).bind(...keys.map((k) => row[k])).run();
  if (!res || res.success === false) throw new ConnectStateError(`insert into ${table} failed`);
  return row;
}

// hiTypes is a small list; persist as TEXT so the column stays a plain string.
const encodeHiTypes = (hi) => (hi == null ? null : typeof hi === "string" ? hi : JSON.stringify(hi));

export async function putConsentReq(db, { requestId, tenantId, actor, patientAbhaHash, hiTypes, expiresAt, now }) {
  return insertRow(db, "connect_abdm_consent_req", {
    request_id: requestId,
    tenant_id: tenantId ?? null,
    actor: actor ?? null,
    patient_abha_hash: patientAbhaHash ?? null, // HMAC, never a raw ABHA
    status: "INITIATED",
    consent_id: null,
    hi_types: encodeHiTypes(hiTypes),
    created_at: now,
    updated_at: now,
    expires_at: expiresAt ?? null,
  });
}

export async function getConsentReq(db, requestId) {
  return (await db.prepare("SELECT * FROM connect_abdm_consent_req WHERE request_id=?").bind(requestId).first()) || null;
}

// Monotonic (R6): once terminal, refuse any change; otherwise only equal-or-higher rank is allowed.
// A refused transition is a normal {ok:false} return (not a throw); the status stays unchanged.
export async function updateConsentStatus(db, requestId, newStatus, now) {
  const row = await getConsentReq(db, requestId);
  if (!row) throw new ConnectStateError(`consent request not found: ${requestId}`);
  const cur = row.status;
  const newRank = RANK[newStatus];
  if (newRank == null) throw new ConnectStateError(`unknown consent status: ${newStatus}`);
  if (TERMINAL.has(cur)) return { ok: false, status: cur };
  if (newRank < RANK[cur]) return { ok: false, status: cur };
  const res = await db.prepare("UPDATE connect_abdm_consent_req SET status=?,updated_at=? WHERE request_id=?")
    .bind(newStatus, now, requestId).run();
  if (!res || res.success === false) throw new ConnectStateError("consent status update failed");
  return { ok: true, status: newStatus };
}

// Seal FIRST (fail-closed: if seal throws, propagate and persist nothing); never store the plaintext key.
export async function putTxn(db, secrets, { requestId, tenantId, consentId, ephPrivKeyB64, ephPubRaw, ourNonce, status, expiresAt, now }) {
  const sealed = await secrets.seal(ephPrivKeyB64);
  return insertRow(db, "connect_abdm_txn", {
    request_id: requestId,
    transaction_id: null, // attached later at on-request (R17)
    tenant_id: tenantId ?? null,
    consent_id: consentId ?? null,
    eph_privkey_sealed: sealed,
    eph_pub_raw: ephPubRaw ?? null,
    our_nonce: ourNonce ?? null,
    ack_claimed: 0,               // exactly-once ack flag; write 0 EXPLICITLY so mock rows and real-D1 rows
                                  // behave identically under `ack_claimed<>?` (0<>1 matches in both; NULL<>1
                                  // is NULL/no-match in real D1 — never rely on the DEFAULT to paper over it).
    status: status ?? null,
    expires_at: expiresAt ?? null,
    created_at: now,
    updated_at: now,
  });
}

export async function getTxnByRequestId(db, requestId) {
  return (await db.prepare("SELECT * FROM connect_abdm_txn WHERE request_id=?").bind(requestId).first()) || null;
}

export async function getTxnByTransactionId(db, transactionId) {
  return (await db.prepare("SELECT * FROM connect_abdm_txn WHERE transaction_id=?").bind(transactionId).first()) || null;
}

export async function attachTransactionId(db, requestId, transactionId, now) {
  // Uniqueness guard: a transaction_id must map to exactly one request row. The authoritative backstop is
  // the PARTIAL UNIQUE index in the schema (real D1); this app-layer read-then-write gives a CLEAN reject.
  // Safe to read-then-write here because this is the once-per-on-request SETUP path, NOT the exactly-once
  // ack path — a lost race here just surfaces as the same {ok:false} the UNIQUE index would force anyway.
  const existing = await getTxnByTransactionId(db, transactionId);
  if (existing && existing.request_id !== requestId) return { ok: false, reason: "dup-txn" };
  const res = await db.prepare("UPDATE connect_abdm_txn SET transaction_id=?,updated_at=? WHERE request_id=?")
    .bind(transactionId, now, requestId).run();
  if (!res || res.success === false) throw new ConnectStateError("attach transaction_id failed");
  return { ok: (res.meta?.changes || 0) > 0 };
}

export async function unsealTxnKey(secrets, txnRow) {
  return secrets.open(txnRow.eph_privkey_sealed);
}

// ---- Stage-3 Task-3: R2 encrypted push-buffer (Fidelius ciphertext at rest; R14) ----------------
// Temporary hold for ABDM-pushed, ALREADY-ENCRYPTED payloads that land before we can join+decrypt
// (buffer-then-join is Task 5; decrypt is Stage 4). Stores Fidelius ciphertext (contentB64) as-is —
// never plaintext PHI, never a raw careContextReference, and adds no second encryption layer.
// Dependency-injected r2/env/now; fail-closed (ConnectStateError) on a genuine R2 error.
const BUFFER_PREFIX = "abdm/buffer";
const txnPrefix = (txnId) => `${BUFFER_PREFIX}/${txnId}/`;

// R14: HMAC the careContextReference so the RAW value never lands in a key, a body, or a log.
// Reuse the existing keyed HMAC (CONNECT_HMAC_SALT); domain-separate from patient pseudonyms.
async function hmacCareContext(env, careContextRef) {
  return hmacPseudonym(env, "abdm/carecontext", String(careContextRef));
}

// Buffer one encrypted entry. Deterministic key `${prefix}/${txnId}/${HMAC(ref)}:${checksum}` means a
// repeat of the same (txnId, careContextRef, checksum) overwrites the same object — idempotent dedupe.
export async function bufferEntry(r2, env, txnId, careContextRef, contentB64, checksum, now) {
  if (!txnId || careContextRef == null || checksum == null) {
    throw new ConnectStateError("bufferEntry requires txnId, careContextRef and checksum");
  }
  const ref = await hmacCareContext(env, careContextRef);        // hex HMAC; the raw ref is never surfaced
  const key = `${txnPrefix(txnId)}${ref}:${checksum}`;
  const body = JSON.stringify({ careContextHash: ref, checksum, contentB64, createdAt: now });
  try {
    const existing = await r2.get(key);                          // deduped ⇔ this key was already buffered
    await r2.put(key, body);
    return { key, deduped: !!existing };
  } catch (e) {
    if (e instanceof ConnectStateError) throw e;
    throw new ConnectStateError(`abdm buffer write failed: ${e && e.message}`);
  }
}

// List one txn's buffered entries as parsed JSON bodies (R2 list returns keys only, so re-get each).
export async function listBuffered(r2, txnId) {
  try {
    const { objects = [] } = (await r2.list({ prefix: txnPrefix(txnId) })) || {};
    const out = [];
    for (const o of objects) {
      const obj = await r2.get(o.key);
      if (obj) out.push(JSON.parse(await obj.text()));
    }
    return out;
  } catch (e) {
    if (e instanceof ConnectStateError) throw e;
    throw new ConnectStateError(`abdm buffer list failed: ${e && e.message}`);
  }
}

// Delete every buffered object under one txn prefix (scoped — never touches another txn). Returns count.
export async function deleteBuffered(r2, txnId) {
  try {
    const { objects = [] } = (await r2.list({ prefix: txnPrefix(txnId) })) || {};
    let n = 0;
    for (const o of objects) { await r2.delete(o.key); n++; }
    return n;
  } catch (e) {
    if (e instanceof ConnectStateError) throw e;
    throw new ConnectStateError(`abdm buffer delete failed: ${e && e.message}`);
  }
}

// ---- Stage-3 Task-4: transaction FSM + exactly-once D1 CAS ack-claim (the correctness spine) --------
// The txn `status` column is a monotonic state machine; `ack_claimed` is a single-shot exactly-once flag.
// BOTH mutations are ONE guarded conditional-UPDATE (compare-and-set): meta.changes===1 means THIS caller
// won the row (its WHERE guard matched exactly the expected pre-state); ===0 means it lost (someone else
// already moved it / claimed it). NEVER read-then-write — a getTxn-then-UPDATE is a TOCTOU race that would
// let two concurrent callbacks both "win", defeating exactly-once. The CAS is the SOLE arbiter. No cache.

// Legal directed FSM edges; terminal states carry an EMPTY successor set, so no exit from them is legal.
// PROTOTYPE-LESS map: a raw `TXN_NEXT[from]` for from ∈ {"constructor","__proto__","toString","valueOf",
// "hasOwnProperty",…} must NOT resolve to an inherited Object.prototype member (truthy → `.indexOf` throws
// a raw TypeError instead of returning "illegal"). With a null prototype those keys are simply absent, so a
// hostile/unknown `from` cleanly falls through to the illegal branch (Array.isArray below is a second belt).
const TXN_NEXT = Object.assign(Object.create(null), {
  INITIATED: ["CONSENT_GRANTED", "FAILED"],
  CONSENT_GRANTED: ["REQUESTED", "FAILED"],
  REQUESTED: ["RECEIVING", "FAILED"],
  RECEIVING: ["TRANSFERRED", "PARTIAL", "FAILED"],
  TRANSFERRED: [],
  PARTIAL: [],
  FAILED: [],
});

// Optimistic-concurrency FSM step. An illegal edge (unknown `from`, or `to` not in TXN_NEXT[from], which
// includes any exit from a terminal) is refused in JS BEFORE any D1 access → {ok:false,reason:"illegal"}.
// A legal edge becomes a single CAS guarded on the expected current status; a lost race (the row was not
// `from` — advanced by someone else, or never was `from`) is a normal {ok:false,reason:"stale"} return.
export async function advanceStatus(db, requestId, from, to, now) {
  const allowed = TXN_NEXT[from];
  if (!Array.isArray(allowed) || allowed.indexOf(to) === -1) return { ok: false, reason: "illegal" };
  const res = await db
    .prepare("UPDATE connect_abdm_txn SET status=?,updated_at=? WHERE request_id=? AND status=?")
    .bind(to, now, requestId, from)
    .run();
  if (!res || res.success === false) throw new ConnectStateError("advanceStatus update failed");
  return res.meta && res.meta.changes === 1 ? { ok: true, status: to } : { ok: false, reason: "stale" };
}

// Exactly-once ack claim. ONE conditional-UPDATE flips ack_claimed 0→1 guarded on ack_claimed<>1, so only
// the FIRST caller matches a row (meta.changes===1 → true); every later/concurrent caller finds the row
// already ==1, matches nothing (changes===0 → false). Returns a plain boolean; throws ConnectStateError
// only on a genuine storage failure. A lost claim is a normal `false`, NOT a throw.
export async function claimAck(db, transactionId, now) {
  const res = await db
    .prepare("UPDATE connect_abdm_txn SET ack_claimed=?,updated_at=? WHERE transaction_id=? AND ack_claimed<>?")
    .bind(1, now, transactionId, 1)
    .run();
  if (!res || res.success === false) throw new ConnectStateError("claimAck update failed");
  return !!(res.meta && res.meta.changes === 1);
}

// ---- Stage-3 Task-5: buffer-then-join — the read-side join precondition resolver -------------------
// In the async ABDM flow the encrypted PUSH (Fidelius ciphertext, keyed by transaction_id) can land
// BEFORE the ON-REQUEST callback that attaches our correlation half (the transaction_id link + the sealed
// ephemeral key). tryJoin decides whether BOTH halves are present so Stage 4 can safely unseal+decrypt.
// It is a STRICT AND and a PURE READ: never decrypts (Stage 4 owns that), never mutates/deletes the buffer
// or the txn row, and is idempotent — the buffer is left intact for the caller every time.
//   ready ⇔ (txn found via transaction_id  AND  txn.eph_privkey_sealed non-empty)  AND  (>=1 buffered entry)
// A false `ready` would make Stage 4 unseal+decrypt garbage; a permanent false not-ready would strand a
// transfer — so the predicate is this AND, NEVER an OR. A not-yet-joinable state is a NORMAL {ready:false}
// return (never a throw); only a genuine storage failure throws ConnectStateError (fail-closed — a partial
// read must never be presented as a join). `env` is part of the injected-deps signature (Stage-4 symmetry);
// the read path derives everything it needs from db/r2/transactionId.
export async function tryJoin(db, r2, env, transactionId) {
  try {
    const txn = await getTxnByTransactionId(db, transactionId);
    // Half 1a — no correlated txn row yet ⇒ push-before-on-request. Retain the buffer for a later join.
    if (!txn) return { ready: false, entries: [], txn: null, reason: "no-txn" };
    // Half 1b — defensive: a txn row with no sealed key can't be unsealed; never declare ready.
    if (!txn.eph_privkey_sealed) return { ready: false, entries: [], txn, reason: "no-key" };
    // Half 2 — nothing pushed yet ⇒ on-request done, awaiting the encrypted push. Not ready.
    const entries = await listBuffered(r2, transactionId);
    if (entries.length === 0) return { ready: false, entries: [], txn, reason: "no-buffer" };
    // BOTH halves present — ready. No mutation, no decrypt: Stage 4 consumes entries, unseals, decrypts, deletes.
    return { ready: true, entries, txn, reason: "ready" };
  } catch (e) {
    if (e instanceof ConnectStateError) throw e; // listBuffered already fail-closes R2 errors
    throw new ConnectStateError(`abdm tryJoin failed: ${e && e.message}`);
  }
}

// Hard backstop age for a NON-terminal txn whose `expires_at` is unparseable (so it can't be aged out by
// expiry). Once `created_at + this <= now`, the row is force-swept rather than leaking its sealed eph key
// forever. // VERIFY (owner): pin the backstop — a legitimate ABDM transfer completes in minutes-to-hours,
// never days, so 7d is a safe "definitely-abandoned" bound that never erases an in-flight transfer.
const SWEEP_MAX_TXN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Erase a patient's HIP care-context registrations, scoped by (tenant, patient HMAC). Mock-safe WHERE (two
// `col=?` predicates). Returns the number of rows removed. Called ONLY on a patient-level `data_erase_at`/
// full-erase trigger — NEVER on a single-consent REVOKE (a registration may back OTHER live consents).
async function eraseCareContexts(db, tenantId, patientAbhaHash) {
  const del = await db.prepare("DELETE FROM connect_abdm_carecontext WHERE tenant_id=? AND patient_abha_hash=?")
    .bind(tenantId, patientAbhaHash).run();
  if (!del || del.success === false) throw new ConnectStateError("sweep care-context erase failed");
  return (del.meta && del.meta.changes) || 0;
}

// ---- Stage-3 Task-6 + Stage-6 Task-2: reconciliation GC sweep — bound key/buffer lifetime + DPDP erasure --
// The cron-driven (Stage 6) garbage collector, in TWO passes over the injected db/r2/env/now (no Date.now/
// global reads). `expires_at`/`data_erase_at`/`now` are ALL ISO-8601 strings (module TIME CONTRACT); expiry
// is detected ISO-aware, NEVER via `Number(iso)`→NaN (the Stage-3 no-op bug that kept expired keys past TTL).
//   PASS 1 (Stage-3 T6, ISO-pinned T1) — expiry/terminal GC of `connect_abdm_txn`: for EVERY txn past its
//     `expires_at` OR in a terminal status (TRANSFERRED/PARTIAL/FAILED — not just the happy path) erase the
//     sealed eph key, delete the R2 push-buffer, remove the row. A NON-terminal row with an unparseable
//     `expires_at` is a data-integrity anomaly: it is SURFACED in `anomalies` and RETAINED — UNLESS it is
//     older than the SWEEP_MAX_TXN_AGE_MS hard backstop (T2), in which case it is force-swept so a garbled
//     expiry can never linger PHI-adjacent key material forever.
//   PASS 2 (Stage-6 T2, DPDP R15 / §8(6)) — REVOKE + dataEraseAt erasure of `connect_abdm_consent_req`: a
//     consent that is REVOKED/EXPIRED, or one past its patient-level `data_erase_at`, has ALL its derived
//     state erased NOW (not left until the txn TTL) — its txns' buffers + sealed keys + rows (joined by the
//     durable `consent_id`), and — ONLY on a patient-level `data_erase_at`/full-erase — the patient's
//     `connect_abdm_carecontext` rows (a single-consent REVOKE never drops a registration that may back
//     OTHER live consents). Erasure-completeness is a DPDP breach surface: a single residual sealed key,
//     buffer object, txn row, or servable care-context for that consent is a VIOLATION. The erasure ITSELF
//     is audited (`data.erased`, metadata-only) and the PHI-free audit trail is RETAINED (never deleted)
//     under DPDP §8(6). Erase-first-then-audit: erasure-completeness outranks the accountability write.
// Fail-closed (ConnectStateError) on any storage failure. Idempotent: a re-sweep erases nothing more and
// emits NO duplicate `data.erased`. Mock-safe SQL throughout (`col=?`/`col<>?`; JS-filter the rest).
export async function sweep(db, r2, env, now) {
  // Txn terminal set — inlined here (small stable domain constant), NOT imported from the Task-4 FSM, to
  // avoid coupling the GC to that module's internals. Distinct from the module-scope consent `TERMINAL`.
  const TERMINAL = new Set(["TRANSFERRED", "PARTIAL", "FAILED"]);
  // ISO-aware expiry: parse BOTH sides; a well-typed ISO `expiresAt` at-or-before `now` ⇒ expired. `<=` so
  // an expiry exactly at `now` counts. A missing/unparseable timestamp yields NaN → NEVER coerced to a bogus
  // number, so the branch can't silently no-op the way `Number("2026-…") < Number(now)` (NaN<NaN=false) did.
  const isExpired = (expiresAt, at) =>
    Number.isFinite(Date.parse(expiresAt)) && Number.isFinite(Date.parse(at)) && Date.parse(expiresAt) <= Date.parse(at);
  // T2 hard age-backstop: a non-terminal row with an unparseable `expires_at` can't be aged out by expiry,
  // so once it is at least SWEEP_MAX_TXN_AGE_MS old (by `created_at`) it is force-swept rather than leaking
  // its sealed key indefinitely. Needs a PARSEABLE `created_at`; both garbled → stays surfaced in anomalies.
  const isAgedOut = (createdAt, at) =>
    Number.isFinite(Date.parse(createdAt)) && Number.isFinite(Date.parse(at)) &&
    (Date.parse(at) - Date.parse(createdAt)) >= SWEEP_MAX_TXN_AGE_MS;
  // Erase ONE txn's derived state, in the safe order: R2 buffer (scoped to its transaction_id) → sealed eph
  // key set to "" → the row. Key erased BEFORE the row delete so it can NEVER be unsealed even if a delete
  // races/fails. All WHERE = `request_id=?` (mock-safe). Returns the buffer count. Reused by BOTH passes.
  const eraseTxn = async (row) => {
    let buffersDeleted = 0;
    if (row.transaction_id) buffersDeleted += await deleteBuffered(r2, row.transaction_id);
    const upd = await db.prepare("UPDATE connect_abdm_txn SET eph_privkey_sealed=?,updated_at=? WHERE request_id=?")
      .bind("", now, row.request_id).run();
    if (!upd || upd.success === false) throw new ConnectStateError("sweep key-erase failed");
    const del = await db.prepare("DELETE FROM connect_abdm_txn WHERE request_id=?").bind(row.request_id).run();
    if (!del || del.success === false) throw new ConnectStateError("sweep row-delete failed");
    return buffersDeleted;
  };
  try {
    // VERIFY: a real D1 GC would enumerate victims with an indexed `WHERE expires_at < ?`; the mock D1
    // only supports `col=?`/`col<>?` (throws on `<`), so enumerate all rows no-WHERE and filter in JS.
    const { results = [] } = await db.prepare("SELECT * FROM connect_abdm_txn").all();
    let txnsSwept = 0, buffersDeleted = 0, keysErased = 0, anomalies = 0, careContextsErased = 0, consentsErased = 0;

    // ---- PASS 1: expiry/terminal GC + the garbled-expiry age-backstop. -------------------------------------
    for (const row of results) {
      const expired = isExpired(row.expires_at, now);
      if (!expired && !TERMINAL.has(row.status)) {
        // In-flight, non-terminal, not-yet-expired.
        if (Number.isFinite(Date.parse(row.expires_at))) continue;          // healthy future expiry → keep
        // Unparseable `expires_at`: surface it and RETAIN — unless it is past the hard age backstop, in
        // which case fall through to force-sweep (a garbled expiry must never linger PHI-adjacent forever).
        if (!isAgedOut(row.created_at, now)) { anomalies++; continue; }
      }
      buffersDeleted += await eraseTxn(row); keysErased++; txnsSwept++;
    }

    // ---- PASS 2: REVOKE + dataEraseAt-driven erasure (DPDP R15). --------------------------------------------
    // Reuse the PHI-free audit sink — `buildAuditEvent` structurally drops anything outside the ALLOW list, so
    // only ids/counts can reach the INSERT (no raw ABHA / careContextReference / decrypted content).
    const auditErasure = makeAuditSink(env, db);
    const { results: consents = [] } = await db.prepare("SELECT * FROM connect_abdm_consent_req").all();
    for (const c of consents) {
      const revokedOrExpired = c.status === "REVOKED" || c.status === "EXPIRED";
      const eraseDeadlinePassed = isExpired(c.data_erase_at, now); // patient-level dataEraseAt (distinct from expiry)
      if (!revokedOrExpired && !eraseDeadlinePassed) continue;

      let cTxns = 0, cBuffers = 0, cKeys = 0, cCare = 0;
      // (1) Derived state, scoped by the durable `consent_id` join — REVOKE overrides the FSM/TTL (erase NOW).
      //     GUARD `consent_id != null`: a NULL bind would (in the mock, via String() coercion) collateral-match
      //     EVERY NULL-consent_id txn — a mass over-erase. An unlinked consent was never granted → has no txns.
      if (c.consent_id != null) {
        const { results: txns = [] } = await db.prepare("SELECT * FROM connect_abdm_txn WHERE consent_id=?").bind(c.consent_id).all();
        for (const t of txns) { cBuffers += await eraseTxn(t); cKeys++; cTxns++; }
      }
      // (2) Care-context rows are a PER-PATIENT registration that may back OTHER live consents, so they are
      //     erased ONLY on a patient-level `data_erase_at`/full-erase — NEVER on a single-consent REVOKE/EXPIRE.
      //     // VERIFY (owner): confirm the association (per-consent derived state vs per-patient registration).
      if (eraseDeadlinePassed && c.tenant_id != null && c.patient_abha_hash) {
        cCare += await eraseCareContexts(db, c.tenant_id, c.patient_abha_hash);
      }
      // (3) Audit the erasure (metadata ONLY; §8(6) — the audit is RETAINED even as the data is erased). Emit
      //     ONLY when something was actually erased → idempotent (a re-sweep finds nothing → no duplicate).
      if (cTxns > 0 || cCare > 0) {
        txnsSwept += cTxns; buffersDeleted += cBuffers; keysErased += cKeys; careContextsErased += cCare; consentsErased++;
        await auditErasure({
          action: "data.erased", outcome: "ok", ts: now, tenantId: c.tenant_id ?? null,
          consentId: c.consent_id ?? null, resourceCounts: { txns: cTxns, buffers: cBuffers, keys: cKeys, careContexts: cCare },
        });
      }
    }
    return { txnsSwept, buffersDeleted, keysErased, anomalies, careContextsErased, consentsErased };
  } catch (e) {
    if (e instanceof ConnectStateError) throw e; // deleteBuffered already fail-closes R2 errors
    throw new ConnectStateError(`abdm sweep failed: ${e && e.message}`);
  }
}

// ---- Stage-6 Task-3: reconcileNotify — recover a claimed-but-non-terminal txn (a LOST hiNotify receipt) --------
// consumeTransfer (hiu.js) claims the ack via a single D1 CAS (claimAck) and, the INSTANT it wins, persists the
// computed `session_status` outcome durably — BEFORE the hiNotify. A crash/throw ANYWHERE in the finalize tail
// after that persist can strand the txn: ack_claimed=1, status STILL 'RECEIVING', session_status set, buffer
// intact — and a plain retry LOSES the CAS, so the receipt is never re-sent and the txn never terminalises (until
// the Task-2 expiry GC erases it). reconcileNotify makes that recoverable: it enumerates the stranded rows and
// IDEMPOTENTLY re-runs the SAME tail — re-notify → delete buffer → advance RECEIVING→outcome.
//   SELECT the strand: `ack_claimed=1 AND status='RECEIVING' AND session_status IS NOT NULL` (mock-safe: the mock
//     D1 has no `IS NOT NULL`, so enumerate no-WHERE and filter in JS, exactly like `sweep`).
//   IDEMPOTENT: a re-run after a prior success finds the row already terminal (status ≠ 'RECEIVING') → not
//     selected → skipped; the buffer delete + FSM advance are themselves no-ops once done. A never-claimed row
//     (ack_claimed=0) is NEVER reconciled — only the CAS winner ever persisted a session_status, so an in-flight
//     RECEIVING transfer is never re-notified/terminalised out from under a live consume.
//   FAIL-CLOSED PER ROW (best-effort): a gateway/storage error on ONE row is caught + audited (metadata-only) and
//     does NOT abort the others; that row is left RECEIVING + buffer-intact → recovered on the NEXT pass. A
//     duplicate hiNotify across passes is tolerated (at-least-once recovery; the gateway hiNotify is keyed by
//     transactionId) — the receipt-loss it repairs is the worse failure. `deps = { gateway }`.
// Returns { reissued, terminalized }: hiNotify re-issued count, and rows advanced RECEIVING→terminal.
export async function reconcileNotify(db, r2, env, deps, now) {
  const audit = makeAuditSink(env, db);   // reuse the PHI-free sink — action strings + allow-listed ids/counts only
  const safeAudit = async (ev) => { try { await audit(ev); } catch { /* accountability write is best-effort; never abort reconcile */ } };
  let reissued = 0, terminalized = 0;
  try {
    // Mock-safe enumerate-then-filter (the mock D1 rejects `col IS NOT NULL`; a real GC would index the predicate).
    const { results = [] } = await db.prepare("SELECT * FROM connect_abdm_txn").all();
    for (const row of results) {
      // The lost-receipt strand ONLY: claimed (ack=1), not yet terminal (still RECEIVING), outcome durable.
      if (row.ack_claimed !== 1 || row.status !== "RECEIVING" || row.session_status == null) continue;
      try {
        // Re-run the finalize tail idempotently. Notify FIRST (so a notify failure leaves the row still RECEIVING
        // + buffer-intact for the next pass), then delete the buffer, then advance RECEIVING → the persisted outcome.
        await deps.gateway.post("hiNotify", { transactionId: row.transaction_id, sessionStatus: row.session_status });
        reissued++;
        await deleteBuffered(r2, row.transaction_id);
        const advanced = await advanceStatus(db, row.request_id, "RECEIVING", row.session_status, now);
        if (advanced.ok === true) terminalized++;
        await safeAudit({
          action: "data.reconciled", outcome: "ok", ts: now, tenantId: row.tenant_id ?? null,
          consentId: row.consent_id ?? null, transactionId: row.transaction_id ?? null,
          resourceCounts: { reissued: 1, terminalized: advanced.ok === true ? 1 : 0 },
        });
      } catch (e) {
        // Fail-closed per row: audit the failure metadata-only and continue; one bad row never aborts the pass.
        await safeAudit({
          action: "data.reconciled", outcome: "error", ts: now, tenantId: row.tenant_id ?? null,
          consentId: row.consent_id ?? null, transactionId: row.transaction_id ?? null,
          resourceCounts: { reissued: 0, terminalized: 0 },
        });
      }
    }
    return { reissued, terminalized };
  } catch (e) {
    if (e instanceof ConnectStateError) throw e; // deleteBuffered/advanceStatus already fail-close their storage errors
    throw new ConnectStateError(`abdm reconcileNotify failed: ${e && e.message}`);
  }
}
