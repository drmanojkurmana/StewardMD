-- db/connect_schema.sql — StewardMD Connect (additive; new tables only)
CREATE TABLE IF NOT EXISTS connect_tenant (
  id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active',
  mode TEXT NOT NULL DEFAULT 'sandbox',            -- sandbox|live
  granted_scopes TEXT, settings TEXT, created_at TEXT, updated_at TEXT );

CREATE TABLE IF NOT EXISTS connect_membership (
  user_id TEXT, tenant_id TEXT, role TEXT,          -- owner|admin|clinician|auditor
  PRIMARY KEY (user_id, tenant_id) );

CREATE TABLE IF NOT EXISTS connect_connector_config (
  tenant_id TEXT, connector_id TEXT, kind TEXT, profile TEXT,
  base_url TEXT, config TEXT, secret_ref TEXT, scope TEXT, status TEXT DEFAULT 'draft',
  PRIMARY KEY (tenant_id, connector_id) );

CREATE TABLE IF NOT EXISTS connect_audit_event (    -- append-only; metadata only, NO PHI
  id TEXT PRIMARY KEY, tenant_id TEXT, ts TEXT, actor TEXT,
  connector_id TEXT, action TEXT, resource_counts TEXT, scope TEXT,
  patient_ref_hash TEXT, latency_ms INTEGER, outcome TEXT,
  -- R14 accountability refs (non-PHI): consent/txn artifact ids + HMAC of the care-context reference
  -- (NEVER the raw careContextReference, raw ABHA, or decrypted content).
  consent_id TEXT, transaction_id TEXT, care_context_hash TEXT );
CREATE INDEX IF NOT EXISTS idx_connect_audit_tenant_ts ON connect_audit_event (tenant_id, ts);
CREATE INDEX IF NOT EXISTS idx_connect_audit_consent ON connect_audit_event (consent_id);
