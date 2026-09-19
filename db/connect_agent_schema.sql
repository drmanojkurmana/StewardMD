-- db/connect_agent_schema.sql — StewardMD Connect Hospital agent broker. ADDITIVE; new tables only.
-- Same convention as db/connect_schema.sql and db/connect_hl7_schema.sql: plain CREATE TABLE IF NOT EXISTS,
-- no numbered migration runner in this repo. Applying this file to an already-deployed D1 is a no-op for
-- every existing table; nothing here ALTERs or drops anything, so rollback = stop reading these tables
-- (turn CONNECT_AGENT_FLAG off) and, optionally, DROP the connect_agent_* / connect_deployment /
-- connect_adapter_version tables. No existing row or column changes meaning.
--
-- NO PHI, NO COOKIES, NO SECRETS here by construction:
--   * a browser session is referenced only by an OPAQUE runner_ref (the Camofox userId lives here and is
--     never returned to a client; cookies stay inside the runner's browser context);
--   * an adapter manifest is referenced by manifest_ref + content_hash, never inlined;
--   * consent/viewer-token rows store keyed HMACs, never the signing key;
--   * no response body, screenshot or browser recording is ever stored.

-- A hospital EMR deployment: the tenant-qualified identity of ONE hospital's EMR installation.
-- A shared vendor hostname does NOT uniquely identify a hospital, so uniqueness is (tenant_id, hospital_id)
-- and (tenant_id, fingerprint) — never fingerprint alone.
CREATE TABLE IF NOT EXISTS connect_deployment (
  id                TEXT PRIMARY KEY,             -- opaque deployment id
  tenant_id         TEXT NOT NULL,
  hospital_id       TEXT NOT NULL,                -- tenant's own hospital key (site/campus)
  name              TEXT,
  origins           TEXT NOT NULL,                -- JSON array of canonical APPROVED https origins
  vendor            TEXT,                         -- vendor/product label (non-authoritative, display only)
  fingerprint       TEXT NOT NULL,                -- vendor fingerprint: sha256 over the canonical origin set
  network_mode      TEXT NOT NULL DEFAULT 'public',   -- public | hospital-runner
  active_version_id TEXT,                         -- connect_adapter_version.id currently ACTIVE (nullable)
  status            TEXT NOT NULL DEFAULT 'active',   -- active | disabled
  created_at        TEXT,
  updated_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_deployment_tenant_hospital ON connect_deployment (tenant_id, hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_deployment_tenant_fp ON connect_deployment (tenant_id, fingerprint);

-- An IMMUTABLE adapter version. Rows are never edited except for lifecycle/approval columns; a changed
-- manifest is a NEW row with a new content_hash and parent_version_id pointing at the one it replaces.
CREATE TABLE IF NOT EXISTS connect_adapter_version (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  deployment_id     TEXT NOT NULL,
  manifest_ref      TEXT NOT NULL,                -- opaque ref to the immutable manifest blob (never inlined)
  schema_version    INTEGER NOT NULL,
  content_hash      TEXT NOT NULL,                -- sha256 of the canonical manifest bytes
  capabilities      TEXT NOT NULL,                -- JSON array of capability names
  parent_version_id TEXT,
  evidence_hash     TEXT,                         -- sha256 of the candidate-specific validation evidence
  approver          TEXT,                         -- actor id of the approving reviewer (null until approved)
  policy_version    TEXT,                         -- activation policy version in force at approval
  lifecycle         TEXT NOT NULL DEFAULT 'CANDIDATE',  -- see functions/_connect/agent/state.js ADAPTER_STATES
  created_at        TEXT,
  updated_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_adapter_version_hash ON connect_adapter_version (tenant_id, deployment_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_connect_adapter_version_lifecycle ON connect_adapter_version (tenant_id, deployment_id, lifecycle);

-- A doctor-controlled browser session. Bound to actor + tenant + deployment. runner_ref is the OPAQUE
-- browser-context reference (the Camofox userId) and is returned ONLY to an authenticated runner.
CREATE TABLE IF NOT EXISTS connect_agent_session (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  deployment_id  TEXT NOT NULL,
  actor_id       TEXT NOT NULL,
  runner_ref     TEXT NOT NULL,                   -- opaque; NEVER in a client response
  runner_id      TEXT,                            -- which runner currently holds the browser context
  consent_id     TEXT,
  state          TEXT NOT NULL,                   -- SESSION_STATES (state.js)
  control_owner  TEXT NOT NULL DEFAULT 'clinician',  -- clinician | agent
  revision       INTEGER NOT NULL DEFAULT 1,      -- compare-and-swap guard
  expires_at     INTEGER NOT NULL,                -- epoch ms; hard TTL
  cleanup_after  INTEGER,                         -- epoch ms; browser cleanup may run from here
  closed_at      TEXT,
  created_at     TEXT,
  updated_at     TEXT,
  -- Phone-runner (additive): origins the doctor's own web view visited during handoff that do NOT share
  -- the deployment's registrable domain, offered back to the doctor for one-tap confirmation (POST
  -- .../origins accepts ONLY an origin that appears here). JSON array of https origin strings; NULL until
  -- the first handoff with visitedOrigins. NOTE: CREATE-IF-NOT-EXISTS adds this only on a FRESH D1; a
  -- provisioned D1 needs `ALTER TABLE connect_agent_session ADD COLUMN pending_origins TEXT;` (SQLite has
  -- no ADD-COLUMN-IF-NOT-EXISTS).
  pending_origins TEXT
);
CREATE INDEX IF NOT EXISTS idx_connect_agent_session_live ON connect_agent_session (tenant_id, actor_id, deployment_id, state);
CREATE INDEX IF NOT EXISTS idx_connect_agent_session_expiry ON connect_agent_session (expires_at);

-- The onboarding JOB attached to a session. Job state is DISTINCT from session state and from adapter
-- lifecycle: a job can be DISCOVERING while the session is AUTHENTICATED, and the adapter it produces has
-- its own lifecycle in connect_adapter_version.
CREATE TABLE IF NOT EXISTS connect_agent_job (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  session_id           TEXT NOT NULL,
  deployment_id        TEXT NOT NULL,
  actor_id             TEXT NOT NULL,
  state                TEXT NOT NULL,             -- JOB_STATES (state.js)
  revision             INTEGER NOT NULL DEFAULT 1,
  idempotency_key      TEXT,                      -- tenant-qualified unique; replays return the same job
  lease_owner          TEXT,                      -- runner id holding the lease
  lease_expires_at     INTEGER,                   -- epoch ms; a lapsed lease is reclaimable (runner loss)
  attempts             INTEGER NOT NULL DEFAULT 0,
  max_attempts         INTEGER NOT NULL DEFAULT 3,
  deadline_at          INTEGER NOT NULL,          -- epoch ms; past this the job EXPIREs
  stage                TEXT,                      -- last stage reported by the runner
  stage_code           TEXT,                      -- SAFE outcome code only (never an upstream message)
  candidate_version_id TEXT,
  completed_at         TEXT,                      -- set once, on the FIRST terminal report (dedupe guard)
  created_at           TEXT,
  updated_at           TEXT,
  -- Phone-runner (additive): the compiled candidate manifest + issued GET probes + offline validateCandidate
  -- output for THIS job, set by POST .../discovery and read back by POST .../evidence and GET
  -- /versions/:id. JSON object, no PHI/secrets (manifest carries no observed values, only shapes/paths).
  -- Deliberately NOT surfaced by sessionView/store's client-safe projections. NOTE: CREATE-IF-NOT-EXISTS
  -- adds this only on a FRESH D1; a provisioned D1 needs `ALTER TABLE connect_agent_job ADD COLUMN
  -- phone_state TEXT;` (SQLite has no ADD-COLUMN-IF-NOT-EXISTS).
  phone_state           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_agent_job_idem ON connect_agent_job (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_connect_agent_job_lease ON connect_agent_job (state, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_connect_agent_job_session ON connect_agent_job (tenant_id, session_id);

-- SERVER-OWNED consent. The client never presents a receipt; it presents nothing. receipt_hmac is a keyed
-- HMAC (CONNECT_CONSENT_SIGNING_KEY) over the canonical record, so a tampered row fails verification.
CREATE TABLE IF NOT EXISTS connect_agent_consent (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  deployment_id  TEXT NOT NULL,
  actor_id       TEXT NOT NULL,
  scope          TEXT NOT NULL,                   -- JSON array
  policy_version TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,                -- epoch ms
  revoked_at     INTEGER,
  receipt_hmac   TEXT NOT NULL,
  created_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_connect_agent_consent_actor ON connect_agent_consent (tenant_id, actor_id, deployment_id);

-- An activation record: which immutable version became ACTIVE for a deployment, under which policy, on
-- which evidence, approved by whom. Append-only; a rollback writes a new row and revokes the old one.
CREATE TABLE IF NOT EXISTS connect_agent_activation (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  deployment_id  TEXT NOT NULL,
  version_id     TEXT NOT NULL,
  approver       TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  evidence_hash  TEXT NOT NULL,
  activated_at   TEXT,
  revoked_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_connect_agent_activation_dep ON connect_agent_activation (tenant_id, deployment_id);

-- Short-lived, actor-bound, SINGLE-USE viewer authorizations. The token string itself is never stored (only
-- its jti); used_at is what makes it single-use, revoked_at is what cancellation flips.
CREATE TABLE IF NOT EXISTS connect_agent_viewer_token (
  jti        TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  session_id TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                    -- epoch ms; explicit TTL
  used_at    INTEGER,
  revoked_at INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_connect_agent_viewer_token_session ON connect_agent_viewer_token (session_id);
CREATE INDEX IF NOT EXISTS idx_connect_agent_viewer_token_expiry ON connect_agent_viewer_token (expires_at);

-- Replay protection for runner-to-server callbacks. One row per accepted nonce; rows past expires_at are
-- swept (the timestamp window makes them meaningless anyway).
CREATE TABLE IF NOT EXISTS connect_agent_nonce (
  nonce      TEXT PRIMARY KEY,
  runner_id  TEXT,
  seen_at    INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connect_agent_nonce_expiry ON connect_agent_nonce (expires_at);
