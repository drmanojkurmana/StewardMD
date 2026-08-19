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
  data_erase_at TEXT,
  -- M3 (additive): the CM's OWN consent-REQUEST id, returned on /consent/request/on-init. DISTINCT from
  -- `consent_id`, which is the ARTEFACT id and only exists once the patient grants. The later hiu notify
  -- carries the consentRequestId, so without this column a grant cannot be matched back to the request that
  -- asked for it. NOTE: CREATE-IF-NOT-EXISTS adds this only on a FRESH D1; a provisioned D1 needs
  -- `ALTER TABLE connect_abdm_consent_req ADD COLUMN consent_request_id TEXT;`.
  consent_request_id TEXT,
  -- M3 (additive): when we last successfully fetched data under this consent. The HIU may repeat a fetch
  -- under an existing artefact only within 14 days; past that the patient must be asked again. Enforced at
  -- the REQUEST (hiu.js#requestHealthInformation), because a request we should not have made is not fixed
  -- by discarding the answer. Provisioned D1 needs
  -- `ALTER TABLE connect_abdm_consent_req ADD COLUMN last_fetched_at TEXT;`.
  last_fetched_at TEXT );
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

-- M1 (2026-08-18): the ABHA <-> local patient binding. Enforces the mandatory certification rule
-- TAGGING_UNIQUEPATIENTID_UNIQUEABHANUMBER - one ABHA number maps to exactly one local patient id
-- within a tenant. The ABHA number itself is NEVER stored: only its tenant-scoped HMAC pseudonym
-- (patient_abha_hash, the same derivation the rest of ABDM uses) and the last 4 digits for display.
CREATE TABLE IF NOT EXISTS connect_abha_link (
  tenant_id         TEXT NOT NULL,
  patient_abha_hash TEXT NOT NULL,
  abha_last4        TEXT,
  abha_address_sealed TEXT,   -- AES-256-GCM ciphertext (CONNECT_MASTER_KEY), never plaintext
  patient_ref       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, patient_abha_hash)
);
-- Reverse lookup: "which ABHA is this patient linked to?" for the registration screen.
CREATE INDEX IF NOT EXISTS idx_abha_link_patient ON connect_abha_link (tenant_id, patient_ref);

-- ABDM consented-records store (2026-08-19). Holds ONLY the records of patients who consented to share
-- through ABDM - never the clinic database. Exists because linking a care context is a promise to serve
-- it on demand with no human in the loop, which a local-first clinic cannot honour from the doctor's
-- device (phone off, doctor moved on, twenty patients waiting).
-- The blob lives in R2, sealed with the Connect master key; this table is the index. care_context_ref is
-- stored here because it is protocol-visible by design and the erasure sweep needs it - it must never
-- reach KV, a log line, a URL or an object key.
CREATE TABLE IF NOT EXISTS connect_abdm_consented_record (
  tenant_id         TEXT NOT NULL,
  patient_abha_hash TEXT NOT NULL,      -- HMAC pseudonym, never a raw ABHA
  ref_hash          TEXT NOT NULL,      -- sha256(care_context_ref); the object key uses this, not the ref
  care_context_ref  TEXT NOT NULL,
  hi_type           TEXT,
  r2_key            TEXT NOT NULL,
  bytes             INTEGER,
  source            TEXT,               -- native-opd | connected-emr | local-clinic
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, ref_hash)
);
-- Erasure on consent revoke / expiry / ABHA opt-out is by (tenant, patient).
CREATE INDEX IF NOT EXISTS idx_consented_patient ON connect_abdm_consented_record (tenant_id, patient_abha_hash);

-- ABHA enrolment consent (2026-08-19). Certification CRT_ABHA_102 requires the ABDM-published consent
-- language to be DISPLAYED and the beneficiary's agreement RECORDED, and the "Registration via Aadhaar
-- OTP" page requires it to be collected BEFORE the Aadhaar OTP is requested. So this row is written
-- first and its id is required by /enrol/otp - consent that cannot be evidenced is not consent.
-- NO PHI: the patient is a local reference the tenant already holds, the worker is our own actor id,
-- and the agreed clause ids are ABDM's own constants. The Aadhaar number is never involved.
CREATE TABLE IF NOT EXISTS connect_abdm_enrol_consent (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  actor         TEXT NOT NULL,        -- the clinician who explained it (the worker attestation)
  patient_ref   TEXT,                 -- the tenant's own patient id, if the patient is already registered
  version       TEXT NOT NULL,        -- the consent-language version shown
  agreed        TEXT NOT NULL,        -- JSON array of the clause/attestation ids agreed to
  flow          TEXT,                 -- aadhaar | other
  created_at    TEXT NOT NULL,
  used_at       TEXT );               -- stamped when an enrolment actually consumed it (single-use)
CREATE INDEX IF NOT EXISTS idx_enrol_consent_tenant ON connect_abdm_enrol_consent (tenant_id, created_at);
