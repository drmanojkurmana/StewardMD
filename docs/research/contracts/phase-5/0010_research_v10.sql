-- ResearchMD Phase 04 migration 0010 (research_v10).
-- Numbered 0010: main's 0008 is F-12 publication consents and phase 3's 0009 is research_job_steps.
-- Apply after 0001 through 0009.
-- Tracks per-user monthly cloud fallback allowances across PDF, stats, and manuscript jobs.
-- Note: no ON DELETE CASCADE on project_id/job_id so project deletion does not reset monthly usage.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_cloud_fallbacks (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('pdf', 'stats', 'draft')),
  job_id TEXT NOT NULL DEFAULT '',
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'used' CHECK(status IN ('used', 'refunded')),
  reason_json TEXT NOT NULL DEFAULT '{}',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_cloud_fallbacks_uid_month
  ON research_cloud_fallbacks(uid, month, status);
CREATE INDEX IF NOT EXISTS idx_research_cloud_fallbacks_job
  ON research_cloud_fallbacks(job_id);
