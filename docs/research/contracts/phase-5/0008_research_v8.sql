-- ResearchMD migration 0008: on-device drafting step cache.
-- Contract: docs/researchmd-build/03-drafts.md (phase 3 of the on-device plan).
--
-- Decisions recorded here:
-- 1. research_job_steps caches one AI gateway reply per (job_id, step_id).
--    A device draft that resumes, or the cloud container picking up a
--    device draft, sends the same stepId and gets the cached reply at no
--    charge. All job, PHI and IPD checks run before the cache is read.
-- 2. ON DELETE CASCADE from research_job_runs, so deleting a job removes
--    its cached steps.
-- 3. CREATE IF NOT EXISTS, so applying 0008 over the schema mirror is a
--    no-op. Run once on a live database that already has 0001 through 0007.

CREATE TABLE IF NOT EXISTS research_job_steps (
  job_id TEXT NOT NULL REFERENCES research_job_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0 CHECK(tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK(tokens_out >= 0),
  created_ts INTEGER NOT NULL,
  PRIMARY KEY (job_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_research_job_steps_project
  ON research_job_steps(project_id, job_id);
