-- Rollback for 0002_research_v2.sql (tested, Phase 2 only).
-- Removes exactly the objects 0002 introduces. Tables shared with 0001
-- (research_projects, research_members, research_studies, research_runs,
-- research_audit_events) are LEFT IN PLACE: dropping them would destroy
-- Phase 1 data. Run inside a batch/transaction; audit what is dropped
-- before confirming.
DROP VIEW IF EXISTS research_prisma_counts;
DROP TABLE IF EXISTS research_conflicts;
DROP TABLE IF EXISTS research_screening_decisions;
DROP TABLE IF EXISTS research_exclusion_reasons;
DROP TABLE IF EXISTS research_dedup_members;
DROP TABLE IF EXISTS research_dedup_groups;
DROP TABLE IF EXISTS research_reports;
DROP TABLE IF EXISTS research_records;
DROP TABLE IF EXISTS research_search_runs;
DROP TABLE IF EXISTS research_invitations;
DROP TABLE IF EXISTS research_protocols;
