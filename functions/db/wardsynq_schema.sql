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

-- THE FHIR HASHED-ID ALIAS INDEX (2026-09-10).
--
-- A canonical WardSynQ id that does not fit FHIR's id rules (or is longer than 64 characters) is
-- published to the outside world as `wsq-<48 hex>`, a SHA-256 prefix - see functions/_wardsynq/
-- fhir-id.js. That is a ONE-WAY function, so when the id comes back in on a read, a search or an
-- If-None-Exist, it has to be turned back into the canonical id somehow.
--
-- Until this table it was turned back by SCANNING the latest SEARCH_POOL records of the type and
-- hashing each one looking for a match - the same bounded-roster mistake the patient identity index
-- exists to retire, and fhir.js's own comment predicted this table by name ("a persisted alias index
-- if a hospital's roster outgrows it"). A resource outside the pool simply did not resolve: the read
-- 404'd for a record that is right there. It fails CLOSED, so it never returned the WRONG record -
-- but "we cannot find your patient" is still the wrong answer.
--
-- Written on append for exactly the ids that get hashed, so the common case (an id that conforms and
-- is published verbatim) costs nothing at all.
CREATE TABLE IF NOT EXISTS wardsynq_id_alias (
  tenant_id     TEXT NOT NULL,
  id_hash       TEXT NOT NULL,   -- the published `wsq-<48 hex>` form
  resource_type TEXT NOT NULL,
  id            TEXT NOT NULL,   -- the canonical WardSynQ id it stands for
  first_seen    TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id_hash)
);

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

-- THE AUDIT TRAIL IS IMMUTABLE, AND TAMPER-EVIDENT (P2.17, 2026-09-14).
--
-- Applied the same way as everything above, and safe to re-apply: every statement is IF NOT EXISTS.
-- The triggers on connect_audit_event itself live beside that table, in db/connect_schema.sql, so
-- apply BOTH files (connect first), BEFORE deploying the code that writes wardsynq_audit_chain:
--   wrangler d1 execute stewardmd-connect --remote --file db/connect_schema.sql
--   wrangler d1 execute stewardmd-connect --remote --file functions/db/wardsynq_schema.sql
-- The repository refuses to write an audit row it cannot chain, so without this table every clinical
-- write fails, and the System health record-store check says the schema is not applied.

-- THE CHAIN (functions/_wardsynq/audit-chain.js). One link per audit row the record repository writes,
-- inserted in the same batch as the row: row_hash = SHA-256(prev_hash || canonical JSON of the stored
-- audit row). A changed audit row stops matching its link, a removed row leaves a link to nothing, a
-- removed link leaves a missing chain_seq.
--
--   chain_seq        1, 2, 3... per hospital, no gaps. THE PRIMARY KEY IS THE CONCURRENCY CONTROL: two
--                    writes that both read head N both insert N+1, the second violates the key, its
--                    whole batch rolls back and the repository re-reads and retries. A guarded UPDATE
--                    of a head row cannot do this in a D1 batch, because an UPDATE matching no row
--                    succeeds and the batch commits.
--   legacy_boundary  only on chain_seq 1: the id of the newest audit row written before the chain
--                    existed (the unchained genesis era, which cannot be verified), or NULL if there
--                    was none. Link 1's prev_hash is derived from it, so it cannot be moved quietly.
-- A side table rather than two columns on connect_audit_event: that table is shared and live, and
-- ALTER TABLE ADD COLUMN is not re-runnable on an on-premise boot that applies this file every time.
CREATE TABLE IF NOT EXISTS wardsynq_audit_chain (
  tenant_id       TEXT    NOT NULL,
  chain_seq       INTEGER NOT NULL,
  audit_id        TEXT    NOT NULL,   -- connect_audit_event.id
  prev_hash       TEXT    NOT NULL,
  row_hash        TEXT    NOT NULL,
  legacy_boundary TEXT,
  PRIMARY KEY (tenant_id, chain_seq),
  UNIQUE (audit_id)
);
CREATE TRIGGER IF NOT EXISTS wardsynq_audit_chain_no_update BEFORE UPDATE ON wardsynq_audit_chain
BEGIN SELECT RAISE(ABORT, 'audit rows are immutable'); END;
CREATE TRIGGER IF NOT EXISTS wardsynq_audit_chain_no_delete BEFORE DELETE ON wardsynq_audit_chain
BEGIN SELECT RAISE(ABORT, 'audit rows are immutable'); END;

-- THE OUTBOX STATUS INDEX (2026-09-14, closing the 200-row scan gap).
--
-- The outbox drain used to read the newest N events of the internal _wardsynq_outbox type and pick
-- out the waiting ones. On a hospital past N settled events an old pending event sat beyond the
-- window forever: never retried, never reported, while the health check counted only what the same
-- window could see. Raising N only moves the wall; a newest-N scan is not a status seek.
--
-- So the drain now asks for waiting rows BY STATUS (pending, retry, running), oldest first, and
-- this index is what keeps that seek cheap no matter how many settled events pile up. The status
-- lives inside the body JSON next to everything else the event carries - a dedicated column would
-- mean backfilling every existing row, and a backfill that rewrites history is exactly what an
-- append-only store must not do. An expression index walks the same field with no row touched.
--
-- Re-runnable like everything else in this file (IF NOT EXISTS): applying the file again, or
-- applying it to a database that already has the index, changes nothing. A database WITHOUT it
-- still answers the status query correctly, only slower, so code can deploy before or after.
CREATE INDEX IF NOT EXISTS idx_wardsynq_record_outbox_status
  ON wardsynq_record (tenant_id, resource_type, json_extract(body, '$.status'));
