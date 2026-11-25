-- ResearchMD Phase 3 migration 0003 ROLLBACK (tested in
-- test/research-phase3-api.test.mjs: apply 0001+0002+0003, roll back, the
-- live Phase 1/2 tables and the pilot mirror are untouched).
-- Drops ONLY the 0003 objects, children before parents. The pilot
-- research_jobs / research_meta_analyses / research_artifacts are not
-- touched (0003 never created or altered them).
PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_research_institution_members_uid;
DROP TABLE IF EXISTS research_institution_members;
DROP TABLE IF EXISTS research_institutions;
DROP INDEX IF EXISTS idx_research_credit_ledger_job;
DROP INDEX IF EXISTS idx_research_credit_ledger_owner;
DROP TABLE IF EXISTS research_credit_ledger;
DROP INDEX IF EXISTS idx_research_ai_usage_job;
DROP INDEX IF EXISTS idx_research_ai_usage_user;
DROP INDEX IF EXISTS idx_research_ai_usage_project;
DROP TABLE IF EXISTS research_ai_usage;
DROP INDEX IF EXISTS idx_research_pdfs_project;
DROP TABLE IF EXISTS research_pdfs;
DROP INDEX IF EXISTS idx_research_job_runs_creator;
DROP INDEX IF EXISTS idx_research_job_runs_project;
DROP INDEX IF EXISTS idx_research_job_runs_queue;
DROP TABLE IF EXISTS research_job_runs;
