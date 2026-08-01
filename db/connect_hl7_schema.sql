-- db/connect_hl7_schema.sql — StewardMD Connect Track B (legacy feeds). ADDITIVE; new table only.
-- No PHI: a feed is identified by an opaque feed_id; the HMAC secret lives envelope-encrypted at secret_ref
-- (never here); no raw PID/ABHA/message content is ever stored.
CREATE TABLE IF NOT EXISTS connect_feed (
  feed_id        TEXT PRIMARY KEY,               -- opaque, non-PHI
  tenant_id      TEXT NOT NULL,
  connector_id   TEXT NOT NULL,                  -- 'hl7v2' | 'file'
  secret_ref     TEXT NOT NULL,                  -- env name of the envelope-sealed HMAC secret (statically-provisioned feeds)
  secret_sealed  TEXT,                           -- envelope-sealed HMAC secret stored INLINE (self-service feeds); NEVER the raw secret
  msg_types      TEXT,                           -- JSON allow-list, e.g. ["ORU","ADT","MDM"]
  granted_scopes TEXT,                           -- JSON SCCM scope
  config         TEXT,                           -- JSON (delimiter, columnMap, ...) NON-secret
  status         TEXT DEFAULT 'active',          -- active | disabled
  created_at     TEXT
);
-- Self-service EMR onboarding (Part 3, Increment 3) REUSES this table. A wizard-created feed stores its
-- server-generated per-feed HMAC secret envelope-sealed INLINE in secret_sealed (secret_ref = 'inline'); the
-- ingest spine prefers secret_sealed over the env-named secret_ref, so no runtime env write is needed. Revoke
-- DELETEs the row (erasing the sealed secret with it), after which correlateFeed returns null -> ingest 401.
-- ALREADY-DEPLOYED DBs must ALTER additively (run ONCE; D1 has no "ADD COLUMN IF NOT EXISTS"):
--   ALTER TABLE connect_feed ADD COLUMN secret_sealed TEXT;
