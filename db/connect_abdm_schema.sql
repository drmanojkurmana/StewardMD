-- db/connect_abdm_schema.sql — ABDM async state (additive; new tables only). No PHI (abha is HMAC'd).
-- The consent lifecycle is ONE row per request_id (our internal correlation id from requestConsent). The GRANT
-- consent-notify LINKS `consent_id` onto that row (the durable join), and verifyConsentArtifact UPDATEs the SAME
-- row with the full SIGNED scope (care_contexts/hi_types/purpose/date_range/expires_at) so the data-request can
-- re-validate off a fresh DB reload — never a cached fetch-time artifact. Status is monotonic (state.js guard).
CREATE TABLE IF NOT EXISTS connect_abdm_consent_req (
  request_id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, patient_abha_hash TEXT,   -- HMAC, not raw ABHA
  status TEXT, consent_id TEXT, hi_types TEXT,
  care_contexts TEXT, purpose TEXT, date_range TEXT,   -- SIGNED scope persisted on verify (R4 reload authority)
  created_at TEXT, updated_at TEXT, expires_at TEXT,
  -- Stage-6 T2 (additive): patient-level ERASURE deadline (DPDP R15), DISTINCT from consent-validity `expires_at`
  -- so "consent expired" and "data must be erased" are never conflated. state.js#sweep erases ALL derived state
  -- (buffers/keys/txns) + the patient's care-contexts once `now` passes it. // VERIFY (owner): whether ABDM's
  -- dataEraseAt equals the artifact expiry or is a separate (usually later) bound. NOTE: CREATE-IF-NOT-EXISTS
  -- adds this only on a FRESH D1; a provisioned D1 needs `ALTER TABLE connect_abdm_consent_req ADD COLUMN
  -- data_erase_at TEXT;` (SQLite has no ADD-COLUMN-IF-NOT-EXISTS) — see the T9 go-live checklist.
  data_erase_at TEXT );
-- `consent_id` is the durable join (linked by the GRANT notify); index it for the by-consent reload path.
-- UNIQUE (partial, NULLs excluded): a consentId maps to AT MOST ONE lifecycle row — the DB-layer backstop
-- that makes the two-row split structurally impossible (persistGranted also fails closed on no-linked-row).
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_req_cid ON connect_abdm_consent_req(consent_id) WHERE consent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_abdm_txn (
  request_id TEXT PRIMARY KEY,                 -- keyed by requestId (R17); transaction_id attached at on-request
  transaction_id TEXT, tenant_id TEXT, consent_id TEXT,
  eph_privkey_sealed TEXT,                      -- envelope-encrypted ephemeral X25519 private key (ADR-2D)
  eph_pub_raw TEXT, our_nonce TEXT,             -- our keyMaterial (public + nonce) — sent to the gateway
  ack_claimed INTEGER NOT NULL DEFAULT 0,       -- exactly-once ack flag (D1 CAS single-shot; Stage-3 Task-4)
  status TEXT, expires_at TEXT, created_at TEXT, updated_at TEXT,
  -- Stage-6 T3 (additive): the computed transfer OUTCOME (TRANSFERRED|PARTIAL|FAILED). consumeTransfer persists
  -- it the instant the ack is claimed and BEFORE the hiNotify, so a crash/throw in the finalize tail leaves a
  -- RECOVERABLE strand (ack_claimed=1 + session_status set + notify_confirmed NULL) that state.js#reconcileNotify
  -- re-drives idempotently (re-notify + delete + terminalise). NOTE: CREATE-IF-NOT-EXISTS adds this only on a
  -- FRESH D1; a provisioned D1 needs `ALTER TABLE connect_abdm_txn ADD COLUMN session_status TEXT;` (SQLite has
  -- no ADD-COLUMN-IF-NOT-EXISTS) — see the T9 go-live checklist.
  session_status TEXT,
  -- Stage-6 T3 (additive): the timestamp of the SUCCESSFUL hiNotify (NULL until the receipt is confirmed sent).
  -- This is the receipt-delivery marker that closes ALL post-claim lost-receipt strands regardless of how far the
  -- finalize tail got — including the COMMON gateway-notify-throw (status terminal + buffer already deleted +
  -- receipt lost), which a `status='RECEIVING'` filter alone misses. reconcileNotify selects
  -- `ack_claimed=1 AND session_status IS NOT NULL AND notify_confirmed IS NULL` and, on a successful re-notify,
  -- stamps this — so a confirmed row is never re-notified. Same provisioned-D1 caveat:
  -- `ALTER TABLE connect_abdm_txn ADD COLUMN notify_confirmed TEXT;`.
  notify_confirmed TEXT );
-- PARTIAL UNIQUE: one request row per transaction_id (exactly-once ack backstop); multiple NULLs allowed
-- (transaction_id is attached later at on-request, so pre-attach rows all sit at NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_abdm_txn_txid ON connect_abdm_txn(transaction_id) WHERE transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_abdm_carecontext (
  id TEXT PRIMARY KEY, tenant_id TEXT, patient_abha_hash TEXT, source TEXT,           -- followcare|icu|case (HIP)
  ref TEXT, hi_type TEXT, display TEXT, linked_at TEXT );
