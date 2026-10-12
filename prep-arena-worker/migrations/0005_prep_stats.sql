-- PrepNucleus Item Statistics (plan section 11; privacy-preserving aggregate telemetry)
-- Apply: npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0005_prep_stats.sql
CREATE TABLE IF NOT EXISTS prep_item_stats (
  item_id TEXT PRIMARY KEY,
  exam TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  right INTEGER NOT NULL DEFAULT 0,
  blank INTEGER NOT NULL DEFAULT 0,
  secs INTEGER NOT NULL DEFAULT 0,
  o0 INTEGER NOT NULL DEFAULT 0,
  o1 INTEGER NOT NULL DEFAULT 0,
  o2 INTEGER NOT NULL DEFAULT 0,
  o3 INTEGER NOT NULL DEFAULT 0,
  updated TEXT
);
CREATE INDEX IF NOT EXISTS prep_item_stats_exam ON prep_item_stats (exam, n DESC);
