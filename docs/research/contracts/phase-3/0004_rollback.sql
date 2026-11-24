-- ResearchMD Phase 3 migration 0004 ROLLBACK (tested in
-- test/research-phase3b-api.test.mjs: apply 0001+0002+0003+0004, roll back,
-- the live Phase 1/2/3 tables and the pilot mirror are untouched).
-- Drops ONLY the 0004 objects, children before parents. 0001-0003 tables
-- (projects, studies, runs, research_pdfs, research_job_runs, ...) are not
-- touched; 0004 never created or altered them.
PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_research_grade_assessments_project;
DROP TABLE IF EXISTS research_grade_assessments;
DROP INDEX IF EXISTS idx_research_screening_suggestions_record;
DROP TABLE IF EXISTS research_screening_suggestions;
DROP INDEX IF EXISTS idx_research_data_imports_project;
DROP TABLE IF EXISTS research_data_imports;
DROP INDEX IF EXISTS idx_research_data_dictionaries_project;
DROP TABLE IF EXISTS research_data_dictionaries;
DROP INDEX IF EXISTS idx_research_rob_conflicts_project;
DROP TABLE IF EXISTS research_rob_conflicts;
DROP INDEX IF EXISTS idx_research_rob_assessments_latest;
DROP TABLE IF EXISTS research_rob_assessments;
DROP INDEX IF EXISTS idx_research_extraction_audit_extraction;
DROP TABLE IF EXISTS research_extraction_audit;
DROP INDEX IF EXISTS idx_research_extraction_suggestions_extraction;
DROP TABLE IF EXISTS research_extraction_suggestions;
DROP INDEX IF EXISTS idx_research_extractions_project;
DROP TABLE IF EXISTS research_extractions;
DROP INDEX IF EXISTS idx_research_extraction_artifacts_project;
DROP TABLE IF EXISTS research_extraction_artifacts;
