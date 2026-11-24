-- ResearchMD Phase 5 migration 0006 (packages 5A.3 and 5B).
-- Contracts: docs/research/contracts/phase-5/manuscript-api.md and the
-- checklist snapshot documented in research-checklist.js.
--
-- Decisions recorded here:
-- 1. Manuscript versions, sections, approvals, export jobs and checklist
--    manual entries are new tables. CREATE IF NOT EXISTS, so applying 0006
--    over the schema mirror is a no-op for these tables.
-- 2. manuscript_draft jobs settle through the existing research_job_runs
--    callback (_callback.js). The 0003 kind CHECK is pdf_extract only and
--    cannot be altered in place. This migration rebuilds that table with
--    the same columns and a wider CHECK ('pdf_extract','manuscript_draft').
--    Foreign keys are off only for the swap; child rows (extraction
--    artifacts) keep their job_id values because the table name is restored.
-- 3. Section text keeps {{run:<id>.<field>}} tokens. No numeric column is
--    added for statistical results.

PRAGMA foreign_keys = OFF;

CREATE TABLE research_job_runs_v6 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('pdf_extract','manuscript_draft')),
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
INSERT INTO research_job_runs_v6 (
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
ALTER TABLE research_job_runs_v6 RENAME TO research_job_runs;
CREATE INDEX IF NOT EXISTS idx_research_job_runs_queue
  ON research_job_runs(status, created_ts);
CREATE INDEX IF NOT EXISTS idx_research_job_runs_project
  ON research_job_runs(project_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_research_job_runs_creator
  ON research_job_runs(created_by, created_ts);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_manuscript_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  title TEXT NOT NULL DEFAULT '',
  authors_json TEXT NOT NULL DEFAULT '[]',
  affiliations TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved','locked')),
  references_json TEXT NOT NULL DEFAULT '[]',
  tokens_json TEXT NOT NULL DEFAULT '{}',
  job_id TEXT NOT NULL DEFAULT '',
  version_hash TEXT,
  locked_by TEXT NOT NULL DEFAULT '',
  locked_at INTEGER,
  lock_json TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_manuscript_versions_job
  ON research_manuscript_versions(project_id, job_id) WHERE job_id != '';
CREATE INDEX IF NOT EXISTS idx_research_manuscript_versions_project
  ON research_manuscript_versions(project_id, version DESC);

CREATE TABLE IF NOT EXISTS research_manuscript_sections (
  version_id TEXT NOT NULL REFERENCES research_manuscript_versions(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 1),
  text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_ts INTEGER NOT NULL,
  PRIMARY KEY (version_id, section_id)
);

CREATE TABLE IF NOT EXISTS research_manuscript_approvals (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES research_manuscript_versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('requested','approved')),
  requested_by TEXT NOT NULL DEFAULT '',
  requested_at INTEGER,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at INTEGER,
  note TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_manuscript_approvals_version
  ON research_manuscript_approvals(version_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_manuscript_exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'docx' CHECK(format IN ('docx')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending')),
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_manuscript_exports_project
  ON research_manuscript_exports(project_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_checklist_manual (
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  guideline_id TEXT NOT NULL,
  item_num TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_ts INTEGER NOT NULL,
  PRIMARY KEY (project_id, guideline_id, item_num)
);
