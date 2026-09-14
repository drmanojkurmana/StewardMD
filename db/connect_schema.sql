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
-- Self-service EMR onboarding (Part 3, Increment 1) REUSES this table with NO schema change / NO ALTER:
-- each onboarded connection is a row where connector_id = a fresh connectionId and the config JSON holds
-- { source:"onboard", name, authMethod, headerName?, tokenEndpoint?, clientId?, sealed:<envelope ciphertext
-- of the credential material>, createdAt, updatedAt, lastTest }. status flips draft->active on a passing test.

CREATE TABLE IF NOT EXISTS connect_audit_event (    -- append-only; metadata only, NO PHI
  id TEXT PRIMARY KEY, tenant_id TEXT, ts TEXT, actor TEXT,
  connector_id TEXT, action TEXT, resource_counts TEXT, scope TEXT,
  patient_ref_hash TEXT, latency_ms INTEGER, outcome TEXT,
  -- R14 accountability refs (non-PHI): consent/txn artifact ids + HMAC of the care-context reference
  -- (NEVER the raw careContextReference, raw ABHA, or decrypted content).
  consent_id TEXT, transaction_id TEXT, care_context_hash TEXT );
CREATE INDEX IF NOT EXISTS idx_connect_audit_tenant_ts ON connect_audit_event (tenant_id, ts);
CREATE INDEX IF NOT EXISTS idx_connect_audit_consent ON connect_audit_event (consent_id);
-- IMMUTABLE IN THE DATABASE, NOT ONLY BY CONVENTION (WardSynQ P2.17, 2026-09-14). No code path updates
-- or deletes an audit row (part1-foundation-design: "Code path has no UPDATE/DELETE on
-- connect_audit_event"; consent erasure retains the audit), but that stopped nothing below the
-- application: a console query, a script, a bad migration. These cover the whole table, Connect's and
-- ABDM's rows included. There is no retention deletion; if one is ever lawfully required it is a
-- separate, audited, owner-only procedure, not a change to these triggers. Triggers do not stop DROP
-- TRIGGER, DROP TABLE, a Time Travel restore or an import: the WardSynQ audit chain
-- (functions/db/wardsynq_schema.sql wardsynq_audit_chain) is what shows rows changed or removed that way.
-- Re-runnable like the rest of this file: wrangler d1 execute stewardmd-connect --remote --file db/connect_schema.sql
CREATE TRIGGER IF NOT EXISTS connect_audit_event_no_update BEFORE UPDATE ON connect_audit_event
BEGIN SELECT RAISE(ABORT, 'audit rows are immutable'); END;
CREATE TRIGGER IF NOT EXISTS connect_audit_event_no_delete BEFORE DELETE ON connect_audit_event
BEGIN SELECT RAISE(ABORT, 'audit rows are immutable'); END;
