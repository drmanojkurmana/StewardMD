// functions/_connect/abdm/state.js — ABDM async correlation store (D1).
// Stage-3 Task-2: monotonic consent status (R6 anti-replay) + sealed ephemeral key (ADR-2D).
// Dependency-injected: caller passes `db` (D1), `secrets` ({seal,open}) and `now` (ISO string).
// No env/global/Date.now reads here. Mock-friendly SQL only: WHERE `col=?`, SET `col=?,...`.
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
