-- StewardMD — Medical Updates: add the `query` column for litapi (Europe PMC) sources.
-- Run ONCE on the remote D1 (ALTER ADD COLUMN errors if it already exists):
--   wrangler d1 execute stewardmd-updates --remote --file functions/db/migrate_litapi.sql

ALTER TABLE sources ADD COLUMN query TEXT DEFAULT '';
