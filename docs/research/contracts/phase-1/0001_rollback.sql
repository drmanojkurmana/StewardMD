-- Rollback for 0001_research_v1.sql (tested, Phase 1 only).
-- Removes exactly the two tables 0001 introduces beyond the pilot schema
-- (research_studies, research_runs). research_projects, research_members and
-- research_audit_events are shared with functions/db/research_schema.sql and
-- are LEFT IN PLACE: dropping them would destroy pilot data. Run inside a
-- batch/transaction; audit what is dropped before confirming.
DROP TABLE IF EXISTS research_runs;
DROP TABLE IF EXISTS research_studies;
