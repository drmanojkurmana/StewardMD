-- PrepNucleus test rank: an anonymous score histogram per test (functions/_prep-rank.js, served by /api/prep/stats).
-- One row per (test key, score bin); no student, device or attempt id is stored.
-- Apply: npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0006_prep_rank.sql
CREATE TABLE IF NOT EXISTS prep_score_hist (
  k TEXT NOT NULL,
  bin INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (k, bin)
);
