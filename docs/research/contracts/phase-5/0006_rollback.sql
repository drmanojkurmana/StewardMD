-- ResearchMD 0006 rollback. Drops the Phase 5 manuscript and checklist
-- tables and restores the research_job_runs kind CHECK to pdf_extract.
-- manuscript_draft rows cannot survive that CHECK, so they are deleted.
-- Phase 1-4 and Phase 6 rows survive. Run once.
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS research_checklist_manual;
DROP TABLE IF EXISTS research_manuscript_exports;
DROP TABLE IF EXISTS research_manuscript_approvals;
DROP TABLE IF EXISTS research_manuscript_sections;
DROP TABLE IF EXISTS research_manuscript_versions;

DELETE FROM research_job_runs WHERE kind = 'manuscript_draft';

CREATE TABLE research_job_runs_v5 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('pdf_extract')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL,
  input_r2_key TEXT NOT NULL DEFAULT '',
  result_r2_key TEXT NOT NULL DEFAULT '',
  ceilings_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  started_ts INTEGER,
  completed_ts INTEGER,
  cancel_requested_ts INTEGER,
  UNIQUE(project_id, idempotency_key)
);
INSERT INTO research_job_runs_v5 (
  id, project_id, kind, status, idempotency_key, input_r2_key, result_r2_key,
  ceilings_json, usage_json, output_json, error_code, created_by, created_ts,
  started_ts, completed_ts, cancel_requested_ts
)
SELECT
  id, project_id, kind, status, idempotency_key, input_r2_key, result_r2_key,
  ceilings_json, usage_json, output_json, error_code, created_by, created_ts,
  started_ts, completed_ts, cancel_requested_ts
FROM research_job_runs;
DROP TABLE research_job_runs;
ALTER TABLE research_job_runs_v5 RENAME TO research_job_runs;
CREATE INDEX IF NOT EXISTS idx_research_job_runs_queue
  ON research_job_runs(status, created_ts);
CREATE INDEX IF NOT EXISTS idx_research_job_runs_project
  ON research_job_runs(project_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_research_job_runs_creator
  ON research_job_runs(created_by, created_ts);

PRAGMA foreign_keys = ON;
