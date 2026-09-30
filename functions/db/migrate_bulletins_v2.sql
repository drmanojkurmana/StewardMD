-- Clinical Bulletins v2 columns (second reader, sent-back note, signer specialties).
-- Not needed in practice: functions/_bulletins_schema.js adds any missing column on the first bulletins request.
-- Hand-run copy for an existing database (each ALTER fails harmlessly with "duplicate column" if already there):
--   wrangler d1 execute stewardmd-updates --remote --file functions/db/migrate_bulletins_v2.sql
ALTER TABLE bulletins ADD COLUMN second_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulletins ADD COLUMN cosigned_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE bulletins ADD COLUMN cosigned_uid TEXT NOT NULL DEFAULT '';
ALTER TABLE bulletins ADD COLUMN cosigned_name TEXT NOT NULL DEFAULT '';
ALTER TABLE bulletins ADD COLUMN cosigned_reg TEXT NOT NULL DEFAULT '';
ALTER TABLE bulletins ADD COLUMN cosigned_council TEXT NOT NULL DEFAULT '';
ALTER TABLE bulletins ADD COLUMN cosigned_ts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulletins ADD COLUMN returned_note TEXT NOT NULL DEFAULT '';
ALTER TABLE bulletins ADD COLUMN returned_uid TEXT NOT NULL DEFAULT '';
ALTER TABLE bulletins ADD COLUMN returned_ts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulletin_signers ADD COLUMN specialties TEXT NOT NULL DEFAULT '';
