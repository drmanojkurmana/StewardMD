// functions/_connect/abdm/state.js — ABDM async correlation store (D1).
// Stage-3 Task-2: monotonic consent status (R6 anti-replay) + sealed ephemeral key (ADR-2D).
// Dependency-injected: caller passes `db` (D1), `secrets` ({seal,open}) and `now` (ISO string).
// No env/global/Date.now reads here. Mock-friendly SQL only: WHERE `col=?`, SET `col=?,...`.
import { hmacPseudonym } from "../audit.js"; // reuse the CONNECT_HMAC_SALT keyed-HMAC (patientRefHash) helper
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
