-- ResearchMD 0009 rollback. Drops the on-device drafting step cache.
-- Jobs and manuscript versions survive; a resumed draft simply pays for
-- its AI calls again. Run once.

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_research_job_steps_project;
DROP TABLE IF EXISTS research_job_steps;

PRAGMA foreign_keys = ON;
