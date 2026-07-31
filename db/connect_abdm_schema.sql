-- db/connect_abdm_schema.sql — ABDM async state (additive; new tables only). No PHI (abha is HMAC'd).
CREATE TABLE IF NOT EXISTS connect_abdm_consent_req (
  request_id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, patient_abha_hash TEXT,   -- HMAC, not raw ABHA
  status TEXT, consent_id TEXT, hi_types TEXT, created_at TEXT, updated_at TEXT, expires_at TEXT );

CREATE TABLE IF NOT EXISTS connect_abdm_txn (
  request_id TEXT PRIMARY KEY,                 -- keyed by requestId (R17); transaction_id attached at on-request
  transaction_id TEXT, tenant_id TEXT, consent_id TEXT,
  eph_privkey_sealed TEXT,                      -- envelope-encrypted ephemeral X25519 private key (ADR-2D)
  eph_pub_raw TEXT, our_nonce TEXT,             -- our keyMaterial (public + nonce) — sent to the gateway
  ack_claimed INTEGER NOT NULL DEFAULT 0,       -- exactly-once ack flag (D1 CAS single-shot; Stage-3 Task-4)
  status TEXT, expires_at TEXT, created_at TEXT, updated_at TEXT );
CREATE INDEX IF NOT EXISTS idx_abdm_txn_txid ON connect_abdm_txn (transaction_id);

CREATE TABLE IF NOT EXISTS connect_abdm_carecontext (
  id TEXT PRIMARY KEY, tenant_id TEXT, patient_abha_hash TEXT, source TEXT,           -- followcare|icu|case (HIP)
  ref TEXT, hi_type TEXT, display TEXT, linked_at TEXT );
