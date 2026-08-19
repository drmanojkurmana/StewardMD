// functions/_connect/abdm/state.js — ABDM async correlation store (D1).
// Stage-3 Task-2: monotonic consent status (R6 anti-replay) + sealed ephemeral key (ADR-2D).
// Dependency-injected: caller passes `db` (D1), `secrets` ({seal,open}) and `now` (ISO string).
// No env/global/Date.now reads here. Mock-friendly SQL only: WHERE `col=?`, SET `col=?,...`.
// TIME CONTRACT (pinned): every timestamp column here (`created_at`/`updated_at`/`expires_at`) and every
// injected `now` is an ISO-8601 string — NEVER epoch-ms. `sweep` compares them ISO-aware (Date.parse),
// never `Number()` (which turns an ISO string into NaN and silently no-ops the expiry branch).
import { deleteCareContext } from "./consented-store.js";
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

// Enumerate ALL keys under a prefix across R2 `list` PAGES. Real Cloudflare R2 truncates a single `list` at
// 1000 keys and returns `{ truncated, cursor }`; a single un-looped call would leave everything past page 1
// undeleted — a §8 residual at scale. We COLLECT all keys first (pure reads, so the offset cursor stays stable)
// and let the caller mutate afterward — never delete DURING pagination (that would shift the offsets and skip keys).
async function listAllKeys(r2, prefix) {
  const keys = [];
  let cursor;
  do {
    const res = (await r2.list({ prefix, cursor })) || {};
    for (const o of (res.objects || [])) keys.push(o.key);
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return keys;
}

// List one txn's buffered entries as parsed JSON bodies (R2 list returns keys only, so re-get each).
export async function listBuffered(r2, txnId) {
  try {
    const out = [];
    for (const key of await listAllKeys(r2, txnPrefix(txnId))) {
      const obj = await r2.get(key);
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
    const keys = await listAllKeys(r2, txnPrefix(txnId));   // collect ALL pages first, THEN delete (stable cursor)
    for (const key of keys) await r2.delete(key);
    return keys.length;
  } catch (e) {
    if (e instanceof ConnectStateError) throw e;
    throw new ConnectStateError(`abdm buffer delete failed: ${e && e.message}`);
  }
}

// ---- Stage-6 Task-2 round-2: consent→buffer INDEX (the orphan-buffer close). ------------------------------------
// The push-buffer is keyed by transaction_id so consumeTransfer/deleteBuffered stay tid-only. But a REVOKE/erase
// only knows a consent's txns via `consent_id`, and in the out-of-order window a buffer's tid is not yet on any
// txn row (on-request has not attached it) → eraseTxn skips it → a PERMANENT orphan. This index is a CONSENT-scoped
// pointer (`abdm/bufidx/<consentId>/<txnId>`) written at buffer time, so eraseForConsent can ENUMERATE by consentId
// and delete the buffer regardless of the txn attach. It NEVER stamps the txn row (that would break the buffer-then-
// join deferral — tryJoin reads "transaction_id attached" as the on-request-happened signal). Non-PHI (consentId +
// tid only, R16). Fail-closed. The pointer is retired by eraseBufferIndex at the consent's REVOKE/dataEraseAt sweep.
const BUFIDX_PREFIX = "abdm/bufidx";
const bufidxPrefix = (consentId) => `${BUFIDX_PREFIX}/${consentId}/`;
export async function bufferIndexPut(r2, consentId, txnId) {
  if (consentId == null || txnId == null) throw new ConnectStateError("bufferIndexPut requires consentId and txnId");
  try {
    await r2.put(`${bufidxPrefix(consentId)}${txnId}`, "1");   // empty marker; the value is irrelevant (non-PHI key)
  } catch (e) {
    if (e instanceof ConnectStateError) throw e;
    throw new ConnectStateError(`abdm buffer-index write failed: ${e && e.message}`);
  }
}
// Erase every buffer this consent ever pointed at (via the index) + retire the index markers. Catches the
// out-of-order ORPHAN (tid never attached to a txn row). deleteBuffered is a no-op for an already-consumed/erased
// tid, so this is idempotent and safe to run alongside the per-txn erase. Returns buffer objects deleted.
async function eraseBufferIndex(r2, consentId) {
  if (consentId == null) return 0;
  try {
    const keys = await listAllKeys(r2, bufidxPrefix(consentId));   // ALL pages first (a consent may point at >1000 txns)
    let n = 0;
    for (const key of keys) {
      const txnId = key.slice(bufidxPrefix(consentId).length);   // exact: slice by the known consent prefix length
      if (txnId) n += await deleteBuffered(r2, txnId);
      await r2.delete(key);
    }
    return n;
  } catch (e) {
    if (e instanceof ConnectStateError) throw e;
    throw new ConnectStateError(`abdm buffer-index erase failed: ${e && e.message}`);
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

// Parse a consent row's persisted `care_contexts` (JSON array of careContextReference strings — or, defensively,
// objects {careContextReference|reference|id}) for the over-erase guard. Returns { refs, opaque }: `opaque` is
// true when scope is PRESENT but we cannot enumerate it (unparseable JSON / not an array / a non-empty array that
// yields no usable ref). FIX-C (round-3): a LIVE consent that is `opaque` must be treated as protecting its
// (unknown) refs — fail-safe toward RETENTION — so we never over-erase a care-context we cannot prove is unreferenced.
function parseCareContextRefs(careContextsJson) {
  if (careContextsJson == null) return { refs: [], opaque: false };   // absent → protects nothing
  let arr; try { arr = JSON.parse(careContextsJson); } catch { return { refs: [], opaque: true }; }
  if (!Array.isArray(arr)) return { refs: [], opaque: true };
  const refs = arr.map((c) => (c == null ? null : typeof c === "string" ? c : (c.careContextReference ?? c.reference ?? c.id ?? null)))
    .filter((x) => x != null);
  return { refs, opaque: arr.length > 0 && refs.length === 0 };       // non-empty array but no extractable ref → opaque
}

// Erase a patient's HIP care-context registrations, scoped by (tenant, patient HMAC). Called ONLY on a patient-
// level `data_erase_at` trigger — NEVER on a single-consent REVOKE. OVER-ERASE GUARD (round-2, MEDIUM): a
// registration may back OTHER live consents, so a careContextReference still referenced by a GRANTED consent whose
// OWN `data_erase_at` has NOT passed is KEPT; only refs with no remaining live consent are deleted. The consent
// being erased is past its own dataEraseAt (or terminal), so it is correctly excluded from "live" and its
// uniquely-backed refs ARE removed. Mock-safe (two-predicate SELECTs + single-id DELETEs). Returns rows removed.
async function eraseCareContexts(db, r2, env, tenantId, patientAbhaHash, now) {
  const { results: ccs = [] } = await db.prepare(
    "SELECT * FROM connect_abdm_carecontext WHERE tenant_id=? AND patient_abha_hash=?").bind(tenantId, patientAbhaHash).all();
  if (ccs.length === 0) return 0;
  const { results: consents = [] } = await db.prepare(
    "SELECT * FROM connect_abdm_consent_req WHERE tenant_id=? AND patient_abha_hash=?").bind(tenantId, patientAbhaHash).all();
  const nowMs = Date.parse(now);
  // A consent "still backs live data" iff it is GRANTED and its own dataEraseAt has not passed (a REVOKED/EXPIRED/
  // DENIED/INITIATED consent, or a GRANTED one past its dataEraseAt = being erased, does NOT keep a ref alive).
  const stillLive = (c) => {
    if (c.status !== "GRANTED") return false;
    const de = Date.parse(c.data_erase_at);
    return !(Number.isFinite(de) && Number.isFinite(nowMs) && de <= nowMs);
  };
  const liveRefs = new Set();
  for (const c of consents) {
    if (!stillLive(c)) continue;
    const { refs, opaque } = parseCareContextRefs(c.care_contexts);
    // FIX-C: a live consent whose scope we cannot enumerate protects EVERY care-context (we cannot prove any is
    // unreferenced by it) → retain ALL of this patient's care-contexts this sweep rather than risk data-loss.
    // // VERIFY (owner): confirm the consent.care_contexts ↔ carecontext.ref association (the base-carried pin).
    if (opaque) return 0;
    for (const ref of refs) liveRefs.add(ref);
  }
  let n = 0;
  for (const cc of ccs) {
    if (liveRefs.has(cc.ref)) continue;   // still referenced by another live consent → never collateral-erase it
    // The consented-store copy goes with the registration it backs. Erasing the registration alone would
    // leave a sealed blob for a care context nothing can reach any more - orphaned PHI, and a DPDP
    // erasure-completeness violation. Scoped to THIS ref, so a record still referenced by another live
    // consent (skipped above) is never collateral-erased. Best-effort: an unbound store must not abort a
    // sweep that is otherwise erasing correctly, and the D1 delete below is what makes the row unreachable.
    if (r2) { try { await deleteCareContext(env, { r2, db }, { tenantId, careContextRef: cc.ref }); } catch { /* index delete below still lands */ } }
    const del = await db.prepare("DELETE FROM connect_abdm_carecontext WHERE id=?").bind(cc.id).run();
    if (!del || del.success === false) throw new ConnectStateError("sweep care-context erase failed");
    n += (del.meta && del.meta.changes) || 0;
  }
  return n;
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
//     OTHER live consents). The RETAINED consent row (kept terminal for R6 anti-replay) has its raw SIGNED
//     scope (`care_contexts`/`hi_types`/`purpose`/`date_range`) NULLED so no patient-linkable careContextReference
//     lingers. Erasure-completeness is a DPDP breach surface: a single residual sealed key, buffer object, txn
//     row, retained raw scope, or servable care-context for that consent is a VIOLATION. The erasure ITSELF
//     is audited (`data.erased`, metadata-only, EXACTLY ONCE per consent even when PASS 1 pre-empted its txns)
//     and the PHI-free audit trail is RETAINED (never deleted)
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
  // T2 hard age-backstop: a non-terminal row with an unparseable `expires_at` can't be aged out by expiry, so
  // once it is at least SWEEP_MAX_TXN_AGE_MS old it is force-swept rather than leaking its sealed key indefinitely.
  // Age is anchored to `created_at`; but if THAT is ALSO garbled (Stage-6 T2-fix FIX-5a: BOTH `expires_at` AND
  // `created_at` unparseable) we fall back to `updated_at`, so a row whose creation stamp is corrupt STILL
  // eventually GCs. A row with NO parseable timestamp ANYWHERE (expires_at + created_at + updated_at all garbled)
  // is irredeemably corrupt and can never be aged, so it is force-swept on sight — never pinned as a permanent
  // anomaly leaking key material. A garbled/absent `now` never sweeps (fail-safe: never age off a bad clock).
  const ageAnchorMs = (row) =>
    Number.isFinite(Date.parse(row.created_at)) ? Date.parse(row.created_at)
      : Number.isFinite(Date.parse(row.updated_at)) ? Date.parse(row.updated_at) : NaN;
  const isAgedOut = (row, at) => {
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs)) return false;                 // no trustworthy clock → never age-sweep
    const anchor = ageAnchorMs(row);
    if (!Number.isFinite(anchor)) return true;                // no parseable timestamp anywhere → force-sweep (no leak)
    return (atMs - anchor) >= SWEEP_MAX_TXN_AGE_MS;
  };
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
    // FIX-4: the consent_ids whose txns PASS 1 pre-empts. Pass 1 emits no `data.erased` (it is pure txn-TTL GC),
    // so when it erases a REVOKED/dataEraseAt consent's already-terminal/expired txn, PASS 2 would otherwise find
    // nothing left and never audit that consent's erasure (a §8(6) accountability gap). This set lets PASS 2 still
    // emit exactly one `data.erased` for such a consent. Empty on a re-sweep (nothing left) → no duplicate audit.
    const pass1ErasedConsents = new Set();

    // ---- PASS 1: expiry/terminal GC + the garbled-expiry age-backstop. -------------------------------------
    for (const row of results) {
      const expired = isExpired(row.expires_at, now);
      if (!expired && !TERMINAL.has(row.status)) {
        // In-flight, non-terminal, not-yet-expired.
        if (Number.isFinite(Date.parse(row.expires_at))) continue;          // healthy future expiry → keep
        // Unparseable `expires_at`: surface it and RETAIN — unless it is past the hard age backstop, in
        // which case fall through to force-sweep (a garbled expiry must never linger PHI-adjacent forever).
        if (!isAgedOut(row, now)) { anomalies++; continue; }
      }
      buffersDeleted += await eraseTxn(row); keysErased++; txnsSwept++;
      if (row.consent_id != null) pass1ErasedConsents.add(String(row.consent_id)); // FIX-4: PASS 2 audits this consent
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
      //     FIX-5b tenant belt (defense-in-depth): scope the join by (consent_id, tenant_id), not consent_id
      //     alone. consent_id is globally unique so this changes nothing today, but it structurally stops a
      //     cross-tenant consent_id collision from reaching another tenant's txns. Applied only when tenant_id is
      //     present (a NULL bind would, via the mock's String() coercion, narrow to NULL-tenant rows); the belt is
      //     status-agnostic so REVOKE-overrides-FSM (erase regardless of the txn's own status) is unaffected.
      if (c.consent_id != null) {
        const txnQuery = c.tenant_id != null
          ? db.prepare("SELECT * FROM connect_abdm_txn WHERE consent_id=? AND tenant_id=?").bind(c.consent_id, c.tenant_id)
          : db.prepare("SELECT * FROM connect_abdm_txn WHERE consent_id=?").bind(c.consent_id);
        const { results: txns = [] } = await txnQuery.all();
        for (const t of txns) { cBuffers += await eraseTxn(t); cKeys++; cTxns++; }
        // FIX-1 round-2: sweep the consent-scoped buffer INDEX → delete any ORPHAN buffer whose transaction_id
        // never reached a txn row (out-of-order push erased before on-request attached it) + retire the pointers.
        // Idempotent with the per-txn erase above (deleteBuffered no-ops an already-deleted tid).
        cBuffers += await eraseBufferIndex(r2, c.consent_id);
      }
      // (2) Care-context rows are a PER-PATIENT registration that may back OTHER live consents, so they are
      //     erased ONLY on a patient-level `data_erase_at`/full-erase — NEVER on a single-consent REVOKE/EXPIRE.
      //     // VERIFY (owner): confirm the association (per-consent derived state vs per-patient registration).
      if (eraseDeadlinePassed && c.tenant_id != null && c.patient_abha_hash) {
        cCare += await eraseCareContexts(db, r2, env, c.tenant_id, c.patient_abha_hash, now);
      }
      // (3) FIX-3: scrub the raw SIGNED scope from the RETAINED consent row. The row is kept (marked terminal) for
      //     R6 anti-replay, but anti-replay needs ONLY {request_id, status, consent_id} + timestamps — it never
      //     reads the scope (updateConsentStatus/getConsentReqByConsentId key off status/consent_id). Leaving the
      //     raw `care_contexts` (a patient-linkable careContextReference list), `hi_types`, `purpose`, `date_range`
      //     on a REVOKED row is DPDP over-retention, so NULL them. `hadScope` is also the exactly-once erasure
      //     marker: true only on the FIRST pass that finds scope present, so a re-sweep (already-scrubbed) neither
      //     re-scrubs-with-effect nor re-audits. (A txn implies a prior GRANT, which persisted scope, so a
      //     pass-1-preempted consent still has scope here — pass 1 only touches the txn table, never these columns.)
      const hadScope = c.care_contexts != null || c.hi_types != null || c.purpose != null || c.date_range != null;
      if (hadScope) {
        const scrub = await db.prepare(
          "UPDATE connect_abdm_consent_req SET care_contexts=?,hi_types=?,purpose=?,date_range=?,updated_at=? WHERE request_id=?")
          .bind(null, null, null, null, now, c.request_id).run();
        if (!scrub || scrub.success === false) throw new ConnectStateError("sweep consent scope-scrub failed");
      }
      // (3b) LOW (round-2): a dataEraseAt-triggered erase must not leave a GRANTED-but-scrubbed row — terminalize it
      //      (GRANTED→EXPIRED via the monotonic guard) so the lifecycle reads honestly and a re-sweep is a clean
      //      no-op. REVOKED/EXPIRED/DENIED rows are already terminal, so this only fires on the dataEraseAt path.
      if (eraseDeadlinePassed && !revokedOrExpired && c.status !== "DENIED") {
        await updateConsentStatus(db, c.request_id, "EXPIRED", now);
      }
      // (4) Audit the erasure (metadata ONLY; §8(6) — the audit is RETAINED even as the data is erased). FIX-4:
      //     emit EXACTLY ONE `data.erased` per consent whenever ANYTHING was erased for it — direct txns (cTxns),
      //     care-contexts (cCare), the retained-scope scrub (hadScope), OR a txn that PASS 1 already pre-empted
      //     (pass1ErasedConsents). Idempotent: a re-sweep finds no txns, no care-contexts, already-scrubbed scope,
      //     and an empty pass1 set → NO duplicate. Pass 1 never audits, so this is the sole, non-double, audit.
      const pass1Pre = c.consent_id != null && pass1ErasedConsents.has(String(c.consent_id));
      if (cTxns > 0 || cBuffers > 0 || cCare > 0 || hadScope || pass1Pre) {
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

// ---- Stage-6 Task-3: reconcileNotify — recover a claimed-but-receipt-unconfirmed txn (a LOST hiNotify) ---------
// consumeTransfer (hiu.js) claims the ack via a single D1 CAS (claimAck) and, the INSTANT it wins, persists the
// computed `session_status` outcome durably — BEFORE the hiNotify — then runs the fail-safe tail (advance → delete
// → notify) and, ONLY after the notify returns, stamps `notify_confirmed`. So a crash/throw ANYWHERE after the
// claim leaves `notify_confirmed` NULL, and the strand is recoverable REGARDLESS of how far the tail got:
//   (a) crash before advance     → status RECEIVING, buffer intact, receipt unsent
//   (b) crash between advance/del → status terminal, buffer intact, receipt unsent
//   (c) notify throw / crash after delete → status terminal, buffer GONE, receipt unsent  (the COMMON case)
// A plain retry LOSES the CAS, so the receipt is never re-sent (until the Task-2 expiry GC erases it). reconcile
// makes ALL THREE recoverable by keying off the receipt-delivery marker (`notify_confirmed`), NOT the FSM status
// (a `status='RECEIVING'` filter would miss (b)/(c) — the common terminal-but-receipt-lost strands).
//   SELECT the strand: `ack_claimed=1 AND session_status IS NOT NULL AND notify_confirmed IS NULL` (mock-safe: the
//     mock D1 has no `IS NOT NULL`, so enumerate no-WHERE and filter in JS, exactly like `sweep`).
//   IDEMPOTENT tail, safe regardless of how far the original got: re-notify → deleteBuffered (no-op if already
//     gone) → advanceStatus RECEIVING→outcome (no-op if already terminal) → stamp `notify_confirmed`. A row whose
//     re-notify succeeds is stamped confirmed → a later pass does NOT select it. A never-claimed row
//     (ack_claimed=0) is NEVER reconciled — only the CAS winner ever persists a session_status, so an in-flight
//     transfer is never re-notified/terminalised out from under a live consume.
//   FAIL-CLOSED PER ROW (best-effort): a gateway/storage error on ONE row is caught + audited (metadata-only) and
//     does NOT abort the others; that row stays notify_confirmed-NULL → recovered on the NEXT pass. A duplicate
//     hiNotify across passes is tolerated (at-least-once recovery; the gateway hiNotify is keyed by transactionId)
//     — the receipt-loss it repairs is the worse failure. `deps = { gateway }`.
// Returns { reissued, terminalized }: hiNotify re-issued count, and rows advanced RECEIVING→terminal THIS pass
// (strand (a) only; (b)/(c) were already terminal so their advance is a no-op — reissued still counts them).
export async function reconcileNotify(db, r2, env, deps, now) {
  const audit = makeAuditSink(env, db);   // reuse the PHI-free sink — action strings + allow-listed ids/counts only
  const safeAudit = async (ev) => { try { await audit(ev); } catch { /* accountability write is best-effort; never abort reconcile */ } };
  let reissued = 0, terminalized = 0;
  try {
    // Mock-safe enumerate-then-filter (the mock D1 rejects `col IS NOT NULL`; a real GC would index the predicate).
    const { results = [] } = await db.prepare("SELECT * FROM connect_abdm_txn").all();
    for (const row of results) {
      // The lost-receipt strand: claimed (ack=1) + outcome durable (session_status set) + receipt NOT yet confirmed.
      if (row.ack_claimed !== 1 || row.session_status == null || row.notify_confirmed != null) continue;
      try {
        // Re-run the finalize tail idempotently. Notify FIRST (a notify failure leaves notify_confirmed NULL for the
        // next pass), then delete the (maybe-already-gone) buffer, then advance (maybe-already-terminal) → outcome,
        // then STAMP notify_confirmed so this row is never re-notified once its receipt lands.
        await deps.gateway.post("hiNotify", { transactionId: row.transaction_id, sessionStatus: row.session_status });
        reissued++;
        await deleteBuffered(r2, row.transaction_id);                                    // no-op if already deleted
        const advanced = await advanceStatus(db, row.request_id, "RECEIVING", row.session_status, now); // no-op if terminal
        if (advanced.ok === true) terminalized++;
        const stamp = await db.prepare("UPDATE connect_abdm_txn SET notify_confirmed=?,updated_at=? WHERE transaction_id=?")
          .bind(now, now, row.transaction_id).run();
        if (!stamp || stamp.success === false) throw new ConnectStateError("reconcile notify_confirmed stamp failed");
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
