-- ResearchMD 0005 rollback. Drops the Phase 6 tables and the four added
-- columns, restoring the v4 shape. Phase 1-4 rows survive. Run once; the
-- DROP COLUMN statements fail if the columns are already gone.
PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_research_projects_institution;
DROP TABLE IF EXISTS research_stats_jobs;
DROP TABLE IF EXISTS research_reviewer_responses;
DROP TABLE IF EXISTS research_reviewer_comments;
DROP TABLE IF EXISTS research_journals;
DROP TABLE IF EXISTS research_institution_onboarding;
DROP TABLE IF EXISTS research_invoices;
DROP TABLE IF EXISTS research_security_incidents;
DROP TABLE IF EXISTS research_ipd_access_log;
DROP TABLE IF EXISTS research_ipd_datasets;
DROP TABLE IF EXISTS research_ipd_evidence;
DROP TABLE IF EXISTS research_ipd_config;

ALTER TABLE research_institution_members DROP COLUMN role;
ALTER TABLE research_institutions DROP COLUMN seats;
ALTER TABLE research_projects DROP COLUMN data_region;
ALTER TABLE research_projects DROP COLUMN institution_id;
