-- ResearchMD Phase 5 migration 0008 (blockers audit F-12, 2026-11-27).
-- Contract: docs/research/contracts/phase-5/manuscript-api.md.
--
-- Decisions recorded here:
-- 1. research_publication_consents stores the clinician's attestation for
--    case-report / case-series publication: written consent obtained, the
--    patient or representative saw the manuscript, the consent date, the
--    manuscript version it was confirmed against, and who confirmed it.
-- 2. Rows are append-only. Every POST /v1/projects/{id}/publication-consent
--    inserts a new row and writes one publication_consent_confirmed audit
--    event. The export and case_report_draft gates pass when ANY row exists.
-- 3. No patient-identifying content is stored: consent_date is a bare
--    YYYY-MM-DD calendar date and there is no free-text field.
-- 4. CREATE IF NOT EXISTS, so applying 0008 over the schema mirror is a
--    no-op. Run once on a live database that already has 0001 through 0007.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_publication_consents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  written_consent_obtained INTEGER NOT NULL CHECK(written_consent_obtained IN (0,1)),
  patient_saw_manuscript INTEGER NOT NULL CHECK(patient_saw_manuscript IN (0,1)),
  consent_date TEXT NOT NULL,
  manuscript_version INTEGER,
  signed_by TEXT NOT NULL,
  signed_at INTEGER NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_publication_consents_project
  ON research_publication_consents(project_id, created_ts DESC);
