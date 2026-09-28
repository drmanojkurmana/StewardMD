-- StewardMD — Medical Updates Verification & Disease Grounding (Migration 0002)
-- Apply: wrangler d1 execute stewardmd-updates --remote --file functions/db/0002_updates_signoff.sql

ALTER TABLE updates ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE updates ADD COLUMN verified_by TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN verified_reg TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN verified_ts INTEGER DEFAULT 0;
ALTER TABLE updates ADD COLUMN disease_id TEXT DEFAULT '';
ALTER TABLE updates ADD COLUMN evidence_grade TEXT DEFAULT 'GRADE 1B';
ALTER TABLE updates ADD COLUMN trial_phase TEXT DEFAULT 'Phase III RCT';

CREATE INDEX IF NOT EXISTS idx_updates_disease ON updates(disease_id, verified);
CREATE INDEX IF NOT EXISTS idx_updates_signoff ON updates(verified, published_ts DESC);
