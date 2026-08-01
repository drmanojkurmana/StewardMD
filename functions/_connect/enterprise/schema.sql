-- functions/_connect/enterprise/schema.sql — StewardMD Connect Track D (ADDITIVE; new tables only).
-- db/connect_schema.sql (connect_tenant / connect_membership / connect_connector_config /
-- connect_audit_event) is NOT modified. Apply against the existing `stewardmd-connect` D1.

-- Pending membership invites (accepted -> promoted into connect_membership on first authenticated resolve).
CREATE TABLE IF NOT EXISTS connect_membership_invite (
  tenant_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,                        -- the invitee's StewardMD account id (same id identify() returns)
  role       TEXT NOT NULL,                        -- owner|admin|clinician|auditor
  status     TEXT NOT NULL DEFAULT 'invited',      -- invited|active
  invited_by TEXT,
  created_at TEXT,
  PRIMARY KEY (tenant_id, user_id)                 -- no email/PII stored
);

-- Per-tenant, per-action rate-limit configuration (secondary availability control; see ratelimit.js).
CREATE TABLE IF NOT EXISTS connect_tenant_limits (
  tenant_id  TEXT NOT NULL,
  action     TEXT NOT NULL,                        -- context:load | maik:attach | connector:validate | ...
  window_sec INTEGER NOT NULL,
  max_count  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, action)
);

-- The BAA/no-retention egress gate (spec §4.3). baa_ok=1 is the ONLY thing that lets a live (real-PHI)
-- bundle reach the LLM egress lane; it stays 0 until a signed BAA/DPA + a configured no-retention/
-- no-training provider tier exist. Flipped ONLY via the owner-only `egress:baa` RBAC action. Audited.
CREATE TABLE IF NOT EXISTS connect_tenant_egress (
  tenant_id     TEXT PRIMARY KEY,
  baa_ok        INTEGER NOT NULL DEFAULT 0,        -- 0=blocked (default), 1=BAA-covered no-retention tier
  provider_tier TEXT,                              -- // VERIFY: the exact no-retention LLM tier/endpoint
  updated_by    TEXT,
  updated_at    TEXT
);
