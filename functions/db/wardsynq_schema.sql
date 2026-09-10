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

-- THE PATIENT IDENTITY INDEX (2026-09-10, closing the audit's remaining CRITICAL finding).
--
-- Identity reconciliation used to answer "do we already have this person?" by reading a bounded
-- roster of Patient rows and scanning it in JavaScript. On a hospital with more patients than the
-- roster ceiling, a returning patient outside the roster simply was not found, the matcher fell
-- through to "new", and a SECOND chart was created for somebody who was already here. Raising the
-- ceiling only moves the wall; a roster scan is not an index and cannot be made into one.
--
-- So an identifier is now written here at the same instant the Patient row is written, in the SAME
-- transaction, and looked up by an index seek that does not care how many patients exist.
--
-- THE PRIMARY KEY IS THE POINT, not the lookup speed. (tenant_id, system_key, value_norm) says, in
-- the database rather than in application logic, that one identifier belongs to one person in one
-- hospital. Two concurrent inbound messages racing to create the same identity cannot both win: the
-- loser gets a constraint violation, re-reads, and finds the patient the winner just created.
--
--   tenant_id   the hospital. First column of the key, so an identifier can NEVER match across
--               tenants - two hospitals legitimately issue the same MRN to different people.
--   system_key  the canonical system ("mrn", "abha", ...), per functions/_wardsynq/identity-key.js.
--   value_norm  the canonical value from the same file. The index and the matcher share ONE
--               canonicalisation; if they ever disagree the index confidently reports strangers.
--   patient_id  the local Patient this identifier belongs to. Never rewritten to point elsewhere:
--               a merge moves nothing (see identity-merge.js), so nothing legitimately re-homes an
--               identifier, and an attempt to do so is a duplicate that must be refused.
CREATE TABLE IF NOT EXISTS wardsynq_patient_identifier (
  tenant_id   TEXT NOT NULL,
  system_key  TEXT NOT NULL,
  value_norm  TEXT NOT NULL,
  patient_id  TEXT NOT NULL,
  first_seen  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, system_key, value_norm)
);
-- "Which identifiers does this patient hold?", for the reverse direction and for cleanup tooling.
CREATE INDEX IF NOT EXISTS idx_wardsynq_patient_identifier_patient
  ON wardsynq_patient_identifier (tenant_id, patient_id);

-- APPLYING THIS TABLE IS HALF THE DEPLOYMENT. THE OTHER HALF IS THE BACKFILL.
--
-- The index is maintained on write, so on the day it ships it is EMPTY, and every patient the
-- hospital already holds is invisible to it. Reconciliation would go on missing exactly the people
-- this exists to find, while looking like it worked. After applying this schema, run the backfill
-- once per tenant - D1Repository.reindexPatientIdentifiers(tenantId) - which pages over the whole
-- Patient table and is safe to re-run.
--
-- It returns {scanned, indexed, conflicts}. READ THE CONFLICTS. Each one is two patients in the
-- existing data already sharing an identifier - a duplicate that pre-dates the constraint. The
-- backfill deliberately does NOT pick a winner: it keeps the first mapping and reports the rest for
-- a records officer to merge, because silently choosing one of two charts is the failure this whole
-- mechanism exists to prevent.

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
