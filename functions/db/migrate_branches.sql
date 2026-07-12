-- StewardMD — Medical Updates: add Internal-Medicine BRANCH sub-specialty tagging.
-- Run ONCE on the already-created remote D1 (idempotent-safe to run a second time only
-- if the ALTERs are removed — SQLite ADD COLUMN errors if the column already exists):
--   wrangler d1 execute stewardmd-updates --remote --file functions/db/migrate_branches.sql
--
-- `branch` is a finer specialty WITHIN the internal_medicine workspace (cardiology,
-- nephrology, …). It drives feed filtering + the "branch" chooser in Notification
-- preferences. Non-IM workspaces leave branch = '' (empty).

ALTER TABLE sources    ADD COLUMN branch TEXT DEFAULT '';
ALTER TABLE updates    ADD COLUMN branch TEXT DEFAULT '';
ALTER TABLE user_prefs ADD COLUMN branches TEXT DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_updates_branch ON updates(branch, published_ts DESC);

-- Tag the seeded society sources with their branch (regulators/registries stay general '').
UPDATE sources SET branch = 'cardiology'          WHERE id IN ('acc', 'aha', 'esc');
UPDATE sources SET branch = 'nephrology'          WHERE id = 'kdigo';
UPDATE sources SET branch = 'endocrinology'       WHERE id = 'ada';
UPDATE sources SET branch = 'infectious_diseases' WHERE id IN ('idsa', 'cdc', 'who');
UPDATE sources SET branch = 'pulmonology'         WHERE id IN ('ats', 'chest', 'gold', 'gina', 'ers');
UPDATE sources SET branch = 'gastroenterology'    WHERE id = 'acg';
UPDATE sources SET branch = 'hepatology'          WHERE id = 'aasld';
