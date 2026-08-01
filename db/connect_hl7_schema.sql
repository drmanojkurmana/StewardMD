-- db/connect_hl7_schema.sql — StewardMD Connect Track B (legacy feeds). ADDITIVE; new table only.
-- No PHI: a feed is identified by an opaque feed_id; the HMAC secret lives envelope-encrypted at secret_ref
-- (never here); no raw PID/ABHA/message content is ever stored.
CREATE TABLE IF NOT EXISTS connect_feed (
  feed_id        TEXT PRIMARY KEY,               -- opaque, non-PHI
  tenant_id      TEXT NOT NULL,
  connector_id   TEXT NOT NULL,                  -- 'hl7v2' | 'file'
  secret_ref     TEXT NOT NULL,                  -- env name of the envelope-sealed HMAC secret (never the secret)
  msg_types      TEXT,                           -- JSON allow-list, e.g. ["ORU","ADT","MDM"]
  granted_scopes TEXT,                           -- JSON SCCM scope
  config         TEXT,                           -- JSON (delimiter, columnMap, ...) NON-secret
  status         TEXT DEFAULT 'active',          -- active | disabled
  created_at     TEXT
);
