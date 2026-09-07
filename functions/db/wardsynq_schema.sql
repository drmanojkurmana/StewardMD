-- functions/db/wardsynq_schema.sql — WardSynQ Clinical Record Service: the D1 persistence for the
-- canonical clinical record. ADDITIVE: new tables only. Applied against the existing
-- `stewardmd-connect` D1 because tenancy (connect_tenant / connect_membership) and the PHI-free
-- audit trail (connect_audit_event) already live there and the record is scoped by them.
--
--   wrangler d1 execute stewardmd-connect --remote --file functions/db/wardsynq_schema.sql
--
-- APPEND-ONLY BY CONSTRUCTION. There is no UPDATE and no DELETE anywhere in the repository that
-- speaks to these tables. A clinical record is a sequence of versions; a correction is a new
-- version with meta.amendedAt set; nothing that was ever true is ever gone. The UNIQUE key on
-- (tenant, type, id, version) is the concurrency control: two clients that both derive version
-- N+1 from version N cannot both land, and the loser gets a conflict rather than a silent overwrite.
--
-- THIS IS THE CLOUDFLARE D1 SHAPE OF ONE PERSISTENCE PORT. The clinical application never sees
-- these tables: it speaks to functions/_wardsynq/repository.js, and a hospital-local Postgres or
-- SQLite implementation of that port is a separate file, not a change to the application.

CREATE TABLE IF NOT EXISTS wardsynq_record (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,   -- global write order; the change-feed cursor
  tenant_id     TEXT    NOT NULL,
  resource_type TEXT    NOT NULL,
  id            TEXT    NOT NULL,
  version       INTEGER NOT NULL,
  patient_id    TEXT,                                -- the patient compartment; Patient rows carry their own id
  recorded_at   TEXT    NOT NULL,                    -- T_recorded, copied out of meta for indexing
  effective_at  TEXT,                                -- T_effective, copied out of meta for indexing
  actor_id      TEXT,                                -- writtenBy.id as stamped by the GovernedStore
  actor_kind    TEXT,                                -- writtenBy.kind
  body          TEXT    NOT NULL,                    -- the full canonical entity, JSON
  UNIQUE (tenant_id, resource_type, id, version)
);
CREATE INDEX IF NOT EXISTS idx_wardsynq_record_patient ON wardsynq_record (tenant_id, patient_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_wardsynq_record_tenant_seq ON wardsynq_record (tenant_id, seq);

-- Idempotency: a client that retries a write after a lost response gets the SAME outcome, not a
-- second version. Keyed per tenant so one hospital's keys can never collide with another's.
CREATE TABLE IF NOT EXISTS wardsynq_idempotency (
  tenant_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  id            TEXT NOT NULL,
  version       INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
